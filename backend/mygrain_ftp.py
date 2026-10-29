"""MYGRAIN's account-private browser file area. No second password database."""
import ctypes
import errno
import hashlib
import json
import os
import pathlib
import re
import time
import secrets
import stat
import threading
import types
import subprocess
from contextlib import contextmanager
from urllib.parse import parse_qs, quote, urlsplit

ROOT = pathlib.Path('/srv/mygrain-ftp')
AUDIO_SUFFIXES = {'.wav', '.aif', '.aiff'}
DAW_MODULE = None
DAW_LOCK = threading.RLock()
MAX_UPLOAD = 1024 * 1024 * 1024
NO_CACHE = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
LIBC = ctypes.CDLL(None, use_errno=True)
RENAME = LIBC.renameat2
RENAME.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
RENAME.restype = ctypes.c_int


def parts(value):
    if not isinstance(value, str) or len(value.encode()) > 4096:
        raise ValueError('Invalid path.')
    if not value:
        return []
    result = value.split('/')
    if any(not name or name.startswith('.') or '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name) or len(os.fsencode(name)) > 255 for name in result):
        raise ValueError('Use normal file/folder names without hidden names or parent paths.')
    return result


def home(user):
    if not user or not isinstance(user.get('username'), str):
        raise ValueError('Login required.')
    name = user['username']
    if len(parts(name)) != 1 or '/' in name:
        raise ValueError('Invalid account.')
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if ROOT.is_symlink():
        raise ValueError('Invalid storage root.')
    result = ROOT / name
    if result.is_symlink():
        raise ValueError('Invalid account directory.')
    result.mkdir(mode=0o700, exist_ok=True)
    return result


@contextmanager
def directory(root, names):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in names:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


def version(s):
    return hashlib.sha256(repr((s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)).encode()).hexdigest()


def move(source, name, target, new_name):
    if RENAME(source, os.fsencode(name), target, os.fsencode(new_name), 1) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def regular(parent, name):
    s = os.stat(name, dir_fd=parent, follow_symlinks=False)
    if not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)):
        raise ValueError('Links and special files are not supported.')
    return s


def listing(root, path):
    names = parts(path)
    entries = []
    with directory(root, names) as fd:
        with os.scandir(fd) as scan:
            for item in scan:
                if item.name.startswith('.'):
                    continue
                s = item.stat(follow_symlinks=False)
                if not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)):
                    continue
                entries.append({'name': item.name, 'path': '/'.join(names + [item.name]), 'directory': stat.S_ISDIR(s.st_mode),
                                'size': s.st_size, 'modified': s.st_mtime, 'version': version(s),
                                'audio': stat.S_ISREG(s.st_mode) and pathlib.Path(item.name).suffix.lower() in AUDIO_SUFFIXES})
                if len(entries) > 5000:
                    raise ValueError('Too many entries in one folder; use subfolders.')
    return sorted(entries, key=lambda item: (not item['directory'], item['name'].casefold()))


def audio_paths(root, path='', depth=0):
    if depth > 32:
        raise ValueError('Folder nesting exceeds 32 levels.')
    result = []
    for item in listing(root, path):
        if item['directory']:
            result.extend(audio_paths(root, item['path'], depth + 1))
        elif item['audio']:
            result.append(item['path'])
        if len(result) > 256:
            raise ValueError('Choose a smaller folder (maximum 256 audio files per import).')
    return result


def upload(root, path, stream, length):
    names = parts(path)
    if not names or not 0 < length <= MAX_UPLOAD:
        raise ValueError('Choose a non-empty file up to 1 GiB.')
    with directory(root, names[:-1]) as fd:
        if os.statvfs(fd).f_bavail * os.statvfs(fd).f_frsize < length + 1024**3:
            raise ValueError('Not enough free storage; 1 GiB is reserved.')
        temporary = '.upload-' + secrets.token_hex(16)
        handle = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        try:
            with os.fdopen(handle, 'wb') as output:
                remaining = length
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError('Upload interrupted; original files unchanged.')
                    output.write(chunk)
                    remaining -= len(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.link(temporary, names[-1], src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
            os.fsync(fd)
        finally:
            os.unlink(temporary, dir_fd=fd)


@contextmanager
def trash_directory(root):
    with directory(root, []) as fd:
        try:
            os.mkdir('.trash', mode=0o700, dir_fd=fd)
        except FileExistsError:
            pass
        with directory(root, ['.trash']) as trash:
            yield trash


def trash_info(fd, identifier, info):
    if not re.fullmatch(r'[a-f0-9]{32}-.+', identifier) or len(parts(identifier)) != 1:
        raise ValueError('Invalid trash item.')
    original = identifier[33:]
    deleted = info.st_mtime
    try:
        meta = os.open('.' + identifier[:32] + '.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(meta, 'r') as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise ValueError('Invalid trash metadata.')
            data = json.loads(source.read(65536))
        original = data['path']
        deleted = data['deleted']
        if not parts(original):
            raise ValueError('Invalid original path.')
    except FileNotFoundError:
        pass  # Existing recovery items from before the Trash UI remain restorable.
    return {'id': identifier, 'name': parts(original)[-1], 'originalPath': original,
            'deleted': deleted, 'directory': stat.S_ISDIR(info.st_mode), 'size': info.st_size,
            'version': version(info)}


def trash_listing(root):
    entries = []
    with trash_directory(root) as fd:
        for name in os.listdir(fd):
            if name.startswith('.'):
                continue
            info = regular(fd, name)
            entries.append(trash_info(fd, name, info))
            if len(entries) > 5000:
                raise ValueError('Too many trash items.')
    return sorted(entries, key=lambda item: item['deleted'], reverse=True)


def restore(root, payload):
    identifier = payload.get('id')
    if not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{32}-.+', identifier) or len(parts(identifier)) != 1:
        raise ValueError('Invalid trash item.')
    with trash_directory(root) as fd:
        info = regular(fd, identifier)
        if payload.get('version') != version(info):
            raise ValueError('This trash item changed. Refresh before trying again.')
        entry = trash_info(fd, identifier, info)
        target = parts(entry['originalPath'])
        try:
            with directory(root, target[:-1]) as destination:
                move(fd, identifier, destination, target[-1])
        except FileNotFoundError:
            # If the original parent was removed, recover safely into the private home.
            target = [target[-1]]
            with directory(root, []) as destination:
                move(fd, identifier, destination, target[-1])
        try:
            os.unlink('.' + identifier[:32] + '.json', dir_fd=fd)
        except FileNotFoundError:
            pass
    return '/'.join(target)


def mutate(root, action, payload):
    names = parts(payload.get('path', ''))
    if action == 'mkdir':
        if not names:
            raise ValueError('Provide a new folder name.')
        with directory(root, names[:-1]) as fd:
            os.mkdir(names[-1], mode=0o700, dir_fd=fd)
        return
    if not names:
        raise ValueError('The user home cannot be moved or deleted.')
    with directory(root, names[:-1]) as source:
        s = regular(source, names[-1])
        if payload.get('version') != version(s):
            raise ValueError('This item changed. Refresh before trying again.')
        if action == 'move':
            target = parts(payload.get('to'))
            if not target or target[:len(names)] == names:
                raise ValueError('Choose a different destination outside the source folder.')
            with directory(root, target[:-1]) as destination:
                move(source, names[-1], destination, target[-1])
        elif action == 'delete':
            with trash_directory(root) as trash:
                token = secrets.token_hex(16)
                metadata = '.' + token + '.json'
                fd = os.open(metadata, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=trash)
                try:
                    with os.fdopen(fd, 'w') as output:
                        json.dump({'path': '/'.join(names), 'deleted': time.time()}, output)
                        output.flush()
                        os.fsync(output.fileno())
                    move(source, names[-1], trash, token + '-' + names[-1].encode('utf-8')[:150].decode('utf-8', 'ignore'))
                except Exception:
                    os.unlink(metadata, dir_fd=trash)
                    raise

        else:
            raise ValueError('Unknown operation.')


def read_audio(root, path):
    names = parts(path)
    if not names or pathlib.Path(names[-1]).suffix.lower() not in AUDIO_SUFFIXES:
        raise ValueError('Choose a WAV / AIF / AIFF file.')
    with directory(root, names[:-1]) as parent:
        fd = os.open(names[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 64 * 1024 * 1024:
                raise ValueError('Loop source files must be regular audio files up to 64 MiB.')
            body = source.read()
    if pathlib.Path(names[-1]).suffix.lower() != '.wav':
        result = subprocess.run(['ffmpeg', '-v', 'error', '-protocol_whitelist', 'pipe', '-f', 'aiff', '-i', 'pipe:0', '-t', '181',
                                 '-ac', '2', '-ar', '44100', '-f', 'wav', '-acodec', 'pcm_s16le', 'pipe:1'],
                                input=body, capture_output=True, timeout=30)
        if result.returncode or len(result.stdout) > 180 * 44100 * 4 + 1024:
            raise ValueError('AIFF decoding failed or the source exceeds 180 seconds.')
        body = result.stdout
    return body


def handle(handler, user, accounts):
    parsed = urlsplit(handler.path)
    prefix = '/api/ftp/'
    action = parsed.path.split(prefix, 1)[1]
    query = parse_qs(parsed.query, keep_blank_values=True)
    if any(len(values) != 1 for values in query.values()):
        raise ValueError('Duplicate query parameters.')
    path = query.get('path', [''])[0]
    root = home(user)
    try:
        if action.startswith('daw-'):
            global DAW_MODULE
            with DAW_LOCK:
                if DAW_MODULE is None:
                    import importlib.util
                    spec = importlib.util.spec_from_file_location('mygrain_private_daw', pathlib.Path(__file__).with_name('mygrain_daw.py'))
                    DAW_MODULE = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(DAW_MODULE)
            api = types.SimpleNamespace(home=home, parts=parts, directory=directory, upload=upload, NO_CACHE=NO_CACHE)
            return DAW_MODULE.handle(handler, user, accounts, api, action, query)
        if handler.command in ('GET', 'HEAD') and action == 'trash':
            return handler.send_json({'ok': True, 'entries': trash_listing(root)}, extra_headers=NO_CACHE)
        if handler.command == 'POST' and action == 'restore':
            payload = handler.read_json()
            if not isinstance(payload, dict):
                raise ValueError('Expected restore operation.')
            return handler.send_json({'ok': True, 'path': restore(root, payload)}, extra_headers=NO_CACHE)
        if handler.command in ('GET', 'HEAD') and action in ('list', 'audio'):
            if action == 'list':
                with trash_directory(root):
                    pass
            payload = {'ok': True, 'username': user['username'], 'path': path}
            payload['entries' if action == 'list' else 'paths'] = listing(root, path) if action == 'list' else audio_paths(root, path)
            return handler.send_json(payload, extra_headers=NO_CACHE)
        if handler.command in ('GET', 'HEAD') and action == 'audio-file':
            return handler.send_mygrain_bytes(read_audio(root, path), 'audio/wav')
        if handler.command in ('GET', 'HEAD') and action == 'file':
            names = parts(path)
            if not names:
                raise ValueError('Choose a file.')
            with directory(root, names[:-1]) as parent:
                fd = os.open(names[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                with os.fdopen(fd, 'rb') as source:
                    s = os.fstat(source.fileno())
                    if not stat.S_ISREG(s.st_mode):
                        raise ValueError('Choose a regular file.')
                    handler.send_response(200)
                    handler.send_header('Content-Type', 'application/octet-stream')
                    handler.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(names[-1], safe=''))
                    handler.send_header('Content-Length', str(s.st_size))
                    for key, value in NO_CACHE.items():
                        handler.send_header(key, value)
                    handler.end_headers()
                    if handler.command != 'HEAD':
                        while chunk := source.read(1024 * 1024):
                            handler.wfile.write(chunk)
            return
        if handler.command == 'POST' and action == 'upload':
            handler.connection.settimeout(120)
            upload(root, path, handler.rfile, int(handler.headers.get('Content-Length', 0)))
            return handler.send_json({'ok': True}, status=201, extra_headers=NO_CACHE)
        if handler.command == 'POST' and action in ('mkdir', 'move', 'delete'):
            payload = handler.read_json()
            if not isinstance(payload, dict):
                raise ValueError('Expected file operation.')
            mutate(root, action, payload)
            return handler.send_json({'ok': True}, extra_headers=NO_CACHE)
        raise ValueError('Unknown file operation.')
    except FileExistsError:
        return handler.send_json({'ok': False, 'error': 'That name already exists. Nothing was overwritten.'}, status=409, extra_headers=NO_CACHE)
    except FileNotFoundError:
        return handler.send_json({'ok': False, 'error': 'File or folder not found. Refresh and retry.'}, status=404, extra_headers=NO_CACHE)
