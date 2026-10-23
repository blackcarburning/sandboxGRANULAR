import math
import hashlib
import copy
import fcntl
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import threading
import time
import wave
import zipfile
from io import BytesIO
from collections import OrderedDict
from contextlib import contextmanager
from urllib.parse import parse_qs, unquote, urlparse


SONGS_ROOT = pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-songs')
MAX_UPLOAD = 128 * 1024 * 1024
MAX_PARTS = 64
SONG_LOCK = threading.RLock()
EDIT_LEASE_SECONDS = 600
ACCOUNT_IDENTITY = lambda: None
PART_MANIFEST_CACHE = OrderedDict()
PART_MANIFEST_CACHE_LOCK = threading.Lock()
PART_MANIFEST_CACHE_BYTES = 8 * 1024 * 1024
SERVER_ARM_MODULE = None
SERVER_ARM_MODULE_LOCK = threading.Lock()
K_CONVERSION_LOCK = threading.Lock()
K_CONVERSION_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'convert-k-snapshot.cjs'


def server_arm_module():
    global SERVER_ARM_MODULE
    if SERVER_ARM_MODULE is None:
        # Song locks are account-scoped; simultaneous accounts must still share
        # one queue/executor, including the very first capability request.
        with SERVER_ARM_MODULE_LOCK:
            if SERVER_ARM_MODULE is None:
                import importlib.util
                spec = importlib.util.spec_from_file_location('mygrain_server_arm', pathlib.Path(__file__).with_name('mygrain_server_arm.py'))
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                SERVER_ARM_MODULE = module
    return SERVER_ARM_MODULE


def convert_k_snapshot(snapshot):
    """Use the canonical, bounded server migration without decoding any audio."""
    if not shutil.which('node') or not K_CONVERSION_SCRIPT.is_file():
        raise ValueError('Server K conversion is unavailable. No saved part was changed.')
    try:
        result = subprocess.run(['node', '--max-old-space-size=128', str(K_CONVERSION_SCRIPT)],
            input=json.dumps(snapshot), text=True, capture_output=True, timeout=15)
    except subprocess.TimeoutExpired:
        raise ValueError('Server K conversion timed out. No saved part was changed.') from None
    if result.returncode:
        raise ValueError('Server K conversion failed: ' + result.stderr.strip()[:500])
    converted = json_object(json.loads(result.stdout))
    if json_object(converted.get('snapshot')).get('assets') != snapshot['assets']:
        raise ValueError('K conversion attempted to change recorded audio. Nothing was saved.')
    return converted


def convert_song_k(folder, original, edit_headers):
    """Stage metadata-only K conversions; commit the whole Song in one revision.

    The canonical JS migration runs on the server. WAV entries are streamed
    unchanged, old archives remain in history, and no browser/source decode is
    involved. The account/storage lock is already held by the route.
    """
    if not shutil.which('node') or not K_CONVERSION_SCRIPT.is_file():
        raise ValueError('Server K conversion is unavailable. No saved part was changed.')
    with K_CONVERSION_LOCK:
        song = copy.deepcopy(original)
        used = {part.get('sourcePartId', part['id']) for part in song['parts']}
        sources = [part for part in song['parts'] + song.get('sharedParts', [])
                   if 'sourcePartId' not in part and part['id'] in used]
        staged, published = [], []
        committed = False
        try:
            for part in sources:
                record = read_part_manifest_record(folder, part)
                snapshot = record['snapshot']
                expected_audio = {asset['path']: asset['sha256'] for asset in record['audioAssets']}
                converted = convert_k_snapshot(snapshot)
                if converted.get('changed') is not True:
                    continue
                updated_snapshot = json_object(converted.get('snapshot'))
                if updated_snapshot.get('assets') != snapshot['assets']:
                    raise ValueError('K conversion attempted to change recorded audio. Nothing was saved.')
                filename = f'{part["id"]}-{secrets.token_hex(16)}.zip'
                temporary = folder / 'parts' / f'.convert-k-{secrets.token_hex(16)}.tmp'
                staged.append((temporary, folder / 'parts' / filename))
                with zipfile.ZipFile(folder / 'parts' / part.get('archive', f'{part["id"]}.zip')) as source, \
                     zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED) as target:
                    for entry in source.infolist():
                        if entry.filename == 'song-part.json':
                            target.writestr(copy.copy(entry), json.dumps(updated_snapshot, separators=(',', ':')).encode())
                        else:
                            with source.open(entry) as incoming, target.open(copy.copy(entry), 'w') as outgoing:
                                audio_hash = hashlib.sha256()
                                for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                                    audio_hash.update(chunk)
                                    outgoing.write(chunk)
                                if audio_hash.hexdigest() != expected_audio.get(entry.filename):
                                    raise ValueError('Recorded audio changed during conversion. No saved part was changed.')
                with temporary.open('rb') as saved:
                    os.fsync(saved.fileno())
                body = temporary.read_bytes()
                if len(body) > MAX_UPLOAD:
                    raise ValueError('Converted part exceeds the 128 MB saved-part limit. No saved part was changed.')
                details = validate_part_zip(body)
                digest, length = hashlib.sha256(body).hexdigest(), len(body)
                del body
                song.setdefault('history', []).append(copy.deepcopy(part))
                old_digest = part['sha256']
                part.update(details, sha256=digest, bytes=length, archive=filename,
                            revision=part.get('revision', 1) + 1, updatedAt=time.time())
                if 'qVersion' not in details:
                    part.pop('qVersion', None)
                # This migration is exclusively metadata: all source WAVs and
                # the old mix still sound the same; retain their exact PCM.
                if part.get('render', {}).get('sourceSha256') == old_digest:
                    part['render'] = {**part['render'], 'sourceSha256': digest}
                else:
                    part.pop('render', None)
            if not staged:
                return original, 0
            require_song_editor(folder, original, edit_headers)
            for temporary, destination in staged:
                # Never replace an existing source or cache file, even on failure.
                os.link(temporary, destination)
                published.append(destination)
                temporary.unlink()
            write_song(folder, song, edit_headers=edit_headers)
            committed = True
            return song, len(staged)
        finally:
            for temporary, _ in staged:
                temporary.unlink(missing_ok=True)
            if not committed:
                for destination in published:
                    destination.unlink(missing_ok=True)


class PartConflictError(ValueError):
    pass


class SongEditError(ValueError):
    def __init__(self, message, status=423, code='SONG_LOCK_REQUIRED', lock=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.lock = lock


@contextmanager
def song_storage_lock():
    with SONG_LOCK:
        SONGS_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (SONGS_ROOT / '.storage.lock').open('a') as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)


def read_edit_lock(folder):
    path = folder / '.edit-lock.json'
    if not path.exists():
        return None
    lock = json.loads(path.read_text())
    return lock if lock['expiresAt'] > time.time() else None


def public_edit_lock(lock):
    return {'label': lock['label'], 'expiresAt': lock['expiresAt'],
            'recoveryId': hashlib.sha256(('mygrain-song-recovery:' + lock['tokenHash']).encode('ascii')).hexdigest()} if lock else None


def write_edit_lock(folder, lock):
    temporary = folder / f'.lock-{secrets.token_hex(8)}.tmp'
    try:
        with temporary.open('x', encoding='utf-8') as output:
            json.dump(lock, output)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(folder / '.edit-lock.json')
    finally:
        temporary.unlink(missing_ok=True)


def matches_edit_lock(lock, headers):
    token = headers.get('X-Mygrain-Song-Lock', '')
    return bool(lock and re.fullmatch(r'[a-f0-9]{64}', token)
                and secrets.compare_digest(lock['tokenHash'], hashlib.sha256(token.encode('ascii')).hexdigest())
                and lock['sessionId'] == headers.get('X-Mygrain-Song-Session')
                and lock['deviceId'] == headers.get('X-Mygrain-Song-Device'))


def check_song_revision(song, headers):
    if headers.get('If-Match') != f'"{song.get("revision", 1)}"':
        raise SongEditError('This song changed on the server. Refresh Songs before editing; your live pattern has not been discarded.', 409, 'SONG_REVISION_CONFLICT')


def require_song_editor(folder, song, headers):
    lock = read_edit_lock(folder)
    if not matches_edit_lock(lock, headers):
        raise SongEditError('This song is read-only. Use Edit Song to obtain a current editing lock.', lock=public_edit_lock(lock))
    check_song_revision(song, headers)


def handle_edit_lock(handler, folder, song, action):
    lock = read_edit_lock(folder)
    token = None
    if action in ('acquire', 'recover'):
        if lock and action == 'acquire':
            raise SongEditError(f'This song is being edited on {lock["label"]}. Playback is still available.', code='SONG_LOCKED', lock=public_edit_lock(lock))
        payload = json_object(handler.read_json())
        for field in ('deviceId', 'sessionId'):
            if not isinstance(payload.get(field), str) or not re.fullmatch(r'[a-f0-9]{32}', payload[field]):
                raise ValueError('A valid browser installation and editing session are required.')
        label = clean_name(payload.get('label'))
        check_song_revision(song, handler.headers)
        if action == 'recover':
            expected = payload.get('recoveryId')
            if not lock or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected) or not secrets.compare_digest(expected, public_edit_lock(lock)['recoveryId']):
                raise SongEditError('The editing lock changed. Check the current lock before recovering it.', code='SONG_LOCK_CHANGED', lock=public_edit_lock(lock))
            if label.lower() != lock['label'].strip().lower():
                raise SongEditError('Only a lock with the same device name can be cleared here.', code='SONG_LOCK_NAME_MISMATCH', lock=public_edit_lock(lock))
        token = secrets.token_hex(32)
        lock = {**{field: payload[field] for field in ('deviceId', 'sessionId')}, 'label': label,
                'tokenHash': hashlib.sha256(token.encode('ascii')).hexdigest(), 'expiresAt': time.time() + EDIT_LEASE_SECONDS}
        write_edit_lock(folder, lock)
    elif action in ('renew', 'release'):
        if not matches_edit_lock(lock, handler.headers):
            raise SongEditError('Your editing lock expired or belongs to another session. Refresh Songs and use Edit Song again.', code='SONG_LOCK_LOST', lock=public_edit_lock(lock))
        if action == 'release':
            (folder / '.edit-lock.json').unlink(missing_ok=True)
            lock = None
        else:
            lock['expiresAt'] = time.time() + EDIT_LEASE_SECONDS
            write_edit_lock(folder, lock)
    else:
        raise FileNotFoundError('Song endpoint not found.')
    return {'ok': True, 'lock': public_edit_lock(lock), 'serverTime': time.time(), 'leaseSeconds': EDIT_LEASE_SECONDS,
            **({'token': token, 'song': public_song(song)} if token else {})}


def owner_hash(headers):
    account = ACCOUNT_IDENTITY()
    if account is not None:
        return hashlib.sha256(f'mygrain-account:{account["id"]}'.encode('ascii')).hexdigest()
    key = headers.get('X-Mygrain-Song-Key', '')
    if not re.fullmatch(r'[a-f0-9]{64}', key):
        raise PermissionError('A song-library key is required.')
    return hashlib.sha256(key.encode('ascii')).hexdigest()


def clean_name(value):
    name = str(value or '').strip()
    if not name or len(name) > 100 or any(ord(character) < 32 for character in name):
        raise ValueError('Use a name between 1 and 100 characters.')
    return name


def json_object(value):
    if not isinstance(value, dict):
        raise ValueError('Expected a JSON object.')
    return value


def checked_repeats(value):
    if isinstance(value, bool) or not re.fullmatch(r'\d{1,2}', str(value)):
        raise ValueError('Pattern repeats must be a whole number from 1 to 64.')
    repeats = int(value)
    if not 1 <= repeats <= 64:
        raise ValueError('Pattern repeats must be a whole number from 1 to 64.')
    return repeats


def full_pattern_steps(part):
    return part['patternSteps'] * part.get('patternCycleMultiplier', 1)


def checked_playback_steps(value, source):
    if type(value) is not int or not 1 <= value <= full_pattern_steps(source):
        raise ValueError(f'Part steps must be a whole number from 1 to {full_pattern_steps(source)}.')
    return value


def checked_colour(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r'#[a-fA-F0-9]{6}', value):
        raise ValueError('Choose a six-digit hex colour or clear the colour.')
    return value.lower()


def song_path(song_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}-[a-f0-9]{8}', song_id):
        raise ValueError('Invalid song ID.')
    path = SONGS_ROOT / song_id
    if path.is_symlink() or path.resolve().parent != SONGS_ROOT.resolve():
        raise ValueError('Invalid song path.')
    return path


def read_song(song_id, owner):
    folder = song_path(song_id)
    manifest_path = folder / 'song.json'
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise FileNotFoundError('Song not found.')
    song = json.loads(manifest_path.read_text())
    account = ACCOUNT_IDENTITY()
    if not (account is not None and account['is_admin']) and not secrets.compare_digest(song.get('ownerHash', ''), owner):
        raise FileNotFoundError('Song not found.')
    song.setdefault('revision', 1)
    return folder, song


def source_part(song, part):
    source_id = part.get('sourcePartId', part['id'])
    source = next((entry for entry in song['parts'] + song.get('sharedParts', []) if entry['id'] == source_id and 'sourcePartId' not in entry), None)
    if source is None:
        raise ValueError('The reused part source is unavailable.')
    return source


def public_song(song):
    result = {key: value for key, value in song.items() if key not in ('ownerHash', 'deletedParts', 'history', 'sharedParts')}
    result['parts'] = []
    for part in song['parts']:
        source = source_part(song, part)
        merged = {**source, **part}
        # Playback cuts belong to occurrences, never inherited from the source.
        if 'playbackSteps' in source or 'playbackSteps' in part:
            merged['playbackSteps'] = part.get('playbackSteps', full_pattern_steps(source))
        result['parts'].append(merged)
    result['revision'] = song.get('revision', 1)
    return result


def upload_body(handler):
    length = int(handler.headers.get('Content-Length', '0'))
    if not 1 <= length <= MAX_UPLOAD:
        raise ValueError('Upload must be between 1 byte and 128 MB.')
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError('Upload was interrupted.')
    return body


def publish_asset(folder, song, filename, body, edit_headers=None, advance_revision=True):
    destination = folder / 'parts' / filename
    temporary = destination.with_suffix(f'.{secrets.token_hex(8)}.tmp')
    existed = destination.exists()
    try:
        with temporary.open('xb') as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(destination)
        write_song(folder, song, edit_headers=edit_headers, advance_revision=advance_revision)
    except Exception:
        if not existed:
            destination.unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)


def read_part_manifest_record(folder, part):
    # Cache only small JSON, never original/decoded audio. File identity and the
    # exact source hash prevent reuse across amendments, accounts or file edits.
    filename = part.get('archive', f'{part["id"]}.zip')
    if not re.fullmatch(r'[a-f0-9-]+\.zip', filename):
        raise ValueError('Invalid part asset.')
    path = folder / 'parts' / filename
    if path.is_symlink() or not path.is_file():
        raise FileNotFoundError('Part asset not found.')
    stat = path.stat()
    if not 1 <= stat.st_size <= MAX_UPLOAD:
        raise ValueError('Invalid saved part size.')
    identity = (str(path.resolve()), part['sha256'], stat.st_dev, stat.st_ino,
                stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    with PART_MANIFEST_CACHE_LOCK:
        cached = PART_MANIFEST_CACHE.get(identity)
        if cached is not None:
            PART_MANIFEST_CACHE.move_to_end(identity)
    if cached is not None:
        return json.loads(cached)
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != part['sha256']:
        raise ValueError('Saved part integrity check failed. No audio was prepared.')
    # Keep full archive/audio validation on the server before allowing a client
    # to trust metadata in place of downloading and inspecting the entire ZIP.
    validate_part_zip(body)
    with zipfile.ZipFile(BytesIO(body)) as archive:
        snapshot = json.loads(archive.read('song-part.json'))
        audio_assets = []
        for asset in snapshot['assets']:
            audio = archive.read(asset['path'])
            audio_assets.append({'key': asset['key'], 'path': asset['path'],
                                 'bytes': len(audio), 'sha256': hashlib.sha256(audio).hexdigest(),
                                 'pcm16': (audio[12:20] == b'fmt \x10\0\0\0' and audio[20:22] == b'\x01\0'
                                           and audio[34:38] == b'\x10\0da' and audio[36:40] == b'data'
                                           and len(audio) == 44 + int.from_bytes(audio[40:44], 'little'))})
        snapshot = json.dumps({'snapshot': snapshot, 'audioAssets': audio_assets}, separators=(',', ':')).encode('utf-8')
    after = path.stat()
    if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != identity[2:]:
        raise PartConflictError('The saved part changed during inspection. Refresh Songs and arm again.')
    with PART_MANIFEST_CACHE_LOCK:
        PART_MANIFEST_CACHE[identity] = snapshot
        PART_MANIFEST_CACHE.move_to_end(identity)
        while PART_MANIFEST_CACHE and (len(PART_MANIFEST_CACHE) > 64
                or sum(map(len, PART_MANIFEST_CACHE.values())) > PART_MANIFEST_CACHE_BYTES):
            PART_MANIFEST_CACHE.popitem(last=False)
    return json.loads(snapshot)


def read_part_manifest(folder, part):
    return read_part_manifest_record(folder, part)['snapshot']


def read_part_audio(folder, part, key):
    # Resolve only a validated manifest key, never a caller-supplied ZIP path.
    record = read_part_manifest_record(folder, part)
    asset = next((asset for asset in record['audioAssets'] if asset['key'] == key), None)
    if asset is None:
        raise FileNotFoundError('Saved sound not found.')
    filename = part.get('archive', f'{part["id"]}.zip')
    with zipfile.ZipFile(folder / 'parts' / filename) as archive:
        body = archive.read(asset['path'])
    if len(body) != asset['bytes'] or hashlib.sha256(body).hexdigest() != asset['sha256']:
        raise ValueError('Saved sound integrity check failed. No audio was prepared.')
    return body


def send_asset(handler, folder, filename, content_type):
    if not re.fullmatch(r'[a-f0-9-]+\.(zip|wav)', filename):
        raise ValueError('Invalid part asset.')
    source_path = folder / 'parts' / filename
    if source_path.is_symlink() or not source_path.is_file():
        raise FileNotFoundError('Part asset not found.')
    handler.send_response(200)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(source_path.stat().st_size))
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    with source_path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            handler.wfile.write(chunk)


def full_copy_part(folder, song, occurrence, part, edit_headers):
    if len(song['parts']) >= MAX_PARTS:
        raise ValueError('The beta supports up to 64 parts per song.')

    def checked_asset(filename, digest, extension):
        if not re.fullmatch(r'[a-f0-9-]+\.' + extension, filename):
            raise ValueError('Invalid copied part asset.')
        path = folder / 'parts' / filename
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_UPLOAD:
            raise ValueError('The saved part asset is unavailable or too large.')
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != digest:
            raise ValueError('Saved part integrity check failed. No copy was created.')
        return body

    archive = checked_asset(part.get('archive', f'{part["id"]}.zip'), part['sha256'], 'zip')
    details = validate_part_zip(archive)
    part_id = secrets.token_hex(16)
    suffix = '_full_copy'
    copied = {**copy.deepcopy(part), **details, 'id': part_id,
              'name': part['name'][:100 - len(suffix)] + suffix, 'repeats': occurrence['repeats'],
              'createdAt': time.time(), 'revision': 1, 'archive': f'{part_id}.zip', 'bytes': len(archive)}
    for field in ('sourcePartId', 'updatedAt', 'render'):
        copied.pop(field, None)
    copied.pop('playbackSteps', None)
    if 'playbackSteps' in occurrence:
        copied['playbackSteps'] = checked_playback_steps(occurrence['playbackSteps'], part)
    assets = {copied['archive']: archive}
    render = part.get('render')
    if render and render.get('sourceSha256') == part['sha256']:
        body = checked_asset(render['file'], render['sha256'], 'wav')
        validate_render(body, copied)
        filename = f'{part_id}-{render["sha256"]}.wav'
        copied['render'] = {**copy.deepcopy(render), 'file': filename}
        assets[filename] = body
    published = []
    temporary = None
    owns_temporary = False
    try:
        for filename, body in assets.items():
            destination = folder / 'parts' / filename
            if destination.exists() or destination.is_symlink():
                raise ValueError('Copy identity collision. Try again.')
            temporary = folder / 'parts' / f'.full-copy-{secrets.token_hex(8)}.tmp'
            with temporary.open('xb') as output:
                owns_temporary = True
                output.write(body)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(destination)
            owns_temporary = False
            published.append(destination)
        song['parts'].append(copied)
        write_song(folder, song, edit_headers=edit_headers)
    except Exception:
        for path in published:
            path.unlink(missing_ok=True)
        raise
    finally:
        if temporary is not None and owns_temporary:
            temporary.unlink(missing_ok=True)
    return copied


def validate_render(body, part):
    with wave.open(BytesIO(body), 'rb') as audio:
        frames = audio.getnframes()
        rate = audio.getframerate()
        duration = 60 / part['bpm'] * part['patternSteps'] / 4 * part.get('patternCycleMultiplier', 1)
        if audio.getnchannels() != 2 or audio.getsampwidth() != 2 or not 8000 <= rate <= 192000 or abs(frames - round(duration * rate)) > 1:
            raise ValueError('Song render must be stereo PCM16 and exactly one saved pattern long.')
        if len(audio.readframes(frames)) != frames * 4:
            raise ValueError('Song render is truncated.')
    return {'frames': frames, 'sampleRate': rate, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'sourceSha256': part['sha256'], 'version': 1}


def write_song(folder, song, edit_headers=None, advance_revision=True):
    if edit_headers is not None:
        require_song_editor(folder, song, edit_headers)
    if advance_revision:
        song['revision'] = song.get('revision', 0) + 1
    temporary = folder / f'.song-{secrets.token_hex(8)}.tmp'
    try:
        with temporary.open('x', encoding='utf-8') as output:
            json.dump(song, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(folder / 'song.json')
    finally:
        temporary.unlink(missing_ok=True)


def validate_q_piano(state, assets):
    piano = state.get('q')
    asset = next((item for item in assets if item.get('key') == 'bastardQ'), None)
    if piano is None:
        if asset:
            raise ValueError('Q piano audio has no saved settings.')
        return False
    if not isinstance(piano, dict) or type(piano.get('version')) is not int or piano['version'] != 1:
        raise ValueError('Unsupported Q piano version.')
    instrument = piano.get('instrument', 'piano')
    if instrument not in ('piano', 'strings'):
        raise ValueError('Unsupported Q instrument.')
    string_sections = {'cello': [36, 40, 43, 47], 'viola': [48, 50, 52, 55, 59, 62],
                       'violin': [66, 69, 72, 76, 79, 83, 86]}
    string_roots = [pitch for section in string_sections.values() for pitch in section]
    expected_bank = 'vsco2-ce-q-strings-2layer-44100-v1' if instrument == 'strings' else 'salamander-v3-q-4layer-44100-v1'
    for key, minimum, maximum, default in [('room', 0, 1, 0), ('delay', 0, 1, 0), ('feedback', 0, .8, .32), ('delayBeats', 1 / 12, 6, .5)]:
        value = piano.get(key, default)
        if type(value) not in (int, float) or not minimum <= value <= maximum:
            raise ValueError('Invalid Q piano effect setting.')
    if 'chordHold' in piano and type(piano['chordHold']) is not bool:
        raise ValueError('Invalid Q chord hold flag.')
    if 'arpEnabled' in piano and type(piano['arpEnabled']) is not bool:
        raise ValueError('Invalid Q arpeggiator enabled flag.')
    if piano.get('arpPattern', 'up') not in ('up', 'down', 'updown', 'odds', 'evens', 'custom') or piano.get('arpRepeat', 'once') not in ('once', 'until-next'):
        raise ValueError('Invalid Q arpeggiator order or repeat mode.')
    if 'performanceVersion' in piano and (type(piano['performanceVersion']) is not int or piano['performanceVersion'] != 6):
        raise ValueError('Unsupported Q performance version.')
    for key in ('sampleLength', 'sampleDecay'):
        value = piano.get(key, 1)
        if type(value) not in (int, float) or not .05 <= value <= 1:
            raise ValueError('Invalid Q sample length or decay.')
    arp_steps = piano.get('arpSteps')
    if 'arpSteps' in piano or piano.get('arpPattern') == 'custom':
        if not isinstance(arp_steps, list) or not 1 <= len(arp_steps) <= 32 or any(type(rank) is not int or not 0 <= rank <= 8 for rank in arp_steps):
            raise ValueError('Invalid Q custom arp pulses.')
    division = piano.get('arpDivision', .25)
    if type(division) not in (int, float) or not .03125 <= division <= 4:
        raise ValueError('Invalid Q arpeggiator time division.')
    sequence = piano.get('sequence')
    if not isinstance(sequence, list) or len(sequence) != 64:
        raise ValueError('Q piano sequence is incomplete.')
    for step in sequence:
        if step is None:
            continue
        if isinstance(step, dict) and step.get('kind') == 'accent' and step.get('notes') == [] and step.get('accent') is True and step.get('rest') is not True:
            continue
        if not isinstance(step, dict) or not isinstance(step.get('notes'), list) or not 1 <= len(step['notes']) <= 8 or any(type(note) is not int or not 21 <= note <= 108 for note in step['notes']):
            raise ValueError('Invalid Q chord notes.')
        if type(step.get('velocity')) is not int or not 1 <= step['velocity'] <= 127 or not isinstance(step.get('gate'), (int, float)) or not .1 <= step['gate'] <= 64:
            raise ValueError('Invalid Q chord velocity or length.')
    bank = piano.get('bank')
    if not any(step and step.get('notes') and not step.get('rest') for step in sequence) and not bank and not asset:
        return False
    if not isinstance(bank, dict) or bank.get('version') != 1 or not asset or asset.get('channels') != 2 or bank.get('sampleRate') != asset.get('sampleRate'):
        raise ValueError('Q piano bank is incomplete.')
    if bank.get('instrument', 'salamander-v3-q-4layer-44100-v1') != expected_bank:
        raise ValueError('Q instrument and sample bank do not match.')
    samples = bank.get('samples')
    if not isinstance(samples, list) or not 1 <= len(samples) <= (34 if instrument == 'strings' else 120):
        raise ValueError('Q sample inventory is incomplete.')
    identities = set()
    previous_end = 0
    for sample in samples:
        if not isinstance(sample, dict):
            raise ValueError('Invalid Q sample.')
        match = re.fullmatch(r'(cello|viola|violin)(\d{2})v(32|96)' if instrument == 'strings' else r'([A-G])(s?)(\d)v(4|8|12|16)', str(sample.get('id', '')))
        if not match or sample['id'] in identities:
            raise ValueError('Invalid or duplicate Q sample identity.')
        if instrument == 'strings':
            midi, velocity = int(match[2]), int(match[3])
            if midi not in string_sections[match[1]]:
                raise ValueError('Invalid Q string section mapping.')
            if any(type(sample.get(key)) is not int for key in ('loopStart', 'loopEnd', 'frames')) or not 0 < sample['loopStart'] < sample['loopEnd'] <= sample['frames']:
                raise ValueError('Invalid Q string sustain loop.')
        else:
            midi = (int(match[3]) + 1) * 12 + {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[match[1]] + bool(match[2])
            velocity = round(int(match[4]) / 16 * 127)
        if sample.get('midi') != midi or sample.get('velocity') != velocity or type(sample.get('offset')) is not int or type(sample.get('frames')) is not int or sample['offset'] < previous_end or sample['frames'] < 1 or sample['offset'] + sample['frames'] > asset.get('frames', 0):
            raise ValueError('Q sample dimensions or pitch mapping are invalid.')
        previous_end = sample['offset'] + sample['frames']
        identities.add(sample['id'])
    for step in sequence:
        if not step or not step.get('notes') or step.get('rest'):
            continue
        velocity = min(127, int(step['velocity'] * (1 + piano.get('accentAmount', .25) if step.get('accent') else 1) + .5))
        layer = min([32, 96] if instrument == 'strings' else [32, 64, 95, 127], key=lambda value: abs(value - velocity))
        for note in step['notes']:
            pitch = note + piano.get('transpose', 0)
            if not 21 <= pitch <= 108:
                raise ValueError('Q transposition is outside the piano range.')
            sampled_pitch = min(string_roots, key=lambda value: abs(value - pitch)) if instrument == 'strings' else min(108, max(21, 21 + int((pitch - 21) / 3 + .5) * 3))
            if not any(sample['midi'] == sampled_pitch and sample['velocity'] == layer for sample in samples):
                raise ValueError('Q piano bank is missing a required pitch or velocity layer.')
    return piano.get('enabled') is True


def q_render_version(piano):
    if piano.get('chordHold') is True and piano.get('arpEnabled') is not True:
        return 8
    if piano.get('sampleLength', 1) < 1 or piano.get('sampleDecay', 1) < 1:
        return 7
    if piano.get('performanceVersion') == 6 or piano.get('arpPattern') == 'custom' or any(step and step.get('accent') is True for step in piano['sequence']):
        return 6
    return 5 if piano.get('instrument') == 'strings' else 4 if piano.get('room', 0) > 0 else 3 if piano.get('arpEnabled') else 1


def validate_drum_roll_cycle(state, cycle, steps):
    roll = state['modes'].get('drumMachineRoll')
    valid = (1, 2, 4, 8)
    if roll is not None:
        if (not isinstance(roll, dict) or type(roll.get('version')) is not int or roll['version'] != 1
            or type(roll.get('length')) is not int or not 1 <= roll['length'] <= 1024
            or not isinstance(roll.get('pattern'), list) or len(roll['pattern']) != roll['length']
            or any(type(x) is not bool for x in roll['pattern'])
            or not isinstance(roll.get('ratchets'), list) or len(roll['ratchets']) != roll['length']
            or any(type(x) is not int or not 0 <= x <= 8 for x in roll['ratchets'])):
            raise ValueError('Invalid snare Roll pattern.')
        if state['modes'].get('drumMachineEnabled') is True and any(roll['pattern']):
            valid = tuple(math.lcm(steps * base, roll['length']) // steps for base in valid)
    if type(cycle) is not int or cycle not in valid:
        raise ValueError('Invalid part pattern cycle length.')


def validate_part_zip(body):
    with zipfile.ZipFile(BytesIO(body)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 41 or len(set(names)) != len(names):
            raise ValueError('Invalid part archive entries.')
        if sum(entry.file_size for entry in entries) > MAX_UPLOAD:
            raise ValueError('Part archive is too large.')
        for entry in entries:
            if entry.compress_type != zipfile.ZIP_STORED or entry.flag_bits & 1:
                raise ValueError('Part archives must use unencrypted stored entries.')
            if not re.fullmatch(r'(song-part\.json|audio/[A-Za-z0-9_-]+\.wav)', entry.filename):
                raise ValueError('Invalid part asset path.')
        manifest_entry = archive.getinfo('song-part.json')
        if manifest_entry.file_size > 2 * 1024 * 1024:
            raise ValueError('Part settings are too large.')
        snapshot = json_object(json.loads(archive.read('song-part.json')))
        if snapshot.get('format') != 'mygrain-song-part' or snapshot.get('version') != 1:
            raise ValueError('Unsupported song-part format.')
        state = snapshot.get('state')
        extra = snapshot.get('extra')
        if not isinstance(state, dict) or not isinstance(state.get('modes'), dict) or not isinstance(extra, dict):
            raise ValueError('Part is missing its complete settings snapshot.')
        steps = int(state.get('patternLength', 0))
        bpm = float(state.get('globalBpm', 0))
        if not 8 <= steps <= 64 or not 40 <= bpm <= 300 or float(state.get('patternLength', 0)) != steps:
            raise ValueError('Invalid part pattern length or tempo.')
        sequence = extra.get('sequencerSteps')
        cycle = extra.get('patternCycleMultiplier', 1)
        validate_drum_roll_cycle(state, cycle, steps)
        if not isinstance(sequence, list) or len(sequence) != steps:
            raise ValueError('Part is missing its sequencer pattern.')
        assets = snapshot.get('assets')
        # Five K recorder takes add four raw WAVs to a fully loaded part.
        if not isinstance(assets, list) or len(assets) > 40:
            raise ValueError('Invalid part audio manifest.')
        keys = set()
        paths = set()
        audio_hashes = {}
        for asset in assets:
            asset = json_object(asset)
            key = asset.get('key', '')
            asset_path = asset.get('path', '')
            if not re.fullmatch(r'[A-Za-z0-9_-]+', key) or asset_path != f'audio/{key}.wav':
                raise ValueError('Invalid audio asset.')
            if key in keys or asset_path in paths or asset_path not in names:
                raise ValueError('Missing or duplicate audio asset.')
            keys.add(key)
            paths.add(asset_path)
            audio_body = archive.read(asset_path)
            audio_hashes[asset_path] = hashlib.sha256(audio_body).hexdigest()
            with wave.open(BytesIO(audio_body), 'rb') as audio:
                if audio.getnchannels() not in (1, 2) or audio.getnframes() < 1:
                    raise ValueError('Invalid part WAV audio.')
                dimensions = {'channels': audio.getnchannels(), 'frames': audio.getnframes(), 'sampleRate': audio.getframerate()}
                if any(field in asset and (type(asset[field]) is not int or asset[field] != value) for field, value in dimensions.items()):
                    raise ValueError('Part audio dimensions do not match its manifest.')
                if len(audio.readframes(audio.getnframes())) != audio.getnframes() * audio.getnchannels() * audio.getsampwidth():
                    raise ValueError('Part WAV audio is truncated.')
        if set(names) != paths | {'song-part.json'}:
            raise ValueError('Unlisted part assets are not allowed.')
        freeze_version = extra.get('freezeStateVersion')
        if freeze_version is not None and (type(freeze_version) is not int or freeze_version != 1):
            raise ValueError('Unsupported portable-freeze version.')
        if freeze_version == 1:
            inventory = extra.get('audioSlots')
            if not isinstance(inventory, dict) or not inventory or any(type(present) is not bool for present in inventory.values()):
                raise ValueError('Part is missing its audio inventory.')
            if {key for key, present in inventory.items() if present} != keys:
                raise ValueError('Part audio inventory does not match its saved samples.')
        piano_active = validate_q_piano(state, assets)
        content = {key: value for key, value in snapshot.items() if key != 'createdAt'}
        content['state'] = {key: value for key, value in state.items() if key != 'timestamp'}
        content['assets'] = sorted(assets, key=lambda asset: asset['key'])
        content['audioHashes'] = audio_hashes
        digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
        return {'bpm': bpm, 'patternSteps': steps, 'patternCycleMultiplier': cycle, 'audioAssets': len(assets), 'contentSha256': digest, **({'qVersion': q_render_version(state['q'])} if piano_active else {})}


LOOP_LAYERS = ('A', 'B', 'C', 'V', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+')
LOOP_ASSETS = {layer: {f'bastard{layer}'} for layer in LOOP_LAYERS}
LOOP_ASSETS['M'] = {'bastardM', 'bastardMRender'}
LOOP_ASSETS['M+'] = {'bastardMPlus', 'bastardMPlusRender'}
DRUM_LANES = ('drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc', 'drumRoll')
K_TRACKS = ('K1', 'K2', 'K3', 'K4', 'K5')
K_ASSETS = {track: {'bastardK', 'bastardKRender'} if index == 0 else {f'bastardKTrack{index + 1}'}
            for index, track in enumerate(K_TRACKS)}
COPY_LAYERS = (*LOOP_LAYERS, *K_TRACKS, 'drums', *DRUM_LANES)


def copy_layers(value):
    """Accept legacy single-loop payloads and a bounded multi-selection."""
    values = [value] if isinstance(value, str) else value
    if not isinstance(values, list) or not values or len(values) > len(COPY_LAYERS) or any(not isinstance(item, str) or item not in COPY_LAYERS for item in values):
        raise ValueError('Choose one or more supported loops, K tracks or drum lanes.')
    return tuple(item for item in COPY_LAYERS if item in values and not (item in DRUM_LANES and 'drums' in values))


def setting_drum_layer(key):
    for prefix in ('drumMachine', 'performanceDrumMachine'):
        if key.startswith(prefix):
            suffix = key[len(prefix):]
            for lane in DRUM_LANES:
                name = lane[4:]
                if suffix.startswith(name) and (len(suffix) == len(name) or not suffix[len(name)].islower()):
                    return lane
            return 'drums'
    return 'drums' if key.startswith('drumSend') else None


def merged_pattern_cycle(snapshot):
    """Same full-cycle calculation as the live Song capture adapter."""
    state = snapshot['state']
    modes = state['modes']
    steps = int(state['patternLength'])
    multiplier = 1
    for lane in ('L', 'X'):
        prefix = f'bastardLoop{lane}'
        sequence = modes.get(prefix + 'Sequence') or []
        if modes.get(prefix + 'Enabled') is True and any(step and step.get('note') and not step.get('rest') for step in sequence[:steps]):
            index = modes.get(prefix + 'TimingIndex', 3)
            timing = (.125, .25, .5, 1, 2, 4, 8)[index] if type(index) is int and 0 <= index <= 6 else 1
            multiplier = max(multiplier, timing)
    piano = state.get('q') or {}
    if piano.get('enabled') is True and any(step and step.get('notes') and not step.get('rest') for step in piano.get('sequence', [])[:steps]):
        rate = piano.get('rate', 1)
        if rate in (.25, .5, 1, 2, 4):
            multiplier = max(multiplier, 1 / rate)
    roll = modes.get('drumMachineRoll')
    if modes.get('drumMachineEnabled') is True and roll and any(roll['pattern']):
        multiplier = math.lcm(steps * int(multiplier), roll['length']) // steps
    return int(multiplier)


def setting_loop_layer(key):
    match = re.match(r'^(?:performance)?[bB]astard(?:Loop)?(.*)$', key)
    if not match:
        return None
    suffix = match[1]
    # K's shared master/legacy controls are not part of loop A or a K track.
    if suffix.startswith('K') and (len(suffix) == 1 or not suffix[1].islower()):
        return None
    for prefix, layer in [('MPlus', 'M+'), ('2', 'B'), ('3', 'C'), *[(layer, layer) for layer in ('V', 'P', 'O', 'L', 'X', 'Q', 'M')]]:
        if suffix.startswith(prefix) and (len(suffix) == len(prefix) or not suffix[len(prefix)].islower()):
            return layer
    return 'A'


def replace_loop_settings(destination, source, layer):
    destination = json_object(destination)
    source = json_object(source)
    result = {key: value for key, value in destination.items() if setting_loop_layer(key) != layer}
    result.update({key: copy.deepcopy(value) for key, value in source.items() if setting_loop_layer(key) == layer})
    return result


def paste_loop_archive(destination_body, source_body, layer):
    layers = copy_layers(layer)
    validate_part_zip(source_body)
    validate_part_zip(destination_body)
    asset_keys = set().union(*(LOOP_ASSETS.get(item, K_ASSETS.get(item, {item} if item in DRUM_LANES and item != 'drumRoll' else set())) for item in layers))
    if 'drums' in layers:
        asset_keys.update(item for item in DRUM_LANES if item != 'drumRoll')

    def selected(key):
        loop = setting_loop_layer(key)
        drum = setting_drum_layer(key)
        return loop in layers or drum in layers or ('drums' in layers and drum is not None)

    def replace_selected(destination, source):
        destination, source = json_object(destination), json_object(source)
        result = {key: value for key, value in destination.items() if not selected(key)}
        result.update({key: copy.deepcopy(value) for key, value in source.items() if selected(key)})
        return result

    with zipfile.ZipFile(BytesIO(source_body)) as source_zip, zipfile.ZipFile(BytesIO(destination_body)) as destination_zip:
        source = json.loads(source_zip.read('song-part.json'))
        destination = json.loads(destination_zip.read('song-part.json'))
        if any(item in K_TRACKS for item in layers):
            # Legacy shared processing becomes per-track processing on the
            # server. Keep destination selection/master and every unchosen take.
            with K_CONVERSION_LOCK:
                source = convert_k_snapshot(source)['snapshot']
                destination = convert_k_snapshot(destination)['snapshot']
            for index, track in enumerate(K_TRACKS):
                if track in layers:
                    destination['state']['modes']['kMultitrack']['tracks'][index] = copy.deepcopy(
                        source['state']['modes']['kMultitrack']['tracks'][index])
        for section in ('modes', 'sliders', 'selects'):
            destination['state'][section] = replace_selected(destination['state'].get(section, {}), source['state'].get(section, {}))
        # Old archives may predate some drum lanes. An absent selected pattern
        # means empty, not "leave whichever pattern is currently live" on recall.
        for item in ('drumKick', 'drumSnare', 'drumHat', 'drumPerc'):
            key = 'drumMachine' + item[4:] + 'Pattern'
            if ('drums' in layers or item in layers) and key not in source['state']['modes']:
                destination['state']['modes'][key] = [False] * int(destination['state']['patternLength'])
        if 'drums' in layers and 'drumMachineEnabled' not in source['state']['modes']:
            destination['state']['modes']['drumMachineEnabled'] = False
        if 'drums' not in layers:
            extra_lanes = [item[4:].lower() for item in layers if item in ('drumClap', 'drumCymbals', 'drumEtc')]
            if extra_lanes:
                tracks = json_object(destination['state']['modes'].setdefault('drumMachineExtraTracks', {}))
                source_tracks = json_object(source['state']['modes'].get('drumMachineExtraTracks', {}))
                for kind in extra_lanes:
                    tracks.pop(kind, None)
                    if kind in source_tracks:
                        tracks[kind] = copy.deepcopy(source_tracks[kind])
        destination_toggles = json_object(destination['state'].get('toggles', {}))
        source_toggles = json_object(source['state'].get('toggles', {}))
        for modulation in set(destination_toggles) | set(source_toggles):
            destination['state'].setdefault('toggles', {})[modulation] = replace_selected(
                destination['state']['toggles'].get(modulation, {}), source['state'].get('toggles', {}).get(modulation, {}))
        if 'Q' in layers:
            destination['state']['q'] = copy.deepcopy(source['state'].get('q'))
        source_trace = json_object(source['state'].get('bastardLoopTrace', {}))
        trace = json_object(destination['state'].get('bastardLoopTrace', {}))
        for item in layers:
            if item not in LOOP_LAYERS:
                continue
            trace.pop(item, None)
            if item in source_trace:
                destination['state'].setdefault('bastardLoopTrace', {})[item] = copy.deepcopy(source_trace[item])
        destination['extra']['controls'] = [control for control in destination['extra'].get('controls', []) if not selected(control['id'])]
        destination['extra']['controls'].extend(copy.deepcopy(control) for control in source['extra'].get('controls', []) if selected(control['id']))
        metadata = json_object(destination['extra'].setdefault('metadata', {}))
        for key in asset_keys:
            metadata.pop(key, None)
            if key in source['extra'].get('metadata', {}):
                metadata[key] = copy.deepcopy(source['extra']['metadata'][key])
        destination['assets'] = [asset for asset in destination['assets'] if asset['key'] not in asset_keys]
        destination['assets'].extend(copy.deepcopy(asset) for asset in source['assets'] if asset['key'] in asset_keys)
        if destination['extra'].get('freezeStateVersion') == 1:
            present = {asset['key'] for asset in destination['assets']}
            destination['extra']['audioSlots'].update({key: key in present for key in asset_keys})
        if any(item in layers for item in ('drums', 'drumRoll', 'L', 'X', 'Q')):
            destination['extra']['patternCycleMultiplier'] = merged_pattern_cycle(destination)
        destination['createdAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        output = BytesIO()
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as result:
            result.writestr('song-part.json', json.dumps(destination, separators=(',', ':')))
            for asset in destination['assets']:
                archive = source_zip if asset['key'] in asset_keys else destination_zip
                result.writestr(asset['path'], archive.read(asset['path']))
                if output.tell() > MAX_UPLOAD:
                    raise ValueError('The pasted part exceeds the 128 MB limit. Shorten its source audio.')
        body = output.getvalue()
        if len(body) > MAX_UPLOAD:
            raise ValueError('The pasted part exceeds the 128 MB limit.')
        return body


def copied_loop_body(payload, owner):
    payload = json_object(payload)
    layers = copy_layers(payload.get('layers', payload.get('layer')))
    source_id = payload.get('sourcePartId', '')
    digest = payload.get('sourceSha256', '')
    if not isinstance(source_id, str) or not re.fullmatch(r'[a-f0-9]{32}', source_id) or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError('Copy items from a saved part first.')
    folder, song = read_song(payload.get('sourceSongId', ''), owner)
    candidates = [part for section in ('parts', 'sharedParts', 'history', 'deletedParts') for part in song.get(section, [])]
    saved = next((part for part in candidates if part['id'] == source_id and part.get('sha256') == digest), None)
    if not saved:
        raise ValueError('The copied revision is unavailable. Copy the loop again.')
    filename = saved.get('archive', f'{source_id}.zip')
    path = folder / 'parts' / filename
    if not re.fullmatch(r'[a-f0-9-]+\.zip', filename) or path.is_symlink() or path.stat().st_size > MAX_UPLOAD:
        raise ValueError('Invalid copied part archive.')
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != digest:
        raise ValueError('Copied part integrity check failed. No part was changed.')
    return body, list(layers)


def handle_song_request(handler, method, inner_path):
    if inner_path != '/api/songs' and not inner_path.startswith('/api/songs/'):
        return False
    headers = {'Cache-Control': 'no-store'}
    try:
        owner = owner_hash(handler.headers)
        segments = [unquote(segment) for segment in inner_path.split('/')[3:] if segment]
        query = parse_qs(urlparse(handler.path).query)
        with song_storage_lock():
            if not segments and method == 'GET':
                songs = []
                for folder in SONGS_ROOT.iterdir():
                    if not folder.is_dir() or folder.is_symlink():
                        continue
                    try:
                        _, song = read_song(folder.name, owner)
                        songs.append(public_song(song))
                    except (FileNotFoundError, ValueError, OSError):
                        continue
                handler.send_json({'ok': True, 'songs': sorted(songs, key=lambda song: song['createdAt']), 'features': {'editingLocks': 1, 'editLeaseSeconds': EDIT_LEASE_SECONDS, 'songRevisions': 1, 'exactPatternRenders': 1, 'keyboardRenders': 1, 'grainFadeRenders': 1, 'grainSustainRenders': 2, 'grainControlRenders': 3, 'vocalCutRenders': 1, 'vocalRepeatRenders': 1, 'drumLaneRenders': 1, 'drumSampleRenders': 1, 'drumRollRenders': 1, 'portableFreezeRenders': 1, 'qPianoRenders': 8, 'contentHashes': 1, 'partManifests': 1, 'partAudioAssets': 1, 'serverPreparation': 1 if ACCOUNT_IDENTITY() is not None and server_arm_module().available() else 0, 'serverKConversion': 1 if K_CONVERSION_SCRIPT.is_file() and shutil.which('node') else 0, 'renameSongs': True, 'amendParts': True, 'deleteParts': True, 'reuseParts': True}}, extra_headers=headers)
            elif not segments and method == 'POST':
                name = clean_name(json_object(handler.read_json()).get('name'))
                slug = re.sub(r'[^A-Za-z0-9_-]+', '-', name).strip('-_') or 'song'
                song_id = f'{slug[:100]}-{secrets.token_hex(4)}'
                folder = song_path(song_id)
                folder.mkdir(mode=0o700)
                (folder / 'parts').mkdir(mode=0o700)
                song = {'id': song_id, 'name': name, 'version': 1, 'createdAt': time.time(), 'ownerHash': owner, 'parts': []}
                write_song(folder, song)
                handler.send_json({'ok': True, 'song': public_song(song)}, status=201, extra_headers=headers)
            elif segments:
                folder, song = read_song(segments[0], owner)
                is_render = len(segments) == 4 and segments[1] == 'parts' and segments[3] in ('render', 'server-arm')
                if method == 'POST' and segments[1:2] != ['lock'] and not is_render:
                    require_song_editor(folder, song, handler.headers)
                if segments[1:] == ['lock'] and method == 'GET':
                    handler.send_json({'ok': True, 'lock': public_edit_lock(read_edit_lock(folder)), 'serverTime': time.time(), 'leaseSeconds': EDIT_LEASE_SECONDS, 'revision': song['revision']}, extra_headers=headers)
                elif len(segments) == 3 and segments[1] == 'lock' and method == 'POST':
                    handler.send_json(handle_edit_lock(handler, folder, song, segments[2]), extra_headers=headers)
                elif len(segments) == 1 and method == 'GET':
                    handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                elif segments[1:] == ['convert-k'] and method == 'POST':
                    song, converted = convert_song_k(folder, song, handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song), 'converted': converted}, extra_headers=headers)
                elif segments[1:] == ['rename'] and method == 'POST':
                    song['name'] = clean_name(json_object(handler.read_json()).get('name'))
                    write_song(folder, song, edit_headers=handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                elif segments[1:] == ['parts'] and method == 'POST':
                    if len(song['parts']) >= MAX_PARTS:
                        raise ValueError('The beta supports up to 64 parts per song.')
                    name = clean_name((query.get('name') or [''])[0])
                    repeats = checked_repeats((query.get('repeats') or ['1'])[0])
                    length = int(handler.headers.get('Content-Length', '0'))
                    if not 1 <= length <= MAX_UPLOAD:
                        raise ValueError('Part upload must be between 1 byte and 128 MB.')
                    body = handler.rfile.read(length)
                    if len(body) != length:
                        raise ValueError('Part upload was interrupted.')
                    details = validate_part_zip(body)
                    part_id = secrets.token_hex(16)
                    archive_path = folder / 'parts' / f'{part_id}.zip'
                    temporary = archive_path.with_suffix('.tmp')
                    try:
                        with temporary.open('xb') as output:
                            output.write(body)
                            output.flush()
                            os.fsync(output.fileno())
                        temporary.replace(archive_path)
                        song['parts'].append({'id': part_id, 'name': name, 'repeats': repeats, 'createdAt': time.time(), 'bytes': length, 'sha256': hashlib.sha256(body).hexdigest(), **details})
                        write_song(folder, song, edit_headers=handler.headers)
                    except Exception:
                        temporary.unlink(missing_ok=True)
                        archive_path.unlink(missing_ok=True)
                        raise
                    handler.send_json({'ok': True, 'song': public_song(song)}, status=201, extra_headers=headers)
                elif segments[1:] == ['arrange'] and method == 'POST':
                    requested = json_object(handler.read_json()).get('parts')
                    originals = {part['id']: part for part in song['parts']}
                    if not isinstance(requested, list) or len(requested) != len(originals):
                        raise ValueError('Arrangement must contain every saved part exactly once.')
                    ordered = []
                    seen = set()
                    source_names = {}
                    for part in requested:
                        part = json_object(part)
                        part_id = part.get('id')
                        if part_id not in originals or part_id in seen:
                            raise ValueError('Invalid or duplicate part in arrangement.')
                        seen.add(part_id)
                        original = originals[part_id]
                        source = source_part(song, original)
                        name = clean_name(part.get('name'))
                        if source['id'] in source_names and source_names[source['id']] != name:
                            raise ValueError('Reused occurrences must share the same part name.')
                        source_names[source['id']] = name
                        arranged = {**original, 'repeats': checked_repeats(part.get('repeats'))}
                        if 'playbackSteps' in part:
                            arranged['playbackSteps'] = checked_playback_steps(part['playbackSteps'], source)
                        ordered.append(arranged)
                    for source_id, name in source_names.items():
                        source_part(song, {'id': source_id})['name'] = name
                    for part in ordered:
                        if 'sourcePartId' not in part:
                            part['name'] = source_names[part['id']]
                    song['parts'] = ordered
                    write_song(folder, song, edit_headers=handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                elif len(segments) in (3, 4) and segments[1] == 'parts':
                    occurrence = next((part for part in song['parts'] if part['id'] == segments[2]), None)
                    if not occurrence or not re.fullmatch(r'[a-f0-9]{32}', segments[2]):
                        raise FileNotFoundError('Part not found.')
                    part = source_part(song, occurrence)
                    action = segments[3] if len(segments) == 4 else ''
                    if method == 'POST' and (query.get('sha256') or [''])[0] != part['sha256']:
                        raise PartConflictError('This part changed on the server. Refresh Songs and recall it again before saving.')
                    if method == 'POST' and action == 'reuse':
                        if len(song['parts']) >= MAX_PARTS:
                            raise ValueError('The beta supports up to 64 parts per song.')
                        reused = {'id': secrets.token_hex(16), 'sourcePartId': part['id'], 'repeats': occurrence['repeats'], 'createdAt': time.time()}
                        if 'playbackSteps' in occurrence:
                            reused['playbackSteps'] = occurrence['playbackSteps']
                        song['parts'].append(reused)
                        write_song(folder, song, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, status=201, extra_headers=headers)
                    elif method == 'POST' and action == 'full-copy':
                        copied = full_copy_part(folder, song, occurrence, part, handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song), 'partId': copied['id']}, status=201, extra_headers=headers)
                    elif method == 'GET' and not action:
                        send_asset(handler, folder, part.get('archive', f'{part["id"]}.zip'), 'application/zip')
                    elif method == 'GET' and action == 'manifest':
                        if (query.get('sha256') or [''])[0] != part['sha256']:
                            raise PartConflictError('This part changed on the server. Refresh Songs and arm again.')
                        record = read_part_manifest_record(folder, part)
                        handler.send_json({'ok': True, 'format': 'mygrain-song-part-manifest', 'version': 1,
                                           'sourceSha256': part['sha256'], **record}, extra_headers=headers)
                    elif method == 'GET' and action == 'audio':
                        if (query.get('sha256') or [''])[0] != part['sha256']:
                            raise PartConflictError('This part changed on the server. Refresh Songs and recall it again.')
                        body = read_part_audio(folder, part, (query.get('key') or [''])[0])
                        handler.send_response(200)
                        handler.send_header('Content-Type', 'audio/wav')
                        handler.send_header('Content-Length', str(len(body)))
                        handler.send_header('Cache-Control', 'no-store')
                        handler.end_headers()
                        handler.wfile.write(body)
                    elif action == 'server-arm' and method in ('POST', 'GET'):
                        if ACCOUNT_IDENTITY() is None:
                            raise PermissionError('Sign into MYGRAIN to prepare audio on the server.')
                        if (query.get('sha256') or [''])[0] != part['sha256']:
                            raise PartConflictError('This part changed on the server. Refresh Songs and arm again.')
                        service = server_arm_module()
                        scope = str(folder.parent.resolve())
                        if method == 'POST':
                            job = service.start(scope, song['id'], part,
                                f'http://127.0.0.1:{handler.server.server_address[1]}/mygrain/', handler.headers.get('Cookie', ''), occurrence['id'])
                        else:
                            job = service.status(scope, song['id'], part['id'], part['sha256'])
                        handler.send_json({'ok': True, 'job': job, **({'song': public_song(song)} if job['state'] == 'done' else {})}, extra_headers=headers)
                    elif method == 'GET' and action == 'render':
                        render = part.get('render')
                        if not render or render.get('sourceSha256') != part['sha256']:
                            raise FileNotFoundError('Arm Cache to render this part first.')
                        send_asset(handler, folder, render['file'], 'audio/wav')
                    elif method == 'POST' and action == 'render':
                        keyboard = (query.get('keyboard') or [''])[0]
                        if keyboard not in ('', '1'):
                            raise ValueError('Unsupported keyboard render version.')
                        grain = (query.get('grain') or [''])[0]
                        if grain not in ('', '1', '2', '3'):
                            raise ValueError('Unsupported grain render version.')
                        vocal_cut = (query.get('vocalcut') or [''])[0]
                        if vocal_cut not in ('', '1'):
                            raise ValueError('Unsupported vocal-cut render version.')
                        vocal_repeat = (query.get('vocalrepeat') or [''])[0]
                        if vocal_repeat not in ('', '1'):
                            raise ValueError('Unsupported vocal section-repeat render version.')
                        drum_lanes = (query.get('drumlanes') or [''])[0]
                        if drum_lanes not in ('', '1'):
                            raise ValueError('Unsupported drum-lane render version.')
                        drum_sample = (query.get('drumsample') or [''])[0]
                        if drum_sample not in ('', '1'):
                            raise ValueError('Unsupported drum-sample render version.')
                        drum_roll = (query.get('drumroll') or [''])[0]
                        if drum_roll not in ('', '1'):
                            raise ValueError('Unsupported snare Roll render version.')
                        portable = (query.get('portable') or [''])[0]
                        if portable not in ('', '1'):
                            raise ValueError('Unsupported portable-freeze render version.')
                        piano = (query.get('q') or [''])[0]
                        if piano not in ('', '1', '2', '3', '4', '5', '6', '7', '8'):
                            raise ValueError('Unsupported Q piano render version.')
                        if part.get('qVersion', 0) > int(piano or '0'):
                            raise ValueError('This part requires Q-aware rendering.')
                        body = upload_body(handler)
                        render = validate_render(body, part)
                        if keyboard == '1':
                            render['keyboardVersion'] = 1
                        if grain:
                            render['grainVersion'] = int(grain)
                        if vocal_cut == '1':
                            render['vocalCutVersion'] = 1
                        if vocal_repeat == '1':
                            render['vocalRepeatVersion'] = 1
                        if drum_lanes == '1':
                            render['drumLanesVersion'] = 1
                        if drum_sample == '1':
                            render['drumSampleVersion'] = 1
                        if drum_roll == '1':
                            render['drumRollVersion'] = 1
                        if portable == '1':
                            render['portableVersion'] = 1
                        if piano:
                            render['qVersion'] = int(piano)
                        render['file'] = f'{part["id"]}-{render["sha256"]}.wav'
                        part['render'] = render
                        publish_asset(folder, song, render['file'], body, advance_revision=False)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    elif method == 'POST' and action in ('save', 'paste-loop'):
                        if action == 'paste-loop':
                            source_body, layer = copied_loop_body(handler.read_json(), owner)
                            archive_path = folder / 'parts' / part.get('archive', f'{part["id"]}.zip')
                            if archive_path.is_symlink() or archive_path.stat().st_size > MAX_UPLOAD:
                                raise ValueError('Invalid destination part archive.')
                            destination_body = archive_path.read_bytes()
                            if hashlib.sha256(destination_body).hexdigest() != part['sha256']:
                                raise ValueError('Destination part integrity check failed. No part was changed.')
                            body = paste_loop_archive(destination_body, source_body, layer)
                        else:
                            body = upload_body(handler)
                        details = validate_part_zip(body)
                        digest = hashlib.sha256(body).hexdigest()
                        previous_content = part.get('contentSha256')
                        if previous_content is None:
                            archive_path = folder / 'parts' / part.get('archive', f'{part["id"]}.zip')
                            previous_content = validate_part_zip(archive_path.read_bytes())['contentSha256']
                        repeats = occurrence['repeats'] if action == 'paste-loop' else checked_repeats((query.get('repeats') or [str(occurrence['repeats'])])[0])
                        name = part['name'] if action == 'paste-loop' else clean_name((query.get('name') or [part['name']])[0])
                        updated = {**part, **details, 'name': name, 'repeats': repeats if occurrence is part else part['repeats'], 'sha256': digest, 'bytes': len(body), 'archive': f'{part["id"]}-{secrets.token_hex(16)}.zip', 'revision': part.get('revision', 1) + 1, 'updatedAt': time.time()}
                        old_steps, new_steps = full_pattern_steps(part), full_pattern_steps(updated)
                        for slot in [updated] + [entry for entry in song['parts'] if 'sourcePartId' in entry]:
                            if slot.get('sourcePartId', slot['id']) == part['id'] and 'playbackSteps' in slot:
                                slot['playbackSteps'] = new_steps if slot['playbackSteps'] == old_steps else min(slot['playbackSteps'], new_steps)
                        if 'qVersion' not in details:
                            updated.pop('qVersion', None)
                        if previous_content == details['contentSha256'] and part.get('render', {}).get('sourceSha256') == part['sha256']:
                            updated['render'] = {**part['render'], 'sourceSha256': digest}
                        else:
                            updated.pop('render', None)
                        song.setdefault('history', []).append(dict(part))
                        occurrence['repeats'] = repeats
                        song['parts'] = [updated if entry['id'] == part['id'] else entry for entry in song['parts']]
                        if 'sharedParts' in song:
                            song['sharedParts'] = [updated if entry['id'] == part['id'] else entry for entry in song['sharedParts']]
                        publish_asset(folder, song, updated['archive'], body, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    elif method == 'POST' and action == 'colour':
                        payload = json_object(handler.read_json())
                        if 'colour' not in payload:
                            raise ValueError('Choose a colour or explicitly clear it.')
                        part['colour'] = checked_colour(payload['colour'])
                        write_song(folder, song, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    elif method == 'POST' and action == 'delete':
                        song.setdefault('deletedParts', []).append({**part, **occurrence, 'deletedAt': time.time()})
                        song['parts'] = [entry for entry in song['parts'] if entry['id'] != occurrence['id']]
                        if occurrence is part and any(entry.get('sourcePartId') == part['id'] for entry in song['parts']):
                            song.setdefault('sharedParts', []).append(part)
                        song['sharedParts'] = [entry for entry in song.get('sharedParts', []) if any(slot.get('sourcePartId') == entry['id'] for slot in song['parts'])]
                        write_song(folder, song, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    else:
                        raise FileNotFoundError('Song endpoint not found.')
                else:
                    raise FileNotFoundError('Song endpoint not found.')
            else:
                raise FileNotFoundError('Song endpoint not found.')
    except SongEditError as error:
        handler.send_json({'ok': False, 'error': str(error), 'code': error.code, 'lock': error.lock, 'serverTime': time.time()}, status=error.status, extra_headers=headers)
    except PartConflictError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=409, extra_headers=headers)
    except PermissionError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=403, extra_headers=headers)
    except FileNotFoundError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=404, extra_headers=headers)
    except (ValueError, TypeError, KeyError, EOFError, zipfile.BadZipFile, wave.Error) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    except OSError:
        handler.send_json({'ok': False, 'error': 'Song storage is unavailable; the save did not complete.'}, status=500, extra_headers=headers)
    return True
