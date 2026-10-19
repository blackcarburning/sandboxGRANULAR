import concurrent.futures
import importlib.util
import json
import pathlib
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('favourites_test_module', pathlib.Path(__file__).resolve().parents[1] / 'backend' / 'mygrain_favourites.py')
favourites = importlib.util.module_from_spec(spec)
spec.loader.exec_module(favourites)


class Handler:
    def __init__(self, body=b'', headers=None):
        self.headers = {'Content-Length': str(len(body)), 'Host': 'localhost', **(headers or {})}
        self.rfile = BytesIO(body)

    def send_json(self, payload, status=200, extra_headers=None):
        self.response = payload
        self.status = status
        self.response_headers = extra_headers


class FavouritesTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='mygrain-favourites-unit-')
        self.addCleanup(self.folder.cleanup)
        self.root = pathlib.Path(self.folder.name) / 'favourites'
        self.override = patch.object(favourites, 'FAVOURITES_ROOT', self.root)
        self.override.start()
        self.addCleanup(self.override.stop)

    def request(self, body=None, headers=None):
        handler = Handler(json.dumps(body).encode() if body is not None else b'', headers)
        self.assertTrue(favourites.handle_favourites_request(handler, 'POST' if body is not None else 'GET', '/api/favourites'))
        return handler

    def change(self, operation, **body):
        result = self.request({'operation': operation, **body})
        self.assertEqual(result.status, 200, result.response)
        return result.response

    def test_get_is_read_only_and_starts_with_a_named_collection(self):
        response = self.request()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.response['groups'][0]['name'], 'Favourites')
        self.assertEqual(response.response_headers['Cache-Control'], 'no-store')
        self.assertFalse(self.root.exists())

    def test_create_rename_and_remove_collections_without_touching_source_files(self):
        source = pathlib.Path(self.folder.name) / 'ride.wav'
        source.write_bytes(b'original fixture')
        result = self.change('create', name='Rides and hats')
        group = result['selectedGroupId']
        self.change('rename', groupId=group, name='Soft rides')
        self.change('set', groupId=group, key='["sample:cymbals","ride.wav"]', selected=True, name='My ride')
        self.change('delete', groupId=group)
        self.assertEqual(source.read_bytes(), b'original fixture')
        self.assertEqual(len(self.request().response['groups']), 1)

    def test_duplicate_collection_names_are_rejected_case_insensitively(self):
        self.change('create', name='Rides')
        response = self.request({'operation': 'create', 'name': ' RIDES '})
        self.assertEqual(response.status, 400)
        self.assertEqual(len(self.request().response['groups']), 2)

    def test_rename_cannot_collide_with_another_collection(self):
        group = self.change('create', name='Rides')['selectedGroupId']
        response = self.request({'operation': 'rename', 'groupId': group, 'name': 'favourites'})
        self.assertEqual(response.status, 400)

    def test_add_rename_and_remove_an_item_are_persistent_and_idempotent(self):
        key = '["repository:wav","big.wav"]'
        for unused in range(2):
            self.change('set', groupId='default', key=key, selected=True, name='big.wav')
        self.change('label', groupId='default', key=key, name='The best backing vocal')
        saved = self.request().response['groups'][0]['items']
        self.assertEqual(saved, {key: {'name': 'The best backing vocal'}})
        for unused in range(2):
            self.change('set', groupId='default', key=key, selected=False)
        self.assertEqual(self.request().response['groups'][0]['items'], {})

    def test_a_reference_can_exist_in_multiple_collections(self):
        group = self.change('create', name='Set two')['selectedGroupId']
        for group_id in ['default', group]:
            self.change('set', groupId=group_id, key='midi:one.mid', selected=True, name='One')
        self.change('set', groupId='default', key='midi:one.mid', selected=False)
        self.assertIn('midi:one.mid', self.request().response['groups'][1]['items'])

    def test_source_rename_moves_references_but_preserves_custom_names(self):
        self.change('set', groupId='default', key='old', selected=True, name='Custom alias')
        self.change('rekey', oldKey='old', newKey='new')
        self.change('rekey', oldKey='old', newKey='new')
        self.assertEqual(self.request().response['groups'][0]['items'], {'new': {'name': 'Custom alias'}})

    def test_last_collection_cannot_be_removed(self):
        self.assertEqual(self.request({'operation': 'delete', 'groupId': 'default'}).status, 400)

    def test_unknown_collection_does_not_replace_existing_data(self):
        self.change('set', groupId='default', key='keep', selected=True, name='Keep')
        saved = (self.root / 'library.json').read_bytes()
        response = self.request({'operation': 'set', 'groupId': 'missing', 'key': 'bad', 'selected': True, 'name': 'Bad'})
        self.assertEqual(response.status, 404)
        self.assertEqual((self.root / 'library.json').read_bytes(), saved)

    def test_cross_origin_mutation_is_rejected(self):
        response = self.request({'operation': 'create', 'name': 'Bad'}, {'Origin': 'https://other.test'})
        self.assertEqual(response.status, 403)
        self.assertFalse(self.root.exists())

    def test_request_validation(self):
        for body in [[], {'operation': 'create', 'name': ''}, {'operation': 'create', 'name': 'x' * 81}, {'operation': 'create', 'name': 'bad\nname'}, {'operation': 'set', 'groupId': 'default', 'key': 'a', 'selected': 'yes', 'name': 'Bad'}]:
            with self.subTest(body=body):
                self.assertEqual(self.request(body).status, 400)

    def test_concurrent_device_edits_merge_under_the_storage_lock(self):
        def add(index):
            return self.request({'operation': 'set', 'groupId': 'default', 'key': str(index), 'selected': True, 'name': f'Sample {index}'}).status
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(list(pool.map(add, range(24))), [200] * 24)
        library = self.request().response
        self.assertEqual(library['revision'], 24)
        self.assertEqual(len(library['groups'][0]['items']), 24)

    def test_failed_atomic_write_preserves_the_original_library(self):
        self.change('create', name='Original')
        saved = (self.root / 'library.json').read_bytes()
        with patch.object(favourites.os, 'replace', side_effect=OSError('Disk full')):
            self.assertEqual(self.request({'operation': 'create', 'name': 'Failed'}).status, 500)
        self.assertEqual((self.root / 'library.json').read_bytes(), saved)
        self.assertEqual([entry.name for entry in self.root.iterdir()], ['library.json'])

    def test_corrupt_storage_is_never_silently_overwritten(self):
        self.root.mkdir()
        target = self.root / 'library.json'
        target.write_text('not json')
        self.assertEqual(self.request({'operation': 'create', 'name': 'Bad'}).status, 400)
        self.assertEqual(target.read_text(), 'not json')

    def test_library_symlinks_are_rejected(self):
        self.root.mkdir()
        original = pathlib.Path(self.folder.name) / 'untouched.json'
        original.write_text('{}')
        (self.root / 'library.json').symlink_to(original)
        self.assertEqual(self.request().status, 400)
        self.assertEqual(original.read_text(), '{}')


if __name__ == '__main__':
    unittest.main()
