"""Account-private editable AI part slots, using unchanged Song-part ZIPs."""
import base64
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from urllib.parse import parse_qs, urlsplit
import zipfile
import wave

_spec = importlib.util.spec_from_file_location('ai_parts_song_validator', Path(__file__).with_name('mygrain_songs.py'))
songs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(songs)
MAX_BYTES = 128 * 1024 * 1024
MAX_STORED_BYTES = 1024 * 1024 * 1024
MAX_OBJECTS = 256
HEADERS = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}


class Conflict(ValueError):
    pass


def text(value, label, maximum, minimum=1):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum or any(ord(c) < 32 and (label != 'Prompt' or c not in '\n\t') for c in value):
        raise ValueError(f'{label} needs {minimum}–{maximum} characters.')
    return value.strip()


def slot_number(value):
    if type(value) is not int or not 1 <= value <= 5:
        raise ValueError('Choose Take 1–5.')
    return value


def revision_number(value):
    if type(value) is not int or not 0 <= value <= 1000000:
        raise ValueError('Refresh the part slots before saving.')
    return value


def validate_meta(meta):
    if not isinstance(meta, dict) or set(meta) != {'slot', 'revision', 'name', 'prompt', 'section', 'repeats'}:
        raise ValueError('Invalid part details.')
    meta = dict(meta)
    slot_number(meta['slot']); revision_number(meta['revision'])
    meta['name'] = text(meta['name'], 'Name', 100)
    meta['prompt'] = text(meta['prompt'], 'Prompt', 1500, 0)
    if type(meta['repeats']) is not int or not 1 <= meta['repeats'] <= 64:
        raise ValueError('Use 1–64 whole-pattern repeats.')
    section = meta['section']
    if section is not None and (not isinstance(section, dict) or set(section) != {'type', 'bars', 'rolls'} or section['type'] not in ('verse', 'chorus', 'bridge', 'middle8') or type(section['bars']) is not int or section['bars'] not in (4, 8, 16) or type(section['rolls']) is not bool or (section['type'] == 'middle8' and section['bars'] != 8)):
        raise ValueError('Invalid section direction.')
    return meta


def paths(database, owner):
    if database is None:
        raise OSError('Part storage is not configured.')
    if not isinstance(owner, str) or not re.fullmatch(r'[a-f0-9]{32}', owner):
        raise ValueError('Invalid account identity.')
    database = Path(database)
    if database.is_symlink():
        raise OSError('Part storage cannot use symbolic links.')
    database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        descriptor = os.open(database, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    except FileExistsError:
        pass
    else:
        os.close(descriptor)
    root = database.parent / 'ai-part-audio'
    for directory in (root, root / owner):
        if directory.is_symlink():
            raise OSError('Invalid part storage directory.')
        directory.mkdir(exist_ok=True, mode=0o700)
    return database, root / owner


def connect(database):
    db = sqlite3.connect(database.resolve().as_uri() + '?mode=rw', uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    with db:
        db.execute('CREATE TABLE IF NOT EXISTS slots(owner TEXT NOT NULL,slot INTEGER NOT NULL,meta TEXT NOT NULL,PRIMARY KEY(owner,slot))')
        db.execute('CREATE TABLE IF NOT EXISTS history(owner TEXT NOT NULL,slot INTEGER NOT NULL,revision INTEGER NOT NULL,meta TEXT NOT NULL,PRIMARY KEY(owner,slot,revision))')
    return db


def rows(db, owner):
    return [json.loads(row['meta']) for row in db.execute('SELECT meta FROM slots WHERE owner=? ORDER BY slot', (owner,))]


def library(database, owner, action='list', meta=None, body=None, slot=None):
    if action not in ('list', 'store', 'rename', 'read'):
        raise ValueError('Unsupported part action.')
    if action == 'store':
        meta = validate_meta(meta)
        if not isinstance(body, bytes) or not 1 <= len(body) <= MAX_BYTES:
            raise ValueError('The part exceeds the 128 MB limit or is empty.')
        details = songs.validate_part_zip(body)
        if meta['section'] is not None and (details['patternSteps'] != 64 or meta['repeats'] * 4 != meta['section']['bars']):
            raise ValueError('Section length does not match its four-bar pattern and repeats.')
    elif action == 'rename':
        if not isinstance(meta, dict) or set(meta) != {'slot', 'revision', 'name'}:
            raise ValueError('Rename a slot and name only.')
        meta = {**meta, 'name': text(meta['name'], 'Name', 100)}
        slot_number(meta['slot']); revision_number(meta['revision'])
    elif action == 'read':
        slot_number(slot)
    database, root = paths(database, owner)
    with closing(connect(database)) as db:
        if action in ('store', 'rename'):
            db.execute('BEGIN IMMEDIATE')
            with db:
                previous = db.execute('SELECT meta FROM slots WHERE owner=? AND slot=?', (owner, meta['slot'])).fetchone()
                previous = json.loads(previous['meta']) if previous else None
                if (previous['revision'] if previous else 0) != meta['revision']:
                    raise Conflict('This take changed on another device. Refresh slots before storing or renaming; nothing was overwritten.')
                if action == 'rename' and previous is None:
                    raise ValueError('Store this take before renaming it.')
                if action == 'store':
                    digest = hashlib.sha256(body).hexdigest()
                    target = root / (digest + '.zip')
                    if target.is_symlink():
                        raise OSError('Invalid part object.')
                    if not target.exists():
                        objects = list(root.glob('*.zip'))
                        if len(objects) >= MAX_OBJECTS or sum(p.stat().st_size for p in objects) + len(body) > MAX_STORED_BYTES:
                            raise ValueError('Your AI part storage limit has been reached. Existing takes are unchanged.')
                        temporary = root / (digest + '-' + secrets.token_hex(8) + '.tmp')
                        try:
                            with temporary.open('xb') as output:
                                os.chmod(temporary, 0o600)
                                output.write(body); output.flush(); os.fsync(output.fileno())
                            temporary.replace(target)
                        finally:
                            temporary.unlink(missing_ok=True)
                    else:
                        if target.stat().st_size != len(body) or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                            raise OSError('Part object integrity failure.')
                    saved = {**meta, **details, 'sha256': digest, 'bytes': len(body)}
                else:
                    saved = {**previous, 'name': meta['name']}
                saved.update(revision=meta['revision'] + 1, updatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
                if previous:
                    db.execute('INSERT INTO history(owner,slot,revision,meta) VALUES(?,?,?,?)', (owner, previous['slot'], previous['revision'], json.dumps(previous)))
                db.execute('INSERT OR REPLACE INTO slots(owner,slot,meta) VALUES(?,?,?)', (owner, saved['slot'], json.dumps(saved)))
        entries = rows(db, owner)
        if action == 'read':
            entry = next((item for item in entries if item['slot'] == slot), None)
            if entry is None:
                raise FileNotFoundError('That take is not stored in your account.')
            path = root / (entry['sha256'] + '.zip')
            if path.is_symlink() or not path.is_file() or path.stat().st_size != entry['bytes'] or path.stat().st_size > MAX_BYTES:
                raise OSError('Stored take is missing or changed.')
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != entry['sha256']:
                raise OSError('Stored take integrity check failed.')
            return entry, data
        return {'ok': True, 'parts': entries, 'slots': 5}


def handle_request(handler, method, database):
    if not getattr(handler, 'mygrain_user', None):
        handler.send_json({'ok': False, 'error': 'Sign in to use saved AI parts.'}, status=401, extra_headers=HEADERS)
        return True
    try:
        owner = handler.mygrain_user['id']
        if method == 'GET':
            query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
            if query:
                if set(query) != {'slot'} or len(query['slot']) != 1 or query['slot'][0] not in ('1', '2', '3', '4', '5'):
                    raise ValueError('Choose a stored take slot.')
                meta, data = library(database, owner, action='read', slot=int(query['slot'][0]))
                handler.send_response(200)
                for key, value in {'Content-Type': 'application/zip', 'Content-Length': str(len(data)), 'X-Mygrain-AI-Part': base64.urlsafe_b64encode(json.dumps(meta).encode()).decode(), **HEADERS}.items():
                    handler.send_header(key, value)
                handler.end_headers(); handler.wfile.write(data)
                return True
            result = library(database, owner)
        elif method == 'POST':
            content_type = handler.headers.get('Content-Type', '').split(';')[0].strip().lower()
            length = int(handler.headers.get('Content-Length', 0))
            if content_type == 'application/zip':
                if not 1 <= length <= MAX_BYTES:
                    raise ValueError('The part exceeds the 128 MB limit or is empty.')
                encoded = handler.headers.get('X-Mygrain-AI-Part', '')
                if not 1 <= len(encoded) <= 10000:
                    raise ValueError('Invalid part metadata header.')
                meta = json.loads(base64.b64decode(encoded, altchars=b'-_', validate=True))
                validate_meta(meta)
                body = handler.rfile.read(length)
                if len(body) != length:
                    raise ValueError('The part upload was incomplete.')
                result = library(database, owner, action='store', meta=meta, body=body)
            elif content_type == 'application/json' and 2 <= length <= 2048:
                meta = json.loads(handler.rfile.read(length))
                result = library(database, owner, action='rename', meta=meta)
            else:
                raise ValueError('Store a part ZIP or rename with JSON.')
        else:
            raise ValueError('Use GET or POST for AI parts.')
        handler.send_json(result, extra_headers=HEADERS)
    except Conflict as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=409, extra_headers=HEADERS)
    except FileNotFoundError:
        handler.send_json({'ok': False, 'error': 'That take is not stored in your account.'}, status=404, extra_headers=HEADERS)
    except ValueError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=HEADERS)
    except (TypeError, KeyError, UnicodeError, EOFError, zipfile.BadZipFile, wave.Error):
        handler.send_json({'ok': False, 'error': 'Invalid take request or archive. Existing takes and your live patch are unchanged.'}, status=400, extra_headers=HEADERS)
    except (OSError, sqlite3.Error):
        handler.send_json({'ok': False, 'error': 'Take storage unavailable. No save was confirmed; refresh the slots before retrying.'}, status=503, extra_headers=HEADERS)
    return True
