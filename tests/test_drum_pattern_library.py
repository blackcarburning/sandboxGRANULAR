import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('drum_patterns_test', pathlib.Path(__file__).parents[1] / 'backend/mygrain_drum_patterns.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def archive(extra=None):
    out = io.BytesIO()
    manifest = {'version': 1, 'state': {'patternLength': 16}, 'audio': {'kick': {'sampleRate': 24000, 'length': 4, 'channels': 1}}}
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_STORED) as z:
        z.writestr('drum-pattern.json', json.dumps(manifest))
        z.writestr('audio/kick-0.f32', b'\x00' * 16)
        if extra:
            z.writestr(extra, b'no')
    return out.getvalue()


class Handler:
    def __init__(self, path, data=None, body=b''):
        self.path = path
        self.data = data
        self.headers = {'Content-Length': str(len(body))}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.status = None
        self.result = None
    def read_json(self): return self.data
    def send_json(self, data, status=200, extra_headers=None): self.result, self.status = data, status
    def send_response(self, status): self.status = status
    def send_header(self, *args): pass
    def end_headers(self): pass


class Library(unittest.TestCase):
    def test_lossless_archive_and_reject_unexpected_or_unsafe_files(self):
        self.assertEqual(module.validate_archive(archive())['audio']['kick']['length'], 4)
        for path in ['../escape', 'unexpected.txt']:
            with self.assertRaises(ValueError): module.validate_archive(archive(path))
        with self.assertRaises(zipfile.BadZipFile): module.validate_archive(b'not a zip')

    def test_nested_folders_pattern_and_account_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            account_a, account_b = pathlib.Path(directory) / 'a', pathlib.Path(directory) / 'b'
            def call(method, path, data=None, body=b'', root=account_a):
                h = Handler(path, data, body)
                module.handle(h, method, path.split('?')[0], root)
                return h
            folder = call('POST', '/api/drum-patterns/folders', {'name': 'Fills', 'parent': ''})
            self.assertEqual(folder.status, 201)
            key = folder.result['folder']['id']
            nested = call('POST', '/api/drum-patterns/folders', {'name': 'Nested', 'parent': key})
            self.assertEqual(nested.status, 201)
            duplicate = call('POST', '/api/drum-patterns/folders', {'name': 'FILLS', 'parent': ''})
            self.assertEqual(duplicate.status, 400)
            self.assertEqual(call('POST', '/api/drum-patterns/folders', {'name': 'Bad', 'parent': '../escape'}).status, 400)
            saved = call('POST', '/api/drum-patterns/patterns?name=Kit&folder=' + key, body=archive())
            self.assertEqual(saved.status, 201)
            pattern = saved.result['pattern']['id']
            loaded = call('GET', '/api/drum-patterns/patterns/' + pattern)
            self.assertEqual(loaded.wfile.getvalue(), archive())
            self.assertEqual(call('GET', '/api/drum-patterns/patterns/' + pattern, root=account_b).status, 404)
            self.assertEqual(call('GET', '/api/drum-patterns', root=account_b).result['patterns'], [])
            self.assertEqual(call('GET', '/api/drum-patterns/patterns/..').status, 400)
            self.assertEqual(len(call('GET', '/api/drum-patterns').result['patterns']), 1)


if __name__ == '__main__': unittest.main()
