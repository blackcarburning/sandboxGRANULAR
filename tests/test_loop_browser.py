import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / 'fs7300-documenter' / 'server.py'
SPEC = importlib.util.spec_from_file_location('mygrain_loop_browser_tests', MODULE_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class LoopBrowserTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = pathlib.Path(self.folder.name)
        self.root_patch = patch.object(SERVER, 'MYGRAIN_BASTARDLOOPS_ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        for index in range(125):
            (self.root / f'loop-{index:04d}.wav').write_bytes(b'fixture')
        (self.root / 'index.html').write_text('browser')
        (self.root / 'not-a-file.wav').mkdir()
        (self.root / 'linked.wav').symlink_to(self.root / 'loop-0000.wav')

    def page(self, **query):
        return SERVER.list_mygrain_repository_page(SERVER.MYGRAIN_BASTARDLOOPS_ROUTE, {
            key: [str(value)] for key, value in query.items()
        })

    def test_first_page_is_small_and_does_not_open_audio_or_load_feedback(self):
        with patch.object(SERVER, 'load_mygrain_repository_feedback_store', side_effect=AssertionError('No feedback needed')), \
                patch.object(pathlib.Path, 'open', side_effect=AssertionError('No audio reads needed')):
            result = self.page(limit=50)
        self.assertEqual(result['total'], 125)
        self.assertEqual(result['repositoryTotal'], 125)
        self.assertEqual(len(result['files']), 50)
        self.assertEqual(result['files'][0]['name'], 'loop-0000.wav')
        self.assertEqual(result['files'][-1]['name'], 'loop-0049.wav')
        self.assertNotIn('feedback', result['files'][0])
        self.assertLess(len(json.dumps(result)), 15000)

    def test_only_visible_files_need_stat_metadata(self):
        original_scandir = SERVER.os.scandir
        inspected = []

        class Entry:
            def __init__(self, entry):
                self.entry = entry
                self.name = entry.name

            def is_file(self, **options):
                return self.entry.is_file(**options)

            def stat(self, **options):
                inspected.append(self.name)
                return self.entry.stat(**options)

        class Directory:
            def __enter__(self):
                self.directory = original_scandir(self_root)
                return (Entry(entry) for entry in self.directory)

            def __exit__(self, *error):
                self.directory.close()

        self_root = self.root
        with patch.object(SERVER.os, 'scandir', side_effect=lambda root: Directory()):
            result = self.page(limit=10, offset=70)
        self.assertEqual(inspected, [entry['name'] for entry in result['files']])
        self.assertEqual(len(inspected), 10)

    def test_paging_search_and_case_insensitive_extensions(self):
        (self.root / 'Voice & <take>.WAV').write_bytes(b'vocal')
        second = self.page(limit=50, offset=50)
        self.assertEqual(second['files'][0]['name'], 'loop-0050.wav')
        last = self.page(limit=50, offset=999999)
        self.assertEqual(last['offset'], 100)
        self.assertEqual(len(last['files']), 26)
        searched = self.page(limit=50, q='VOICE & <TAKE>')
        self.assertEqual(searched['total'], 1)
        self.assertEqual(searched['repositoryTotal'], 126)
        self.assertEqual(searched['files'][0]['url'], '/mygrain-bastardloops/Voice%20%26%20%3Ctake%3E.WAV')

    def test_empty_search_and_bounded_limits(self):
        result = self.page(limit=50, offset=50, q='missing')
        self.assertEqual(result['files'], [])
        self.assertEqual(result['offset'], 0)
        self.assertEqual(result['total'], 0)
        self.assertEqual(len(self.page(limit=999999)['files']), 100)
        self.assertEqual(len(self.page(limit=-5, offset=-10)['files']), 1)
        with self.assertRaises(ValueError):
            self.page(limit='invalid')

    def test_a_file_removed_during_listing_does_not_fail_the_page(self):
        original_stat = SERVER.os.DirEntry.stat

        def disappearing_stat(entry, **options):
            if entry.name == 'loop-0001.wav':
                raise FileNotFoundError(entry.name)
            return original_stat(entry, **options)

        with patch.object(SERVER.os.DirEntry, 'stat', disappearing_stat):
            result = self.page(limit=5)
        self.assertEqual(len(result['files']), 4)

    def test_http_opt_in_preserves_legacy_list_and_rejects_invalid_page(self):
        legacy = [{'name': 'legacy.wav', 'feedback': {'comment': 'retained'}}]
        server_spec = importlib.util.spec_from_file_location('loop_browser_http_accounts_tests', MODULE_PATH)
        server_module = importlib.util.module_from_spec(server_spec)
        server_spec.loader.exec_module(server_module)
        accounts = server_module.init_account_store(self.root / 'http')
        repository = accounts.path_for('bastardloops', accounts.lookup_user('admin'))
        repository.mkdir(parents=True)
        for path in self.root.glob('*.wav'):
            if not path.is_symlink() and path.is_file():
                (repository / path.name).write_bytes(path.read_bytes())
        with ThreadingHTTPServer(('127.0.0.1', 0), server_module.DocumenterHandler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                base = f'http://127.0.0.1:{server.server_port}/mygrain-bastardloops/api/list'
                login_url = f'http://127.0.0.1:{server.server_port}/mygrain/api/auth/login'
                login = Request(login_url, data=json.dumps({'username': 'admin', 'password': 'snowpeas'}).encode(), headers={'Content-Type': 'application/json'})
                with urlopen(login) as response:
                    cookie = response.getheader('Set-Cookie').split(';')[0]
                    self.assertTrue(json.load(response)['ok'])
                headers = {'Cookie': cookie, 'X-Mygrain-User': 'admin'}
                with patch.object(server_module, 'list_mygrain_repository_files', return_value=legacy):
                    with urlopen(Request(base, headers=headers)) as response:
                        self.assertEqual(json.load(response), {'ok': True, 'files': legacy})
                    with urlopen(Request(base + '?limit=50&offset=100', headers=headers)) as response:
                        self.assertEqual(len(json.load(response)['files']), 25)
                    with self.assertRaises(HTTPError) as failure:
                        urlopen(Request(base + '?limit=bad', headers=headers))
                    self.assertEqual(failure.exception.code, 400)
            finally:
                server.shutdown()
                worker.join()


if __name__ == '__main__':
    unittest.main()
