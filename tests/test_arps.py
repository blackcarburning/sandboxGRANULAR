import concurrent.futures
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('arps_test_module', pathlib.Path(__file__).resolve().parents[1] / 'backend' / 'mygrain_arps.py')
arps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arps)


class Handler:
    def __init__(self, body=b'', headers=None):
        self.headers = {'Content-Length': str(len(body)), 'Host': 'localhost', 'Content-Type': 'application/json', **(headers or {})}
        self.rfile = BytesIO(body)

    def send_json(self, payload, status=200, extra_headers=None):
        self.response = payload
        self.status = status
        self.response_headers = extra_headers


class ArpsTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='mygrain-arps-unit-')
        self.addCleanup(folder.cleanup)
        self.root = pathlib.Path(folder.name) / 'arps'
        override = patch.object(arps, 'ARPS_ROOT', self.root)
        override.start()
        self.addCleanup(override.stop)
        self.pattern = {'version': 1, 'steps': [1, 0, 3, 2, 0, 8], 'division': 1 / 6, 'repeat': 'until-next'}

    def request(self, body=None, headers=None):
        handler = Handler(json.dumps(body).encode() if body is not None else b'', headers)
        self.assertTrue(arps.handle_arps_request(handler, 'POST' if body is not None else 'GET', '/api/arps'))
        return handler

    def save(self, name='Test'):
        return self.request({'name': name, 'pattern': self.pattern})

    def test_repository_is_global_durable_and_no_store(self):
        self.assertEqual(self.request().response['presets'], [])
        result = self.save()
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['presets'][0]['pattern'], self.pattern)
        self.assertEqual(self.request().response['presets'], result.response['presets'])
        self.assertEqual(self.request().response_headers['Cache-Control'], 'no-store')
        self.assertTrue((self.root / 'library.json').is_file())

    def test_duplicate_names_never_overwrite_shared_presets(self):
        self.save()
        before = (self.root / 'library.json').read_bytes()
        result = self.save(' test ')
        self.assertEqual(result.status, 400)
        self.assertEqual((self.root / 'library.json').read_bytes(), before)

    def test_invalid_patterns_and_names_cannot_be_saved(self):
        for steps in [[], [True], [1.1], [-1], [9], [1] * 33, '1,2,3']:
            with self.subTest(steps=steps):
                pattern = {**self.pattern, 'steps': steps}
                self.assertEqual(self.request({'name': 'Invalid', 'pattern': pattern}).status, 400)
        for value in [True, 0, float('nan'), .2, '0.25']:
            self.assertEqual(self.request({'name': 'Invalid', 'pattern': {**self.pattern, 'division': value}}).status, 400)
        for value in ['', 'Bad\nname', 'x' * 81, True]:
            self.assertEqual(self.request({'name': value, 'pattern': self.pattern}).status, 400)
        self.assertFalse((self.root / 'library.json').exists())

    def test_cross_site_and_wrong_content_type_saves_are_rejected(self):
        body = {'name': 'Unsafe', 'pattern': self.pattern}
        self.assertEqual(self.request(body, {'Origin': 'https://evil.example'}).status, 403)
        self.assertEqual(self.request(body, {'Sec-Fetch-Site': 'cross-site'}).status, 403)
        self.assertEqual(self.request(body, {'Content-Type': 'text/plain'}).status, 400)
        self.assertFalse(self.root.exists())

    def test_concurrent_saves_keep_every_preset_and_monotonic_revision(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda index: self.save(f'Arp {index}'), range(24)))
        self.assertTrue(all(result.status == 200 for result in results))
        library = self.request().response
        self.assertEqual(len(library['presets']), 24)
        self.assertEqual(library['revision'], 24)
        self.assertEqual(len({preset['id'] for preset in library['presets']}), 24)

    def test_corruption_and_symbolic_links_are_not_overwritten(self):
        self.root.mkdir()
        target = self.root / 'library.json'
        target.write_text('invalid JSON')
        self.assertEqual(self.save().status, 400)
        self.assertEqual(target.read_text(), 'invalid JSON')
        target.unlink()
        outside = self.root.parent / 'outside.json'
        outside.write_text('private')
        target.symlink_to(outside)
        self.assertEqual(self.save().status, 400)
        self.assertEqual(outside.read_text(), 'private')

    def test_failed_atomic_write_leaves_previous_library_intact(self):
        self.save()
        before = (self.root / 'library.json').read_bytes()
        with patch.object(arps.os, 'replace', side_effect=OSError('disk unavailable')):
            self.assertEqual(self.save('Different').status, 500)
        self.assertEqual((self.root / 'library.json').read_bytes(), before)
        self.assertEqual(len(list(self.root.iterdir())), 1)


if __name__ == '__main__':
    unittest.main()
