"""Small account-private prompt library, separate from auth and audio stores."""
from contextlib import closing
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time

MAX_PROMPTS = 200


def clean_text(value, label, minimum, maximum, multiline=False):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum or any(ord(c) < 32 and (not multiline or c not in '\n\t') for c in value):
        raise ValueError(f'{label} needs {minimum}–{maximum} characters.')
    return value.strip()


def library(database, owner, request=None):
    if database is None:
        raise OSError('Prompt storage is not configured.')
    if not isinstance(owner, str) or not re.fullmatch(r'[a-f0-9]{32}', owner):
        raise ValueError('Invalid account identity.')
    if request is not None:
        if not isinstance(request, dict) or request.get('action') not in ('save', 'remove'):
            raise ValueError('Use save or remove for prompt storage.')
        if request['action'] == 'save':
            if set(request) != {'action', 'name', 'prompt'}:
                raise ValueError('Save a name and prompt only.')
            name = clean_text(request['name'], 'Prompt name', 1, 80)
            prompt = clean_text(request['prompt'], 'Prompt', 3, 1500, multiline=True)
        elif set(request) != {'action', 'id'} or not isinstance(request['id'], str) or not re.fullmatch(r'[a-f0-9]{32}', request['id']):
            raise ValueError('Invalid saved prompt identity.')
    database = Path(database)
    if database.is_symlink():
        raise OSError('Prompt storage cannot use symbolic links.')
    database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        fd = os.open(database, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=rw', uri=True, timeout=5)) as db:
        db.row_factory = sqlite3.Row
        with db:
            db.execute('''CREATE TABLE IF NOT EXISTS prompts (
                owner TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
                name_key TEXT NOT NULL, prompt TEXT NOT NULL, created_at TEXT NOT NULL,
                removed_at TEXT, PRIMARY KEY(owner, id))''')
            db.execute('CREATE UNIQUE INDEX IF NOT EXISTS prompts_live_names ON prompts(owner, name_key) WHERE removed_at IS NULL')
        saved_id = None
        # Serialize count/name checks with writes across tabs and server threads.
        if request is not None:
            db.execute('BEGIN IMMEDIATE')
            with db:
                if request['action'] == 'save':
                    existing = db.execute('SELECT id,prompt FROM prompts WHERE owner=? AND name_key=? AND removed_at IS NULL', (owner, name.casefold())).fetchone()
                    if existing:
                        if existing['prompt'] != prompt:
                            raise ValueError('That prompt name already exists. Choose another name; nothing was overwritten.')
                        saved_id = existing['id']
                    else:
                        if db.execute('SELECT count(*) FROM prompts WHERE owner=? AND removed_at IS NULL', (owner,)).fetchone()[0] >= MAX_PROMPTS:
                            raise ValueError('Your prompt library is full. Remove an old prompt before saving another.')
                        saved_id = secrets.token_hex(16)
                        db.execute('INSERT INTO prompts(owner,id,name,name_key,prompt,created_at) VALUES(?,?,?,?,?,?)', (owner, saved_id, name, name.casefold(), prompt, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())))
                else:
                    changed = db.execute('UPDATE prompts SET removed_at=? WHERE owner=? AND id=? AND removed_at IS NULL', (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), owner, request['id'])).rowcount
                    if not changed:
                        raise ValueError('That prompt is not in your library. Refresh the list.')
        rows = db.execute('SELECT id,name,prompt,created_at AS createdAt FROM prompts WHERE owner=? AND removed_at IS NULL ORDER BY name_key,id', (owner,)).fetchall()
        return {'ok': True, 'prompts': [dict(row) for row in rows], 'savedId': saved_id, 'limit': MAX_PROMPTS}


def handle_request(handler, method, database):
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
    if not getattr(handler, 'mygrain_user', None):
        handler.send_json({'ok': False, 'error': 'Sign in to use saved prompts.'}, status=401, extra_headers=headers)
        return True
    try:
        request = None
        if method == 'POST':
            if handler.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
                raise ValueError('Prompt saves need JSON content.')
            length = int(handler.headers.get('Content-Length', 0))
            if not 2 <= length <= 8192:
                raise ValueError('Prompt save request is too large or empty.')
            request = json.loads(handler.rfile.read(length))
        elif method != 'GET':
            raise ValueError('Use GET or POST for saved prompts.')
        handler.send_json(library(database, handler.mygrain_user['id'], request), extra_headers=headers)
    except (ValueError, UnicodeError) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    except (OSError, sqlite3.Error):
        handler.send_json({'ok': False, 'error': 'Prompt storage unavailable. No save was confirmed; your patch is unchanged.'}, status=503, extra_headers=headers)
    return True
