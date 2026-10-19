import base64
import errno
import http.client
import importlib.util
import json
import pathlib
import socket
import struct
import subprocess
import tempfile
import threading
import time
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from http.server import ThreadingHTTPServer
from io import BytesIO
from unittest.mock import Mock, patch
from urllib.parse import urlencode, urlsplit


WORKSPACE = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('mygrain_radiolab_http_tests', WORKSPACE / 'fs7300-documenter/server.py')
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
RADIO = SERVER._radiolab_module
ACCOUNTS = SERVER._accounts_module


def wav_bytes(frames=800, value=1, channels=2, width=2):
    output = BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(width)
        audio.setframerate(8000)
        audio.writeframes(int(value).to_bytes(width, 'little', signed=True) * channels * frames)
    return output.getvalue()


class Client:
    def __init__(self, address, username=None, cookie=None):
        self.address = address
        self.username = username
        self.cookie = cookie

    def request(self, method, path, body=None, payload=None, identity=True, headers=None):
        outgoing = {'Cookie': self.cookie} if self.cookie else {}
        if identity and self.username:
            outgoing['X-Mygrain-User'] = self.username
        if payload is not None:
            body = json.dumps(payload).encode()
            outgoing['Content-Type'] = 'application/json'
        outgoing.update(headers or {})
        connection = http.client.HTTPConnection(*self.address, timeout=10)
        try:
            connection.request(method, path, body=body, headers=outgoing)
            response = connection.getresponse()
            data = response.read()
            if response.getheader('Content-Type', '').startswith('application/json'):
                data = json.loads(data)
            if response.getheader('Set-Cookie'):
                self.cookie = response.getheader('Set-Cookie').split(';')[0]
            return response.status, data, dict(response.getheaders())
        finally:
            connection.close()

    def login(self, username, password):
        status, data, headers = self.request('POST', '/mygrain/api/auth/login', payload={'username': username, 'password': password})
        if status != 200:
            raise AssertionError((status, data))
        self.username = username


class QuietHandler(SERVER.DocumenterHandler):
    def log_message(self, *args):
        pass


class RadioLabCatalogueTests(unittest.TestCase):
    def test_bounded_catalogue_has_unique_strict_ids_and_curated_direct_feeds(self):
        self.assertGreaterEqual(len(RADIO.STATIONS), 19)
        self.assertLessEqual(len(RADIO.STATIONS), 23)
        station_ids = [station['id'] for station in RADIO.STATIONS]
        stream_urls = [station['url'] for station in RADIO.STATIONS]
        self.assertEqual(len(station_ids), len(set(station_ids)))
        self.assertEqual(len(stream_urls), len(set(stream_urls)))
        for station in RADIO.STATIONS:
            with self.subTest(station=station['id']):
                self.assertRegex(station['id'], r'\A[a-z0-9][a-z0-9-]{0,47}\Z')
                for field in ('name', 'language', 'kind'):
                    self.assertTrue(isinstance(station[field], str) and station[field].strip())
                parsed, host, port = RADIO.checked_station_url(station['url'], station)
                self.assertIn(parsed.scheme, ('http', 'https'))
                self.assertEqual(port, 443 if parsed.scheme == 'https' else 80)
                self.assertFalse(parsed.fragment)
                self.assertFalse(parsed.path.endswith(('.m3u', '.m3u8', '.pls', '.ogg', '.opus')))
                self.assertTrue(host)
                self.assertFalse(station.get('redirectHosts'))
                for invalid_id in (station['id'] + '/', station['id'] + '?url=https://example.com', station['url']):
                    with self.assertRaises(RADIO.RequestError):
                        RADIO.station_by_id(invalid_id)
                self.assertIs(RADIO.station_by_id(station['id']), station)

    def test_expansion_has_official_provenance_and_neutral_ownership_labels(self):
        public_ids = {'rthk-radio1', 'rnz-pacific', 'channel-africa', 'rfi-monde', 'france-culture'}
        unusual_ids = {'wfmu-freeform', 'resonance-fm', 'wrmi-9955', 'tilos-radio', 'fsk-hamburg'}
        public_source_hosts = {'app4.rthk.hk', 'stream-ice.radionz.co.nz', 'www.channelafrica.co.za', 'www.rfi.fr', 'developers.radiofrance.fr'}
        unusual_source_hosts = {'www.wfmu.org', 'www.resonancefm.com', 'wrmi.net', 'stream.tilos.hu', 'www.fsk-hh.org'}
        for station_id in public_ids | unusual_ids:
            with self.subTest(station=station_id):
                station = RADIO.station_by_id(station_id)
                source = urlsplit(station['sourceUrl'])
                self.assertEqual(source.scheme, 'https')
                self.assertIn(source.hostname, public_source_hosts if station_id in public_ids else unusual_source_hosts)
                self.assertIsNone(source.port)
                self.assertIsNone(source.username)
                self.assertIsNone(source.password)
                if station_id in public_ids:
                    self.assertRegex(station['kind'], r'\A(?:Public|Government public|State) ')
                else:
                    self.assertRegex(station['kind'], r'\A(?:Independent nonprofit|Community|Private shortwave) ')
        self.assertIn('Government public', RADIO.station_by_id('rthk-radio1')['kind'])
        self.assertIn('SABC-managed', RADIO.station_by_id('channel-africa')['kind'])
        self.assertIn('brokered religious', RADIO.station_by_id('wrmi-9955')['kind'])


class RadioLabHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='mygrain-radiolab-http-')
        self.root = pathlib.Path(self.temporary.name)
        self.accounts = SERVER.init_account_store(self.root)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()
        self.admin = Client(self.server.server_address)
        self.dan = Client(self.server.server_address)
        self.anonymous = Client(self.server.server_address)
        self.admin.login('admin', 'snowpeas')
        self.dan.login('dan', 'charged')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.assertIsNone(ACCOUNTS.current_user())
        self.assertFalse(RADIO.ACTIVE_STREAMS)
        self.temporary.cleanup()

    def success(self, client, method, path, **kwargs):
        status, data, headers = client.request(method, path, **kwargs)
        self.assertIn(status, (200, 201), (path, status, data))
        self.assertIn('no-store', headers['Cache-Control'])
        return data

    def save(self, client, name='Radio capture', body=None, station='vesti-fm'):
        query = urlencode({'name': name, 'station': station})
        return self.success(client, 'POST', '/mygrain/api/radiolab/samples?' + query, body=body if body is not None else wav_bytes())['sample']

    def source_root(self, client):
        return self.accounts.path_for('source_mirrors', self.accounts.lookup_user(client.username)) / RADIO.FOLDER

    def test_catalog_auth_identity_and_public_assets(self):
        for path in ('/mygrain/api/radiolab/stations', '/mygrain/api/radiolab/samples', '/mygrain/api/radiolab/file?name=x', '/mygrain/radiolab/stream/vesti-fm?_mygrain_user=admin'):
            self.assertEqual(self.anonymous.request('GET', path)[0], 401)
        catalog = self.success(self.admin, 'GET', '/mygrain/api/radiolab/stations')
        self.assertEqual([station['id'] for station in catalog['stations']], [station['id'] for station in RADIO.STATIONS])
        self.assertEqual(catalog['rewindSeconds'], 15)
        for station in catalog['stations']:
            self.assertEqual(set(station), {'id', 'name', 'language', 'kind', 'streamUrl'})
            self.assertTrue(station['streamUrl'].startswith('/mygrain/radiolab/stream/'))
            self.assertIn('_mygrain_user=admin', station['streamUrl'])
            self.assertNotIn('/api/', station['streamUrl'])
        self.assertEqual(self.admin.request('GET', '/mygrain/api/radiolab/stations', identity=False)[0], 401)
        for asset in ('radiolab.js', 'radiolab.css', 'radiolab-worklet.js'):
            self.assertTrue(ACCOUNTS.public_asset('/' + asset))
        self.assertFalse(ACCOUNTS.public_asset('/SAMPLES_RADIOLAB/secret.wav'))
        self.assertFalse(ACCOUNTS.public_asset('/backend/mygrain_radiolab.py'))
        with patch.object(RADIO, 'open_station_stream') as upstream:
            for query in ('', '?_mygrain_user=dan', '?_mygrain_user=', '?_mygrain_user=admin&_mygrain_user=admin'):
                self.assertEqual(self.admin.request('GET', '/mygrain/radiolab/stream/vesti-fm' + query, identity=False)[0], 401)
            self.assertEqual(self.dan.request('GET', catalog['stations'][0]['streamUrl'], identity=False)[0], 401)
            self.assertEqual(self.admin.request('GET', '/mygrain/radiolab/stream/unknown?_mygrain_user=admin', identity=False)[0], 404)
            upstream.assert_not_called()

    def test_private_unique_named_wav_listing_and_actual_bytes(self):
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain/api/radiolab/samples'), {'ok': True, 'samples': [], 'folder': 'SAMPLES_RADIOLAB'})
        body = wav_bytes(value=123)
        first = self.save(self.admin, 'Daily news.wav', body)
        second = self.save(self.admin, 'Daily news.wav', body)
        self.assertNotEqual(first['filename'], second['filename'])
        self.assertEqual(first['name'], 'Daily news')
        self.assertEqual(first['station'], 'vesti-fm')
        self.assertAlmostEqual(first['duration'], .1)
        samples = self.success(self.admin, 'GET', '/mygrain/api/radiolab/samples')['samples']
        self.assertEqual({sample['filename'] for sample in samples}, {first['filename'], second['filename']})
        self.assertEqual(self.success(self.admin, 'GET', first['url']), body)
        self.assertEqual(self.admin.request('GET', first['url'], identity=False)[0], 200)
        self.assertEqual(self.dan.request('GET', first['url'])[0], 401)
        unbound = '/mygrain/api/radiolab/file?' + urlencode({'name': first['filename']})
        self.assertEqual(self.dan.request('GET', unbound)[0], 404)
        self.assertEqual(self.success(self.dan, 'GET', '/mygrain/api/radiolab/samples')['samples'], [])
        self.assertFalse((WORKSPACE / 'sandboxGRANULAR' / 'SAMPLES_RADIOLAB').exists())
        self.assertEqual((self.source_root(self.admin) / first['filename']).read_bytes(), body)
        self.assertEqual((self.source_root(self.admin) / first['filename']).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.source_root(self.admin).stat().st_mode & 0o777, 0o700)

    def test_delete_only_targeted_private_wav_metadata_and_invalidates_source_cache(self):
        target = self.save(self.admin, 'Delete this')
        retained = self.save(self.admin, 'Keep this', wav_bytes(value=12))
        private = self.save(self.dan, 'Other account', wav_bytes(value=34))
        unrelated = self.source_root(self.admin).parent / 'unrelated.wav'
        unrelated.write_bytes(wav_bytes(value=56))
        source_roots = (self.source_root(self.admin).parent, self.source_root(self.dan).parent)
        before = {path: path.read_bytes() for root in source_roots for path in root.rglob('*') if path.is_file()}
        target_path = self.source_root(self.admin) / target['filename']
        metadata_path = target_path.with_suffix('.wav.json')
        for client, expected in ((self.admin, 2), (self.dan, 1)):
            listing = self.success(client, 'GET', '/mygrain-bastardloops/api/source-files?source=samples_radiolab')
            self.assertEqual(len(listing['files']), expected)
        endpoint = '/mygrain/api/radiolab/samples?' + urlencode({'name': target['filename']})
        with patch.object(RADIO, 'INVALIDATE_SOURCE_CACHE', wraps=SERVER.invalidate_radiolab_source_cache) as invalidated:
            deleted = self.success(self.admin, 'DELETE', endpoint)
            invalidated.assert_called_once_with()
        self.assertEqual(deleted, {'ok': True, 'deleted': True, 'filename': target['filename'], 'folder': RADIO.FOLDER})
        self.assertFalse(target_path.exists())
        self.assertFalse(metadata_path.exists())
        for path, body in before.items():
            if path not in (target_path, metadata_path):
                self.assertEqual(path.read_bytes(), body, str(path))
        self.assertEqual(self.admin.request('GET', target['url'])[0], 404)
        self.assertEqual(self.success(self.admin, 'GET', retained['url']), wav_bytes(value=12))
        self.assertEqual(self.success(self.dan, 'GET', private['url']), wav_bytes(value=34))
        for client in (self.admin, self.dan):
            listing = self.success(client, 'GET', '/mygrain-bastardloops/api/source-files?source=samples_radiolab')
            self.assertEqual(len(listing['files']), 1)
        self.assertEqual(self.admin.request('DELETE', endpoint)[:2], (404, {'ok': False, 'error': 'RadioLab sample not found.'}))

    def test_delete_requires_cookie_identity_and_same_origin_and_cannot_cross_accounts(self):
        sample = self.save(self.admin)
        endpoint = '/mygrain/api/radiolab/samples?' + urlencode({'name': sample['filename']})
        for client, kwargs, expected in (
            (self.anonymous, {}, 401),
            (self.admin, {'identity': False}, 401),
            (self.admin, {'headers': {'X-Mygrain-User': 'dan'}}, 401),
            (self.admin, {'headers': {'Origin': 'https://attacker.example'}}, 403),
            (self.dan, {}, 404),
        ):
            with self.subTest(expected=expected, kwargs=kwargs):
                self.assertEqual(client.request('DELETE', endpoint, **kwargs)[0], expected)
                self.assertEqual((self.source_root(self.admin) / sample['filename']).read_bytes(), wav_bytes())
        self.success(self.admin, 'DELETE', endpoint)

    def test_delete_rejects_invalid_names_symlinks_and_nonregular_files_without_partial_deletion(self):
        sample = self.save(self.admin)
        other = self.save(self.dan, body=wav_bytes(value=99))
        endpoint = '/mygrain/api/radiolab/samples?'
        for query in ('', 'name=', 'name=one&name=two', 'name=../outside.wav',
                      'name=%2Ftmp%2Foutside.wav', 'name=bad%00.wav', 'name=' + sample['filename'] + '.json'):
            self.assertEqual(self.admin.request('DELETE', endpoint + query)[0], 400)
        path = self.source_root(self.admin) / sample['filename']
        metadata = path.with_suffix('.wav.json')
        other_path = self.source_root(self.dan) / other['filename']
        for target in (path, metadata):
            original = target.read_bytes()
            target.unlink()
            target.symlink_to(other_path)
            self.assertEqual(self.admin.request('DELETE', endpoint + urlencode({'name': path.name}))[0], 503)
            self.assertTrue(path.exists())
            self.assertTrue(metadata.exists())
            self.assertEqual(other_path.read_bytes(), wav_bytes(value=99))
            target.unlink()
            target.write_bytes(original)
        original = metadata.read_bytes()
        metadata.unlink()
        metadata.mkdir()
        self.assertEqual(self.admin.request('DELETE', endpoint + urlencode({'name': path.name}))[0], 503)
        self.assertEqual(path.read_bytes(), wav_bytes())
        metadata.rmdir()
        metadata.write_bytes(original)

    def test_delete_missing_directory_or_files_and_orphans_are_useful_and_scoped(self):
        filename = 'missing-20261017T000000Z-0000000000000000.wav'
        endpoint = '/mygrain/api/radiolab/samples?'
        self.assertEqual(self.admin.request('DELETE', endpoint + urlencode({'name': filename}))[0], 404)
        self.assertFalse(self.source_root(self.admin).exists())
        for missing in ('wav', 'metadata'):
            sample = self.save(self.admin)
            path = self.source_root(self.admin) / sample['filename']
            metadata = path.with_suffix('.wav.json')
            (path if missing == 'wav' else metadata).unlink()
            self.success(self.admin, 'DELETE', endpoint + urlencode({'name': path.name}))
            self.assertFalse(path.exists())
            self.assertFalse(metadata.exists())

    def test_delete_storage_failure_invalidates_partial_removal_and_preserves_other_audio(self):
        sample = self.save(self.admin)
        retained = self.save(self.admin, 'Keep', wav_bytes(value=76))
        path = self.source_root(self.admin) / sample['filename']
        original_unlink = RADIO.os.unlink

        def fail_metadata(name, **kwargs):
            if name == path.name + '.json':
                raise PermissionError(errno.EACCES, 'private storage detail')
            return original_unlink(name, **kwargs)

        with patch.object(RADIO.os, 'unlink', side_effect=fail_metadata), patch.object(RADIO, 'INVALIDATE_SOURCE_CACHE') as invalidated:
            status, data, headers = self.admin.request('DELETE', '/mygrain/api/radiolab/samples?' + urlencode({'name': path.name}))
            self.assertEqual(status, 503)
            self.assertNotIn('private storage detail', data['error'])
            self.assertIn('no-store', headers['Cache-Control'])
            invalidated.assert_called_once_with()
        self.assertFalse(path.exists())
        self.assertTrue(path.with_suffix('.wav.json').exists())
        self.assertEqual(self.success(self.admin, 'GET', retained['url']), wav_bytes(value=76))

    def test_actual_browser_encoder_and_generated_catalog_names_save_privately(self):
        script = r'''
const fs = require('node:fs');
const { Controller } = require('./radiolab.js');
const stations = JSON.parse(fs.readFileSync(0, 'utf8'));
const channel = Float32Array.from({ length: 4410 }, (_, frame) => Math.sin(frame * 2 * Math.PI * 440 / 44100) * 0.25);
(async () => {
    const recordings = [];
    for (const station of stations) {
        const operation = { sampleRate: 44100, station: { id: station.id, name: station.name } };
        const input = { value: '' };
        const controller = Object.assign(Object.create(Controller.prototype), {
            isCurrentCapture(candidate) { return candidate === operation; },
            status() {}, render() {}, diagnosticEvent() {},
            element(id) { return id === 'radiolabStation' ? { value: station.id } : input; },
            pendingRecord: operation, captureDiagnostics: {}
        });
        controller.startRecording(operation);
        if (controller.recorder.metadata.rewindSeconds !== 0) throw new Error('Manual capture must not include pre-roll.');
        controller.recorder.append([channel, channel]);
        controller.recorder.stop();
        recordings.push({ name: input.value, station: station.id, body: Buffer.from(controller.recorder.wav()).toString('base64') });
    }
    process.stdout.write(JSON.stringify(recordings));
})().catch(error => { console.error(error); process.exitCode = 1; });
'''
        result = subprocess.run(['node', '-e', script], input=json.dumps(RADIO.STATIONS),
                                cwd=WORKSPACE / 'sandboxGRANULAR', text=True, capture_output=True, check=True, timeout=15)
        recordings = json.loads(result.stdout)
        self.assertEqual(len(recordings), len(RADIO.STATIONS))
        self.assertIn('上海新闻广播 / Shanghai News Radio', next(recording['name'] for recording in recordings if recording['station'] == 'shanghai-news'))
        for client, other in ((self.admin, self.dan), (self.dan, self.admin)):
            for recording in recordings:
                with self.subTest(user=client.username, station=recording['station']):
                    body = base64.b64decode(recording['body'])
                    sample = self.save(client, recording['name'], body, recording['station'])
                    self.assertEqual(sample['name'], recording['name'])
                    self.assertEqual((sample['sampleRate'], sample['channels'], sample['bitsPerSample']), (44100, 2, 16))
                    self.assertAlmostEqual(sample['duration'], .1)
                    self.assertEqual(self.success(client, 'GET', sample['url']), body)
                    self.assertEqual(other.request('GET', sample['url'])[0], 401)
                    self.assertEqual(other.request('GET', '/mygrain/api/radiolab/file?' + urlencode({'name': sample['filename']}))[0], 404)
            samples = self.success(client, 'GET', '/mygrain/api/radiolab/samples')['samples']
            self.assertEqual({sample['name'] for sample in samples}, {recording['name'] for recording in recordings})

    def test_display_names_are_metadata_not_storage_paths(self):
        names = ('Radio 上海新闻广播 / Shanghai News Radio 2026-10-17-10-30-24',
                 'Japanese radio — 日本語 / Russian русский', '../outside', '/tmp/radiolab-escape', 'nested\\name')
        for name in names:
            with self.subTest(name=name):
                sample = self.save(self.dan, name)
                self.assertEqual(sample['name'], name)
                self.assertRegex(sample['filename'], RADIO.FILENAME_PATTERN)
                path = self.source_root(self.dan) / sample['filename']
                self.assertEqual(path.parent, self.source_root(self.dan))
                self.assertEqual(path.read_bytes(), wav_bytes())
                self.assertEqual(json.loads(path.with_suffix('.wav.json').read_text())['name'], name)
                self.assertEqual(self.admin.request('GET', '/mygrain/api/radiolab/file?' + urlencode({'name': sample['filename']}))[0], 404)

    def test_request_errors_are_specific_and_do_not_echo_input(self):
        cases = (
            ('name=' + 'x' * 101, wav_bytes(), 'Use a sample name of 1–100 characters without control characters, not just dots.'),
            ('name=bad%00name', wav_bytes(), 'Use a sample name of 1–100 characters without control characters, not just dots.'),
            ('name=test&name=duplicate', wav_bytes(), 'Provide one name.'),
            ('name=test&station=https://private.invalid/secret', wav_bytes(), 'Choose a station from the RadioLab catalog.'),
            ('name=test', b'not a WAV' * 8, 'Upload a complete PCM WAV recording, at most 64 MB.'),
            ('name=test', wav_bytes()[:-2], 'The WAV recording has an invalid length.'),
            ('name=test', wav_bytes(frames=160), 'Recordings must be longer than 0.02 seconds and at most 180 seconds.'),
        )
        for query, body, message in cases:
            with self.subTest(query=query):
                status, data, headers = self.admin.request('POST', '/mygrain/api/radiolab/samples?' + query, body=body)
                self.assertEqual((status, data), (400, {'ok': False, 'error': message}))
                self.assertIn('no-store', headers['Cache-Control'])
        self.assertFalse(self.source_root(self.admin).exists())

    def test_storage_errors_are_safe_server_errors_and_preserve_existing_samples(self):
        saved = self.save(self.admin)
        files_before = {path.name: path.read_bytes() for path in self.source_root(self.admin).iterdir()}
        for failure in (errno.ENOSPC, errno.EDQUOT, errno.EACCES, errno.EPERM, errno.EROFS, errno.ENOENT, errno.EIO):
            with self.subTest(errno=failure), patch.object(RADIO, 'write_private', side_effect=OSError(failure, 'private detail', '/secret/private/storage')):
                status, data, headers = self.admin.request('POST', '/mygrain/api/radiolab/samples?name=retry', body=wav_bytes())
                self.assertEqual(status, 507 if failure in (errno.ENOSPC, errno.EDQUOT) else 503)
                self.assertFalse(data['ok'])
                self.assertIn('Contact the administrator' if status == 507 or failure in (errno.EACCES, errno.EPERM, errno.EROFS) else 'contact the administrator', data['error'])
                self.assertNotIn('/secret', data['error'])
                self.assertNotIn('private detail', data['error'])
                self.assertIn('no-store', headers['Cache-Control'])
                if status == 507:
                    self.assertIn('storage is full', data['error'])
        self.assertEqual({path.name: path.read_bytes() for path in self.source_root(self.admin).iterdir()}, files_before)
        self.assertEqual(self.success(self.admin, 'GET', saved['url']), wav_bytes())
        handler = Mock(path='/mygrain/api/radiolab/samples')
        with patch.object(RADIO, 'list_samples', side_effect=ValueError('unexpected internal failure')):
            with self.assertRaisesRegex(ValueError, 'unexpected internal failure'):
                RADIO.handle_radiolab_request(handler, 'GET', '/api/radiolab/samples')
        handler.send_json.assert_not_called()

    def test_corrupt_metadata_errors_are_safe_and_do_not_change_wav(self):
        sample = self.save(self.admin)
        path = self.source_root(self.admin) / sample['filename']
        for body in (b'not JSON /secret/private/storage', b'\xff', b'[]', b'{}'):
            with self.subTest(body=body):
                path.with_suffix('.wav.json').write_bytes(body)
                status, data, headers = self.admin.request('GET', sample['url'])
                self.assertEqual(status, 503)
                self.assertIn('private storage is unavailable', data['error'])
                self.assertNotIn('/secret', data['error'])
                self.assertEqual(self.success(self.admin, 'GET', '/mygrain/api/radiolab/samples')['samples'], [])
                self.assertEqual(path.read_bytes(), wav_bytes())

    def test_symlinked_account_source_root_cannot_cross_accounts(self):
        sample = self.save(self.admin)
        self.source_root(self.dan).parent.symlink_to(self.source_root(self.admin).parent, target_is_directory=True)
        for method, body in (('GET', None), ('POST', wav_bytes())):
            status, data, headers = self.dan.request(method, '/mygrain/api/radiolab/samples?name=test', body=body)
            self.assertEqual(status, 503)
            self.assertNotIn(str(self.source_root(self.admin)), data['error'])
        self.assertEqual(self.dan.request('DELETE', '/mygrain/api/radiolab/samples?' + urlencode({'name': sample['filename']}))[0], 503)
        self.assertEqual(self.success(self.admin, 'GET', sample['url']), wav_bytes())
        self.assertEqual(len(self.success(self.admin, 'GET', '/mygrain/api/radiolab/samples')['samples']), 1)

    def test_local_only_bank_scoped_cache_and_new_account(self):
        self.assertEqual(SERVER.MYGRAIN_BASTARDLOOP_SOURCE_CONFIG['samples_radiolab']['remote'], 'LOCALONLY')
        with patch.object(SERVER.subprocess, 'run', side_effect=AssertionError('No remote fallback')):
            for client in (self.admin, self.dan):
                listing = self.success(client, 'GET', '/mygrain-bastardloops/api/source-files?source=samples_radiolab')
                self.assertEqual(listing['files'], [])
                token = ACCOUNTS.CURRENT_USER.set(self.accounts.lookup_user(client.username))
                try:
                    with self.assertRaises(ValueError):
                        SERVER.fetch_bastardloop_sample_bytes('samples_radiolab', 'missing.wav')
                finally:
                    ACCOUNTS.CURRENT_USER.reset(token)
            admin_sample = self.save(self.admin, body=wav_bytes(value=11))
            self.save(self.dan, body=wav_bytes(value=22))
            for client, expected in ((self.admin, 11), (self.dan, 22)):
                files = self.success(client, 'GET', '/mygrain-bastardloops/api/source-files?source=samples_radiolab')['files']
                self.assertEqual(len(files), 1)
                self.assertEqual(self.success(client, 'GET', files[0]['previewUrl']), wav_bytes(value=expected))
                self.save(client, 'Second')
                self.assertEqual(len(self.success(client, 'GET', '/mygrain-bastardloops/api/source-files?source=samples_radiolab')['files']), 2)
                selected = self.success(client, 'POST', '/mygrain-bastardloops/api/source-sample', payload={'source': 'samples_radiolab', 'path': files[0]['relativePath']})
                self.assertIn(selected, (wav_bytes(value=expected), wav_bytes()))
            third = Client(self.server.server_address)
            self.success(third, 'POST', '/mygrain/api/auth/register', payload={'username': 'radiolab-new', 'password': 'radiolab-test-password'})
            third.username = 'radiolab-new'
            self.assertEqual(self.success(third, 'GET', '/mygrain/api/radiolab/samples')['samples'], [])
            sample = self.save(third)
            self.assertEqual((self.source_root(third) / sample['filename']).read_bytes(), wav_bytes())
            self.assertEqual(third.request('GET', '/mygrain/api/radiolab/file?' + urlencode({'name': admin_sample['filename']}))[0], 404)

    def test_invalid_wav_bounds_names_traversal_and_symlinks(self):
        for name in ('', '.', '..', 'bad\x00name', 'x' * 101):
            self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/samples?' + urlencode({'name': name}), body=wav_bytes())[0], 400)
        for body in (b'not a WAV' * 8, wav_bytes()[:-2], wav_bytes() + b'junk', wav_bytes(frames=8000 * 181), wav_bytes(frames=160)):
            self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/samples?name=test', body=body)[0], 400)
        inconsistent = bytearray(wav_bytes())
        struct.pack_into('<I', inconsistent, 28, 123)
        self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/samples?name=test', body=inconsistent)[0], 400)
        float_wav = bytearray(wav_bytes())
        struct.pack_into('<H', float_wav, 20, 3)
        self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/samples?name=test', body=float_wav)[0], 400)
        self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/samples?name=test&station=not-real', body=wav_bytes())[0], 400)
        with patch.object(RADIO, 'MAX_UPLOAD_BYTES', 64):
            self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/samples?name=test', body=wav_bytes())[0], 400)
        for filename in ('../test.wav', '/tmp/test.wav', 'nested/test.wav', 'nested\\test.wav'):
            self.assertEqual(self.admin.request('GET', '/mygrain/api/radiolab/file?' + urlencode({'name': filename}))[0], 400)
        sample = self.save(self.admin)
        path = self.source_root(self.admin) / sample['filename']
        outside = self.root / 'outside.wav'
        outside.write_bytes(wav_bytes(value=99))
        path.unlink()
        path.symlink_to(outside)
        self.assertEqual(self.admin.request('GET', sample['url'])[0], 503)
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain/api/radiolab/samples')['samples'], [])
        self.source_root(self.dan).parent.mkdir(parents=True)
        self.source_root(self.dan).symlink_to(self.source_root(self.admin), target_is_directory=True)
        status, data, headers = self.dan.request('POST', '/mygrain/api/radiolab/samples?name=bad', body=wav_bytes())
        self.assertEqual(status, 503)
        self.assertNotIn(str(self.source_root(self.admin)), data['error'])

    def test_concurrent_users_save_without_collisions_or_shared_cache(self):
        def operation(index):
            client = self.admin if index % 2 == 0 else self.dan
            body = wav_bytes(value=index + 1)
            sample = self.save(client, 'Simultaneous', body)
            self.assertEqual(self.success(client, 'GET', sample['url']), body)
            return client.username, sample['filename']

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(operation, range(16)))
        self.assertEqual(len({filename for user, filename in results}), 16)
        for client in (self.admin, self.dan):
            files = self.success(client, 'GET', '/mygrain-bastardloops/api/source-files?source=samples_radiolab')['files']
            self.assertEqual({sample['name'] for sample in files}, {filename for user, filename in results if user == client.username})

    def test_relay_does_not_hold_user_lock_and_cleans_up(self):
        entered = threading.Event()
        release = threading.Event()
        response = Mock()
        response.read1.side_effect = lambda maximum: (entered.set(), release.wait(4), b'')[2]
        connection = Mock()
        url = '/mygrain/radiolab/stream/vesti-fm?_mygrain_user=admin'
        with patch.object(RADIO, 'open_station_stream', return_value=(connection, response, 'audio/mpeg')):
            with ThreadPoolExecutor(max_workers=2) as executor:
                streaming = executor.submit(self.admin.request, 'GET', url, identity=False)
                self.assertTrue(entered.wait(2))
                started = time.monotonic()
                try:
                    self.save(self.admin, 'While listening')
                    self.success(self.dan, 'GET', '/mygrain/api/radiolab/samples')
                    self.assertLess(time.monotonic() - started, 2)
                finally:
                    release.set()
                status, body, headers = streaming.result(timeout=4)
                self.assertEqual(status, 200)
                self.assertEqual(headers['X-Accel-Buffering'], 'no')
                self.assertIn('no-store', headers['Cache-Control'])
        response.close.assert_called_once()
        connection.close.assert_called_once()

    def test_relay_limits_user_global_and_stream_read_bytes(self):
        user = self.accounts.lookup_user('admin')
        url = '/mygrain/radiolab/stream/vesti-fm?_mygrain_user=admin'
        with ExitStack() as active:
            for stream in range(RADIO.MAX_USER_STREAMS):
                active.enter_context(RADIO.stream_slot(user['id']))
            status, data, headers = self.admin.request('GET', url, identity=False)
            self.assertEqual(status, 429)
            self.assertEqual(headers['Retry-After'], '10')
            self.success(self.admin, 'GET', '/mygrain/api/radiolab/samples')
        with patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1), RADIO.stream_slot(user['id']):
            self.assertEqual(self.dan.request('GET', '/mygrain/radiolab/stream/vesti-fm?_mygrain_user=dan', identity=False)[0], 429)
        response = Mock()
        response.read1.side_effect = lambda maximum: b'a' * maximum
        connection = Mock()
        with patch.object(RADIO, 'MAX_STREAM_BYTES', 10), patch.object(RADIO, 'open_station_stream', return_value=(connection, response, 'audio/aac')):
            status, body, headers = self.admin.request('GET', url, identity=False)
            self.assertEqual((status, body, headers['Content-Type']), (200, b'a' * 10, 'audio/aac'))
        response.close.assert_called_once()
        connection.close.assert_called_once()

    def test_symlinked_metadata_and_no_partial_save_or_overwrite(self):
        sample = self.save(self.admin)
        path = self.source_root(self.admin) / sample['filename']
        with self.assertRaises(FileExistsError):
            RADIO.write_private(path, wav_bytes(value=77))
        self.assertEqual(path.read_bytes(), wav_bytes())
        metadata = path.with_suffix('.wav.json')
        copied = self.root / 'outside.json'
        copied.write_bytes(metadata.read_bytes())
        metadata.unlink()
        metadata.symlink_to(copied)
        self.assertEqual(self.admin.request('GET', sample['url'])[0], 503)
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain/api/radiolab/samples')['samples'], [])
        original_write = RADIO.write_private

        def failing_metadata_write(target, payload):
            if target.suffix == '.json':
                raise OSError('test disk failure')
            return original_write(target, payload)

        with patch.object(RADIO, 'write_private', side_effect=failing_metadata_write):
            self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/samples?name=must-not-survive', body=wav_bytes())[0], 503)
        self.assertEqual({target.name for target in self.source_root(self.admin).glob('*.wav')}, {sample['filename']})


class RadioLabProxySafetyTests(unittest.TestCase):
    def setUp(self):
        self.station = RADIO.STATIONS[0]

    def addresses(self, *addresses):
        return [(socket.AF_INET6 if ':' in address else socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443)) for address in addresses]

    def test_only_curated_hosts_safe_schemes_ports_and_redirects(self):
        for url in ('http://icecast-vgtrk.cdnvideo.ru/test', 'file:///etc/passwd', 'https://127.0.0.1/test', 'https://example.org/test', 'https://user:pass@icecast-vgtrk.cdnvideo.ru/test', 'https://icecast-vgtrk.cdnvideo.ru:8443/test', 'https://icecast-vgtrk.cdnvideo.ru/test#fragment', 'https://icecast-vgtrk.cdnvideo.ru/\r\nHost: x', 'https://icecast-vgtrk.cdnvideo.ru\\@example.org/test'):
            with self.subTest(url=url), self.assertRaises(RADIO.RelayError):
                RADIO.checked_station_url(url, self.station)
        parsed, host, port = RADIO.checked_station_url(self.station['url'], self.station)
        self.assertEqual((host, port), ('icecast-vgtrk.cdnvideo.ru', 443))
        for address in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '0.0.0.0', '192.168.1.2', '::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '100.64.0.1', '192.0.2.1'):
            with self.subTest(address=address), patch.object(RADIO.socket, 'getaddrinfo', return_value=self.addresses(address)), self.assertRaises(RADIO.RelayError):
                RADIO.resolve_public_addresses(host, port)
        with patch.object(RADIO.socket, 'getaddrinfo', return_value=self.addresses('1.1.1.1', '127.0.0.1')), self.assertRaises(RADIO.RelayError):
            RADIO.resolve_public_addresses(host, port)

    def test_connects_to_checked_ip_with_original_tls_hostname_and_no_metadata(self):
        transport = Mock()
        context = Mock()
        context.wrap_socket.return_value = transport
        connection = Mock()
        with patch.object(RADIO, 'resolve_public_addresses', return_value=self.addresses('1.1.1.1')) as resolve, patch.object(RADIO.socket, 'socket', return_value=transport), patch.object(RADIO.ssl, 'create_default_context', return_value=context), patch.object(RADIO.http.client, 'HTTPSConnection', return_value=connection):
            RADIO.open_pinned_connection(self.station['url'], self.station)
        resolve.assert_called_once_with('icecast-vgtrk.cdnvideo.ru', 443)
        transport.connect.assert_called_once_with(('1.1.1.1', 443))
        context.wrap_socket.assert_called_once_with(transport, server_hostname='icecast-vgtrk.cdnvideo.ru', do_handshake_on_connect=False)
        transport.do_handshake.assert_called_once_with()
        headers = connection.request.call_args.kwargs['headers']
        self.assertEqual(headers['Icy-MetaData'], '0')
        self.assertEqual(headers['Accept-Encoding'], 'identity')
        self.assertNotIn('Cookie', headers)

    def test_unsafe_redirect_and_wrong_content_type_close_upstream(self):
        response = Mock(status=302)
        response.getheader.return_value = 'http://169.254.169.254/latest/meta-data/'
        connection = Mock()
        with patch.object(RADIO, 'open_pinned_connection', return_value=(connection, response)), self.assertRaises(RADIO.RelayError):
            RADIO.open_station_stream(self.station)
        response.close.assert_called_once()
        connection.close.assert_called_once()
        response = Mock(status=200)
        response.getheader.side_effect = lambda name, default='': 'text/html' if name == 'Content-Type' else default
        connection = Mock()
        with patch.object(RADIO, 'open_pinned_connection', return_value=(connection, response)), self.assertRaises(RADIO.RelayError):
            RADIO.open_station_stream(self.station)
        response.close.assert_called_once()
        connection.close.assert_called_once()

    def test_valid_aac_and_mp3_and_bounded_redirects(self):
        for content_type in ('audio/mpeg', 'audio/aac'):
            response = Mock(status=200)
            response.getheader.side_effect = lambda name, default='': content_type if name == 'Content-Type' else default
            connection = Mock()
            with patch.object(RADIO, 'open_pinned_connection', return_value=(connection, response)):
                self.assertEqual(RADIO.open_station_stream(self.station), (connection, response, content_type))
        response = Mock(status=302)
        response.getheader.return_value = '/next'
        connection = Mock()
        with patch.object(RADIO, 'open_pinned_connection', return_value=(connection, response)) as upstream, self.assertRaises(RADIO.RelayError):
            RADIO.open_station_stream(self.station)
        self.assertEqual(upstream.call_count, RADIO.MAX_REDIRECTS + 1)
        self.assertEqual(connection.close.call_count, RADIO.MAX_REDIRECTS + 1)

    def test_disconnect_and_read_timeout_close_upstream_and_release_slot(self):
        token = ACCOUNTS.CURRENT_USER.set({'id': 'radio-proxy-unit', 'username': 'test'})
        try:
            for failure in (BrokenPipeError(), TimeoutError()):
                handler = Mock(command='GET', path='/mygrain/radiolab/stream/vesti-fm')
                response = Mock()
                connection = Mock()
                if isinstance(failure, BrokenPipeError):
                    response.read1.return_value = b'audio bytes'
                    handler.wfile.write.side_effect = failure
                else:
                    response.read1.side_effect = failure
                with patch.object(RADIO, 'open_station_stream', return_value=(connection, response, 'audio/mpeg')):
                    RADIO.handle_stream_request(handler, '/radiolab/stream/vesti-fm')
                self.assertTrue(handler.close_connection)
                self.assertFalse(RADIO.ACTIVE_STREAMS)
                response.close.assert_called_once()
                connection.close.assert_called_once()
                handler.send_json.assert_not_called()
        finally:
            ACCOUNTS.CURRENT_USER.reset(token)

    def test_dns_resolution_timeout_and_saturated_resolvers_are_bounded(self):
        release = threading.Event()
        slots = threading.BoundedSemaphore(1)

        def delayed_resolve(*args, **kwargs):
            release.wait(2)
            return self.addresses('1.1.1.1')

        with patch.object(RADIO, 'DNS_SLOTS', slots):
            try:
                with patch.object(RADIO, 'CONNECT_TIMEOUT', .01), patch.object(RADIO.socket, 'getaddrinfo', side_effect=delayed_resolve), self.assertRaises(RADIO.RelayError):
                    RADIO.resolve_public_addresses('example.org', 443)
            finally:
                release.set()
            self.assertTrue(slots.acquire(timeout=2))
            with self.assertRaises(RADIO.RelayError):
                RADIO.resolve_public_addresses('example.org', 443)
            slots.release()

    def test_pcm_validation_supports_browser_encodings_and_rejects_loop_metadata(self):
        for channels in (1, 2):
            for width in (1, 2, 3, 4):
                self.assertAlmostEqual(RADIO.checked_wav(wav_bytes(channels=channels, width=width))['duration'], .1)
        body = wav_bytes()
        loop_metadata = bytearray(36)
        struct.pack_into('<I', loop_metadata, 28, 1)
        body += b'smpl' + struct.pack('<I', len(loop_metadata)) + loop_metadata
        body = body[:4] + struct.pack('<I', len(body) - 8) + body[8:]
        with self.assertRaises(ValueError):
            RADIO.checked_wav(body)


if __name__ == '__main__':
    unittest.main()
