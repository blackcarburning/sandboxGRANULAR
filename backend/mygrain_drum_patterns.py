"""Account-scoped, append-only drum folders and lossless PCM pattern archives."""
import io
import json
import os
import pathlib
import re
import secrets
import threading
import time
import zipfile
from urllib.parse import parse_qs, urlparse

LOCK = threading.RLock()
MAX_BYTES = 128 * 1024 * 1024
KINDS = {'kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc'}


def identifier(value, empty=False):
    if empty and value == '':
        return ''
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value):
        raise ValueError('Invalid library item.')
    return value


def name(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 120 or any(ord(c) < 32 for c in value):
        raise ValueError('Enter a name of 1–120 characters.')
    return value.strip()


def validate_archive(body):
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        info = archive.infolist()
        if len(info) > 16 or len({i.filename for i in info}) != len(info) or sum(i.file_size for i in info) > MAX_BYTES:
            raise ValueError('Pattern archive is too large or contains duplicate files.')
        if any(i.compress_type != zipfile.ZIP_STORED for i in info):
            raise ValueError('Use the drum machine Save Pattern button.')
        manifest_info = archive.getinfo('drum-pattern.json')
        if manifest_info.file_size > 1024 * 1024:
            raise ValueError('Pattern settings are too large.')
        manifest = json.loads(archive.read(manifest_info))
        if manifest.get('version') != 1 or not isinstance(manifest.get('state'), dict) or not isinstance(manifest.get('audio'), dict):
            raise ValueError('Invalid drum pattern archive.')
        allowed = {'drum-pattern.json'}
        for kind, slot in manifest['audio'].items():
            if kind not in KINDS or not isinstance(slot, dict):
                raise ValueError('Invalid drum sound.')
            rate, length, channels = slot.get('sampleRate'), slot.get('length'), slot.get('channels')
            if type(rate) is not int or not 8000 <= rate <= 192000 or type(length) is not int or not 1 <= length <= rate * 120 or channels not in (1, 2):
                raise ValueError('Invalid drum PCM dimensions.')
            for ch in range(channels):
                path = f'audio/{kind}-{ch}.f32'
                allowed.add(path)
                if archive.getinfo(path).file_size != length * 4:
                    raise ValueError('Truncated drum sound.')
        if {i.filename for i in info} != allowed:
            raise ValueError('Unexpected drum pattern files.')
        return manifest


def atomic_json(path, data):
    temporary = path.with_name('.' + path.name + '-' + secrets.token_hex(8))
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def handle(handler, method, inner_path, songs_root):
    if inner_path != '/api/drum-patterns' and not inner_path.startswith('/api/drum-patterns/'):
        return False
    headers = {'Cache-Control': 'private, no-store'}
    try:
        root = pathlib.Path(os.fspath(songs_root)) / '.drum-patterns'
        if root.is_symlink():
            raise ValueError('Invalid library path.')
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with LOCK:
            index_path = root / 'index.json'
            index = json.loads(index_path.read_text()) if index_path.exists() else {'version': 1, 'folders': [], 'patterns': []}
            parts = inner_path.split('/')[3:]
            if parts == [] and method == 'GET':
                handler.send_json({'ok': True, **index}, extra_headers=headers)
            elif parts == ['folders'] and method == 'POST':
                payload = handler.read_json()
                parent = identifier(payload.get('parent', ''), True)
                if parent and not any(f['id'] == parent for f in index['folders']):
                    raise ValueError('Folder no longer exists.')
                title = name(payload.get('name'))
                if any(f['parent'] == parent and f['name'].casefold() == title.casefold() for f in index['folders']):
                    raise ValueError('A folder with that name already exists here.')
                folder = {'id': secrets.token_hex(16), 'parent': parent, 'name': title}
                index['folders'].append(folder)
                atomic_json(index_path, index)
                handler.send_json({'ok': True, 'folder': folder}, status=201, extra_headers=headers)
            elif parts == ['patterns'] and method == 'POST':
                query = parse_qs(urlparse(handler.path).query, keep_blank_values=True)
                title = name(query.get('name', [''])[0])
                folder = identifier(query.get('folder', [''])[0], True)
                if folder and not any(f['id'] == folder for f in index['folders']):
                    raise ValueError('Folder no longer exists.')
                length = int(handler.headers.get('Content-Length', 0))
                if not 1 <= length <= MAX_BYTES:
                    raise ValueError('Pattern must be under 128 MB.')
                body = handler.rfile.read(length)
                if len(body) != length:
                    raise ValueError('Incomplete pattern upload.')
                manifest = validate_archive(body)
                item = {'id': secrets.token_hex(16), 'name': title, 'folder': folder, 'createdAt': time.time(), 'sounds': len(manifest['audio'])}
                path = root / (item['id'] + '.zip')
                with path.open('xb') as output:
                    output.write(body)
                os.chmod(path, 0o600)
                try:
                    index['patterns'].append(item)
                    atomic_json(index_path, index)
                except Exception:
                    path.unlink(missing_ok=True)
                    raise
                handler.send_json({'ok': True, 'pattern': item}, status=201, extra_headers=headers)
            elif len(parts) == 2 and parts[0] == 'patterns' and method == 'GET':
                key = identifier(parts[1])
                if not any(p['id'] == key for p in index['patterns']):
                    raise FileNotFoundError('Pattern not found.')
                path = root / (key + '.zip')
                if path.is_symlink():
                    raise ValueError('Invalid pattern path.')
                body = path.read_bytes()
                handler.send_response(200)
                handler.send_header('Content-Type', 'application/zip')
                handler.send_header('Content-Length', str(len(body)))
                handler.send_header('Cache-Control', 'private, no-store')
                handler.end_headers()
                handler.wfile.write(body)
            else:
                raise FileNotFoundError('Library route not found.')
    except FileNotFoundError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=404, extra_headers=headers)
    except (ValueError, KeyError, zipfile.BadZipFile, TypeError) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    return True
