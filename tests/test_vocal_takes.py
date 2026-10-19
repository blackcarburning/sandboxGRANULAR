import concurrent.futures
import importlib.util
import json
import pathlib
import tempfile
import unittest
import wave
from io import BytesIO
from unittest.mock import patch
from urllib.parse import urlencode


spec = importlib.util.spec_from_file_location('vocal_takes_test_module', pathlib.Path(__file__).resolve().parents[1] / 'backend' / 'mygrain_vocal_takes.py')
vocal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vocal)


def recording(frames=8000, rate=8000, channels=1):
    output = BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b'\x00\x20' * frames * channels)
    return output.getvalue()


class Handler:
    def __init__(self, path, body=b'', headers=None):
        self.path = '/mygrain/api/vocal-takes' + path
        self.headers = {'Content-Length': str(len(body)), 'Host': 'localhost', **(headers or {})}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response = None
        self.response_headers = {}

    def send_json(self, payload, status=200, extra_headers=None):
        self.response = payload
        self.status = status
        self.response_headers = extra_headers or {}

    def send_response(self, status):
        self.status = status

    def send_header(self, key, value):
        self.response_headers[key] = value

    def end_headers(self):
        pass


class VocalTakeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='mygrain-vocal-unit-')
        self.previous_root = vocal.TAKES_ROOT
        vocal.TAKES_ROOT = pathlib.Path(self.folder.name) / 'takes'

    def tearDown(self):
        vocal.TAKES_ROOT = self.previous_root
        self.folder.cleanup()

    def request(self, method='GET', path='', payload=None, body=None, headers=None):
        if body is None:
            body = json.dumps(payload).encode() if payload is not None else b''
        handler = Handler(path, body, headers)
        handled = vocal.handle_vocal_request(handler, method, handler.path.split('?')[0].removeprefix('/mygrain'))
        self.assertTrue(handled)
        return handler

    def user(self, name='Vocalist'):
        result = self.request('POST', '/users', {'name': name})
        self.assertEqual(result.status, 201)
        return result.response['user']

    def take(self, user=None, **changes):
        user = user or self.user()
        query = {'userId': user['id'], 'folderId': '', 'name': 'Version 1', 'bpm': '120', 'songName': 'none', **changes}
        result = self.request('POST', '/takes?' + urlencode(query), body=recording())
        self.assertEqual(result.status, 201, result.response)
        return result.response['take']

    def test_empty_library_is_global_and_noncacheable(self):
        result = self.request(headers={'X-Mygrain-Song-Key': 'different'})
        self.assertEqual(result.response, {'ok': True, 'users': [], 'takes': [], 'shared': True})
        self.assertEqual(result.response_headers['Cache-Control'], 'no-store')

    def test_named_user_does_not_require_password(self):
        user = self.user('Singer One')
        self.assertEqual(user['name'], 'Singer One')
        self.assertTrue(vocal.safe_path('users', user['id']).is_dir())
        self.assertNotIn('password', user)

    def test_duplicate_user_case_insensitive(self):
        self.user()
        self.assertEqual(self.request('POST', '/users', {'name': 'vOcAlIsT'}).status, 400)

    def test_invalid_names_rejected(self):
        for name in ('', '../bad', '..', 'bad\\name', 'bad\nname', 'a' * 101, None, 7):
            self.assertEqual(self.request('POST', '/users', {'name': name}).status, 400)

    def test_raw_wav_roundtrip_and_storage_in_user_folder(self):
        take = self.take(songName='Song / demo')
        result = self.request(path=f"/takes/{take['id']}/audio")
        self.assertEqual(result.status, 200)
        self.assertEqual(result.wfile.getvalue(), recording())
        self.assertEqual(take['songName'], 'Song / demo')
        self.assertEqual(take['durationSeconds'], 1)
        self.assertEqual(take['frames'], 8000)
        self.assertEqual(vocal.take_path(take).parent.name, take['userId'])

    def test_same_name_versions_have_distinct_ids_and_files(self):
        user = self.user()
        first = self.take(user)
        second = self.take(user)
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(len(self.request().response['takes']), 2)

    def test_storage_survives_module_reload_and_song_keys(self):
        take = self.take()
        replacement = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(replacement)
        replacement.TAKES_ROOT = vocal.TAKES_ROOT
        handler = Handler('', headers={'X-Mygrain-Song-Key': 'new-library'})
        replacement.handle_vocal_request(handler, 'GET', '/api/vocal-takes')
        self.assertEqual(handler.response['takes'][0]['id'], take['id'])

    def test_folder_creation_and_move_keep_wav_unchanged(self):
        user = self.user()
        take = self.take(user)
        folder = self.request('POST', f"/users/{user['id']}/folders", {'name': 'Writing'}).response['folder']
        old_path = vocal.take_path(take)
        self.assertEqual(self.request('POST', f"/takes/{take['id']}/move", {'folderId': folder['id']}).status, 200)
        updated = self.request().response['takes'][0]
        self.assertFalse(old_path.exists())
        self.assertEqual(vocal.take_path(updated).parent.name, folder['id'])
        self.assertEqual(vocal.take_path(updated).read_bytes(), recording())
        self.request('POST', f"/takes/{take['id']}/move", {'folderId': ''})
        self.assertTrue(old_path.exists())

    def test_duplicate_folder_rejected(self):
        user = self.user()
        path = f"/users/{user['id']}/folders"
        self.assertEqual(self.request('POST', path, {'name': 'Folder'}).status, 201)
        self.assertEqual(self.request('POST', path, {'name': 'FOLDER'}).status, 400)

    def test_users_cannot_mix_folders_accidentally(self):
        first = self.user('One')
        second = self.user('Two')
        take = self.take(first)
        folder = self.request('POST', f"/users/{second['id']}/folders", {'name': 'Other'}).response['folder']
        self.assertEqual(self.request('POST', f"/takes/{take['id']}/move", {'folderId': folder['id']}).status, 404)
        self.assertTrue(vocal.take_path(take).exists())

    def test_invalid_folder_types_do_not_hide_or_move_takes(self):
        take = self.take()
        for folder_id in (None, [], {}, 0, False):
            self.assertEqual(self.request('POST', f"/takes/{take['id']}/move", {'folderId': folder_id}).status, 400)
        self.assertEqual(self.request().response['takes'][0]['folderId'], '')
        self.assertTrue(vocal.take_path(take).exists())

    def test_rename_only_changes_label(self):
        take = self.take()
        self.request('POST', f"/takes/{take['id']}/rename", {'name': 'New version'})
        updated = self.request().response['takes'][0]
        self.assertEqual(updated['name'], 'New version')
        self.assertEqual(vocal.take_path(updated).read_bytes(), recording())

    def test_delete_removes_browser_entry_and_archives_file(self):
        take = self.take()
        result = self.request('POST', f"/takes/{take['id']}/delete", {})
        self.assertEqual(result.status, 200)
        self.assertEqual(self.request().response['takes'], [])
        self.assertFalse(vocal.take_path(take).exists())
        self.assertEqual(len(list(vocal.safe_path('deleted').glob('*.wav'))), 1)
        self.assertEqual(self.request(path=f"/takes/{take['id']}/audio").status, 404)

    def test_invalid_and_incomplete_audio_not_saved(self):
        user = self.user()
        path = '/takes?' + urlencode({'userId': user['id'], 'name': 'bad'})
        for body in (b'bad', recording()[:-12], recording(frames=10), recording(rate=4000), recording(channels=3)):
            self.assertEqual(self.request('POST', path, body=body).status, 400)
        self.assertEqual(self.request().response['takes'], [])

    def test_invalid_bpm_rejected(self):
        user = self.user()
        for bpm in ('nan', 'inf', '0', '401', 'oops'):
            query = urlencode({'userId': user['id'], 'name': 'bad', 'bpm': bpm})
            self.assertEqual(self.request('POST', '/takes?' + query, body=recording()).status, 400)

    def test_recordings_over_180_seconds_rejected(self):
        with self.assertRaisesRegex(ValueError, '180 seconds'):
            vocal.checked_wav(recording(frames=8000 * 180 + 1))

    def test_upload_limit_checked_before_read(self):
        self.assertEqual(self.request('POST', '/takes', body=b'x', headers={'Content-Length': str(vocal.MAX_UPLOAD + 1)}).status, 400)
        self.assertEqual(self.request('POST', '/takes', body=b'x', headers={'Content-Length': 'x'}).status, 400)
        self.assertEqual(self.request('POST', '/takes', body=b'x', headers={'Content-Length': '10'}).status, 400)

    def test_unknown_user_cannot_upload(self):
        self.assertEqual(self.request('POST', '/takes?userId=../bad&name=bad', body=recording()).status, 404)

    def test_symlinked_audio_rejected(self):
        take = self.take()
        target = vocal.take_path(take)
        target.unlink()
        target.symlink_to('/etc/passwd')
        self.assertEqual(self.request(path=f"/takes/{take['id']}/audio").status, 400)

    def test_cross_origin_mutations_rejected(self):
        for headers in ({'Origin': 'https://evil.invalid'}, {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request('POST', '/users', {'name': 'Spoof'}, headers=headers).status, 403)
        self.assertEqual(self.request('POST', '/users', {'name': 'Local'}, headers={'Origin': 'http://localhost'}).status, 201)

    def test_failed_manifest_write_rolls_back_upload_move_and_delete(self):
        user = self.user()
        take = self.take(user)
        folder = self.request('POST', f"/users/{user['id']}/folders", {'name': 'Target'}).response['folder']
        with patch.object(vocal, 'write_library', side_effect=OSError('disk full')):
            query = urlencode({'userId': user['id'], 'name': 'Failed'})
            self.assertEqual(self.request('POST', '/takes?' + query, body=recording()).status, 500)
            self.assertEqual(self.request('POST', f"/takes/{take['id']}/move", {'folderId': folder['id']}).status, 500)
            self.assertEqual(self.request('POST', f"/takes/{take['id']}/delete", {}).status, 500)
        self.assertEqual(len(self.request().response['takes']), 1)
        self.assertEqual(vocal.take_path(take).read_bytes(), recording())
        self.assertEqual(len(list(vocal.TAKES_ROOT.glob('users/**/*.wav'))), 1)

    def test_parallel_versions_do_not_lose_entries(self):
        user = self.user()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            takes = list(executor.map(lambda index: self.take(user, name=f'Take {index}'), range(10)))
        self.assertEqual(len({take['id'] for take in takes}), 10)
        self.assertEqual(len(self.request().response['takes']), 10)


if __name__ == '__main__':
    unittest.main()
