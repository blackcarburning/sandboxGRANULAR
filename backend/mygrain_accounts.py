import contextvars
import functools
import hashlib
import hmac
import os
import pathlib
import re
import secrets
import shutil
import sqlite3
import ssl
import threading
import time
from contextlib import ExitStack, contextmanager
from http.cookies import SimpleCookie
from urllib.parse import quote, unquote, urlsplit


COOKIE_NAME = 'mygrain_session'
SESSION_SECONDS = 90 * 24 * 60 * 60
PASSWORD_ITERATIONS = 600_000
SEED_HASHES = {
    'admin': 'pbkdf2_sha256$600000$713a868535dbd2c699efcad16616109d$074672be7a95ae7786a2bf21167f79d93e2ac5ee09c7ac9c31d64256bf6bfba3',
    'dan': 'pbkdf2_sha256$600000$00d8c24af5db82b83c10e53823a43753$7bfc6e87dca862a6aaa38582558028495aee0cd55137d7136a1c77fd837a50d0',
}
CURRENT_USER = contextvars.ContextVar('mygrain_account', default=None)
USERNAME_PATTERN = re.compile(r'[a-z0-9][a-z0-9_-]{0,31}')
PUBLIC_FILES = {
    'index.html', 'manual.html', 'q-scales.json',
    'assets/brand/mygrain-rainbow-brain.png', 'assets/brand/mygrain-rainbow-brain.webp',
    'assets/brand/mygrain-icon.png',
    'background-audio.js', 'audio-debug-storage.js', 'audio-diagnostics.js', 'drum-enhancements.css', 'drum-tone.js', 'drum-roll.js',
    'mygrain-utils.js', 'random-performance-samples.js', 'mygrain-accounts.js', 'mygrain-accounts.css',
    'navigation-palette.js', 'navigation-palette.css',
    'ai-patch-direction.js', 'ai-song-parts.js', 'ai-patch-direction.css', 'ai-patch-controls.json',
    'k-multitrack.js', 'k-multitrack-host.js', 'k-multitrack.css', 'k-track-meters.js', 'k-track-dsp.js',
    'l-reverb.js', 'q-arp-builder.js', 'q-card.css', 'q-card.js', 'q-theory.js',
    'radiolab.js', 'radiolab.css', 'radiolab-worklet.js',
    'randomise-commentary.js', 'runtime-diagnostics.js', 'sample-favourites.css', 'sample-favourites.js',
    'song-beta-adapter.js', 'song-beta-capture-worklet.js', 'song-beta-clock.js',
    'song-beta-export.js', 'song-beta-locks.js', 'song-beta-render-deck.js',
    'song-beta-storage.js', 'song-beta.css', 'song-beta.js',
    'vocal-loop-cut.css', 'vocal-loop-cut.js', 'vocal-takes.css', 'vocal-takes.js',
}
PUBLIC_ASSET_ROOTS = {'SAMPLES_Q', 'SAMPLES_Q_KEYBOARD', 'SAMPLES_Q_STRINGS', 'third-party'}
PUBLIC_ASSET_SUFFIXES = {'.wav', '.mp3', '.ogg', '.flac', '.json', '.js', '.css', '.wasm', '.png', '.svg', '.woff', '.woff2', '.txt'}


class AccountError(ValueError):
    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.status = status
        self.code = code


def current_user():
    return CURRENT_USER.get()


def checked_path(path, boundary=None, allow_leaf_link=False):
    path = pathlib.Path(path).absolute()
    if '..' in path.parts or (boundary is not None and not path.is_relative_to(pathlib.Path(boundary).absolute())):
        raise ValueError('Invalid storage path.')
    for ancestor in (*reversed(path.parents), path):
        if allow_leaf_link and ancestor == path:
            break
        if ancestor.is_symlink():
            raise ValueError('Symbolic links are not supported in account storage.')
    return path


class ScopedPath(os.PathLike):
    def __init__(self, resolver, boundary=None):
        self.resolver = resolver
        self.boundary = boundary or resolver

    def path(self, allow_leaf_link=False):
        return checked_path(self.resolver(), self.boundary(), allow_leaf_link=allow_leaf_link)

    def __fspath__(self):
        return str(self.path())

    def __str__(self):
        return os.fspath(self)

    def __repr__(self):
        return f'ScopedPath({str(self)!r})'

    def __truediv__(self, child):
        return ScopedPath(lambda: self.resolver() / child, self.boundary)

    def __eq__(self, other):
        try:
            return self.path() == pathlib.Path(other)
        except TypeError:
            return False

    def __getattr__(self, name):
        if name == 'is_symlink':
            return lambda: self.path(allow_leaf_link=True).is_symlink()
        value = getattr(self.path(), name)
        if isinstance(value, pathlib.Path):
            return ScopedPath(lambda: value, self.boundary)
        if not callable(value):
            return value

        def call(*args, **kwargs):
            result = getattr(self.path(), name)(*args, **kwargs)
            if name in ('iterdir', 'glob', 'rglob'):
                return (ScopedPath(lambda path=path: path, self.boundary) for path in result)
            if isinstance(result, pathlib.Path) and name not in ('resolve', 'absolute'):
                return ScopedPath(lambda: result, self.boundary)
            return result
        return call


class ScopedLock:
    def __init__(self, accounts, legacy_lock):
        self.accounts = accounts
        self.legacy_lock = legacy_lock
        self.held = contextvars.ContextVar('mygrain_held_lock', default=())

    def __enter__(self):
        user = current_user()
        lock = self.accounts.user_lock(user) if user is not None else self.legacy_lock
        lock.acquire()
        self.held.set((*self.held.get(), lock))
        return self

    def __exit__(self, *args):
        held = self.held.get()
        self.held.set(held[:-1])
        held[-1].release()


def normalize_username(value):
    username = value.strip().lower() if isinstance(value, str) else ''
    if not USERNAME_PATTERN.fullmatch(username):
        raise AccountError('Use 1–32 letters, numbers, underscores or hyphens, starting with a letter or number.')
    return username


def validate_password(password):
    if not isinstance(password, str) or not 6 <= len(password) <= 1024:
        raise AccountError('Passwords must contain 6–1024 characters.')
    return password


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', validate_password(password).encode('utf-8'), salt, PASSWORD_ITERATIONS)
    return f'pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}'


def verify_password(password, encoded):
    try:
        algorithm, iterations, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256' or not isinstance(password, str) or len(password) > 1024:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


class Accounts:
    def __init__(self, database, users_root, legacy_paths, wav_feedback_invalidated=None):
        self.database = pathlib.Path(database)
        self.users_root = pathlib.Path(users_root)
        self.legacy_paths = {key: pathlib.Path(path) for key, path in legacy_paths.items()}
        self.storage_lock = threading.RLock()
        self.user_locks = {}
        self.wav_feedback_invalidated = wav_feedback_invalidated

    def user_lock(self, user):
        with self.storage_lock:
            return self.user_locks.setdefault(user['id'], threading.RLock())

    @contextmanager
    def lock_users(self, *users):
        with ExitStack() as stack:
            for user in sorted({user['id']: user for user in users}.values(), key=lambda user: user['id']):
                stack.enter_context(self.user_lock(user))
            yield

    @contextmanager
    def connection(self):
        checked_path(self.database)
        if not self.database.is_file():
            raise AccountError('MYGRAIN accounts have not been initialized.', 503, 'ACCOUNTS_NOT_INITIALIZED')
        connection = sqlite3.connect(f'file:{quote(str(self.database.absolute()))}?mode=rw', uri=True, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self, admin_password=None, dan_password=None):
        seed_hashes = dict(SEED_HASHES)
        for username, password in (('admin', admin_password), ('dan', dan_password)):
            if password is not None:
                seed_hashes[username] = hash_password(password)
        with self.storage_lock:
            checked_path(self.database)
            self.database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.database.parent.chmod(0o700)
            checked_path(self.users_root).mkdir(parents=True, exist_ok=True, mode=0o700)
            self.users_root.chmod(0o700)
            descriptor = os.open(self.database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600) if not self.database.exists() else None
            if descriptor is not None:
                os.close(descriptor)
            self.database.chmod(0o600)
            with self.connection() as connection:
                connection.executescript('''
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
                        created_at REAL NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS sessions (
                        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                        expires_at REAL NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS shares (
                        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
                        recipient_id TEXT NOT NULL REFERENCES users(id),
                        filename TEXT NOT NULL, recipient_filename TEXT NOT NULL,
                        sha256 TEXT NOT NULL, size INTEGER NOT NULL,
                        comments TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,
                        updated_at REAL NOT NULL, recipient_deleted INTEGER NOT NULL DEFAULT 0,
                        source_deleted INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE INDEX IF NOT EXISTS shares_owner ON shares(owner_id);
                    CREATE INDEX IF NOT EXISTS shares_recipient ON shares(recipient_id, recipient_filename);
                    CREATE TABLE IF NOT EXISTS wav_provenance (
                        user_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL,
                        created_by_id TEXT REFERENCES users(id), file_signature TEXT,
                        PRIMARY KEY (user_id, filename)
                    );
                ''')
                share_columns = {row['name'] for row in connection.execute('PRAGMA table_info(shares)')}
                for column in ('created_by_id', 'comments_by_id'):
                    if column not in share_columns:
                        connection.execute(f'ALTER TABLE shares ADD COLUMN {column} TEXT REFERENCES users(id)')
                if 'file_signature' not in {row['name'] for row in connection.execute('PRAGMA table_info(wav_provenance)')}:
                    connection.execute('ALTER TABLE wav_provenance ADD COLUMN file_signature TEXT')
                connection.execute("UPDATE shares SET comments_by_id=recipient_id WHERE comments<>'' AND comments_by_id IS NULL")
                for username, encoded in seed_hashes.items():
                    if connection.execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone() is None:
                        connection.execute('INSERT INTO users VALUES (?, ?, ?, ?, ?)',
                                           (secrets.token_hex(16), username, encoded, int(username == 'admin'), time.time()))
                for row in connection.execute('SELECT id, username, is_admin FROM users WHERE is_admin=0'):
                    base = checked_path(self.users_root / row['id'], self.users_root)
                    base.mkdir(exist_ok=True, mode=0o700)
                    base.chmod(0o700)

    def path_for(self, key, user=None):
        user = user if user is not None else current_user()
        if user is None or user['is_admin']:
            return self.legacy_paths[key]
        if not re.fullmatch(r'[a-f0-9]{32}', user['id']):
            raise ValueError('Invalid account storage identity.')
        base = self.users_root / user['id']
        if key.endswith('_feedback'):
            return base / 'data' / f'{key}.json'
        return base / key

    def scoped_path(self, key):
        resolver = lambda: self.path_for(key)
        boundary = (lambda: resolver().parent) if key.endswith('_feedback') else resolver
        return ScopedPath(resolver, boundary)

    def lookup_user(self, username):
        with self.connection() as connection:
            row = connection.execute('SELECT id, username, is_admin FROM users WHERE username=?', (normalize_username(username),)).fetchone()
        return dict(row) if row else None

    def register(self, username, password):
        username = normalize_username(username)
        encoded = hash_password(password)
        user = {'id': secrets.token_hex(16), 'username': username, 'is_admin': 0}
        with self.storage_lock, self.connection() as connection:
            try:
                connection.execute('INSERT INTO users VALUES (?, ?, ?, 0, ?)', (user['id'], username, encoded, time.time()))
                checked_path(self.users_root / user['id'], self.users_root).mkdir(mode=0o700)
            except sqlite3.IntegrityError:
                raise AccountError('That username is already registered.', 409, 'USERNAME_TAKEN') from None
        return user

    def login(self, username, password):
        username = normalize_username(username)
        with self.connection() as connection:
            row = connection.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        encoded = row['password_hash'] if row else f'pbkdf2_sha256${PASSWORD_ITERATIONS}${"00" * 16}${"00" * 32}'
        if not verify_password(password, encoded) or row is None:
            raise AccountError('Invalid username or password.', 401, 'INVALID_CREDENTIALS')
        return {key: row[key] for key in ('id', 'username', 'is_admin')}

    def session_user(self, token):
        if not token or not re.fullmatch(r'[a-f0-9]{64}', token):
            return None
        try:
            with self.connection() as connection:
                row = connection.execute('''SELECT users.id, users.username, users.is_admin FROM sessions
                    JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?''',
                                         (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
            return dict(row) if row else None
        except AccountError as error:
            if error.status == 503:
                return None
            raise

    def new_session(self, user, old_token=None):
        token = secrets.token_hex(32)
        with self.connection() as connection:
            connection.execute('DELETE FROM sessions WHERE expires_at<=?', (time.time(),))
            if old_token:
                connection.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(old_token.encode()).hexdigest(),))
            connection.execute('INSERT INTO sessions VALUES (?, ?, ?)',
                               (hashlib.sha256(token.encode()).hexdigest(), user['id'], time.time() + SESSION_SECONDS))
        return token

    def logout(self, token):
        if token and self.database.exists():
            with self.connection() as connection:
                connection.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))

    def usernames(self):
        with self.connection() as connection:
            return [{'username': row['username']} for row in connection.execute('SELECT username FROM users ORDER BY username')]

    @staticmethod
    def file_signature(path):
        stat = checked_path(path).stat()
        return f'{stat.st_dev}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}'

    def wav_created(self, filename):
        user_id = current_user()['id']
        signature = self.file_signature(self.path_for('wavs') / filename)
        with self.connection() as connection:
            connection.execute('''INSERT INTO wav_provenance (user_id, filename, created_by_id, file_signature) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, filename) DO UPDATE SET created_by_id=excluded.created_by_id, file_signature=excluded.file_signature''',
                               (user_id, filename, user_id, signature))

    def invalidate_changed_wav(self, filename):
        user_id = current_user()['id']
        with self.connection() as connection:
            provenance = connection.execute('SELECT file_signature FROM wav_provenance WHERE user_id=? AND filename=?',
                                            (user_id, filename)).fetchone()
            incoming = connection.execute('''SELECT sha256, size FROM shares
                WHERE recipient_id=? AND recipient_filename=? AND recipient_deleted=0''', (user_id, filename)).fetchone()
        path = checked_path(self.path_for('wavs') / filename)
        matches = True
        try:
            if provenance:
                matches = provenance['file_signature'] == self.file_signature(path)
            elif incoming:
                matches = path.stat().st_size == incoming['size']
                if matches:
                    with path.open('rb') as handle:
                        matches = hashlib.file_digest(handle, 'sha256').hexdigest() == incoming['sha256']
        except FileNotFoundError:
            matches = False
        if not matches:
            if self.wav_feedback_invalidated is not None:
                self.wav_feedback_invalidated(filename)
            self.begin_file_change(filename, deleting=True)
        if provenance is None or not matches:
            try:
                signature = self.file_signature(path)
            except FileNotFoundError:
                signature = None
            if signature is not None:
                with self.connection() as connection:
                    connection.execute('''INSERT OR IGNORE INTO wav_provenance
                        (user_id, filename, created_by_id, file_signature) VALUES (?, ?, NULL, ?)''',
                                       (user_id, filename, signature))
        return not matches

    def wav_attribution(self):
        user_id = current_user()['id']
        with self.connection() as connection:
            provenance = connection.execute('''SELECT filename, file_signature, users.username AS creator FROM wav_provenance
                LEFT JOIN users ON users.id=wav_provenance.created_by_id WHERE user_id=?''', (user_id,)).fetchall()
            incoming = connection.execute('''SELECT recipient_filename, sha256, size, creator.username AS creator,
                sharer.username AS sharer FROM shares
                LEFT JOIN users AS creator ON creator.id=shares.created_by_id
                JOIN users AS sharer ON sharer.id=shares.owner_id
                WHERE recipient_id=? AND recipient_deleted=0''', (user_id,)).fetchall()
        result = {}
        valid = set()
        root = self.path_for('wavs')
        for row in provenance:
            try:
                matches = row['file_signature'] == self.file_signature(root / row['filename'])
            except FileNotFoundError:
                matches = False
            result[row['filename']] = {'createdBy': row['creator'] if matches else None, 'sharedBy': None}
            if matches:
                valid.add(row['filename'])
        for row in incoming:
            filename = row['recipient_filename']
            if filename not in result:
                path = checked_path(root / filename, root)
                try:
                    if path.stat().st_size == row['size']:
                        with path.open('rb') as handle:
                            if hashlib.file_digest(handle, 'sha256').hexdigest() == row['sha256']:
                                valid.add(filename)
                except FileNotFoundError:
                    pass
            if filename in valid:
                result[filename] = {'createdBy': row['creator'], 'sharedBy': row['sharer']}
        return result

    def share(self, filename, recipient_username):
        owner = current_user()
        recipient = self.lookup_user(recipient_username)
        if recipient is None:
            raise AccountError('Recipient not found.', 404)
        if recipient['id'] == owner['id']:
            raise AccountError('Choose another user to share with.')
        if not isinstance(filename, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.wav', filename, re.IGNORECASE):
            raise AccountError('Choose a WAV filename from your own rendered WAV browser.')
        with self.lock_users(owner, recipient):
            source = checked_path(self.path_for('wavs', owner) / filename)
            if not source.is_file():
                raise AccountError('WAV not found in your rendered WAV storage.', 404)
            self.invalidate_changed_wav(filename)
            root = checked_path(self.path_for('wavs', recipient))
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            destination = None
            try:
                for index in range(10000):
                    candidate = filename if index == 0 else f'{source.stem}-{index}.wav'
                    destination = checked_path(root / candidate, root)
                    try:
                        output = destination.open('xb')
                        break
                    except FileExistsError:
                        destination = None
                else:
                    raise AccountError('The recipient has too many files with that name.', 409)
                with source.open('rb') as original, output:
                    shutil.copyfileobj(original, output)
                    output.flush()
                    os.fsync(output.fileno())
                digest = hashlib.sha256()
                with destination.open('rb') as copied:
                    for chunk in iter(lambda: copied.read(1024 * 1024), b''):
                        digest.update(chunk)
                now = time.time()
                identifier = secrets.token_hex(16)
                with self.connection() as connection:
                    provenance = connection.execute('SELECT created_by_id, file_signature FROM wav_provenance WHERE user_id=? AND filename=?',
                                                    (owner['id'], filename)).fetchone()
                    creator_id = provenance['created_by_id'] if provenance and provenance['file_signature'] == self.file_signature(source) else None
                    connection.execute('''INSERT INTO shares
                        (id, owner_id, recipient_id, filename, recipient_filename, sha256, size, created_at, updated_at, created_by_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                                       (identifier, owner['id'], recipient['id'], filename, destination.name,
                                        digest.hexdigest(), destination.stat().st_size, now, now, creator_id))
                    connection.execute('''INSERT INTO wav_provenance (user_id, filename, created_by_id, file_signature) VALUES (?, ?, ?, ?)
                        ON CONFLICT(user_id, filename) DO UPDATE SET created_by_id=excluded.created_by_id, file_signature=excluded.file_signature''',
                                       (recipient['id'], destination.name, creator_id, self.file_signature(destination)))
                return next(share for share in self.outbound_shares() if share['id'] == identifier)
            except Exception:
                if destination is not None:
                    destination.unlink(missing_ok=True)
                raise

    def outbound_shares(self):
        with self.connection() as connection:
            rows = connection.execute('''SELECT shares.*, users.username AS recipient, creator.username AS creator,
                sharer.username AS sharer, commenter.username AS commenter FROM shares
                JOIN users ON users.id=shares.recipient_id
                JOIN users AS sharer ON sharer.id=shares.owner_id
                LEFT JOIN users AS creator ON creator.id=shares.created_by_id
                LEFT JOIN users AS commenter ON commenter.id=shares.comments_by_id
                WHERE owner_id=? ORDER BY shares.created_at DESC''',
                                      (current_user()['id'],)).fetchall()
        return [{'id': row['id'], 'filename': row['filename'], 'recipient': row['recipient'],
                 'recipientFilename': row['recipient_filename'], 'comments': row['comments'],
                 'createdBy': row['creator'], 'sharedBy': row['sharer'],
                 'commentsBy': row['commenter'] if row['comments'] else None,
                 'createdAt': row['created_at'], 'updatedAt': row['updated_at'],
                 'recipientDeleted': bool(row['recipient_deleted']), 'sourceDeleted': bool(row['source_deleted']),
                 'sha256': row['sha256'], 'size': row['size']} for row in rows]

    def incoming_shares(self):
        with self.connection() as connection:
            rows = connection.execute('''SELECT recipient_filename, users.username AS shared_by FROM shares
                JOIN users ON users.id=shares.owner_id WHERE recipient_id=? AND recipient_deleted=0''',
                                      (current_user()['id'],)).fetchall()
        return {row['recipient_filename']: row['shared_by'] for row in rows}

    def feedback_changed(self, filename, comment):
        self.invalidate_changed_wav(filename)
        with self.connection() as connection:
            user_id = current_user()['id']
            connection.execute('UPDATE shares SET comments=?, comments_by_id=?, updated_at=? WHERE recipient_id=? AND recipient_filename=? AND recipient_deleted=0',
                               (comment, user_id if comment else None, time.time(), user_id, filename))

    def begin_file_change(self, filename, deleting=False):
        user_id = current_user()['id']
        with self.connection() as connection:
            recipient_ids = [row['id'] for row in connection.execute('SELECT id FROM shares WHERE recipient_id=? AND recipient_filename=? AND recipient_deleted=0', (user_id, filename))]
            source_ids = [row['id'] for row in connection.execute('SELECT id FROM shares WHERE owner_id=? AND filename=? AND source_deleted=0', (user_id, filename))]
            connection.execute('UPDATE shares SET recipient_deleted=1, updated_at=? WHERE recipient_id=? AND recipient_filename=? AND recipient_deleted=0',
                               (time.time(), user_id, filename))
            connection.execute('UPDATE shares SET source_deleted=1, updated_at=? WHERE owner_id=? AND filename=? AND source_deleted=0',
                               (time.time(), user_id, filename))
            if deleting:
                connection.execute('DELETE FROM wav_provenance WHERE user_id=? AND filename=?', (user_id, filename))
        return {'recipient': recipient_ids, 'source': source_ids, 'filename': filename}

    def finish_file_rename(self, changes, filename):
        user_id = current_user()['id']
        with self.connection() as connection:
            connection.execute('DELETE FROM wav_provenance WHERE user_id=? AND filename=?', (user_id, filename))
            connection.execute('UPDATE wav_provenance SET filename=? WHERE user_id=? AND filename=?',
                               (filename, user_id, changes['filename']))
            for identifier in changes['recipient']:
                connection.execute('UPDATE shares SET recipient_filename=?, recipient_deleted=0, updated_at=? WHERE id=? AND recipient_id=?',
                                   (filename, time.time(), identifier, user_id))
            for identifier in changes['source']:
                connection.execute('UPDATE shares SET filename=?, source_deleted=0, updated_at=? WHERE id=? AND owner_id=?',
                                   (filename, time.time(), identifier, user_id))


def request_token(handler):
    cookie = SimpleCookie()
    try:
        cookie.load(handler.headers.get('Cookie', ''))
        return cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else None
    except Exception:
        return None


def request_scheme(handler):
    if isinstance(handler.connection, ssl.SSLSocket):
        return 'https'
    if handler.client_address[0] in ('127.0.0.1', '::1') and handler.headers.get('X-Forwarded-Proto') == 'https':
        return 'https'
    return 'http'


def session_cookie(handler, token=None):
    cookie = f'{COOKIE_NAME}={token or ""}; Path=/; Max-Age={SESSION_SECONDS if token else 0}; HttpOnly; SameSite=Lax'
    return cookie + ('; Secure' if request_scheme(handler) == 'https' else '')


def require_same_origin(handler):
    origin = handler.headers.get('Origin')
    referer = handler.headers.get('Referer')
    if handler.headers.get('Sec-Fetch-Site') == 'cross-site':
        raise AccountError('Cross-site requests are not allowed.', 403, 'CSRF_ORIGIN')
    if origin is None and referer is None:
        return
    source = urlsplit(origin if origin is not None else referer)
    target = urlsplit(f'{request_scheme(handler)}://{handler.headers.get("Host", "")}')
    if source.scheme not in ('http', 'https') or source.username or source.password or (source.scheme, source.hostname, source.port) != (target.scheme, target.hostname, target.port):
        raise AccountError('Cross-origin requests are not allowed.', 403, 'CSRF_ORIGIN')


def decoded_route_path(path):
    decoded = path
    for unused in range(4):
        next_path = unquote(decoded)
        if next_path == decoded:
            break
        decoded = next_path
    if '\\' in decoded or '\x00' in decoded or any(part in ('.', '..') for part in decoded.split('/')) or '//' in decoded:
        raise AccountError('Invalid request path.', 403)
    return decoded


def public_asset(inner):
    filename = inner.lstrip('/') or 'index.html'
    parts = pathlib.PurePosixPath(filename).parts
    return filename in PUBLIC_FILES or (len(parts) >= 2 and parts[0] in PUBLIC_ASSET_ROOTS
                                        and not any(part.startswith('.') for part in parts)
                                        and (pathlib.PurePosixPath(filename).suffix.lower() in PUBLIC_ASSET_SUFFIXES or parts[-1] == 'LICENSE'))


def bind_media_urls(payload):
    user = current_user()
    if user is None:
        return payload
    if isinstance(payload, list):
        return [bind_media_urls(item) for item in payload]
    if not isinstance(payload, dict):
        return payload
    result = {}
    for key, value in payload.items():
        if key in ('url', 'previewUrl', 'audioUrl', 'renderUrl', 'downloadUrl') and isinstance(value, str) and value.startswith('/mygrain'):
            address, fragment_separator, fragment = value.partition('#')
            separator = '&' if '?' in address else '?'
            result[key] = address + separator + 'mygrainUser=' + quote(user['username']) + (fragment_separator + fragment if fragment_separator else '')
        else:
            result[key] = bind_media_urls(value)
    return result


def request_wrapper(method):
    @functools.wraps(method)
    def guarded(handler, *args, **kwargs):
        token = CURRENT_USER.set(None)
        try:
            return handler.dispatch_mygrain_request(method, *args, **kwargs)
        finally:
            CURRENT_USER.reset(token)
    return guarded
