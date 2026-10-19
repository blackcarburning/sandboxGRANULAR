import json
import os
import pathlib
import secrets
import tempfile
import threading
from urllib.parse import urlparse


FAVOURITES_ROOT = pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-favourites')
FAVOURITES_LOCK = threading.RLock()
MAX_GROUPS = 100
MAX_ITEMS = 10000


def clean_text(value, maximum, label):
    if not isinstance(value, str):
        raise ValueError(f'{label} must be text.')
    text = value.strip()
    if not text or len(text) > maximum or any(ord(character) < 32 for character in text):
        raise ValueError(f'{label} must contain 1–{maximum} characters without control characters.')
    return text


def storage_path():
    if FAVOURITES_ROOT.is_symlink() or (FAVOURITES_ROOT / 'library.json').is_symlink():
        raise ValueError('Favourite storage cannot use symbolic links.')
    return FAVOURITES_ROOT / 'library.json'


def read_library():
    target = storage_path()
    if not target.exists():
        return {'version': 1, 'revision': 0, 'groups': [{'id': 'default', 'name': 'Favourites', 'items': {}}]}
    with target.open(encoding='utf-8') as stream:
        library = json.load(stream)
    if not isinstance(library, dict) or library.get('version') != 1 or not isinstance(library.get('groups'), list) or not library['groups']:
        raise ValueError('Favourite storage needs repair; no data was overwritten.')
    if not isinstance(library.get('revision'), int) or library['revision'] < 0:
        raise ValueError('Favourite storage revision is invalid; no data was overwritten.')
    for group in library['groups']:
        if not isinstance(group, dict) or not isinstance(group.get('items'), dict):
            raise ValueError('Favourite collection data is invalid; no data was overwritten.')
        clean_text(group.get('id'), 80, 'Collection ID')
        clean_text(group.get('name'), 80, 'Collection name')
        for key, item in group['items'].items():
            clean_text(key, 4096, 'Favourite key')
            if not isinstance(item, dict):
                raise ValueError('Favourite item data is invalid; no data was overwritten.')
            clean_text(item.get('name'), 240, 'Favourite name')
    return library


def write_library(library):
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


def mutate_library(library, request):
    operation = request.get('operation')
    if operation == 'rekey':
        old_key = clean_text(request.get('oldKey'), 4096, 'Original favourite key')
        new_key = clean_text(request.get('newKey'), 4096, 'New favourite key')
        if old_key != new_key:
            for group in library['groups']:
                item = group['items'].pop(old_key, None)
                if item is not None and new_key not in group['items']:
                    group['items'][new_key] = item
        return None
    if operation == 'create':
        name = clean_text(request.get('name'), 80, 'Collection name')
        if len(library['groups']) >= MAX_GROUPS:
            raise ValueError('The favourite collection limit has been reached.')
        if any(group['name'].casefold() == name.casefold() for group in library['groups']):
            raise ValueError('That favourite collection already exists.')
        group = {'id': secrets.token_hex(16), 'name': name, 'items': {}}
        library['groups'].append(group)
        return group['id']
    group_id = clean_text(request.get('groupId'), 80, 'Collection ID')
    group = next((group for group in library['groups'] if group['id'] == group_id), None)
    if group is None:
        raise FileNotFoundError('That favourite collection no longer exists. Refresh favourites.')
    if operation == 'rename':
        name = clean_text(request.get('name'), 80, 'Collection name')
        if any(other['id'] != group_id and other['name'].casefold() == name.casefold() for other in library['groups']):
            raise ValueError('That favourite collection already exists.')
        group['name'] = name
    elif operation == 'delete':
        if len(library['groups']) == 1:
            raise ValueError('Keep at least one favourite collection. Remove its hearts individually instead.')
        library['groups'].remove(group)
    elif operation in ('set', 'label'):
        key = clean_text(request.get('key'), 4096, 'Favourite key')
        if operation == 'set' and request.get('selected') is False:
            group['items'].pop(key, None)
        else:
            if operation == 'set' and request.get('selected') is not True:
                raise ValueError('Selected must be true or false.')
            if operation == 'label' and key not in group['items']:
                raise FileNotFoundError('That item is no longer in this favourite collection.')
            name = clean_text(request.get('name'), 240, 'Favourite name')
            if key not in group['items'] and sum(len(entry['items']) for entry in library['groups']) >= MAX_ITEMS:
                raise ValueError('The favourite item limit has been reached.')
            group['items'][key] = {'name': name}
    else:
        raise ValueError('Unknown favourite operation.')
    return group_id


def handle_favourites_request(handler, method, inner_path):
    if inner_path != '/api/favourites':
        return False
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
    try:
        if method == 'POST':
            origin = handler.headers.get('Origin')
            if origin and urlparse(origin).netloc != handler.headers.get('Host'):
                raise PermissionError('Favourite changes must come from this site.')
            length = int(handler.headers.get('Content-Length', 0))
            if length < 2 or length > 16384:
                raise ValueError('Favourite request must be 2–16384 bytes.')
            request = json.loads(handler.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('Favourite request must be an object.')
        elif method != 'GET':
            raise ValueError('Unsupported favourite method.')
        with FAVOURITES_LOCK:
            library = read_library()
            selected = None
            if method == 'POST':
                selected = mutate_library(library, request)
                library['revision'] += 1
                write_library(library)
            handler.send_json({'ok': True, **library, 'selectedGroupId': selected}, extra_headers=headers)
    except PermissionError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=403, extra_headers=headers)
    except FileNotFoundError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=404, extra_headers=headers)
    except (ValueError, TypeError, KeyError) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    except OSError:
        handler.send_json({'ok': False, 'error': 'Favourite storage is unavailable. No changes were confirmed.'}, status=500, extra_headers=headers)
    return True
