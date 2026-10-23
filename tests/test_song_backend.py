import importlib.util
import json
import pathlib
import tempfile
import unittest
import wave
import zipfile
from io import BytesIO
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / 'backend' / 'mygrain_songs.py'
SPEC = importlib.util.spec_from_file_location('mygrain_song_tests', MODULE_PATH)
SONGS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SONGS)


def part_zip(steps=16, missing=False, unexpected=False):
    audio = BytesIO()
    with wave.open(audio, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(44100)
        output.writeframes(b'\0\0' * 128)
    manifest = {
        'format': 'mygrain-song-part', 'version': 1,
        'state': {'modes': {}, 'globalBpm': '120', 'patternLength': steps},
        'extra': {'sequencerSteps': [{'enabled': True, 'pitch': 'C4', 'volume': 80}] * steps},
        'assets': [{'key': 'bastardL', 'path': 'audio/bastardL.wav'}]
    }
    archive = BytesIO()
    with zipfile.ZipFile(archive, 'w') as output:
        output.writestr('song-part.json', json.dumps(manifest))
        if not missing:
            output.writestr('audio/bastardL.wav', audio.getvalue())
        if unexpected:
            output.writestr('../outside.txt', 'bad')
    return archive.getvalue()


def render_wav(part, extra_frames=0):
    audio = BytesIO()
    with wave.open(audio, 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(8000)
        frames = round(60 / part['bpm'] * part['patternSteps'] / 4 * 8000) + extra_frames
        output.writeframes(b'\x01\0\x01\0' * frames)
    return audio.getvalue()


def rewrite_part(body, mutate, audio_body=None):
    with zipfile.ZipFile(BytesIO(body)) as source:
        entries = {name: source.read(name) for name in source.namelist()}
    manifest = json.loads(entries['song-part.json'])
    mutate(manifest)
    entries['song-part.json'] = json.dumps(manifest, sort_keys=True, indent=2).encode()
    if audio_body is not None:
        entries['audio/bastardL.wav'] = audio_body
    rewritten = BytesIO()
    with zipfile.ZipFile(rewritten, 'w') as output:
        for name, content in reversed(list(entries.items())):
            output.writestr(name, content)
    return rewritten.getvalue()


class Handler:
    def __init__(self, path='/mygrain/api/songs', payload=None, body=b'', key='a' * 64):
        self.path = path
        self.payload = payload
        self.headers = {'X-Mygrain-Song-Key': key, 'Content-Length': str(len(body))}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response = None
        self.response_headers = {}

    def read_json(self):
        return self.payload

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


class SongBackendTests(unittest.TestCase):
    def test_additive_snapshot_save_preserves_shared_order_audio_history_and_reuses_render_without_another_revision(self):
        for delete_original in (False, True):
            with self.subTest(delete_original=delete_original):
                original_body = rewrite_part(part_zip(), lambda manifest: manifest['extra'].update({
                    'freezeStateVersion': 1, 'audioSlots': {'bastardL': True}}))
                song = self.create()
                base = f'/api/songs/{song["id"]}'
                song = self.request('POST', base + '/parts?name=Intro&repeats=2', body=original_body).response['song']
                song = self.reuse(song)
                original, reference = song['parts']
                song = self.request('POST', base + f'/parts/{original["id"]}/colour?sha256={original["sha256"]}', payload={'colour': '#123456'}).response['song']
                arranged = [{**reference, 'repeats': 7}, original]
                song = self.request('POST', base + '/arrange', payload={'parts': arranged}).response['song']
                if delete_original:
                    song = self.request('POST', base + f'/parts/{original["id"]}/delete?sha256={original["sha256"]}').response['song']
                old = song['parts'][0]
                endpoint = base + f'/parts/{old["id"]}'
                render_body = render_wav(old)
                song = self.request('POST', endpoint + f'/render?sha256={old["sha256"]}&portable=1&keyboard=1&grain=1', body=render_body).response['song']
                old_render = song['parts'][0]['render']
                placements = [(part['id'], part['repeats'], part.get('colour'), part['name'], part.get('sourcePartId')) for part in song['parts']]
                revision = song['revision']

                def upgrade(manifest):
                    manifest['extra']['audioSlots'].update({'bastardK': False, 'bastardKRender': False})
                    manifest['extra']['metadata'] = {'bastardK': None}
                    manifest['state']['modes']['bastardLoopKEnabled'] = False

                upgraded_body = rewrite_part(original_body, upgrade)
                result = self.request('POST', endpoint + f'/save?sha256={old["sha256"]}', body=upgraded_body)
                self.assertEqual(result.status, 200)
                saved = result.response['song']
                self.assertEqual(saved['revision'], revision + 1)
                self.assertEqual([(part['id'], part['repeats'], part.get('colour'), part['name'], part.get('sourcePartId')) for part in saved['parts']], placements)
                self.assertEqual(len({part['sha256'] for part in saved['parts']}), 1)
                self.assertNotEqual(saved['parts'][0]['sha256'], old['sha256'])
                with zipfile.ZipFile(BytesIO(original_body)) as before, zipfile.ZipFile(BytesIO(upgraded_body)) as after:
                    self.assertEqual(before.read('audio/bastardL.wav'), after.read('audio/bastardL.wav'))
                for part in saved['parts']:
                    self.assertEqual(self.request('GET', base + f'/parts/{part["id"]}').wfile.getvalue(), upgraded_body)
                folder, stored = SONGS.read_song(song['id'], SONGS.owner_hash({'X-Mygrain-Song-Key': 'a' * 64}))
                self.assertEqual(len(stored['history']), 1)
                historical = stored['history'][0]
                self.assertEqual(historical['sha256'], old['sha256'])
                self.assertEqual(historical['render'], old_render)
                self.assertEqual((folder / 'parts' / historical.get('archive', f'{original["id"]}.zip')).read_bytes(), original_body)
                self.assertEqual((folder / 'parts' / old_render['file']).read_bytes(), render_body)
                digest = saved['parts'][0]['sha256']
                retained = self.request('POST', endpoint + f'/render?sha256={digest}&portable=1&keyboard=1&grain=1', body=render_body)
                self.assertEqual(retained.status, 200)
                self.assertEqual(retained.response['song']['revision'], revision + 1)
                for part in retained.response['song']['parts']:
                    self.assertEqual(part['render']['sha256'], old_render['sha256'])
                    self.assertEqual(part['render']['sourceSha256'], digest)
                self.assertEqual(self.request('GET', endpoint + '/render').wfile.getvalue(), render_body)
                self.assertEqual(self.request('GET', base).response['song']['revision'], revision + 1)
                self.assertEqual(self.request('POST', endpoint + f'/save?sha256={old["sha256"]}', body=upgraded_body).status, 409)
                self.assertEqual(len(SONGS.read_song(song['id'], SONGS.owner_hash({'X-Mygrain-Song-Key': 'a' * 64}))[1]['history']), 1)

    def test_compatibility_archive_save_cannot_bypass_the_editor_or_exact_song_revision(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        endpoint = f'/api/songs/{song["id"]}/parts/{part["id"]}/save?sha256={part["sha256"]}'
        folder, stored = SONGS.read_song(song['id'], SONGS.owner_hash({'X-Mygrain-Song-Key': 'a' * 64}))
        previous_manifest = (folder / 'song.json').read_bytes()
        previous_files = {entry.name: entry.read_bytes() for entry in (folder / 'parts').iterdir()}
        upgraded = rewrite_part(part_zip(), lambda manifest: manifest['state']['modes'].update({'bastardLoopKEnabled': False}))
        for headers, code in [
            ({}, 'SONG_LOCK_REQUIRED'),
            ({'X-Mygrain-Song-Device': '1' * 32, 'X-Mygrain-Song-Session': '2' * 32,
              'X-Mygrain-Song-Lock': self.edit_tokens[song['id']], 'If-Match': f'"{stored["revision"] - 1}"'}, 'SONG_REVISION_CONFLICT')
        ]:
            with self.subTest(code=code):
                handler = Handler(path='/mygrain' + endpoint, body=upgraded)
                handler.headers.update(headers)
                SONGS.handle_song_request(handler, 'POST', endpoint.split('?')[0])
                self.assertEqual(handler.response['code'], code)
                self.assertEqual((folder / 'song.json').read_bytes(), previous_manifest)
                self.assertEqual({entry.name: entry.read_bytes() for entry in (folder / 'parts').iterdir()}, previous_files)

    def test_portable_snapshot_requires_every_declared_sample_and_matching_dimensions(self):
        valid = rewrite_part(part_zip(), lambda manifest: manifest['extra'].update({'freezeStateVersion': 1, 'audioSlots': {'bastardL': True, 'grainASample': False}}))
        self.assertEqual(SONGS.validate_part_zip(valid)['audioAssets'], 1)
        for inventory in [None, {}, {'bastardL': False}, {'bastardL': True, 'grainASample': True}, {'bastardL': 1}]:
            with self.subTest(inventory=inventory):
                invalid = rewrite_part(valid, lambda manifest: manifest['extra'].update({'audioSlots': inventory}))
                with self.assertRaises(ValueError):
                    SONGS.validate_part_zip(invalid)
        invalid = rewrite_part(valid, lambda manifest: manifest['assets'][0].update({'frames': 999}))
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            SONGS.validate_part_zip(invalid)

    def test_portable_render_marker_preserves_snapshot_and_rejects_unknown_versions(self):
        self.assertEqual(self.request('GET').response['features']['portableFreezeRenders'], 1)
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}'
        result = self.request('POST', f'{path}&portable=1', body=render_wav(part))
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['parts'][0]['render']['portableVersion'], 1)
        self.assertEqual(result.response['song']['parts'][0]['sha256'], part['sha256'])
        self.assertEqual(self.request('POST', f'{path}&portable=2', body=render_wav(part)).status, 400)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root_patch = patch.object(SONGS, 'SONGS_ROOT', pathlib.Path(self.directory.name))
        self.root_patch.start()
        self.edit_tokens = {}

    def tearDown(self):
        self.root_patch.stop()
        self.directory.cleanup()

    def request(self, method, inner='/api/songs', **kwargs):
        handler = Handler(path='/mygrain' + inner, **kwargs)
        segments = inner.split('?')[0].split('/')[3:]
        if method == 'POST' and segments and 'lock' not in segments and segments[-1] != 'render':
            try:
                _, song = SONGS.read_song(segments[0], SONGS.owner_hash(handler.headers))
                if song['id'] not in self.edit_tokens:
                    acquire = Handler(payload={'deviceId': '1' * 32, 'sessionId': '2' * 32, 'label': 'Test editor'})
                    acquire.headers['If-Match'] = f'"{song["revision"]}"'
                    SONGS.handle_song_request(acquire, 'POST', f'/api/songs/{song["id"]}/lock/acquire')
                    self.edit_tokens[song['id']] = acquire.response['token']
                handler.headers.update({'X-Mygrain-Song-Device': '1' * 32, 'X-Mygrain-Song-Session': '2' * 32,
                                        'X-Mygrain-Song-Lock': self.edit_tokens[song['id']], 'If-Match': f'"{song["revision"]}"'})
            except (FileNotFoundError, ValueError, PermissionError):
                pass
        self.assertTrue(SONGS.handle_song_request(handler, method, inner.split('?')[0]))
        return handler

    def create(self):
        handler = self.request('POST', payload={'name': 'My Song'})
        self.assertEqual(handler.status, 201)
        return handler.response['song']

    def upload(self, song):
        handler = self.request('POST', f'/api/songs/{song["id"]}/parts?name=Intro&repeats=2', body=part_zip())
        self.assertEqual(handler.status, 201)
        return handler.response['song']

    def reuse(self, song, index=0):
        part = song['parts'][index]
        handler = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/reuse?sha256={part["sha256"]}')
        self.assertEqual(handler.status, 201)
        return handler.response['song']

    def test_reuse_persists_only_a_reference_and_shares_existing_audio_and_render(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        render = render_wav(part)
        song = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}', body=render).response['song']
        folder = SONGS.SONGS_ROOT / song['id']
        files = {entry.name: entry.read_bytes() for entry in (folder / 'parts').iterdir()}
        song = self.reuse(song)
        self.assertEqual(files, {entry.name: entry.read_bytes() for entry in (folder / 'parts').iterdir()})
        reference = song['parts'][1]
        self.assertNotEqual(reference['id'], part['id'])
        self.assertEqual(reference['sourcePartId'], part['id'])
        self.assertEqual(reference['render'], song['parts'][0]['render'])
        stored = json.loads((folder / 'song.json').read_text())['parts'][1]
        self.assertEqual(set(stored), {'id', 'sourcePartId', 'repeats', 'createdAt'})
        for action, expected in [('', part_zip()), ('/render', render)]:
            result = self.request('GET', f'/api/songs/{song["id"]}/parts/{reference["id"]}{action}')
            self.assertEqual(result.status, 200)
            self.assertEqual(result.wfile.getvalue(), expected)
        self.assertTrue(self.request('GET').response['features']['reuseParts'])

    def test_reusing_a_reference_points_to_the_original_source_without_chaining(self):
        song = self.reuse(self.upload(self.create()))
        song = self.reuse(song, 1)
        self.assertEqual(len({part['id'] for part in song['parts']}), 3)
        self.assertEqual(song['parts'][2]['sourcePartId'], song['parts'][0]['id'])
        self.assertEqual(len(list((SONGS.SONGS_ROOT / song['id'] / 'parts').iterdir())), 1)

    def test_reuse_rejects_stale_sources_foreign_libraries_missing_parts_and_full_arrangements(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        endpoint = f'/api/songs/{song["id"]}/parts/{part["id"]}/reuse'
        self.assertEqual(self.request('POST', endpoint + '?sha256=stale').status, 409)
        self.assertEqual(self.request('POST', endpoint + '?sha256=' + part['sha256'], key='b' * 64).status, 404)
        self.assertEqual(self.request('POST', f'/api/songs/{song["id"]}/parts/{"0" * 32}/reuse?sha256={part["sha256"]}').status, 404)
        with patch.object(SONGS, 'MAX_PARTS', 1):
            self.assertEqual(self.request('POST', endpoint + '?sha256=' + part['sha256']).status, 400)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_occurrences_have_independent_order_and_repeats_but_share_names_and_colours(self):
        song = self.reuse(self.upload(self.create()))
        original, reference = song['parts']
        payload = {'parts': [{'id': reference['id'], 'name': 'Verse', 'repeats': 5}, {'id': original['id'], 'name': 'Verse', 'repeats': 2}]}
        result = self.request('POST', f'/api/songs/{song["id"]}/arrange', payload=payload)
        self.assertEqual(result.status, 200)
        self.assertEqual([(part['id'], part['name'], part['repeats']) for part in result.response['song']['parts']], [(reference['id'], 'Verse', 5), (original['id'], 'Verse', 2)])
        result = self.request('POST', f'/api/songs/{song["id"]}/parts/{reference["id"]}/colour?sha256={reference["sha256"]}', payload={'colour': '#ff1122'})
        self.assertEqual([part['colour'] for part in result.response['song']['parts']], ['#ff1122', '#ff1122'])
        stored = json.loads((SONGS.SONGS_ROOT / song['id'] / 'song.json').read_text())
        self.assertNotIn('name', stored['parts'][0])
        self.assertNotIn('colour', stored['parts'][0])

    def test_conflicting_shared_names_and_duplicate_occurrence_ids_are_rejected_atomically(self):
        song = self.reuse(self.upload(self.create()))
        for names, ids in [(['Intro', 'Different'], [0, 1]), (['Intro', 'Intro'], [0, 0])]:
            payload = {'parts': [{'id': song['parts'][index]['id'], 'name': name, 'repeats': 1} for index, name in zip(ids, names)]}
            self.assertEqual(self.request('POST', f'/api/songs/{song["id"]}/arrange', payload=payload).status, 400)
            self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_amending_a_reference_updates_all_shared_audio_but_only_its_repeat_count(self):
        song = self.reuse(self.upload(self.create()))
        original, reference = song['parts']
        song = self.request('POST', f'/api/songs/{song["id"]}/parts/{reference["id"]}/render?sha256={reference["sha256"]}', body=render_wav(reference)).response['song']
        self.assertEqual(song['parts'][0]['render'], song['parts'][1]['render'])
        updated_body = part_zip(32)
        result = self.request('POST', f'/api/songs/{song["id"]}/parts/{reference["id"]}/save?sha256={reference["sha256"]}&name=Verse&repeats=5', body=updated_body)
        self.assertEqual(result.status, 200)
        song = result.response['song']
        self.assertEqual([part['patternSteps'] for part in song['parts']], [32, 32])
        self.assertEqual([part['name'] for part in song['parts']], ['Verse', 'Verse'])
        self.assertEqual([part['repeats'] for part in song['parts']], [2, 5])
        self.assertEqual(song['parts'][0]['sha256'], song['parts'][1]['sha256'])
        self.assertTrue(all('render' not in part for part in song['parts']))
        for part in song['parts']:
            self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(), updated_body)
        self.assertEqual(len(list((SONGS.SONGS_ROOT / song['id'] / 'parts').glob('*.zip'))), 2)
        self.assertEqual(self.request('POST', f'/api/songs/{song["id"]}/parts/{original["id"]}/reuse?sha256={original["sha256"]}').status, 409)

    def test_deleting_original_occurrence_preserves_references_and_their_editable_source(self):
        song = self.reuse(self.upload(self.create()))
        original, reference = song['parts']
        result = self.request('POST', f'/api/songs/{song["id"]}/parts/{original["id"]}/delete?sha256={original["sha256"]}')
        self.assertEqual(result.status, 200)
        song = result.response['song']
        self.assertEqual([part['id'] for part in song['parts']], [reference['id']])
        self.assertNotIn('sharedParts', song)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}/parts/{reference["id"]}').wfile.getvalue(), part_zip())
        song = self.reuse(song)
        reference = song['parts'][0]
        self.assertEqual(song['parts'][1]['sourcePartId'], original['id'])
        render_result = self.request('POST', f'/api/songs/{song["id"]}/parts/{reference["id"]}/render?sha256={reference["sha256"]}', body=render_wav(reference))
        self.assertEqual(render_result.status, 200)
        self.assertEqual(render_result.response['song']['parts'][0]['render'], render_result.response['song']['parts'][1]['render'])
        saved = self.request('POST', f'/api/songs/{song["id"]}/parts/{reference["id"]}/save?sha256={reference["sha256"]}&name=Verse&repeats=3', body=part_zip(32))
        self.assertEqual(saved.status, 200)
        self.assertEqual([part['patternSteps'] for part in saved.response['song']['parts']], [32, 32])
        self.assertEqual([part['repeats'] for part in saved.response['song']['parts']], [3, 2])
        listed = self.request('GET').response['songs'][0]
        self.assertEqual(listed, saved.response['song'])
        self.assertNotIn('history', listed)
        self.assertNotIn('deletedParts', listed)

    def test_deleting_references_does_not_remove_other_occurrences_or_recovery_assets(self):
        song = self.reuse(self.upload(self.create()))
        reference = song['parts'][1]
        result = self.request('POST', f'/api/songs/{song["id"]}/parts/{reference["id"]}/delete?sha256={reference["sha256"]}')
        self.assertEqual(result.status, 200)
        self.assertEqual(len(result.response['song']['parts']), 1)
        original = result.response['song']['parts'][0]
        result = self.request('POST', f'/api/songs/{song["id"]}/parts/{original["id"]}/delete?sha256={original["sha256"]}')
        self.assertEqual(result.response['song']['parts'], [])
        self.assertTrue((SONGS.SONGS_ROOT / song['id'] / 'parts' / f'{original["id"]}.zip').is_file())

    def test_create_named_folder_and_private_library(self):
        song = self.create()
        self.assertTrue((SONGS.SONGS_ROOT / song['id'] / 'song.json').is_file())
        self.assertTrue(song['id'].startswith('My-Song-'))
        self.assertNotIn('ownerHash', song)
        self.assertEqual(len(self.request('GET').response['songs']), 1)
        self.assertEqual(self.request('GET', key='b' * 64).response['songs'], [])

    def test_other_library_cannot_read_or_modify_song(self):
        song = self.create()
        for method, suffix, arguments in [('GET', '', {}), ('POST', '/parts?name=bad&repeats=1', {'body': part_zip()})]:
            result = self.request(method, f'/api/songs/{song["id"]}{suffix}', key='b' * 64, **arguments)
            self.assertEqual(result.status, 404)

    def test_key_is_required(self):
        self.assertEqual(self.request('GET', key='').status, 403)

    def test_full_archive_is_saved_and_retrievable_byte_for_byte(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        self.assertEqual(part['audioAssets'], 1)
        self.assertEqual(part['repeats'], 2)
        self.assertEqual(part['patternSteps'], 16)
        result = self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}')
        self.assertEqual(result.status, 200)
        self.assertEqual(result.wfile.getvalue(), part_zip())
        self.assertEqual(result.response_headers['Cache-Control'], 'no-store')

    def test_nonstandard_supported_pattern_length(self):
        self.assertEqual(SONGS.validate_part_zip(part_zip(12))['patternSteps'], 12)

    def test_missing_audio_or_traversal_archive_is_rejected(self):
        for archive in [part_zip(missing=True), part_zip(unexpected=True), b'not a zip']:
            song = self.create()
            result = self.request('POST', f'/api/songs/{song["id"]}/parts?name=Intro&repeats=1', body=archive)
            self.assertEqual(result.status, 400)
            self.assertEqual(list((SONGS.SONGS_ROOT / song['id'] / 'parts').iterdir()), [])

    def test_invalid_repeats_are_rejected(self):
        for repeats in [0, 65, 1.5, True, 'nan']:
            with self.assertRaises(ValueError):
                SONGS.checked_repeats(repeats)

    def test_colour_saves_and_clears_without_changing_snapshot_or_render(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        rendered = self.request('POST', path + f'/render?sha256={part["sha256"]}', body=render_wav(part)).response['song']
        result = self.request('POST', path + f'/colour?sha256={part["sha256"]}', payload={'colour': '#AABBCC'})
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['parts'][0], {**rendered['parts'][0], 'colour': '#aabbcc'})
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], result.response['song'])
        self.assertEqual(self.request('GET', path).wfile.getvalue(), part_zip())
        self.assertEqual(self.request('GET', path + '/render').wfile.getvalue(), render_wav(part))
        cleared = self.request('POST', path + f'/colour?sha256={part["sha256"]}', payload={'colour': None})
        self.assertEqual(cleared.status, 200)
        self.assertEqual(cleared.response['song']['parts'][0], {**rendered['parts'][0], 'colour': None})

    def test_colour_follows_identity_through_move_rename_repeats_and_amendment(self):
        song = self.upload(self.upload(self.create()))
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        self.assertEqual(self.request('POST', path + f'/colour?sha256={part["sha256"]}', payload={'colour': '#123456'}).status, 200)
        parts = [{'id': entry['id'], 'name': 'Renamed', 'repeats': 3} for entry in reversed(song['parts'])]
        moved = self.request('POST', f'/api/songs/{song["id"]}/arrange', payload={'parts': parts})
        self.assertEqual(moved.status, 200)
        self.assertEqual(moved.response['song']['parts'][1]['colour'], '#123456')
        self.assertNotIn('colour', moved.response['song']['parts'][0])
        saved = self.request('POST', path + f'/save?sha256={part["sha256"]}', body=part_zip(12))
        self.assertEqual(saved.status, 200)
        self.assertEqual(saved.response['song']['parts'][1]['colour'], '#123456')
        self.assertEqual(saved.response['song']['parts'][1]['id'], part['id'])

    def test_invalid_missing_stale_or_foreign_colour_writes_do_not_change_song(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/colour?sha256={part["sha256"]}'
        for value in ['', '#fff', '#12345678', '#zzzzzz', 'red', 'url(bad)', 42, True, {}, []]:
            self.assertEqual(self.request('POST', path, payload={'colour': value}).status, 400)
        self.assertEqual(self.request('POST', path, payload={}).status, 400)
        self.assertEqual(self.request('POST', path, payload={'colour': '#123456'}, key='b' * 64).status, 404)
        self.assertEqual(self.request('POST', path.replace(part['sha256'], 'stale'), payload={'colour': '#123456'}).status, 409)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_failed_colour_write_keeps_original_manifest(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        with patch.object(SONGS, 'write_song', side_effect=OSError('disk full')):
            result = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/colour?sha256={part["sha256"]}', payload={'colour': '#123456'})
        self.assertEqual(result.status, 500)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_path_traversal_cannot_escape_song_root(self):
        for song_id in ['../outside', '%2e%2e', 'song/../outside', '..']:
            self.assertEqual(self.request('GET', f'/api/songs/{song_id}').status, 400)

    def test_duplicate_names_create_separate_song_folders(self):
        first = self.create()
        second = self.create()
        self.assertNotEqual(first['id'], second['id'])

    def test_song_rename_preserves_id_folder_parts_and_render(self):
        features = self.request('GET').response['features']
        self.assertEqual(features['contentHashes'], 1)
        self.assertTrue(features['renameSongs'])
        song = self.upload(self.create())
        part = song['parts'][0]
        rendered = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}', body=render_wav(part)).response['song']
        result = self.request('POST', f'/api/songs/{song["id"]}/rename', payload={'name': ' Renamed song '})
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['id'], song['id'])
        self.assertEqual(result.response['song']['name'], 'Renamed song')
        self.assertEqual(result.response['song']['parts'], rendered['parts'])
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song']['name'], 'Renamed song')
        self.assertEqual(self.request('GET').response['songs'][0]['name'], 'Renamed song')
        self.assertTrue((SONGS.SONGS_ROOT / song['id']).is_dir())

    def test_invalid_or_foreign_song_rename_is_rejected(self):
        song = self.create()
        for value in ['', ' ', 'x' * 101, 'bad\nname', None]:
            result = self.request('POST', f'/api/songs/{song["id"]}/rename', payload={'name': value})
            self.assertEqual(result.status, 400)
        self.assertEqual(self.request('POST', f'/api/songs/{song["id"]}/rename', key='b' * 64, payload={'name': 'Foreign'}).status, 404)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song']['name'], song['name'])

    def test_failed_song_rename_keeps_saved_name(self):
        song = self.create()
        with patch.object(SONGS, 'write_song', side_effect=OSError('disk full')):
            result = self.request('POST', f'/api/songs/{song["id"]}/rename', payload={'name': 'New name'})
        self.assertEqual(result.status, 500)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song']['name'], song['name'])

    def test_content_hash_ignores_capture_timestamps_archive_order_and_json_order(self):
        body = part_zip()
        first = rewrite_part(body, lambda manifest: (manifest.update(createdAt='first capture'), manifest['state'].update(timestamp=1)))
        second = rewrite_part(body, lambda manifest: (manifest.update(createdAt='second capture'), manifest['state'].update(timestamp=2)))
        self.assertNotEqual(first, second)
        self.assertEqual(SONGS.validate_part_zip(first)['contentSha256'], SONGS.validate_part_zip(second)['contentSha256'])
        self.assertEqual(SONGS.validate_part_zip(body)['contentSha256'], SONGS.validate_part_zip(second)['contentSha256'])

    def test_unchanged_amendment_keeps_render_and_refreshes_archive_integrity_hash(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        rendered = self.request('POST', path + f'/render?sha256={part["sha256"]}&keyboard=1&grain=1', body=render_wav(part)).response['song']['parts'][0]['render']
        body = rewrite_part(part_zip(), lambda manifest: (manifest.update(createdAt='new capture'), manifest['state'].update(timestamp=999)))
        result = self.request('POST', path + f'/save?sha256={part["sha256"]}&name=Renamed&repeats=3', body=body)
        self.assertEqual(result.status, 200)
        updated = result.response['song']['parts'][0]
        self.assertNotEqual(updated['sha256'], part['sha256'])
        self.assertEqual(updated['contentSha256'], part['contentSha256'])
        self.assertEqual(updated['render'], {**rendered, 'sourceSha256': updated['sha256']})
        self.assertEqual(self.request('GET', path + '/render').wfile.getvalue(), render_wav(part))
        self.assertEqual(self.request('GET', path).wfile.getvalue(), body)

    def test_legacy_unchanged_amendment_reuses_render_without_content_hash_migration(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        self.request('POST', path + f'/render?sha256={part["sha256"]}', body=render_wav(part))
        folder, saved = SONGS.read_song(song['id'], SONGS.owner_hash({'X-Mygrain-Song-Key': 'a' * 64}))
        saved['parts'][0].pop('contentSha256')
        SONGS.write_song(folder, saved)
        body = rewrite_part(part_zip(), lambda manifest: manifest.update(createdAt='legacy resave'))
        updated = self.request('POST', path + f'/save?sha256={part["sha256"]}', body=body).response['song']['parts'][0]
        self.assertIn('contentSha256', updated)
        self.assertIn('render', updated)
        self.assertEqual(self.request('GET', path + '/render').wfile.getvalue(), render_wav(part))

    def test_changed_settings_keys_patterns_and_samples_invalidate_only_changed_render(self):
        changes = [
            lambda manifest: manifest['state'].update(globalBpm=90),
            lambda manifest: manifest['state']['modes'].update(granularLayersEnabled=True),
            lambda manifest: manifest['extra'].update(heldNotes=['C4', 'E4']),
            lambda manifest: manifest['extra']['sequencerSteps'][0].update(volume=25)
        ]
        for mutate in changes:
            with self.subTest(change=mutate):
                song = self.upload(self.upload(self.create()))
                part, untouched = song['parts']
                path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
                self.request('POST', path + f'/render?sha256={part["sha256"]}', body=render_wav(part))
                body = rewrite_part(part_zip(), mutate)
                result = self.request('POST', path + f'/save?sha256={part["sha256"]}', body=body)
                changed = result.response['song']['parts'][0]
                self.assertNotEqual(changed['contentSha256'], part['contentSha256'])
                self.assertNotIn('render', changed)
                self.assertEqual(result.response['song']['parts'][1], untouched)
        with zipfile.ZipFile(BytesIO(part_zip())) as archive:
            audio = bytearray(archive.read('audio/bastardL.wav'))
        audio[-2:] = b'\x01\x00'
        changed_audio = rewrite_part(part_zip(), lambda manifest: None, bytes(audio))
        self.assertNotEqual(SONGS.validate_part_zip(changed_audio)['contentSha256'], SONGS.validate_part_zip(part_zip())['contentSha256'])

    def test_rename_and_reorder_preserve_immutable_archive(self):
        song = self.upload(self.create())
        song = self.upload(song)
        original_bytes = (SONGS.SONGS_ROOT / song['id'] / 'parts' / f'{song["parts"][0]["id"]}.zip').read_bytes()
        parts = [dict(part) for part in reversed(song['parts'])]
        parts[0]['name'] = 'Chorus'
        parts[0]['repeats'] = 4
        result = self.request('POST', f'/api/songs/{song["id"]}/arrange', payload={'parts': parts})
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['parts'][0]['name'], 'Chorus')
        self.assertEqual(result.response['song']['parts'][0]['id'], parts[0]['id'])
        self.assertEqual((SONGS.SONGS_ROOT / song['id'] / 'parts' / f'{song["parts"][0]["id"]}.zip').read_bytes(), original_bytes)

    def test_arrangement_cannot_drop_or_duplicate_saved_parts(self):
        song = self.upload(self.upload(self.create()))
        for parts in [song['parts'][:1], [song['parts'][0]] * 2]:
            self.assertEqual(self.request('POST', f'/api/songs/{song["id"]}/arrange', payload={'parts': parts}).status, 400)

    def test_failed_manifest_write_leaves_no_partial_part(self):
        song = self.create()
        with patch.object(SONGS, 'write_song', side_effect=OSError('disk full')):
            result = self.request('POST', f'/api/songs/{song["id"]}/parts?name=Intro&repeats=1', body=part_zip())
        self.assertEqual(result.status, 500)
        self.assertEqual(list((SONGS.SONGS_ROOT / song['id'] / 'parts').iterdir()), [])

    def test_amend_atomically_replaces_snapshot_and_preserves_prior_revision(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        original = (SONGS.SONGS_ROOT / song['id'] / 'parts' / f'{part["id"]}.zip').read_bytes()
        body = part_zip(12)
        result = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/save?sha256={part["sha256"]}&name=Changed&repeats=3', body=body)
        self.assertEqual(result.status, 200)
        amended = result.response['song']['parts'][0]
        self.assertEqual((amended['id'], amended['name'], amended['patternSteps'], amended['repeats'], amended['revision']), (part['id'], 'Changed', 12, 3, 2))
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(), body)
        self.assertEqual((SONGS.SONGS_ROOT / song['id'] / 'parts' / f'{part["id"]}.zip').read_bytes(), original)
        self.assertNotIn('history', result.response['song'])
        self.assertEqual(len(SONGS.read_song(song['id'], SONGS.owner_hash({'X-Mygrain-Song-Key': 'a' * 64}))[1]['history']), 1)

    def test_stale_or_foreign_amend_and_delete_cannot_change_snapshot(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        for action in ['save', 'delete', 'render']:
            path = f'/api/songs/{song["id"]}/parts/{part["id"]}/{action}'
            self.assertEqual(self.request('POST', path + '?sha256=stale', body=part_zip()).status, 409)
            self.assertEqual(self.request('POST', path + f'?sha256={part["sha256"]}', key='b' * 64, body=part_zip()).status, 404)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_failed_amend_preserves_live_snapshot_and_removes_partial_revision(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        with patch.object(SONGS, 'write_song', side_effect=OSError('disk full')):
            result = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/save?sha256={part["sha256"]}', body=part_zip(12))
        self.assertEqual(result.status, 500)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)
        self.assertEqual(len(list((SONGS.SONGS_ROOT / song['id'] / 'parts').iterdir())), 1)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(), part_zip())

    def test_delete_removes_part_from_order_but_retains_recovery_files(self):
        song = self.upload(self.upload(self.create()))
        part = song['parts'][0]
        result = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/delete?sha256={part["sha256"]}')
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['parts'], song['parts'][1:])
        self.assertNotIn('deletedParts', result.response['song'])
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}').status, 404)
        self.assertTrue((SONGS.SONGS_ROOT / song['id'] / 'parts' / f'{part["id"]}.zip').is_file())

    def test_exact_length_render_is_stored_reused_and_invalidated_on_amendment(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        body = render_wav(part)
        self.assertEqual(self.request('GET', path + '/render').status, 404)
        result = self.request('POST', path + f'/render?sha256={part["sha256"]}', body=body)
        self.assertEqual(result.status, 200)
        rendered = result.response['song']['parts'][0]['render']
        self.assertEqual(rendered['sourceSha256'], part['sha256'])
        self.assertEqual(self.request('GET', path + '/render').wfile.getvalue(), body)
        result = self.request('POST', path + f'/save?sha256={part["sha256"]}', body=part_zip(12))
        self.assertEqual(result.status, 200)
        self.assertNotIn('render', result.response['song']['parts'][0])
        self.assertEqual(self.request('GET', path + '/render').status, 404)
        self.assertTrue((SONGS.SONGS_ROOT / song['id'] / 'parts' / rendered['file']).is_file())

    def test_failed_delete_preserves_song_order_and_all_audio(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        with patch.object(SONGS, 'write_song', side_effect=OSError('disk full')):
            result = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/delete?sha256={part["sha256"]}')
        self.assertEqual(result.status, 500)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(), part_zip())

    def test_keyboard_render_marker_is_persisted_with_the_original_snapshot_hash(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        result = self.request('POST', path + f'/render?sha256={part["sha256"]}&keyboard=1', body=render_wav(part))
        self.assertEqual(result.status, 200)
        render = result.response['song']['parts'][0]['render']
        self.assertEqual(render['keyboardVersion'], 1)
        self.assertEqual(render['sourceSha256'], part['sha256'])
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song']['parts'][0]['render'], render)
        self.assertEqual(self.request('GET', path + '/render').wfile.getvalue(), render_wav(part))
        self.assertEqual(self.request('GET', path).wfile.getvalue(), part_zip())
        self.assertEqual(self.request('GET', '/api/songs').response['features']['keyboardRenders'], 1)

    def test_grain_loop_render_marker_preserves_original_and_is_advertised(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        result = self.request('POST', f'{path}/render?sha256={part["sha256"]}&grain=5', body=render_wav(part))
        self.assertEqual(result.status, 200)
        saved = result.response['song']['parts'][0]
        self.assertEqual(saved['sha256'], part['sha256'])
        self.assertEqual(saved['render']['grainVersion'], 5)
        self.assertEqual(self.request('GET', path).wfile.getvalue(), part_zip())
        self.assertEqual(self.request('GET', '/api/songs').response['features']['grainLoopRenders'], 5)

    def test_grain_fade_render_marker_preserves_snapshot_and_is_advertised(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&keyboard=1&grain=1'
        result = self.request('POST', path, body=render_wav(part))
        self.assertEqual(result.status, 200)
        saved = result.response['song']['parts'][0]
        self.assertEqual(saved['sha256'], part['sha256'])
        self.assertEqual(saved['render']['grainVersion'], 1)
        self.assertEqual(saved['render']['keyboardVersion'], 1)
        self.assertEqual(self.request('GET', '/api/songs').response['features']['grainFadeRenders'], 1)

    def test_sustained_grain_render_marker_preserves_original_and_reused_sources(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        self.request('POST', f'{path}/reuse?sha256={part["sha256"]}', body=b'')
        result = self.request('POST', f'{path}/render?sha256={part["sha256"]}&grain=2', body=render_wav(part))
        self.assertEqual(result.status, 200)
        for saved in result.response['song']['parts']:
            self.assertEqual(saved['sha256'], part['sha256'])
            self.assertEqual(saved['render']['grainVersion'], 2)

    def test_grain_control_render_marker_preserves_original_and_is_advertised(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&grain=3'
        result = self.request('POST', path, body=render_wav(part))
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['parts'][0]['sha256'], part['sha256'])
        self.assertEqual(result.response['song']['parts'][0]['render']['grainVersion'], 3)
        self.assertEqual(self.request('GET', '/api/songs').response['features']['grainControlRenders'], 3)

    def test_unknown_grain_fade_version_is_rejected_without_changing_the_song(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&grain=6'
        result = self.request('POST', path, body=render_wav(part))
        self.assertEqual(result.status, 400)
        self.assertNotIn('render', self.request('GET', f'/api/songs/{song["id"]}').response['song']['parts'][0])

    def test_smooth_grain_marker_preserves_original_and_reused_sources(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        self.request('POST', f'{path}/reuse?sha256={part["sha256"]}', body=b'')
        result = self.request('POST', f'{path}/render?sha256={part["sha256"]}&grain=4', body=render_wav(part))
        self.assertEqual(result.status, 200)
        self.assertEqual(result.response['song']['revision'], song['revision'] + 1)  # Only the earlier reuse is editorial.
        for saved in result.response['song']['parts']:
            self.assertEqual(saved['sha256'], part['sha256'])
            self.assertEqual(saved['render']['grainVersion'], 4)
        self.assertEqual(self.request('GET', '/api/songs').response['features']['grainEdgeRenders'], 4)

    def test_vocal_cut_render_marker_preserves_source_and_is_shared_with_reused_parts(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        self.request('POST', f'{path}/reuse?sha256={part["sha256"]}', body=b'')
        result = self.request('POST', f'{path}/render?sha256={part["sha256"]}&vocalcut=1', body=render_wav(part))
        self.assertEqual(result.status, 200)
        for saved in result.response['song']['parts']:
            self.assertEqual(saved['sha256'], part['sha256'])
            self.assertEqual(saved['render']['vocalCutVersion'], 1)
        self.assertEqual(self.request('GET', '/api/songs').response['features']['vocalCutRenders'], 1)

    def test_unknown_vocal_cut_render_version_does_not_change_saved_parts(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&vocalcut=2'
        result = self.request('POST', path, body=render_wav(part))
        self.assertEqual(result.status, 400)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_section_repeat_and_drum_lane_markers_survive_reuse_and_keep_original_assets(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        original = self.request('GET', path)
        self.assertEqual(original.status, 200)
        self.assertTrue(original.wfile.getvalue())
        self.request('POST', f'{path}/reuse?sha256={part["sha256"]}', body=b'')
        result = self.request('POST', f'{path}/render?sha256={part["sha256"]}&vocalcut=1&vocalrepeat=1&drumlanes=1', body=render_wav(part))
        self.assertEqual(result.status, 200)
        for saved in result.response['song']['parts']:
            self.assertEqual(saved['sha256'], part['sha256'])
            self.assertEqual(saved['render']['vocalRepeatVersion'], 1)
            self.assertEqual(saved['render']['drumLanesVersion'], 1)
        features = self.request('GET', '/api/songs').response['features']
        self.assertEqual(features['vocalRepeatRenders'], 1)
        self.assertEqual(features['drumLaneRenders'], 1)
        restored = self.request('GET', path)
        self.assertEqual(restored.status, 200)
        self.assertEqual(restored.wfile.getvalue(), original.wfile.getvalue())

    def test_unknown_section_repeat_and_drum_lane_versions_leave_songs_unchanged(self):
        for feature in ['vocalrepeat', 'drumlanes', 'drumsample']:
            with self.subTest(feature=feature):
                song = self.upload(self.create())
                part = song['parts'][0]
                path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&{feature}=2'
                self.assertEqual(self.request('POST', path, body=render_wav(part)).status, 400)
                self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_drum_sample_render_version_is_saved_without_changing_source(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}'
        original = self.request('GET', path).wfile.getvalue()
        result = self.request('POST', f'{path}/render?sha256={part["sha256"]}&drumsample=1', body=render_wav(part))
        self.assertEqual(result.status, 200)
        saved = result.response['song']['parts'][0]
        self.assertEqual(saved['render']['drumSampleVersion'], 1)
        self.assertEqual(saved['sha256'], part['sha256'])
        self.assertEqual(self.request('GET', path).wfile.getvalue(), original)
        self.assertEqual(self.request('GET', '/api/songs').response['features']['drumSampleRenders'], 1)

    def test_unknown_keyboard_render_version_is_rejected_without_changing_the_song(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&keyboard=2'
        self.assertEqual(self.request('POST', path, body=render_wav(part)).status, 400)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_overlong_short_truncated_and_stale_song_renders_are_rejected(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        path = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}'
        for body in [render_wav(part, 100), render_wav(part, -100), render_wav(part)[:-16], b'not wav']:
            self.assertEqual(self.request('POST', path, body=body).status, 400)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)


if __name__ == '__main__':
    unittest.main()
