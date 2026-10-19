import json
import os
import pathlib
import secrets
import tempfile
import threading
import time
from urllib.parse import urlparse


ARPS_ROOT = pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-arps')
ARPS_LOCK = threading.RLock()
MAX_PRESETS = 1000


def validate_pattern(pattern):
    if not isinstance(pattern, dict) or type(pattern.get('version')) is not int or pattern['version'] != 1:
        raise ValueError('Unsupported arp pattern version.')
    steps = pattern.get('steps')
    if not isinstance(steps, list) or not 1 <= len(steps) <= 32 or any(type(rank) is not int or not 0 <= rank <= 8 for rank in steps):
        raise ValueError('Arp patterns need 1–32 pulses: 0 for a gap, 1–8 for chord-note order.')
    division = pattern.get('division')
    if type(division) not in (int, float) or division not in (4, 2, 1, .5, 1 / 3, .25, 1 / 6, .125, 1 / 12, .0625, .03125):
        raise ValueError('Invalid arp time division.')
    if pattern.get('repeat') not in ('once', 'until-next'):
        raise ValueError('Invalid arp repeat mode.')
    return {'version': 1, 'steps': steps[:], 'division': division, 'repeat': pattern['repeat']}


def clean_name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(character) < 32 for character in value):
        raise ValueError('Arp names need 1–80 characters without control characters.')
    return value.strip()


def storage_path():
    target = ARPS_ROOT / 'library.json'
    if ARPS_ROOT.is_symlink() or target.is_symlink():
        raise ValueError('Arp storage cannot use symbolic links.')
    return target


def read_library():
    target = storage_path()
    if not target.exists():
        return {'version': 1, 'revision': 0, 'presets': []}
    with target.open(encoding='utf-8') as stream:
        library = json.load(stream)
    if not isinstance(library, dict) or library.get('version') != 1 or type(library.get('revision')) is not int or library['revision'] < 0 or not isinstance(library.get('presets'), list) or len(library['presets']) > MAX_PRESETS:
        raise ValueError('Arp storage needs repair; no presets were overwritten.')
    identifiers = set()
    names = set()
    for preset in library['presets']:
        if not isinstance(preset, dict) or not isinstance(preset.get('id'), str) or len(preset['id']) != 32 or any(character not in '0123456789abcdef' for character in preset['id']) or preset['id'] in identifiers:
            raise ValueError('Arp preset identity is invalid; no presets were overwritten.')
        name = clean_name(preset.get('name')).casefold()
        if name in names:
            raise ValueError('Duplicate arp preset names; no presets were overwritten.')
        names.add(name)
        identifiers.add(preset['id'])
        validate_pattern(preset.get('pattern'))
    return library


def save_preset(library, request):
    name = clean_name(request.get('name'))
    pattern = validate_pattern(request.get('pattern'))
    if any(preset['name'].casefold() == name.casefold() for preset in library['presets']):
        raise ValueError('That arp name already exists. Use a new name; existing shared presets will not be overwritten.')
    if len(library['presets']) >= MAX_PRESETS:
        raise ValueError('The shared arp repository is full. No existing presets were removed.')
    identifier = secrets.token_hex(16)
    library['presets'].append({'id': identifier, 'name': name, 'pattern': pattern, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    library['revision'] += 1
    target = storage_path()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent, delete=False) as stream:
            temporary = pathlib.Path(stream.name)
            json.dump(library, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return identifier


def handle_arps_request(handler, method, inner_path):
    if inner_path != '/api/arps':
        return False
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
    try:
        if method == 'POST':
            origin = handler.headers.get('Origin')
            if origin and urlparse(origin).netloc != handler.headers.get('Host'):
                raise PermissionError('Arp saves must come from this site.')
            if handler.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise PermissionError('Cross-site arp saves are not allowed.')
            if handler.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
                raise ValueError('Arp saves need JSON content.')
            length = int(handler.headers.get('Content-Length', 0))
            if not 2 <= length <= 8192:
                raise ValueError('Arp requests must be 2–8192 bytes.')
            request = json.loads(handler.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('Arp save must be an object.')
        elif method != 'GET':
            raise ValueError('Unsupported arp repository method.')
        with ARPS_LOCK:
            library = read_library()
            saved = save_preset(library, request) if method == 'POST' else None
            handler.send_json({'ok': True, **library, 'savedId': saved}, extra_headers=headers)
    except PermissionError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=403, extra_headers=headers)
    except (ValueError, TypeError, KeyError) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    except OSError:
        handler.send_json({'ok': False, 'error': 'Arp storage is unavailable. No save was confirmed.'}, status=500, extra_headers=headers)
    return True
