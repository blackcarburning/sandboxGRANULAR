import hashlib
import json
import pathlib
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from unittest.mock import patch
from types import SimpleNamespace

from test_song_backend import Handler, SONGS, part_zip, render_wav


class SongLockTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root_patch = patch.object(SONGS, 'SONGS_ROOT', pathlib.Path(self.directory.name))
        self.root_patch.start()
        self.now = 1000
        self.clock_patch = patch.object(SONGS, 'time', SimpleNamespace(time=lambda: self.now))
        self.clock_patch.start()
        self.first = {'deviceId': '1' * 32, 'sessionId': '2' * 32, 'label': 'Mark iPhone'}
        self.second = {'deviceId': '3' * 32, 'sessionId': '4' * 32, 'label': 'Laptop'}
        self.song = self.call('POST', payload={'name': 'Lock test'}).response['song']
        self.base = f'/api/songs/{self.song["id"]}'

    def tearDown(self):
        self.clock_patch.stop()
        self.root_patch.stop()
        self.directory.cleanup()

    def call(self, method, path='/api/songs', headers=None, **kwargs):
        handler = Handler(path='/mygrain' + path, **kwargs)
        handler.headers.update(headers or {})
        self.assertTrue(SONGS.handle_song_request(handler, method, path.split('?')[0]))
        return handler

    def acquire(self, identity=None, revision=1):
        return self.call('POST', self.base + '/lock/acquire', payload=identity or self.first, headers={'If-Match': f'"{revision}"'})

    def credentials(self, result, identity=None, revision=1):
        identity = identity or self.first
        return {'X-Mygrain-Song-Lock': result.response['token'], 'X-Mygrain-Song-Device': identity['deviceId'],
                'X-Mygrain-Song-Session': identity['sessionId'], 'If-Match': f'"{revision}"'}

    def rename(self, headers, name='Edited'):
        return self.call('POST', self.base + '/rename', headers=headers, payload={'name': name})

    def test_ten_minute_lease_has_no_public_secret_or_hardware_identity(self):
        acquired = self.acquire()
        self.assertEqual(acquired.status, 200)
        self.assertEqual(acquired.response['lock'], {'label': 'Mark iPhone', 'expiresAt': 1600})
        status = self.call('GET', self.base + '/lock')
        self.assertEqual(status.response['leaseSeconds'], 600)
        self.assertEqual(status.response_headers['Cache-Control'], 'no-store')
        for response in [status.response, self.call('GET', self.base).response, self.call('GET').response]:
            serialized = json.dumps(response)
            for secret in [acquired.response['token'], 'tokenHash', self.first['deviceId'], self.first['sessionId']]:
                self.assertNotIn(secret, serialized)

    def test_second_device_cannot_acquire_but_can_read_and_play_assets(self):
        acquired = self.acquire()
        headers = self.credentials(acquired)
        saved = self.call('POST', self.base + '/parts?name=Intro', body=part_zip(), headers=headers)
        self.assertEqual(saved.status, 201)
        part = saved.response['song']['parts'][0]
        denied = self.acquire(self.second, 2)
        self.assertEqual((denied.status, denied.response['code']), (423, 'SONG_LOCKED'))
        self.assertIn('Mark iPhone', denied.response['error'])
        self.assertEqual(self.call('GET', self.base).status, 200)
        self.assertEqual(self.call('GET', self.base + f'/parts/{part["id"]}').status, 200)

    def test_simultaneous_devices_get_exactly_one_lock(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.acquire, [self.first, self.second]))
        self.assertEqual(sorted(result.status for result in results), [200, 423])

    def test_two_tabs_with_same_device_are_separate_editors(self):
        self.acquire()
        other_tab = {**self.first, 'sessionId': '5' * 32}
        self.assertEqual(self.acquire(other_tab).status, 423)

    def test_different_songs_can_have_different_editors(self):
        first = self.acquire()
        other_song = self.call('POST', payload={'name': 'Independent song'}).response['song']
        endpoint = f'/api/songs/{other_song["id"]}/lock/acquire'
        second = self.call('POST', endpoint, payload=self.second, headers={'If-Match': '"1"'})
        self.assertEqual(second.status, 200)
        self.assertEqual(self.rename(self.credentials(first)).status, 200)

    def test_a_token_cannot_be_used_on_another_song(self):
        headers = self.credentials(self.acquire())
        other_song = self.call('POST', payload={'name': 'Independent song'}).response['song']
        self.assertEqual(self.call('POST', f'/api/songs/{other_song["id"]}/rename', payload={'name': 'Wrong token'}, headers=headers).status, 423)

    def test_invalid_identity_or_label_never_obtains_a_lock(self):
        for invalid in [{**self.first, 'deviceId': '../invalid'}, {**self.first, 'sessionId': None}, {**self.first, 'label': 'a\nb'}, {**self.first, 'label': ''}]:
            self.assertEqual(self.acquire(invalid).status, 400)
            self.assertIsNone(self.call('GET', self.base + '/lock').response['lock'])

    def test_failed_lock_persistence_never_reports_acquisition(self):
        with patch.object(SONGS, 'write_edit_lock', side_effect=OSError('Disk full')):
            self.assertEqual(self.acquire().status, 500)
        self.assertIsNone(self.call('GET', self.base + '/lock').response['lock'])

    def test_old_clients_cannot_write_without_lock_even_when_unlocked(self):
        self.assertEqual(self.rename({'If-Match': '"1"'}).status, 423)
        self.assertEqual(self.call('GET', self.base).response['song']['name'], 'Lock test')

    def test_spoofing_device_and_session_without_token_cannot_save_or_renew(self):
        acquired = self.acquire()
        headers = {**self.credentials(acquired), 'X-Mygrain-Song-Lock': 'f' * 64}
        self.assertEqual(self.rename(headers).status, 423)
        self.assertEqual(self.call('POST', self.base + '/lock/renew', headers=headers).status, 423)

    def test_token_from_another_tab_or_device_is_rejected(self):
        headers = self.credentials(self.acquire())
        for field in ['X-Mygrain-Song-Session', 'X-Mygrain-Song-Device']:
            self.assertEqual(self.rename({**headers, field: 'e' * 32}).status, 423)

    def test_all_content_endpoints_require_lock(self):
        saved = self.call('POST', self.base + '/parts?name=Intro', body=part_zip(), headers=self.credentials(self.acquire()))
        part = saved.response['song']['parts'][0]
        endpoints = ['/rename', '/arrange', '/parts?name=New'] + [f'/parts/{part["id"]}/{action}?sha256={part["sha256"]}' for action in ['save', 'delete', 'reuse', 'colour']]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.call('POST', self.base + endpoint, payload={}, body=part_zip()).status, 423)
        self.assertEqual(self.call('GET', self.base).response['song']['revision'], 2)

    def test_owner_can_write_and_each_content_change_advances_revision(self):
        headers = self.credentials(self.acquire())
        result = self.rename(headers)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['revision'], 2)
        self.assertEqual(self.rename({**headers, 'If-Match': '"2"'}, 'Again').response['song']['revision'], 3)

    def test_missing_and_stale_revision_never_overwrite(self):
        headers = self.credentials(self.acquire())
        self.assertEqual(self.rename(headers).status, 200)
        for revision in ['"1"', '*', '2', '']:
            denied = self.rename({**headers, 'If-Match': revision}, 'Overwrite')
            self.assertEqual((denied.status, denied.response['code']), (409, 'SONG_REVISION_CONFLICT'))
        self.assertEqual(self.call('GET', self.base).response['song']['name'], 'Edited')

    def test_heartbeat_renews_for_ten_minutes_without_changing_song(self):
        headers = self.credentials(self.acquire())
        self.now = 1030
        renewed = self.call('POST', self.base + '/lock/renew', headers=headers)
        self.assertEqual(renewed.response['lock']['expiresAt'], 1630)
        self.assertEqual(self.call('GET', self.base).response['song']['revision'], 1)
        self.now = 1601
        self.assertEqual(self.acquire(self.second).status, 423)

    def test_expiry_is_exactly_ten_minutes_after_last_renewal(self):
        headers = self.credentials(self.acquire())
        self.now = 1599.999
        self.assertEqual(self.acquire(self.second).status, 423)
        self.now = 1600
        self.assertEqual(self.call('POST', self.base + '/lock/renew', headers=headers).status, 423)
        self.assertEqual(self.rename(headers).status, 423)
        self.assertEqual(self.acquire(self.second).status, 200)

    def test_expired_session_cannot_release_or_overwrite_replacement_lock(self):
        headers = self.credentials(self.acquire())
        self.now = 1601
        replacement = self.acquire(self.second)
        self.assertEqual(self.call('POST', self.base + '/lock/release', headers=headers).status, 423)
        self.assertEqual(self.rename(headers).status, 423)
        self.assertEqual(self.rename(self.credentials(replacement, self.second)).status, 200)

    def test_finish_releases_immediately_and_old_token_cannot_return(self):
        headers = self.credentials(self.acquire())
        self.assertEqual(self.call('POST', self.base + '/lock/release', headers=headers).status, 200)
        self.assertEqual(self.acquire(self.second).status, 200)
        self.assertEqual(self.rename(headers).status, 423)

    def test_reacquire_with_stale_song_revision_is_rejected_before_locking(self):
        headers = self.credentials(self.acquire())
        self.rename(headers)
        self.now = 1601
        self.assertEqual(self.acquire(self.second).status, 409)
        self.assertIsNone(self.call('GET', self.base + '/lock').response['lock'])
        self.assertEqual(self.acquire(self.second, 2).status, 200)

    def test_locks_survive_backend_memory_reset(self):
        headers = self.credentials(self.acquire())
        with patch.object(SONGS, 'SONG_LOCK', __import__('threading').RLock()):
            self.assertEqual(self.acquire(self.second).status, 423)
            self.assertEqual(self.rename(headers).status, 200)
        lock = json.loads((SONGS.SONGS_ROOT / self.song['id'] / '.edit-lock.json').read_text())
        self.assertNotIn(headers['X-Mygrain-Song-Lock'], json.dumps(lock))
        self.assertEqual(lock['tokenHash'], hashlib.sha256(headers['X-Mygrain-Song-Lock'].encode()).hexdigest())

    def test_expiry_during_upload_is_rechecked_at_commit(self):
        headers = self.credentials(self.acquire())
        body = part_zip()
        handler = Handler(path='/mygrain' + self.base + '/parts?name=Slow', body=body)
        handler.headers.update(headers)
        source = BytesIO(body)
        def read(length):
            self.now = 1601
            return source.read(length)
        handler.rfile = type('SlowUpload', (), {'read': staticmethod(read)})()
        SONGS.handle_song_request(handler, 'POST', self.base + '/parts')
        self.assertEqual(handler.status, 423)
        self.assertEqual(self.call('GET', self.base).response['song']['parts'], [])
        self.assertEqual(list((SONGS.SONGS_ROOT / self.song['id'] / 'parts').iterdir()), [])

    def test_read_only_cache_upload_is_hash_checked_and_not_a_song_edit(self):
        headers = self.credentials(self.acquire())
        song = self.call('POST', self.base + '/parts?name=Intro', body=part_zip(), headers=headers).response['song']
        part = song['parts'][0]
        endpoint = self.base + f'/parts/{part["id"]}/render?sha256={part["sha256"]}'
        rendered = self.call('POST', endpoint, body=render_wav(part))
        self.assertEqual(rendered.status, 200)
        self.assertEqual(rendered.response['song']['revision'], 2)
        self.assertEqual(self.call('POST', endpoint.replace(part['sha256'], '0' * 64), body=render_wav(part)).status, 409)
        self.assertEqual(self.rename({**headers, 'If-Match': '"2"'}).status, 200)

    def test_library_authorization_still_scopes_lock_endpoints(self):
        self.acquire()
        for method, endpoint in [('GET', '/lock'), ('POST', '/lock/acquire'), ('POST', '/lock/release'), ('POST', '/lock/renew')]:
            self.assertEqual(self.call(method, self.base + endpoint, key='b' * 64, payload=self.second).status, 404)
        self.assertEqual(self.call('GET', self.base + '/lock', key='invalid').status, 403)

    def test_old_manifests_default_to_revision_one_without_changing_parts(self):
        manifest = SONGS.SONGS_ROOT / self.song['id'] / 'song.json'
        song = json.loads(manifest.read_text())
        del song['revision']
        manifest.write_text(json.dumps(song))
        self.assertEqual(self.call('GET', self.base).response['song']['revision'], 1)
        result = self.rename(self.credentials(self.acquire()))
        self.assertEqual((result.status, result.response['song']['revision']), (200, 2))


if __name__ == '__main__':
    unittest.main()
