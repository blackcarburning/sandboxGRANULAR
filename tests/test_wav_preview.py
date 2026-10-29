"""Real FFmpeg/HTTP isolation and priority checks for iPhone listening copies."""
import concurrent.futures
import hashlib
import http.client
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
import mygrain_wav_preview as preview

SPEC = importlib.util.spec_from_file_location('preview_account_fixtures', pathlib.Path(__file__).with_name('test_mygrain_accounts.py'))
fixtures = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixtures)


class PreviewTests(unittest.TestCase):
    def setUp(self):
        fixtures.AccountHTTPTests.setUp(self)
        self.store = preview.PreviewStore(self.accounts, self.root / 'cache')
        self.preview_server = preview.PreviewServer(('127.0.0.1', 0), preview.PreviewHandler)
        self.preview_server.preview_store = self.store
        self.preview_thread = threading.Thread(target=self.preview_server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.preview_thread.start()
        self.root.joinpath('admin/wavs').mkdir(parents=True, exist_ok=True)
        self.wav = self.root / 'admin/wavs/one.wav'
        subprocess.run(['/usr/bin/ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10',
                        '-ac', '2', '-c:a', 'pcm_s24le', '-y', str(self.wav)], check=True)
        self.source_hash = hashlib.sha256(self.wav.read_bytes()).hexdigest()
        self.user = self.accounts.lookup_user('admin')
        self.fast_admin = fixtures.Client(self.preview_server.server_address)
        self.fast_admin.username, self.fast_admin.cookie = self.admin.username, self.admin.cookie
        self.url = preview.ROUTE + '?filename=one.wav'

    def tearDown(self):
        self.assertEqual(hashlib.sha256(self.wav.read_bytes()).hexdigest(), self.source_hash)
        self.preview_server.shutdown()
        self.preview_server.server_close()
        self.preview_thread.join()
        fixtures.AccountHTTPTests.tearDown(self)

    # Do not inherit the unrelated account test suite.
    def test_compressed_audio_and_warm_cache(self):
        status, body, headers = self.fast_admin.request('GET', self.url)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'audio/mp4')
        self.assertEqual(headers['Cache-Control'], 'private, no-store')
        self.assertEqual(headers['X-Mygrain-Preview-Cache'], 'miss')
        self.assertLess(len(body), self.wav.stat().st_size / 8)
        with patch.object(preview.subprocess, 'run', side_effect=AssertionError('A warm request must not encode')):
            again, reused, warm = self.fast_admin.request('GET', self.url)
        self.assertEqual((again, reused), (200, body))
        self.assertEqual(warm['X-Mygrain-Preview-Cache'], 'hit')
        output = self.root / 'probe.m4a'
        output.write_bytes(body)
        info = json.loads(subprocess.check_output(['/usr/bin/ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,channels', '-of', 'json', str(output)]))
        self.assertAlmostEqual(float(info['format']['duration']), 10, delta=.05)
        self.assertEqual(info['streams'][0]['channels'], 2)
        self.assertEqual(info['streams'][0]['codec_name'], 'aac')

    def test_auth_identity_and_no_cross_account_cache_access(self):
        self.assertEqual(self.fast_admin.request('GET', self.url)[0], 200)
        anonymous = fixtures.Client(self.preview_server.server_address)
        self.assertEqual(anonymous.request('GET', self.url)[0], 401)
        self.assertEqual(self.fast_admin.request('GET', self.url, identity=False)[0], 401)
        dan = fixtures.Client(self.preview_server.server_address)
        dan.username, dan.cookie = self.dan.username, self.dan.cookie
        self.assertEqual(dan.request('GET', self.url)[0], 404)
        self.assertEqual(dan.request('GET', self.url, headers={'X-Mygrain-User': 'admin'})[0], 401)
        self.assertEqual(self.fast_admin.request('GET', self.url + '&mygrainUser=dan')[0], 401)
        for name in ['../one.wav', '.one.wav', 'x/one.wav', 'x\\one.wav']:
            from urllib.parse import urlencode
            self.assertEqual(self.fast_admin.request('GET', preview.ROUTE + '?' + urlencode({'filename': name}))[0], 400)
        (self.root / 'admin/wavs/link.wav').symlink_to(self.wav)
        self.assertEqual(self.fast_admin.request('GET', preview.ROUTE + '?filename=link.wav')[0], 503)
        (self.root / 'admin/wavs/dir.wav').mkdir()
        self.assertEqual(self.fast_admin.request('GET', preview.ROUTE + '?filename=dir.wav')[0], 404)
        self.assertEqual(self.store.cache.stat().st_mode & 0o777, 0o700)

    def test_separate_process_request_never_waits_for_app_account_lock(self):
        with self.accounts.user_lock(self.user), concurrent.futures.ThreadPoolExecutor(1) as pool:
            result = pool.submit(self.fast_admin.request, 'GET', self.url)
            self.assertEqual(result.result(timeout=2)[0], 200)

    def test_simultaneous_requests_encode_once(self):
        original_run = preview.subprocess.run
        calls = []
        def counted(*args, **kwargs):
            calls.append(args)
            time.sleep(.1)
            return original_run(*args, **kwargs)
        with patch.object(preview.subprocess, 'run', side_effect=counted), concurrent.futures.ThreadPoolExecutor(4) as pool:
            results = list(pool.map(lambda _: self.fast_admin.request('GET', self.url), range(4)))
        self.assertTrue(all(result[0] == 200 for result in results))
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(result[1] == results[0][1] for result in results))

    def test_watcher_warms_without_poll_delay_for_request(self):
        self.store.warm_once()
        self.assertEqual(self.fast_admin.request('GET', self.url)[2]['X-Mygrain-Preview-Cache'], 'hit')

    def test_replacement_and_deletion_never_reuse_old_copy(self):
        first = self.fast_admin.request('GET', self.url)
        original = self.wav.read_bytes()
        replacement = self.wav.with_suffix('.new')
        replacement.write_bytes(original)
        replacement.replace(self.wav)
        second = self.fast_admin.request('GET', self.url)
        self.assertEqual(second[2]['X-Mygrain-Preview-Cache'], 'miss')
        self.wav.rename(self.wav.with_suffix('.held'))
        try:
            self.assertEqual(self.fast_admin.request('GET', self.url)[0], 404)
        finally:
            self.wav.with_suffix('.held').rename(self.wav)

    def test_failed_encode_removes_partial_cache_and_can_retry(self):
        with patch.object(preview.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)):
            self.assertEqual(self.fast_admin.request('GET', self.url)[0], 422)
        self.assertEqual(list(self.store.cache.iterdir()), [])
        self.assertEqual(self.fast_admin.request('GET', self.url)[0], 200)


if __name__ == '__main__':
    unittest.main()
