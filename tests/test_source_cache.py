import importlib.util
import pathlib
import sys
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from mygrain_source_cache import SourceCache


class CacheTests(unittest.TestCase):
    def test_lru_and_immutable_owned_pcm(self):
        cache = SourceCache(max_bytes=64)
        source = np.ones((4, 2), np.float32)
        a, meta = cache.get('a', lambda: (source, {'bpm': 120}))
        source[:] = 0
        self.assertTrue(a.all())
        with self.assertRaises(ValueError):
            a[:] = 0
        meta['bpm'] = 0
        self.assertEqual(cache.get('a', lambda: self.fail())[1]['bpm'], 120)
        cache.get('b', lambda: (source, {}))
        cache.get('a', lambda: self.fail())
        cache.get('c', lambda: (source, {}))
        self.assertNotIn('b', cache.entries)
        self.assertEqual(cache.bytes, 64)
        cache.get('oversized', lambda: (np.zeros((100, 2), np.float32), {}))
        self.assertNotIn('oversized', cache.entries)
        self.assertEqual(cache.bytes, 64)

    def test_expiry_and_single_flight(self):
        cache = SourceCache(ttl=.02)
        builds = []
        def build():
            builds.append(1)
            time.sleep(.01)
            return np.ones((4, 2)), {}
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda _: cache.get('same', build), range(4)))
        self.assertEqual(len(builds), 1)
        time.sleep(.03)
        cache.get('same', build)
        self.assertEqual(len(builds), 2)

    def test_server_content_bpm_and_account_invalidation_and_access_checks(self):
        from io import BytesIO
        from scipy.io import wavfile
        spec = importlib.util.spec_from_file_location('cache_server_test', ROOT.parent / 'fs7300-documenter/server.py')
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        server._gpu_phase.close()
        audio = BytesIO()
        wavfile.write(audio, 48000, np.zeros((96000, 2), np.int16))
        user = {'id': 'a'*32, 'is_admin': False}
        with patch.object(server, 'fetch_bastardloop_sample_bytes', return_value=audio.getvalue()) as fetch, patch.object(server._accounts_module, 'current_user', return_value=user), patch.object(server, 'get_bastardloop_local_source_root', return_value='/test'), patch.object(server, 'maybe_prepare_bar_locked_bastardloop_source', side_effect=lambda x, *args: (x, {})) as conform:
            server.prepare_bastardloop_source('samples_vocal', 'x.wav', 100)
            server.prepare_bastardloop_source('samples_vocal', 'x.wav', 100)
            self.assertEqual(conform.call_count, 1)
            self.assertEqual(fetch.call_count, 2)
            server.prepare_bastardloop_source('samples_vocal', 'x.wav', 110)
            self.assertEqual(conform.call_count, 2)
            user['id'] = 'b'*32
            server.prepare_bastardloop_source('samples_vocal', 'x.wav', 110)
            self.assertEqual(conform.call_count, 3)
            audio = BytesIO()
            wavfile.write(audio, 48000, np.ones((96000, 2), np.int16))
            fetch.return_value = audio.getvalue()
            server.prepare_bastardloop_source('samples_vocal', 'x.wav', 110)
            self.assertEqual(conform.call_count, 4)
            fetch.side_effect = PermissionError('revoked')
            with self.assertRaises(PermissionError):
                server.prepare_bastardloop_source('samples_vocal', 'x.wav', 110)


if __name__ == '__main__':
    unittest.main()
