"""Private Wasp libraries, isolated by authenticated stable account ID."""
import json
import os
import pathlib
import re
import secrets
import tempfile
import time

class Conflict(ValueError):
    pass

def location(accounts, user, checked_path):
    uid = user['id']
    if not isinstance(uid, str) or not re.fullmatch(r'[a-f0-9]{32}', uid):
        raise ValueError('Invalid account identity.')
    return checked_path(accounts.users_root / uid / 'wasp-patches' / 'library.json', accounts.users_root)

def read_library(path):
    if not path.exists():
        return {'version': 1, 'revision': 0, 'patches': []}
    if path.stat().st_size > 8 * 1024 * 1024:
        raise OSError('Wasp library is too large.')
    try:
        value = json.loads(path.read_text())
        if value['version'] != 1 or type(value['revision']) is not int or value['revision'] < 0 or not isinstance(value['patches'], list) or len(value['patches']) > 256:
            raise ValueError()
        ids = set()
        for item in value['patches']:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', item['id']) or item['id'] in ids or clean_name(item.get('name')) != item['name'] or not isinstance(item.get('settings'), dict):
                raise ValueError()
            ids.add(item['id'])
        return value
    except (ValueError, KeyError, TypeError) as error:
        raise OSError('Wasp library cannot be read safely.') from error

def clean_name(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 80 or any(ord(c) < 32 for c in value):
        raise ValueError('Use a patch name of 1–80 characters.')
    return value.strip()

def mutate(library, payload, validate_settings):
    if type(payload.get('revision')) is not int or payload['revision'] != library['revision']:
        raise Conflict('Your Wasp library changed on another device. Refresh before saving.')
    result = json.loads(json.dumps(library))
    patches = result['patches']; action = payload.get('action')
    if action not in {'save', 'replace', 'rename', 'delete'}:
        raise ValueError('Unknown Wasp patch action.')
    selected = None
    if action != 'save':
        selected = next((p for p in patches if p['id'] == payload.get('id')), None)
        if selected is None:
            raise FileNotFoundError('Wasp patch not found in your library.')
    if action in {'save', 'rename'}:
        name = clean_name(payload.get('name'))
        if any(p['name'].casefold() == name.casefold() and p is not selected for p in patches):
            raise ValueError('That patch name already exists. Choose Replace or another name.')
    if action in {'save', 'replace'}:
        settings = payload.get('settings')
        if not isinstance(settings, dict):
            raise ValueError('Missing Wasp settings.')
        validate_settings(settings)
        settings = json.loads(json.dumps(settings, allow_nan=False)); settings['enabled'] = False
    if action == 'save':
        if len(patches) >= 256:
            raise ValueError('Your library is full (256 patches). Delete a patch first.')
        selected = {'id': secrets.token_hex(16), 'name': name, 'createdAt': time.time()}
        patches.append(selected)
    if action in {'save', 'replace'}:
        selected['settings'] = settings
    if action == 'rename':
        selected['name'] = name
    if action == 'delete':
        patches.remove(selected)
    else:
        selected['updatedAt'] = time.time()
    result['revision'] += 1
    return result, selected['id']

def write_library(path, library):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.wasp-', delete=False) as stream:
            temporary = stream.name
            json.dump(library, stream, ensure_ascii=False, allow_nan=False)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path); temporary = None
    finally:
        if temporary:
            os.unlink(temporary)

def handle_request(handler, method, accounts, user, checked_path, validate_settings):
    headers = {'Cache-Control': 'private, no-store'}
    try:
        if method not in {'GET', 'HEAD', 'POST'}:
            return handler.send_json({'ok': False, 'error': 'Method not allowed.'}, status=405, extra_headers=headers)
        payload = None
        if method == 'POST':
            length = int(handler.headers.get('Content-Length', '0'))
            if not 2 <= length <= 16384 or handler.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ValueError('Expected a small JSON Wasp patch request.')
            payload = json.loads(handler.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Expected a JSON object.')
        with accounts.user_lock(user):
            path = location(accounts, user, checked_path)
            library = read_library(path); selected = None
            if payload is not None:
                library, selected = mutate(library, payload, validate_settings)
                write_library(path, library)
        handler.send_json({'ok': True, **library, 'selectedId': selected}, extra_headers=headers)
    except Conflict as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=409, extra_headers=headers)
    except FileNotFoundError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=404, extra_headers=headers)
    except (ValueError, TypeError, KeyError) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    except OSError:
        handler.send_json({'ok': False, 'error': 'Wasp storage unavailable. No save was confirmed.'}, status=500, extra_headers=headers)
