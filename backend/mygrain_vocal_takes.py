import json
import math
import os
import pathlib
import re
import secrets
import threading
import time
import wave
from io import BytesIO
from urllib.parse import parse_qs, urlparse


TAKES_ROOT = pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-vocal-takes')
MAX_UPLOAD = 128 * 1024 * 1024
LIBRARY_LOCK = threading.RLock()


def clean_name(value):
    if not isinstance(value, str):
        raise ValueError('A name is required.')
    name = value.strip()
    if not name or len(name) > 100 or name in ('.', '..') or any(ord(character) < 32 or character in '/\\' for character in name):
        raise ValueError('Use 1–100 characters without slashes or control characters.')
    return name


def safe_path(*segments):
    root = TAKES_ROOT.absolute()
    if root.is_symlink():
        raise ValueError('Vocal storage cannot be a symbolic link.')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = root
    for segment in segments:
        if not re.fullmatch(r'[a-f0-9]{32}|library\.json|users|folders|deleted', segment):
            raise ValueError('Invalid storage identifier.')
        target = target / segment
        if target.is_symlink():
            raise ValueError('Symbolic links are not supported in vocal storage.')
    return target


def read_library():
    manifest = safe_path('library.json')
    if not manifest.exists():
        return {'version': 1, 'users': {}, 'takes': {}}
    with manifest.open(encoding='utf-8') as stream:
        return json.load(stream)


def write_library(library):
    target = safe_path('library.json')
    temporary = safe_path(secrets.token_hex(16))
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            os.chmod(temporary, 0o600)
            json.dump(library, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def public_library(library):
    users = sorted(library['users'].values(), key=lambda user: user['name'].casefold())
    takes = sorted(library['takes'].values(), key=lambda take: take['createdAt'], reverse=True)
    return {'ok': True, 'users': users, 'takes': takes, 'shared': True}


def checked_user(library, user_id):
    if user_id not in library['users']:
        raise FileNotFoundError('The selected user no longer exists. Refresh the library.')
    return library['users'][user_id]


def checked_folder(user, folder_id):
    if not isinstance(folder_id, str):
        raise ValueError('Choose a folder from this user’s area.')
    if folder_id and folder_id not in {folder['id'] for folder in user['folders']}:
        raise FileNotFoundError('The selected folder no longer exists. Refresh the library.')
    return folder_id


def take_path(take):
    segments = ['users', take['userId']]
    if take['folderId']:
        segments.extend(['folders', take['folderId']])
    folder = safe_path(*segments)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = folder / (take['id'] + '.wav')
    if target.is_symlink():
        raise ValueError('Symbolic links are not supported in vocal storage.')
    return target


def request_body(handler, maximum):
    try:
        length = int(handler.headers.get('Content-Length', '0'))
    except ValueError as error:
        raise ValueError('Invalid upload length.') from error
    if length <= 0 or length > maximum:
        raise ValueError(f'Request size must be between 1 and {maximum} bytes.')
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError('The upload was incomplete; nothing was saved.')
    return body


def request_json(handler):
    payload = json.loads(request_body(handler, 32 * 1024))
    if not isinstance(payload, dict):
        raise ValueError('Expected a JSON object.')
    return payload


def checked_wav(body):
    try:
        with wave.open(BytesIO(body), 'rb') as audio:
            channels = audio.getnchannels()
            rate = audio.getframerate()
            frames = audio.getnframes()
            width = audio.getsampwidth()
            if channels not in (1, 2) or not 8000 <= rate <= 192000 or width != 2 or audio.getcomptype() != 'NONE':
                raise ValueError('Save a mono or stereo 16-bit PCM WAV recording.')
            if not 0.02 < frames / rate <= 180:
                raise ValueError('Vocal takes must be longer than 0.02 seconds and at most 180 seconds.')
            if len(audio.readframes(frames)) != frames * channels * width:
                raise ValueError('The WAV recording is incomplete.')
            return {'channels': channels, 'sampleRate': rate, 'frames': frames, 'durationSeconds': frames / rate}
    except (wave.Error, EOFError) as error:
        raise ValueError('The recording is not a valid WAV file.') from error


def save_take(library, query, body):
    user_id = query.get('userId', [''])[0]
    user = checked_user(library, user_id)
    folder_id = checked_folder(user, query.get('folderId', [''])[0])
    name = clean_name(query.get('name', [''])[0])
    song_name = query.get('songName', ['none'])[0].strip() or 'none'
    if len(song_name) > 100 or any(ord(character) < 32 for character in song_name):
        raise ValueError('Song names must be at most 100 characters without control characters.')
    bpm = float(query.get('bpm', ['120'])[0])
    if not math.isfinite(bpm) or not 20 <= bpm <= 400:
        raise ValueError('Recording BPM must be between 20 and 400.')
    metadata = checked_wav(body)
    take = {'id': secrets.token_hex(16), 'userId': user_id, 'folderId': folder_id, 'name': name, 'songName': song_name, 'bpm': bpm, 'createdAt': time.time(), 'bytes': len(body), **metadata}
    target = take_path(take)
    try:
        with target.open('xb') as stream:
            os.chmod(target, 0o600)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        library['takes'][take['id']] = take
        write_library(library)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return take


def move_take(library, take, folder_id):
    checked_folder(checked_user(library, take['userId']), folder_id)
    if take['folderId'] == folder_id:
        return
    original = take_path(take)
    updated = {**take, 'folderId': folder_id}
    target = take_path(updated)
    os.replace(original, target)
    try:
        library['takes'][take['id']] = updated
        write_library(library)
    except Exception:
        os.replace(target, original)
        raise


def delete_take(library, take):
    original = take_path(take)
    deleted = safe_path('deleted')
    deleted.mkdir(exist_ok=True, mode=0o700)
    target = deleted / (take['id'] + '-' + secrets.token_hex(8) + '.wav')
    os.replace(original, target)
    try:
        del library['takes'][take['id']]
        write_library(library)
    except Exception:
        os.replace(target, original)
        raise


def handle_vocal_request(handler, method, inner_path):
    prefix = '/api/vocal-takes'
    if inner_path != prefix and not inner_path.startswith(prefix + '/'):
        return False
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
    try:
        if method != 'GET':
            origin = handler.headers.get('Origin')
            if handler.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and urlparse(origin).netloc != handler.headers.get('Host')):
                raise PermissionError('Vocal storage changes must come from this app.')
        segments = inner_path[len(prefix):].strip('/').split('/') if inner_path != prefix else []
        with LIBRARY_LOCK:
            library = read_library()
            if not segments and method == 'GET':
                handler.send_json(public_library(library), extra_headers=headers)
            elif segments == ['users'] and method == 'POST':
                name = clean_name(request_json(handler).get('name'))
                if any(user['name'].casefold() == name.casefold() for user in library['users'].values()):
                    raise ValueError('That user already exists. Choose them from the user list.')
                user = {'id': secrets.token_hex(16), 'name': name, 'folders': [], 'createdAt': time.time()}
                safe_path('users', user['id']).mkdir(parents=True, mode=0o700)
                library['users'][user['id']] = user
                write_library(library)
                handler.send_json({'ok': True, 'user': user}, status=201, extra_headers=headers)
            elif len(segments) == 3 and segments[0] == 'users' and segments[2] == 'folders' and method == 'POST':
                user = checked_user(library, segments[1])
                name = clean_name(request_json(handler).get('name'))
                if any(folder['name'].casefold() == name.casefold() for folder in user['folders']):
                    raise ValueError('That folder already exists for this user.')
                folder = {'id': secrets.token_hex(16), 'name': name}
                safe_path('users', user['id'], 'folders', folder['id']).mkdir(parents=True, mode=0o700)
                user['folders'].append(folder)
                write_library(library)
                handler.send_json({'ok': True, 'folder': folder}, status=201, extra_headers=headers)
            elif segments == ['takes'] and method == 'POST':
                query = parse_qs(urlparse(handler.path).query, keep_blank_values=True)
                take = save_take(library, query, request_body(handler, MAX_UPLOAD))
                handler.send_json({'ok': True, 'take': take}, status=201, extra_headers=headers)
            elif len(segments) == 3 and segments[0] == 'takes':
                take = library['takes'].get(segments[1])
                if not take:
                    raise FileNotFoundError('The take no longer exists. Refresh the browser.')
                action = segments[2]
                if action == 'audio' and method == 'GET':
                    with take_path(take).open('rb') as stream:
                        handler.send_response(200)
                        for key, value in headers.items():
                            handler.send_header(key, value)
                        handler.send_header('Content-Type', 'audio/wav')
                        handler.send_header('Content-Length', str(os.fstat(stream.fileno()).st_size))
                        handler.end_headers()
                        while chunk := stream.read(64 * 1024):
                            handler.wfile.write(chunk)
                elif action == 'rename' and method == 'POST':
                    take['name'] = clean_name(request_json(handler).get('name'))
                    write_library(library)
                    handler.send_json({'ok': True, 'take': take}, extra_headers=headers)
                elif action == 'move' and method == 'POST':
                    move_take(library, take, request_json(handler).get('folderId', ''))
                    handler.send_json({'ok': True}, extra_headers=headers)
                elif action == 'delete' and method == 'POST':
                    delete_take(library, take)
                    handler.send_json({'ok': True}, extra_headers=headers)
                else:
                    raise FileNotFoundError('Unknown vocal take action.')
            else:
                raise FileNotFoundError('Unknown vocal library endpoint.')
    except PermissionError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=403, extra_headers=headers)
    except FileNotFoundError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=404, extra_headers=headers)
    except (ValueError, TypeError, KeyError) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    except OSError:
        handler.send_json({'ok': False, 'error': 'Vocal storage is unavailable. The operation did not complete.'}, status=500, extra_headers=headers)
    return True
