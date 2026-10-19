import hashlib
import http.client
import importlib.util
import json
import pathlib
import socket
import stat
import tempfile
import threading
import time
import unittest
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from io import BytesIO
from urllib.parse import urlencode
from unittest.mock import patch


WORKSPACE = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('mygrain_accounts_http_tests', WORKSPACE / 'fs7300-documenter/server.py')
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
ACCOUNTS = SERVER._accounts_module


def wav_bytes(frames=800, value=1):
    buffer = BytesIO()
    with wave.open(buffer, 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(int(value).to_bytes(2, 'little', signed=True) * 2 * frames)
    return buffer.getvalue()


def part_bytes():
    buffer = BytesIO()
    manifest = {
        'format': 'mygrain-song-part', 'version': 1,
        'state': {'modes': {}, 'globalBpm': '120', 'patternLength': 16},
        'extra': {'sequencerSteps': [{'enabled': True, 'pitch': 'C4', 'volume': 80}] * 16},
        'assets': [{'key': 'bastardL', 'path': 'audio/bastardL.wav'}],
    }
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('song-part.json', json.dumps(manifest))
        archive.writestr('audio/bastardL.wav', wav_bytes())
    return buffer.getvalue()


class Client:
    def __init__(self, address):
        self.address = address
        self.username = None
        self.cookie = None

    def request(self, method, path, data=None, body=None, headers=None, identity=True):
        outgoing = {}
        if self.cookie:
            outgoing['Cookie'] = self.cookie
        if identity and self.username:
            outgoing['X-Mygrain-User'] = self.username
        if data is not None:
            outgoing['Content-Type'] = 'application/json'
            body = json.dumps(data).encode()
        outgoing.update(headers or {})
        connection = http.client.HTTPConnection(*self.address, timeout=20)
        try:
            connection.request(method, path, body=body, headers=outgoing)
            response = connection.getresponse()
            raw = response.read()
            result = json.loads(raw) if raw and response.getheader('Content-Type', '').startswith('application/json') else raw
            received = dict(response.getheaders())
            if response.getheader('Set-Cookie') is not None:
                self.cookie = response.getheader('Set-Cookie').split(';')[0]
            return response.status, result, received
        finally:
            connection.close()

    def login(self, username='admin', password='snowpeas'):
        result = self.request('POST', '/mygrain/api/auth/login', data={'username': username, 'password': password})
        if result[0] == 200:
            self.username = result[1]['user']['username']
        return result


class QuietHandler(SERVER.DocumenterHandler):
    def log_message(self, *args):
        pass


class AccountHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='mygrain-account-http-')
        self.root = pathlib.Path(self.temporary.name)
        self.accounts = SERVER.init_account_store(self.root)
        SERVER._debug_logs_module.UPLOAD_TIMES.clear()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()
        self.admin = Client(self.server.server_address)
        self.dan = Client(self.server.server_address)
        self.anonymous = Client(self.server.server_address)
        self.assertEqual(self.admin.login()[0], 200)
        self.assertEqual(self.dan.login('dan', 'charged')[0], 200)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.assertIsNone(ACCOUNTS.current_user())
        self.temporary.cleanup()

    def success(self, client, method, path, **kwargs):
        status, result, headers = client.request(method, path, **kwargs)
        self.assertIn(status, (200, 201), (path, status, result))
        if isinstance(result, dict):
            self.assertTrue(result.get('ok'), result)
        return result

    def upload(self, client, filename, body=None, route='/mygrain-wavs'):
        return self.success(client, 'POST', route + '/api/upload', body=body or wav_bytes(), headers={'X-Filename': filename})['savedName']

    def third_user(self):
        client = Client(self.server.server_address)
        self.success(client, 'POST', '/mygrain/api/auth/register', data={'username': 'third-user', 'password': 'third-user-passphrase'})
        client.username = 'third-user'
        return client

    def test_session_context_registration_cookie_and_logout(self):
        status, body, headers = self.anonymous.request('GET', '/mygrain')
        self.assertEqual((status, headers['Location']), (308, '/mygrain/'))
        session = self.success(self.anonymous, 'GET', '/mygrain/api/auth/session')
        self.assertEqual(session, {'ok': True, 'authenticated': False, 'user': None})
        for client, username in ((self.anonymous, None), (self.admin, 'admin'), (self.dan, 'dan')):
            status, body, headers = client.request('GET', '/mygrain/account-context.js')
            self.assertEqual(status, 200)
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertIn('javascript', headers['Content-Type'])
            context = json.loads(body.decode().split('=', 1)[1].rstrip(';\n'))
            self.assertEqual(context['user'], {'username': username} if username else None)
        status, result, headers = self.admin.login('ADMIN')
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', headers['Set-Cookie'])
        self.assertIn(f'Max-Age={ACCOUNTS.SESSION_SECONDS}', headers['Set-Cookie'])
        token = self.admin.cookie.split('=', 1)[1]
        new = ACCOUNTS.Accounts(self.accounts.database, self.accounts.users_root, self.accounts.legacy_paths)
        self.assertEqual(new.session_user(token)['username'], 'admin')
        self.success(self.admin, 'POST', '/mygrain/api/auth/logout', data={})
        self.assertIsNone(new.session_user(token))
        self.assertFalse(self.success(self.admin, 'GET', '/mygrain/api/auth/session')['authenticated'])
        third = self.third_user()
        registered_root = self.accounts.users_root / self.accounts.lookup_user('third-user')['id']
        self.assertEqual(stat.S_IMODE(registered_root.stat().st_mode), 0o700)
        users = self.success(third, 'GET', '/mygrain/api/auth/users')['users']
        self.assertEqual(users, [{'username': 'admin'}, {'username': 'dan'}, {'username': 'third-user'}])
        self.assertEqual(third.request('POST', '/mygrain/api/auth/register', data={'username': 'THIRD-user', 'password': 'another-passphrase'})[0], 409)
        self.assertEqual(third.request('POST', '/mygrain/api/auth/register', data={'username': '../bad', 'password': 'another-passphrase'})[0], 400)
        self.assertEqual(self.anonymous.login('dan', 'incorrect')[0], 401)

    def test_seed_hashes_idempotence_permissions_and_no_implicit_initialization(self):
        dan_root = self.accounts.users_root / self.accounts.lookup_user('dan')['id']
        dan_root.chmod(0o755)
        admin_root = self.accounts.legacy_paths['wavs']
        admin_root.mkdir(parents=True, exist_ok=True, mode=0o755)
        admin_permissions = stat.S_IMODE(admin_root.stat().st_mode)
        with self.accounts.connection() as connection:
            before = dict(connection.execute('SELECT username, password_hash FROM users'))
            connection.execute('UPDATE users SET password_hash=? WHERE username=?', (ACCOUNTS.hash_password('changed-passphrase'), 'dan'))
        self.accounts.initialize()
        self.assertEqual(self.dan.login('dan', 'changed-passphrase')[0], 200)
        self.assertEqual(self.dan.login('dan', 'charged')[0], 401)
        self.assertTrue(ACCOUNTS.verify_password('snowpeas', before['admin']))
        self.assertTrue(ACCOUNTS.verify_password('charged', before['dan']))
        self.assertNotEqual(before['admin'].split('$')[2], before['dan'].split('$')[2])
        self.assertNotIn(b'snowpeas', self.accounts.database.read_bytes())
        self.assertNotIn(b'charged', self.accounts.database.read_bytes())
        self.assertEqual(stat.S_IMODE(self.accounts.database.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.accounts.database.parent.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.accounts.users_root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.accounts.users_root / self.accounts.lookup_user('dan')['id']).stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(admin_root.stat().st_mode), admin_permissions)
        absent = ACCOUNTS.Accounts(self.root / 'uninitialized/auth.sqlite3', self.root / 'other-users', self.accounts.legacy_paths)
        self.assertIsNone(absent.session_user('a' * 64))
        self.assertFalse(absent.database.parent.exists())
        with self.assertRaises(ACCOUNTS.AccountError):
            absent.register('uninitialized', 'not-persisted')
        self.assertFalse(absent.database.exists())
        with patch.object(SERVER, 'init_account_store', side_effect=AssertionError('Import must not initialize')):
            fresh_spec = importlib.util.spec_from_file_location('mygrain_import_no_init', WORKSPACE / 'fs7300-documenter/server.py')
            fresh = importlib.util.module_from_spec(fresh_spec)
            with patch('sqlite3.connect', side_effect=AssertionError('Import must not connect')):
                fresh_spec.loader.exec_module(fresh)

    def test_actual_http_restart_preserves_sessions_users_and_stores(self):
        song = self.success(self.dan, 'POST', '/mygrain/api/songs', data={'name': 'survives restart'})['song']
        name = self.upload(self.admin, 'persists.wav')
        before_id = self.accounts.lookup_user('dan')['id']
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.accounts = SERVER.init_account_store(self.root)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()
        self.admin.address = self.dan.address = self.server.server_address
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain/api/auth/session')['user'], {'username': 'admin'})
        self.assertEqual(self.success(self.dan, 'GET', '/mygrain/api/auth/session')['user'], {'username': 'dan'})
        self.assertEqual(self.accounts.lookup_user('dan')['id'], before_id)
        self.assertEqual(self.success(self.dan, 'GET', '/mygrain/api/songs')['songs'][0]['id'], song['id'])
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain-wavs/' + name), wav_bytes())

    def test_unauthenticated_every_api_and_direct_download_are_denied(self):
        paths = ['/mygrain/api/songs', '/mygrain/api/songs/legacy-12345678/parts/' + 'a' * 32,
                 '/mygrain/api/vocal-takes', '/mygrain/api/favourites', '/mygrain/api/arps',
                 '/mygrain/api/debug-logs', '/mygrain/api/patches/list', '/mygrain/api/auth/users',
                 '/mygrain/patches/reference-patch.zip', '/mygrain-wavs/secret.wav', '/mygrain-stems/secret.zip',
                 '/mygrain-midi/secret.mid', '/mygrain-bastardloops/secret.wav', '/mygrain-wavs/api/shares',
                 '/mygrain-bastardloops/api/source-files', '/mygrain-wavs/api/list']
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(self.anonymous.request('GET', path, headers={'X-Mygrain-Song-Key': 'a' * 64})[0], 401)
        for method, path in [('POST', '/mygrain/api/songs'), ('DELETE', '/mygrain-wavs/api/delete?filename=secret.wav'),
                             ('POST', '/mygrain/api/debug-logs'), ('PUT', '/mygrain-wavs/api/upload'), ('PATCH', '/mygrain/api/songs')]:
            self.assertEqual(self.anonymous.request(method, path, data={})[0], 401)
        for path in ['/mygrain/', '/mygrain/manual.html', '/mygrain/mygrain-utils.js', '/mygrain/song-beta.css',
                     '/mygrain/SAMPLES_Q/manifest.json', '/mygrain/third-party/tonal-scale-type-LICENSE.txt']:
            self.assertEqual(self.anonymous.request('GET', path)[0], 200, path)

    def test_navigation_palette_assets_are_public_exact_sources(self):
        for filename in ('navigation-palette.js', 'navigation-palette.css'):
            expected = (WORKSPACE / 'sandboxGRANULAR' / filename).read_bytes()
            for client in (self.anonymous, self.admin):
                with self.subTest(filename=filename, username=client.username):
                    status, payload, headers = client.request('GET', '/mygrain/' + filename + '?v=20261017-navigation-r3')
                    self.assertEqual(status, 200)
                    self.assertEqual(payload, expected)
                    self.assertEqual(headers.get('Cache-Control'), 'no-store')
        self.assertEqual(self.anonymous.request('GET', '/mygrain/backend/mygrain_accounts.py')[0], 401)
        self.assertEqual(self.admin.request('GET', '/mygrain/backend/mygrain_accounts.py')[0], 403)

    def test_identity_pin_and_csrf_guard_before_writes(self):
        status, result, headers = self.admin.request('POST', '/mygrain/api/songs', data={'name': 'no'}, headers={'X-Mygrain-User': 'dan'})
        self.assertEqual((status, result.get('code')), (401, 'ACCOUNT_CHANGED'))
        self.assertEqual(self.admin.request('GET', '/mygrain/api/songs', identity=False)[1]['code'], 'ACCOUNT_CHANGED')
        origin = f'http://127.0.0.1:{self.server.server_port}'
        for extra in [{'Origin': 'https://attacker.invalid'}, {'Origin': 'null'}, {'Referer': 'https://attacker.invalid/page'},
                      {'Sec-Fetch-Site': 'cross-site'}, {'Origin': origin.replace('http:', 'https:')}]:
            self.assertEqual(self.admin.request('POST', '/mygrain/api/songs', data={'name': 'no'}, headers=extra)[0], 403)
            self.assertEqual(self.anonymous.request('POST', '/mygrain/api/auth/login', data={'username': 'admin', 'password': 'snowpeas'}, headers=extra)[0], 403)
        self.success(self.admin, 'POST', '/mygrain/api/songs', data={'name': 'same origin'}, headers={'Origin': origin})
        self.success(self.admin, 'POST', '/mygrain/api/songs', data={'name': 'CLI no origin'})
        headers = self.admin.request('GET', '/mygrain-wavs/api/list')[2]
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertNotIn('Access-Control-Allow-Credentials', headers)
        self.assertEqual(self.admin.request('POST', '/mygrain/api/auth/login', data={'username': 'dan', 'password': 'charged'})[0], 200)
        self.assertEqual(self.admin.request('POST', '/mygrain/api/songs', data={'name': 'old admin tab'})[1]['code'], 'ACCOUNT_CHANGED')

    def test_private_download_identity_binding_and_standalone_redirect(self):
        name = self.upload(self.admin, 'bound.wav')
        returned = self.success(self.admin, 'GET', '/mygrain-wavs/api/list')['files'][0]['url']
        self.assertIn('mygrainUser=admin', returned)
        self.assertEqual(self.admin.request('GET', '/mygrain-wavs/' + name, headers={'X-Mygrain-User': 'dan'})[1]['code'], 'ACCOUNT_CHANGED')
        self.assertEqual(self.dan.request('GET', returned, identity=False)[1]['code'], 'ACCOUNT_CHANGED')
        for route in ('/mygrain-wavs', '/mygrain-stems', '/mygrain-midi', '/mygrain-bastardloops'):
            status, body, headers = self.dan.request('GET', route + '/')
            self.assertEqual(status, 303)
            self.assertEqual(headers['Location'], '/mygrain/')

    def test_positive_static_allowlist_encoded_traversal_and_symlinks(self):
        for path in ['/mygrain/backend/mygrain_accounts.py', '/mygrain/ops-backup/a/index.html',
                     '/mygrain/backups/archive.zip', '/mygrain/2026-10-13_pre_song_implementation/app/index.html',
                     '/mygrain/index_working_12_10_2026.html', '/mygrain/working001.html', '/mygrain/.git/config',
                     '/mygrain/api/../index.html', '/mygrain/%2e%2e/fs7300-documenter/server.py',
                     '/mygrain/%252e%252e/server.py', '/mygrain/patches/%2e%2e/index.html']:
            self.assertIn(self.admin.request('GET', path)[0], (403, 404), path)
        admin_root = self.accounts.path_for('wavs', self.accounts.lookup_user('admin'))
        admin_root.mkdir(parents=True)
        (admin_root / 'private.wav').write_bytes(b'admin private')
        dan_root = self.accounts.path_for('wavs', self.accounts.lookup_user('dan'))
        dan_root.mkdir(parents=True)
        (dan_root / 'linked.wav').symlink_to(admin_root / 'private.wav')
        self.assertNotEqual(self.dan.request('GET', '/mygrain-wavs/linked.wav')[0], 200)
        self.assertEqual(self.dan.request('GET', '/mygrain-wavs/private.wav')[0], 404)
        (dan_root / 'linked.wav').unlink()
        dan_root.rmdir()
        dan_root.symlink_to(admin_root, target_is_directory=True)
        self.assertNotEqual(self.dan.request('GET', '/mygrain-wavs/private.wav')[0], 200)
        self.assertNotEqual(self.dan.request('POST', '/mygrain-wavs/api/upload', body=b'bad', headers={'X-Filename': 'private.wav'})[0], 201)
        self.assertEqual((admin_root / 'private.wav').read_bytes(), b'admin private')

    def test_other_static_mounts_cannot_alias_private_account_files(self):
        admin_root = self.accounts.path_for('wavs', self.accounts.lookup_user('admin'))
        admin_root.mkdir(parents=True)
        (admin_root / 'private.wav').write_bytes(wav_bytes())
        route = {'base': '/test-alias', 'root': self.root, 'documenter_api': False, 'public': True}
        with patch.object(SERVER, 'PROTECTED_ROUTES', [*SERVER.PROTECTED_ROUTES, route]):
            for path in ('/test-alias/admin/wavs/private.wav', '/test-alias/auth/accounts.sqlite3', '/test-alias/auth/accounts.sqlite3-journal'):
                self.assertEqual(self.anonymous.request('GET', path)[0], 403)

    def test_all_file_repositories_and_feedback_are_account_scoped(self):
        for route, filename, first, second in [('/mygrain-wavs', 'same.wav', wav_bytes(value=1), wav_bytes(value=2)),
                                             ('/mygrain-stems', 'same.zip', part_bytes(), part_bytes() + b'dan'),
                                             ('/mygrain-midi', 'same.mid', b'MThd-admin', b'MThd-dan')]:
            for client, body in ((self.admin, first), (self.dan, second)):
                name = self.upload(client, filename, body, route)
                self.assertEqual(name, filename)
                self.assertEqual(self.success(client, 'GET', route + '/' + filename), body)
                self.success(client, 'POST', route + '/api/file-feedback', data={'filename': filename, 'comment': client.username})
            self.assertEqual(self.success(self.admin, 'GET', route + '/api/file-feedback?filename=' + filename)['feedback']['comment'], 'admin')
            self.assertEqual(self.success(self.dan, 'GET', route + '/api/file-feedback?filename=' + filename)['feedback']['comment'], 'dan')
        for client in (self.admin, self.dan):
            result = self.success(client, 'POST', '/mygrain/api/patches/upload', body=part_bytes() + client.username.encode(), headers={'X-Filename': 'same.zip'})
            self.assertEqual(result['savedName'], 'same.zip')
            self.assertEqual(self.success(client, 'GET', '/mygrain/patches/same.zip'), part_bytes() + client.username.encode())
        third = self.third_user()
        self.assertEqual(self.success(third, 'GET', '/mygrain-wavs/api/list')['files'], [])
        self.assertEqual(self.success(third, 'GET', '/mygrain/api/patches/list')['files'], [])
        for client in (self.admin, self.dan):
            query = {'source': 'sampledrop', 'path': 'fixture.wav', 'comment': client.username}
            self.success(client, 'POST', '/mygrain-bastardloops/api/source-file-feedback', data=query)
            result = self.success(client, 'GET', '/mygrain-bastardloops/api/source-file-feedback?source=sampledrop&path=fixture.wav')
            self.assertEqual(result['feedback']['comment'], client.username)
        self.assertNotEqual(self.accounts.path_for('repository_feedback', self.accounts.lookup_user('admin')),
                            self.accounts.path_for('repository_feedback', self.accounts.lookup_user('dan')))

    def test_favourites_arps_vocal_takes_and_debug_logs_are_isolated(self):
        for client in (self.admin, self.dan):
            self.success(client, 'POST', '/mygrain/api/favourites', data={'operation': 'create', 'name': client.username})
            self.success(client, 'POST', '/mygrain/api/arps', data={'name': client.username, 'pattern': {'version': 1, 'steps': [1, 0], 'division': .25, 'repeat': 'once'}})
            vocalist = self.success(client, 'POST', '/mygrain/api/vocal-takes/users', data={'name': client.username})['user']
            folder = self.success(client, 'POST', f'/mygrain/api/vocal-takes/users/{vocalist["id"]}/folders', data={'name': 'private'})['folder']
            query = urlencode({'userId': vocalist['id'], 'folderId': folder['id'], 'name': client.username, 'bpm': 120})
            take = self.success(client, 'POST', '/mygrain/api/vocal-takes/takes?' + query, body=wav_bytes())['take']
            self.assertEqual(self.success(client, 'GET', f'/mygrain/api/vocal-takes/takes/{take["id"]}/audio'), wav_bytes())
            other = self.dan if client is self.admin else self.admin
            self.assertEqual(other.request('GET', f'/mygrain/api/vocal-takes/takes/{take["id"]}/audio')[0], 404)
            report = {'schemaVersion': 1, 'application': 'MYGRAIN', 'build': 'test', 'captureTime': '2026-10-16T12:00:00Z',
                      'currentState': None, 'recentLogs': [], 'debugConsoleText': client.username,
                      'debugConsoleEvents': [], 'userAgent': 'test', 'platform': 'test',
                      'phoneDiagnostics': {'schemaVersion': 1, 'incidents': []}}
            receipt = self.success(client, 'POST', '/mygrain/api/debug-logs', data=report, headers={'X-Mygrain-Debug': '1'})
            stored = self.accounts.path_for('debug_logs', self.accounts.lookup_user(client.username)) / (receipt['logId'] + '.json')
            self.assertEqual(json.loads(stored.read_text())['report']['debugConsoleText'], client.username)
        for client in (self.admin, self.dan):
            favs = self.success(client, 'GET', '/mygrain/api/favourites')
            self.assertEqual([group['name'] for group in favs['groups']], ['Favourites', client.username])
            self.assertEqual([preset['name'] for preset in self.success(client, 'GET', '/mygrain/api/arps')['presets']], [client.username])
            takes = self.success(client, 'GET', '/mygrain/api/vocal-takes')
            self.assertEqual([take['name'] for take in takes['takes']], [client.username])
            self.assertEqual([user['name'] for user in takes['users']], [client.username])

    def test_songs_parts_renders_leases_and_legacy_admin_ownership(self):
        created = {}
        for client in (self.admin, self.dan):
            song = self.success(client, 'POST', '/mygrain/api/songs', data={'name': client.username})['song']
            base = '/mygrain/api/songs/' + song['id']
            lock = self.success(client, 'POST', base + '/lock/acquire', data={'label': client.username, 'deviceId': 'a' * 32, 'sessionId': 'b' * 32}, headers={'If-Match': f'"{song["revision"]}"'})
            edit = {'X-Mygrain-Song-Lock': lock['token'], 'X-Mygrain-Song-Device': 'a' * 32,
                    'X-Mygrain-Song-Session': 'b' * 32, 'If-Match': f'"{song["revision"]}"'}
            song = self.success(client, 'POST', base + '/parts?name=part&repeats=1', body=part_bytes(), headers=edit)['song']
            part = song['parts'][0]
            endpoint = base + f'/parts/{part["id"]}'
            self.assertEqual(self.success(client, 'GET', endpoint), part_bytes())
            rendered = wav_bytes(frames=round(60 / part['bpm'] * part['patternSteps'] / 4 * 8000))
            self.success(client, 'POST', endpoint + f'/render?sha256={part["sha256"]}', body=rendered)
            self.assertEqual(self.success(client, 'GET', endpoint + '/render'), rendered)
            other = self.dan if client is self.admin else self.admin
            for suffix in ('', '/lock', f'/parts/{part["id"]}', f'/parts/{part["id"]}/render'):
                self.assertEqual(other.request('GET', base + suffix, headers={'X-Mygrain-Song-Key': 'a' * 64})[0], 404)
            created[client.username] = song
        second_device = Client(self.server.server_address)
        self.assertEqual(second_device.login('dan', 'charged')[0], 200)
        self.assertEqual(self.success(second_device, 'GET', '/mygrain/api/songs')['songs'][0]['id'], created['dan']['id'])
        admin_song = created['admin']
        manifest = self.accounts.path_for('songs', self.accounts.lookup_user('admin')) / admin_song['id'] / 'song.json'
        stored = json.loads(manifest.read_text())
        stored['ownerHash'] = hashlib.sha256(b'legacy-browser-secret').hexdigest()
        manifest.write_text(json.dumps(stored))
        before = manifest.read_bytes()
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain/api/songs')['songs'][0]['id'], admin_song['id'])
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain/api/songs/' + admin_song['id'])['song']['id'], admin_song['id'])
        self.assertEqual(manifest.read_bytes(), before)

    def wav_entry(self, client, filename, paginated=False):
        path = '/mygrain-wavs/api/list' + ('?limit=50' if paginated else '')
        return next(entry for entry in self.success(client, 'GET', path)['files'] if entry['name'] == filename)

    def test_wav_creator_and_comment_author_ignore_client_attribution(self):
        result = self.success(self.admin, 'POST', '/mygrain-wavs/api/upload?createdBy=dan&sharedBy=dan',
                              body=wav_bytes(), headers={'X-Filename': 'credits.wav', 'X-Created-By': 'dan', 'X-User': 'dan'})
        filename = result['savedName']
        for paginated in (False, True):
            entry = self.wav_entry(self.admin, filename, paginated)
            self.assertEqual((entry['createdBy'], entry['sharedBy'], entry['commentBy']), ('admin', None, None))
        feedback = self.success(self.admin, 'POST', '/mygrain-wavs/api/file-feedback', data={
            'filename': filename, 'comment': 'Real admin note', 'commentBy': 'dan', 'commentsBy': 'dan',
            'createdBy': 'dan', 'sharedBy': 'dan', 'username': 'dan', 'user': 'dan',
        })['feedback']
        self.assertEqual(feedback['commentBy'], 'admin')
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain-wavs/api/file-feedback?filename=' + filename)['feedback']['commentBy'], 'admin')
        for paginated in (False, True):
            entry = self.wav_entry(self.admin, filename, paginated)
            self.assertEqual((entry['commentBy'], entry['feedback']['commentBy']), ('admin', 'admin'))
        self.success(self.admin, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': filename, 'comment': '   ', 'commentBy': 'dan'})
        self.assertIsNone(self.wav_entry(self.admin, filename)['commentBy'])

    def test_three_user_reshare_preserves_creator_sharer_and_real_note_authors(self):
        third = self.third_user()
        filename = self.upload(self.admin, 'three-users.wav')
        first = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={
            'filename': filename, 'username': 'dan', 'createdBy': 'dan', 'sharedBy': third.username,
        })['share']
        self.assertEqual((first['createdBy'], first['sharedBy'], first['comments'], first['commentsBy']), ('admin', 'admin', '', None))
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={
            'filename': first['recipientFilename'], 'notes': 'Dan note for admin', 'commentBy': 'admin',
        })
        second = self.success(self.dan, 'POST', '/mygrain-wavs/api/share', data={
            'filename': first['recipientFilename'], 'username': third.username, 'createdBy': 'dan',
            'sharedBy': 'admin', 'commentsBy': 'admin', 'user': 'admin',
        })['share']
        self.assertEqual((second['createdBy'], second['sharedBy'], second['commentsBy']), ('admin', 'dan', None))
        entry = self.wav_entry(third, second['recipientFilename'])
        self.assertEqual((entry['createdBy'], entry['sharedBy'], entry['feedback']['comment']), ('admin', 'dan', ''))
        self.success(third, 'POST', '/mygrain-wavs/api/file-feedback', data={
            'filename': second['recipientFilename'], 'comment': 'Third note for Dan', 'commentBy': 'admin',
        })
        outbound = self.success(self.dan, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertEqual((outbound['createdBy'], outbound['sharedBy'], outbound['comments'], outbound['commentsBy']),
                         ('admin', 'dan', 'Third note for Dan', third.username))
        admin_outbound = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertEqual((admin_outbound['comments'], admin_outbound['commentsBy']), ('Dan note for admin', 'dan'))
        self.assertNotIn('Third note for Dan', json.dumps(admin_outbound))
        returned = self.success(third, 'POST', '/mygrain-wavs/api/share', data={'filename': second['recipientFilename'], 'username': 'admin'})['share']
        entry = self.wav_entry(self.admin, returned['recipientFilename'])
        self.assertEqual((entry['createdBy'], entry['sharedBy']), ('admin', third.username))
        self.success(third, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': second['recipientFilename'], 'comment': ''})
        self.assertIsNone(self.success(self.dan, 'GET', '/mygrain-wavs/api/shares')['shares'][0]['commentsBy'])

    def test_rename_preserves_attribution_without_overwriting_files_or_notes(self):
        third = self.third_user()
        source = self.upload(self.admin, 'source-credits.wav')
        shared = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': source, 'username': 'dan'})['share']
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': shared['recipientFilename'], 'comment': 'Shared note'})
        existing = self.upload(self.dan, 'occupied.wav', wav_bytes(value=17))
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': existing, 'comment': 'Existing note'})
        renamed = self.success(self.dan, 'POST', '/mygrain-wavs/api/rename', data={
            'from': shared['recipientFilename'], 'to': existing, 'createdBy': 'dan', 'commentBy': 'admin',
        })['savedName']
        self.assertEqual(renamed, 'occupied-1.wav')
        self.assertEqual(self.success(self.dan, 'GET', '/mygrain-wavs/' + existing), wav_bytes(value=17))
        kept = self.wav_entry(self.dan, existing)
        self.assertEqual((kept['createdBy'], kept['sharedBy'], kept['feedback']['comment']), ('dan', None, 'Existing note'))
        moved = self.wav_entry(self.dan, renamed, True)
        self.assertEqual((moved['createdBy'], moved['sharedBy'], moved['commentBy'], moved['feedback']['fileName']), ('admin', 'admin', 'dan', renamed))
        self.assertEqual(moved['feedback']['comment'], 'Shared note')
        self.success(self.dan, 'POST', '/mygrain-wavs/api/rename', data={'from': renamed, 'to': renamed})
        reshared = self.success(self.dan, 'POST', '/mygrain-wavs/api/share', data={'filename': renamed, 'username': third.username})['share']
        self.assertEqual((reshared['createdBy'], reshared['sharedBy']), ('admin', 'dan'))
        self.success(self.admin, 'POST', '/mygrain-wavs/api/rename', data={'from': source, 'to': 'source-moved.wav'})
        outbound = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertEqual((outbound['filename'], outbound['recipientFilename'], outbound['createdBy'], outbound['commentsBy']),
                         ('source-moved.wav', renamed, 'admin', 'dan'))

    def test_delete_and_filename_reuse_reset_file_metadata_but_preserve_share_snapshot(self):
        source = self.upload(self.admin, 'reused-credits.wav')
        shared = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': source, 'username': 'dan'})['share']
        filename = shared['recipientFilename']
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': filename, 'comment': 'Old recipient note'})
        self.success(self.dan, 'DELETE', '/mygrain-wavs/api/delete?filename=' + filename)
        self.upload(self.dan, filename, wav_bytes(value=19))
        entry = self.wav_entry(self.dan, filename)
        self.assertEqual((entry['createdBy'], entry['sharedBy'], entry['commentBy'], entry['feedback']['comment']), ('dan', None, None, ''))
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': filename, 'comment': 'Private replacement note'})
        snapshot = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertTrue(snapshot['recipientDeleted'])
        self.assertEqual((snapshot['createdBy'], snapshot['sharedBy'], snapshot['comments'], snapshot['commentsBy']),
                         ('admin', 'admin', 'Old recipient note', 'dan'))
        self.assertNotIn('Private replacement note', json.dumps(snapshot))

    def test_legacy_files_and_notes_do_not_invent_original_creator_or_author(self):
        third = self.third_user()
        for client in (self.admin, self.dan):
            user = self.accounts.lookup_user(client.username)
            root = self.accounts.path_for('wavs', user)
            root.mkdir(parents=True, exist_ok=True)
            (root / 'legacy-unknown.wav').write_bytes(wav_bytes())
            notes = self.accounts.path_for('repository_feedback', user)
            notes.parent.mkdir(parents=True, exist_ok=True)
            notes.write_text(json.dumps({'version': 1, 'items': {'legacy': {
                'routeBase': '/mygrain-wavs', 'fileName': 'legacy-unknown.wav', 'comment': 'Unproven old note',
            }}}))
            entry = self.wav_entry(client, 'legacy-unknown.wav', True)
            self.assertEqual((entry['createdBy'], entry['sharedBy'], entry['commentBy'], entry['feedback']['commentBy']), (None, None, None, None))
            self.assertEqual(entry['feedback']['comment'], 'Unproven old note')
        shared = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': 'legacy-unknown.wav', 'username': 'dan'})['share']
        self.assertEqual((shared['createdBy'], shared['sharedBy']), (None, 'admin'))
        reshared = self.success(self.dan, 'POST', '/mygrain-wavs/api/share', data={'filename': shared['recipientFilename'], 'username': third.username})['share']
        self.assertEqual((reshared['createdBy'], reshared['sharedBy']), (None, 'dan'))
        entry = self.wav_entry(third, reshared['recipientFilename'])
        self.assertEqual((entry['createdBy'], entry['sharedBy']), (None, 'dan'))

    def test_additive_attribution_migration_preserves_old_shares_and_recipient_note_author(self):
        source = self.upload(self.admin, 'migration-credits.wav')
        shared = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': source, 'username': 'dan'})['share']
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': shared['recipientFilename'], 'comment': 'Historic recipient note'})
        with self.accounts.connection() as connection:
            users_before = [tuple(row) for row in connection.execute('SELECT * FROM users ORDER BY id')]
            sessions_before = [tuple(row) for row in connection.execute('SELECT * FROM sessions ORDER BY token_hash')]
            connection.executescript('''
                CREATE TABLE shares_before (
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
                    recipient_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL,
                    recipient_filename TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
                    comments TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    recipient_deleted INTEGER NOT NULL DEFAULT 0, source_deleted INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO shares_before SELECT id, owner_id, recipient_id, filename, recipient_filename,
                    sha256, size, comments, created_at, updated_at, recipient_deleted, source_deleted FROM shares;
                DROP TABLE shares;
                ALTER TABLE shares_before RENAME TO shares;
                DROP TABLE wav_provenance;
            ''')
            shares_before = [tuple(row) for row in connection.execute('SELECT * FROM shares')]
        self.accounts.initialize()
        self.accounts.initialize()
        with self.accounts.connection() as connection:
            self.assertEqual([tuple(row) for row in connection.execute('SELECT * FROM users ORDER BY id')], users_before)
            self.assertEqual([tuple(row) for row in connection.execute('SELECT * FROM sessions ORDER BY token_hash')], sessions_before)
            self.assertEqual([tuple(row)[:12] for row in connection.execute('SELECT * FROM shares')], shares_before)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM wav_provenance').fetchone()[0], 0)
        snapshot = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertEqual((snapshot['createdBy'], snapshot['sharedBy'], snapshot['comments'], snapshot['commentsBy']),
                         (None, 'admin', 'Historic recipient note', 'dan'))
        entry = self.wav_entry(self.dan, shared['recipientFilename'])
        self.assertEqual((entry['createdBy'], entry['sharedBy']), (None, 'admin'))
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain-wavs/' + source), wav_bytes())

    def test_external_wav_overwrites_invalidate_creator_without_leaking_replacement_notes(self):
        third = self.third_user()
        filename = self.upload(self.admin, 'external-credits.wav')
        shared = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': filename, 'username': 'dan'})['share']
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': shared['recipientFilename'], 'comment': 'Original recipient note'})
        recipient_root = self.accounts.path_for('wavs', self.accounts.lookup_user('dan'))
        replacement = recipient_root / 'maintenance-upload.tmp'
        replacement.write_bytes(wav_bytes(value=23))
        replacement.replace(recipient_root / shared['recipientFilename'])
        entry = self.wav_entry(self.dan, shared['recipientFilename'])
        self.assertEqual((entry['createdBy'], entry['sharedBy']), (None, None))
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': shared['recipientFilename'], 'comment': 'Replacement private note'})
        snapshot = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertEqual((snapshot['comments'], snapshot['commentsBy'], snapshot['recipientDeleted']), ('Original recipient note', 'dan', True))
        reshared = self.success(self.dan, 'POST', '/mygrain-wavs/api/share', data={'filename': shared['recipientFilename'], 'username': third.username})['share']
        self.assertEqual((reshared['createdBy'], reshared['sharedBy']), (None, 'dan'))
        admin_root = self.accounts.path_for('wavs', self.accounts.lookup_user('admin'))
        (admin_root / filename).write_bytes(wav_bytes(value=29))
        self.assertIsNone(self.wav_entry(self.admin, filename)['createdBy'])
        again = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': filename, 'username': third.username})['share']
        self.assertIsNone(again['createdBy'])

    def test_external_replacement_clears_notes_for_list_feedback_and_share_entry_points(self):
        root = self.accounts.path_for('wavs', self.accounts.lookup_user('admin'))
        for trigger in ('list', 'feedback', 'share'):
            with self.subTest(trigger=trigger):
                filename = self.upload(self.admin, 'generation-' + trigger + '.wav')
                self.success(self.admin, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': filename, 'comment': 'Old generation private note'})
                replacement = root / 'replacement.tmp'
                replacement.write_bytes(wav_bytes(value=31))
                replacement.replace(root / filename)
                if trigger == 'feedback':
                    feedback = self.success(self.admin, 'GET', '/mygrain-wavs/api/file-feedback?filename=' + filename)['feedback']
                    self.assertEqual((feedback['comment'], feedback['commentBy']), ('', None))
                elif trigger == 'share':
                    self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': filename, 'username': 'dan'})
                for paginated in (False, True):
                    entry = self.wav_entry(self.admin, filename, paginated)
                    self.assertEqual((entry['createdBy'], entry['sharedBy'], entry['commentBy']), (None, None, None))
                    self.assertEqual((entry['feedback']['comment'], entry['feedback']['commentBy']), ('', None))
                self.success(self.admin, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': filename, 'comment': 'New unknown-creator generation note'})
                self.assertEqual(self.wav_entry(self.admin, filename)['commentBy'], 'admin')
                replacement.write_bytes(wav_bytes(value=37))
                replacement.replace(root / filename)
                entry = self.wav_entry(self.admin, filename)
                self.assertEqual((entry['commentBy'], entry['feedback']['comment'], entry['feedback']['commentBy']), (None, '', None))

    def test_rename_of_replaced_shared_wav_does_not_carry_stale_notes_or_authors(self):
        source = self.upload(self.admin, 'replaced-before-rename.wav')
        shared = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': source, 'username': 'dan'})['share']
        filename = shared['recipientFilename']
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': filename, 'comment': 'Previous shared generation note'})
        root = self.accounts.path_for('wavs', self.accounts.lookup_user('dan'))
        replacement = root / 'replacement.tmp'
        replacement.write_bytes(wav_bytes(value=41))
        replacement.replace(root / filename)
        renamed = self.success(self.dan, 'POST', '/mygrain-wavs/api/rename', data={'from': filename, 'to': 'new-generation-renamed.wav'})['savedName']
        entry = self.wav_entry(self.dan, renamed)
        self.assertEqual((entry['createdBy'], entry['sharedBy'], entry['commentBy']), (None, None, None))
        self.assertEqual((entry['feedback']['comment'], entry['feedback']['commentBy']), ('', None))
        for name in (filename, renamed):
            feedback = self.success(self.dan, 'GET', '/mygrain-wavs/api/file-feedback?filename=' + name)['feedback']
            self.assertEqual((feedback['comment'], feedback['commentBy']), ('', None))
        snapshot = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertTrue(snapshot['recipientDeleted'])
        self.assertEqual((snapshot['comments'], snapshot['commentsBy']), ('Previous shared generation note', 'dan'))

    def test_failed_rename_keeps_creator_and_successful_rename_moves_provenance_before_note_failure(self):
        filename = self.upload(self.admin, 'failed-credits.wav')
        with patch.object(pathlib.Path, 'rename', side_effect=OSError('synthetic rename failure')):
            self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/rename', data={'from': filename, 'to': 'not-moved.wav'})[0], 400)
        self.assertEqual(self.wav_entry(self.admin, filename)['createdBy'], 'admin')
        with patch.object(SERVER, 'rename_mygrain_repository_feedback', side_effect=OSError('synthetic notes failure')):
            self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/rename', data={'from': filename, 'to': 'moved-credits.wav'})[0], 400)
        self.assertEqual(self.wav_entry(self.admin, 'moved-credits.wav')['createdBy'], 'admin')

    def test_shared_copy_comments_rename_delete_and_filename_reuse(self):
        original = wav_bytes(value=123)
        name = self.upload(self.admin, 'shared.wav', original)
        self.upload(self.dan, name, wav_bytes(value=234))
        share = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': name, 'username': 'DAN'})['share']
        recipient_name = share['recipientFilename']
        self.assertNotEqual(recipient_name, name)
        self.assertEqual(self.success(self.dan, 'GET', '/mygrain-wavs/' + recipient_name), original)
        self.assertEqual(share['sha256'], hashlib.sha256(original).hexdigest())
        incoming = self.success(self.dan, 'GET', '/mygrain-wavs/api/list?limit=50')['files']
        self.assertEqual(next(entry for entry in incoming if entry['name'] == recipient_name)['sharedBy'], 'admin')
        renamed = self.success(self.dan, 'POST', '/mygrain-wavs/api/rename', data={'from': recipient_name, 'to': 'renamed.wav'})['savedName']
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': renamed, 'notes': 'Recipient private note'})
        outbound = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertEqual((outbound['id'], outbound['recipientFilename'], outbound['comments']), (share['id'], renamed, 'Recipient private note'))
        self.assertEqual(self.admin.request('GET', '/mygrain-wavs/' + renamed)[0], 404)
        third = self.third_user()
        self.assertEqual(self.success(third, 'GET', '/mygrain-wavs/api/shares')['shares'], [])
        self.assertEqual(third.request('GET', '/mygrain-wavs/' + renamed)[0], 404)
        self.success(self.admin, 'POST', '/mygrain-wavs/api/rename', data={'from': name, 'to': 'source-renamed.wav'})
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]['filename'], 'source-renamed.wav')
        self.success(self.admin, 'DELETE', '/mygrain-wavs/api/delete?filename=source-renamed.wav')
        self.assertEqual(self.success(self.dan, 'GET', '/mygrain-wavs/' + renamed), original)
        self.success(self.dan, 'DELETE', '/mygrain-wavs/api/delete?filename=' + renamed)
        self.upload(self.dan, renamed, wav_bytes(value=999))
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': renamed, 'comment': 'Unrelated replacement secret'})
        tombstone = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertTrue(tombstone['recipientDeleted'])
        self.assertTrue(tombstone['sourceDeleted'])
        self.assertEqual(tombstone['comments'], 'Recipient private note')
        self.assertNotIn('Unrelated replacement secret', json.dumps(tombstone))

    def test_share_validation_and_bytes_detached_from_source(self):
        name = self.upload(self.admin, 'own.wav', wav_bytes(value=1))
        for data in [{'filename': name, 'username': 'admin'}, {'filename': '../own.wav', 'username': 'dan'},
                     {'filename': '/tmp/own.wav', 'username': 'dan'}, {'filename': name, 'username': 'missing'},
                     {'filename': 'absent.wav', 'username': 'dan'}, {'filename': name, 'username': '../dan'}]:
            self.assertIn(self.admin.request('POST', '/mygrain-wavs/api/share', data=data)[0], (400, 404))
        share = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': name, 'username': 'dan', 'root': '/tmp/ignored'})['share']
        source = self.accounts.path_for('wavs', self.accounts.lookup_user('admin')) / name
        source.write_bytes(wav_bytes(value=2))
        self.assertEqual(self.success(self.dan, 'GET', '/mygrain-wavs/' + share['recipientFilename']), wav_bytes(value=1))

    def test_failed_file_operations_tombstone_before_filename_reuse(self):
        name = self.upload(self.admin, 'failure.wav')
        copied = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': name, 'username': 'dan'})['share']
        recipient_name = copied['recipientFilename']
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': recipient_name, 'comment': 'Keep this snapshot'})
        with patch.object(SERVER, 'delete_mygrain_repository_feedback', side_effect=OSError('synthetic store failure')):
            self.assertEqual(self.dan.request('DELETE', '/mygrain-wavs/api/delete?filename=' + recipient_name)[0], 400)
        self.upload(self.dan, recipient_name)
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': recipient_name, 'comment': 'Do not disclose this replacement'})
        tombstone = self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'][0]
        self.assertTrue(tombstone['recipientDeleted'])
        self.assertEqual(tombstone['comments'], 'Keep this snapshot')
        copied = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': name, 'username': 'dan'})['share']
        with patch.object(pathlib.Path, 'rename', side_effect=OSError('synthetic rename failure')):
            self.assertEqual(self.dan.request('POST', '/mygrain-wavs/api/rename', data={'from': copied['recipientFilename'], 'to': 'uncommitted.wav'})[0], 400)
        self.upload(self.dan, 'uncommitted.wav')
        self.success(self.dan, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': 'uncommitted.wav', 'comment': 'New private file'})
        after = next(share for share in self.success(self.admin, 'GET', '/mygrain-wavs/api/shares')['shares'] if share['id'] == copied['id'])
        self.assertTrue(after['recipientDeleted'])
        self.assertEqual(after['comments'], '')

    def test_source_mirrors_cache_remote_fallback_and_generated_loops_are_isolated(self):
        source = 'samples_clap'
        local_dir = SERVER.MYGRAIN_BASTARDLOOP_SOURCE_CONFIG[source]['local_dir']
        admin_root = self.accounts.path_for('source_mirrors', self.accounts.lookup_user('admin')) / local_dir
        admin_root.mkdir(parents=True)
        (admin_root / 'admin-marker.wav').write_bytes(wav_bytes(value=123))
        with patch.object(SERVER.subprocess, 'run', side_effect=AssertionError('No remote account fallback')):
            listing = self.success(self.admin, 'GET', '/mygrain-bastardloops/api/source-files?source=' + source)
            self.assertIn('admin-marker.wav', json.dumps(listing))
            for path in ['/mygrain-bastardloops/api/source-files?source=' + source,
                         '/mygrain-bastardloops/api/source-sample?source=' + source + '&path=admin-marker.wav']:
                status, result, headers = self.dan.request('GET', path)
                self.assertEqual(status, 400)
                self.assertNotIn('admin-marker', json.dumps(result))
            self.assertEqual(self.dan.request('POST', '/mygrain-bastardloops/api/source-sample', data={'source': source})[0], 400)
            token = ACCOUNTS.CURRENT_USER.set(self.accounts.lookup_user('dan'))
            try:
                with self.assertRaises(ValueError):
                    SERVER.fetch_bastardloop_sample_bytes(source, 'admin-marker.wav')
            finally:
                ACCOUNTS.CURRENT_USER.reset(token)
            dan_root = self.accounts.path_for('source_mirrors', self.accounts.lookup_user('dan')) / local_dir
            dan_root.mkdir(parents=True)
            (dan_root / 'dan-marker.wav').write_bytes(wav_bytes(value=456))
            self.assertIn('dan-marker.wav', json.dumps(self.success(self.dan, 'GET', '/mygrain-bastardloops/api/source-files?source=' + source)))
            self.assertEqual(self.success(self.dan, 'GET', '/mygrain-bastardloops/api/source-sample?source=' + source + '&path=dan-marker.wav'), wav_bytes(value=456))
            native_url = self.success(self.dan, 'GET', '/mygrain-bastardloops/api/source-files?source=' + source)['files'][0]['previewUrl']
            self.assertEqual(self.dan.request('GET', native_url, identity=False)[0], 200)
            self.assertEqual(self.admin.request('GET', native_url, identity=False)[1]['code'], 'ACCOUNT_CHANGED')
            for unsafe in ('../outside.wav', 'nested/../outside.wav', 'nested/../../outside.wav'):
                with self.assertRaises(ValueError):
                    SERVER.fetch_bastardloop_sample_bytes(source, unsafe)
            generated = []
            for client in (self.admin, self.dan):
                result = self.success(client, 'POST', '/mygrain-bastardloops/api/bastardloop', data={'source': source, 'seed': 'isolation-fixture', 'patternLength': 8})
                generated.append(result)
                files = self.success(client, 'GET', '/mygrain-bastardloops/api/list')['files']
                self.assertEqual(len(files), 1)
                self.assertEqual(files[0]['name'], result['savedName'])
                self.success(client, 'GET', result['url'])
            self.assertNotEqual(self.success(self.admin, 'GET', generated[0]['url']), self.success(self.dan, 'GET', generated[1]['url']))

    def test_real_concurrent_requests_do_not_mix_context_or_collide(self):
        def operation(index):
            client = self.admin if index % 2 == 0 else self.dan
            body = wav_bytes(value=index + 1)
            name = self.upload(client, 'race.wav', body)
            downloaded = self.success(client, 'GET', '/mygrain-wavs/' + name)
            song = self.success(client, 'POST', '/mygrain/api/songs', data={'name': client.username + '-' + str(index)})['song']
            return client.username, name, body == downloaded, song['id']
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(operation, range(16)))
        for username in ('admin', 'dan'):
            selected = [result for result in results if result[0] == username]
            self.assertEqual(len({result[1] for result in selected}), 8)
            self.assertTrue(all(result[2] for result in selected))
            client = self.admin if username == 'admin' else self.dan
            songs = self.success(client, 'GET', '/mygrain/api/songs')['songs']
            self.assertEqual(len(songs), 8)
            self.assertTrue(all(song['name'].startswith(username + '-') for song in songs))
        self.assertEqual({result[1] for result in results if result[0] == 'admin'}, {result[1] for result in results if result[0] == 'dan'})

    def test_stalled_upload_cannot_block_another_account(self):
        for path, extra in [('/mygrain-wavs/api/upload', {'X-Filename': 'incomplete.wav'}), ('/mygrain/api/songs', {})]:
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
            connection.request('POST', path, body=b'{', headers={'Content-Length': '1000', 'Cookie': self.admin.cookie,
                                                               'X-Mygrain-User': 'admin', **extra})
            try:
                time.sleep(.05)
                started = time.monotonic()
                self.success(self.dan, 'GET', '/mygrain-wavs/api/list')
                self.success(self.dan, 'GET', '/mygrain/api/songs')
                self.assertLess(time.monotonic() - started, 1)
                connection.sock.shutdown(socket.SHUT_WR)
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, 400)
            finally:
                connection.close()


if __name__ == '__main__':
    unittest.main()
