"""Account-private, atomic rendered ideas. No item count or aggregate byte quota.

The existing authenticated plugin-library dispatcher owns identity/CSRF. Scratchpad
has its own store, outside bin quotas and all ordinary repository listings.
"""
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import time
import wave
import zipfile
from urllib.parse import parse_qs, urlparse

BASE = '/api/plugin-library/scratchpad'
PRIVATE = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
# Per-request admission is not a library quota. Keep normal source ZIP admission.
MAX_PATCH = 128 * 1024 * 1024
MAX_WAV = 256 * 1024 * 1024
MAX_UPLOAD = MAX_PATCH + MAX_WAV + 65536
FIELDS = 'id,name,folder,created,updated,revision,frames,sampleRate,audioBytes,patchBytes,audioSha256,patchSha256'

class Error(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

def name(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 120 or any(ord(c) < 32 for c in value):
        raise Error('Use a name of 1–120 characters.')
    return value.strip()

def read(handler, maximum, kind):
    lengths = handler.headers.get_all('Content-Length', [])
    if handler.headers.get('Transfer-Encoding') or handler.headers.get('Content-Encoding') or len(lengths) != 1 or not lengths[0].isdigit():
        raise Error('A plain content length is required.', 411)
    size = int(lengths[0])
    if not 0 < size <= maximum:
        raise Error('This request exceeds the safe transfer size. Existing ideas are unchanged.', 413)
    if handler.headers.get('Content-Type', '').split(';')[0].strip().lower() != kind:
        raise Error('Invalid content type.', 415)
    body = handler.rfile.read(size)
    if len(body) != size:
        raise Error('Incomplete upload.')
    return body

def payload(handler):
    value = json.loads(read(handler, 8192, 'application/json'))
    if not isinstance(value, dict):
        raise Error('Expected an object.')
    return value

def connect(accounts, user, checked):
    directory = checked(accounts.users_root / user['id'] / 'scratchpad', accounts.users_root)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    path = checked(directory / 'ideas.sqlite3', directory)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY,name TEXT,folded TEXT UNIQUE,created REAL)')
        db.execute('''CREATE TABLE IF NOT EXISTS ideas (id TEXT PRIMARY KEY,name TEXT,folder TEXT REFERENCES folders(id),created REAL,updated REAL,revision INTEGER,frames INTEGER,sampleRate INTEGER,audioBytes INTEGER,patchBytes INTEGER,audioSha256 TEXT,patchSha256 TEXT,audio BLOB,patch BLOB,deleted REAL)''')
        db.execute('CREATE INDEX IF NOT EXISTS idea_listing ON ideas(deleted,folder,created)')
        db.commit()
        os.chmod(path, 0o600)
        return db
    except BaseException:
        db.close()
        raise

def folder(db, ident):
    if ident is not None and (not isinstance(ident, str) or not re.fullmatch('[a-f0-9]{32}', ident) or not db.execute('SELECT 1 FROM folders WHERE id=?', (ident,)).fetchone()):
        raise Error('Folder not found.', 404)
    return ident

def paired(body, validate_part):
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            entries = archive.infolist()
            if len(entries) != 2 or {e.filename for e in entries} != {'render.wav', 'pattern.zip'} or any(e.compress_type != zipfile.ZIP_STORED or e.flag_bits & 9 for e in entries):
                raise Error('An idea requires both its WAV and editable patch.')
            wav_size, patch_size = archive.getinfo('render.wav').file_size, archive.getinfo('pattern.zip').file_size
            if wav_size < 44 or patch_size < 22:
                raise Error('Invalid WAV or editable patch.')
            if wav_size > MAX_WAV or patch_size > MAX_PATCH:
                raise Error('WAV or editable patch exceeds its transfer limit.', 413)
            wav, patch = archive.read('render.wav'), archive.read('pattern.zip')
        validate_part(patch)
        if wav[:4] != b'RIFF' or wav[8:12] != b'WAVE' or int.from_bytes(wav[4:8], 'little') + 8 != len(wav):
            raise Error('Incomplete WAV.')
        with wave.open(io.BytesIO(wav), 'rb') as audio:
            frames, rate = audio.getnframes(), audio.getframerate()
            if audio.getnchannels() not in (1, 2) or audio.getsampwidth() not in (2, 3, 4) or not 8000 <= rate <= 192000 or frames < 1 or audio._data_chunk.chunksize != frames * audio.getnchannels() * audio.getsampwidth():
                raise Error('Invalid WAV.')
            remaining = frames
            frame_bytes = audio.getnchannels() * audio.getsampwidth()
            while remaining:
                chunk = audio.readframes(min(remaining, 65536))
                if not chunk or len(chunk) % frame_bytes:
                    raise Error('Incomplete WAV audio data.')
                remaining -= len(chunk) // frame_bytes
        return wav, patch, frames, rate
    except Error:
        raise
    except (ValueError, KeyError, zipfile.BadZipFile, wave.Error, EOFError, OverflowError) as error:
        raise Error('Invalid idea or editable patch: ' + str(error)[:200]) from error

def handle(handler, method, inner, accounts, user, checked, validate_part):
    try:
        if not user:
            raise Error('Login required.', 401)
        match = re.fullmatch(re.escape(BASE) + r'(?:/(folders|items)(?:/([a-f0-9]{32})(?:/(audio|patch))?)?)?', inner)
        if not match:
            raise Error('Scratchpad route not found.', 404)
        group, ident, asset = match.groups()
        query = parse_qs(urlparse(handler.path).query, keep_blank_values=True)
        creating = group == 'items' and ident is None and method == 'POST'
        body = None
        if creating:
            if set(query) - {'name', 'folder'} or any(len(v) != 1 for v in query.values()):
                raise Error('Invalid save options.')
            title = name(query.get('name', [''])[0])
            body = paired(read(handler, MAX_UPLOAD, 'application/zip'), validate_part)
        elif method == 'POST':
            body = payload(handler)
        elif method not in ('GET', 'HEAD', 'DELETE'):
            raise Error('Method not allowed.', 405)
        with accounts.user_lock(user):
            db = connect(accounts, user, checked)
            try:
                with db:
                    if method in ('POST', 'DELETE'):
                        db.execute('BEGIN IMMEDIATE')
                    if group == 'folders' and method == 'POST' and not ident:
                        if set(body) != {'name'}:
                            raise Error('Only a folder name is allowed.')
                        title = name(body['name']);new_id = secrets.token_hex(16)
                        db.execute('INSERT INTO folders VALUES (?,?,?,?)', (new_id, title, title.casefold(), time.time()))
                        result = {'ok': True, 'id': new_id, 'name': title}
                    elif creating:
                        destination = folder(db, query.get('folder', [None])[0] or None)
                        wav, patch, frames, rate = body
                        new_id, now = secrets.token_hex(16), time.time()
                        db.execute('INSERT INTO ideas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)', (new_id, title, destination, now, now, 1, frames, rate, len(wav), len(patch), hashlib.sha256(wav).hexdigest(), hashlib.sha256(patch).hexdigest(), wav, patch))
                        result = {'ok': True, 'item': dict(db.execute('SELECT '+FIELDS+' FROM ideas WHERE id=?', (new_id,)).fetchone())}
                    elif group == 'items' and ident:
                        row = db.execute('SELECT '+FIELDS+' FROM ideas WHERE id=? AND deleted IS NULL', (ident,)).fetchone()
                        if not row:
                            raise Error('Idea not found.', 404)
                        if method in ('GET', 'HEAD'):
                            if asset not in ('audio', 'patch'):
                                raise Error('Choose audio or patch.', 404)
                            result = bytes(db.execute('SELECT '+asset+' FROM ideas WHERE id=?', (ident,)).fetchone()[0])
                        elif method == 'POST' and not asset:
                            if set(body) - {'revision', 'name', 'folder'} or set(body) == {'revision'} or type(body.get('revision')) is not int:
                                raise Error('Use a name or folder and the current revision.')
                            if body['revision'] != row['revision']:
                                raise Error('This idea changed elsewhere. Refresh and try again.', 409)
                            title = name(body['name']) if 'name' in body else row['name']
                            destination = folder(db, body['folder']) if 'folder' in body else row['folder']
                            db.execute('UPDATE ideas SET name=?,folder=?,updated=?,revision=revision+1 WHERE id=?', (title, destination, time.time(), ident))
                            result = {'ok': True, 'item': dict(db.execute('SELECT '+FIELDS+' FROM ideas WHERE id=?', (ident,)).fetchone())}
                        elif method == 'DELETE' and not asset:
                            if handler.headers.get('If-Match') != str(row['revision']):
                                raise Error('This idea changed elsewhere. Refresh before deleting.', 409)
                            # Private recovery retains both assets; normal APIs no longer expose them.
                            db.execute('UPDATE ideas SET deleted=?,revision=revision+1 WHERE id=?', (time.time(), ident))
                            result = {'ok': True, 'deleted': ident}
                        else:
                            raise Error('Method not allowed.', 405)
                    elif not group and method in ('GET', 'HEAD'):
                        if set(query) - {'folder', 'q', 'offset', 'limit'} or any(len(v) != 1 for v in query.values()):
                            raise Error('Invalid listing options.')
                        limit, offset = int(query.get('limit', ['50'])[0]), int(query.get('offset', ['0'])[0])
                        if not 1 <= limit <= 200 or not 0 <= offset <= 1000000000:
                            raise Error('Invalid page.')
                        clauses, values = ['deleted IS NULL'], []
                        if 'folder' in query and query['folder'][0] != 'all':
                            destination = folder(db, query['folder'][0] or None)
                            clauses.append('folder IS ?');values.append(destination)
                        search = query.get('q', [''])[0]
                        if len(search) > 120:
                            raise Error('Search is too long.')
                        if search:
                            clauses.append("name LIKE ? ESCAPE '\\'");values.append('%'+search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%')
                        where = ' AND '.join(clauses)
                        total = db.execute('SELECT COUNT(*) FROM ideas WHERE '+where, values).fetchone()[0]
                        rows = db.execute('SELECT '+FIELDS+' FROM ideas WHERE '+where+' ORDER BY created DESC,id LIMIT ? OFFSET ?', (*values, limit, offset)).fetchall()
                        result = {'ok': True, 'items': [dict(r) for r in rows], 'total': total, 'offset': offset, 'limit': limit, 'folders': [dict(r) for r in db.execute('SELECT id,name FROM folders ORDER BY folded')], 'capacityLimit': None}
                    else:
                        raise Error('Method not allowed.', 405)
            finally:
                db.close()
        if isinstance(result, bytes):
            handler.send_response(200)
            for key, value in PRIVATE.items():handler.send_header(key, value)
            handler.send_header('Content-Type', 'audio/wav' if asset == 'audio' else 'application/zip')
            handler.send_header('Content-Length', str(len(result)))
            handler.end_headers()
            if method != 'HEAD':handler.wfile.write(result)
            return
        return handler.send_json(result, status=201 if creating or group == 'folders' and method == 'POST' else 200, extra_headers=PRIVATE)
    except sqlite3.IntegrityError:
        return handler.send_json({'ok': False, 'error': 'A folder with that name already exists.'}, status=409, extra_headers=PRIVATE)
    except (Error, ValueError, OSError, sqlite3.Error) as error:
        handler.close_connection = True
        return handler.send_json({'ok': False, 'error': str(error) if isinstance(error, Error) else 'Invalid request or unavailable Scratchpad storage.'}, status=getattr(error, 'status', 400), extra_headers=PRIVATE)
