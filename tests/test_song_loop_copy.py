import json
import unittest
import wave
import zipfile
from io import BytesIO
from unittest.mock import patch

import test_song_backend as backend

Handler = backend.Handler
SONGS = backend.SONGS
render_wav = backend.render_wav


PREFIXES = {'A': '', 'B': '2', 'C': '3', 'V': 'V', 'P': 'P', 'O': 'O', 'L': 'L', 'X': 'X', 'Q': 'Q', 'M': 'M', 'M+': 'MPlus'}


def complete_part(tag, steps=16, empty=(), portable=True):
    modes = {'globalSentinel': tag, 'loopLayerSolo': ['bastardx']}
    sliders = {'finalVolume': str(tag)}
    controls = [{'id': 'globalSentinel', 'value': str(tag)}]
    for layer, prefix in PREFIXES.items():
        modes[f'bastardLoop{prefix}Enabled'] = layer not in empty
        modes[f'bastardLoop{prefix}PitchSemitones'] = tag
        modes[f'bastardLoop{prefix}Sequence'] = [{'notes': [tag], 'rest': False}] * 64
        sliders[f'performanceBastardLoop{prefix}Level'] = str(tag)
        controls.append({'id': f'performanceBastard{prefix}DivisionHalf', 'type': 'checkbox', 'value': 'half', 'checked': bool(tag % 2)})
    assets = []
    entries = {}
    for layer, keys in SONGS.LOOP_ASSETS.items():
        for key in sorted(keys):
            if layer in empty:
                continue
            audio = BytesIO()
            channels = 2 if layer == 'Q' else 1
            with wave.open(audio, 'wb') as output:
                output.setnchannels(channels)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(int(tag).to_bytes(2, 'little', signed=True) * 128 * channels)
            path = f'audio/{key}.wav'
            entries[path] = audio.getvalue()
            assets.append({'key': key, 'path': path, 'channels': channels, 'frames': 128, 'sampleRate': 44100})
    q = None if 'Q' in empty else {
        'version': 1, 'enabled': True, 'room': .1 * tag, 'sequence': [None] * 64,
        'bank': {'version': 1, 'sampleRate': 44100, 'samples': [{'id': 'C4v4', 'midi': 60, 'velocity': 32, 'offset': 0, 'frames': 128}]}
    }
    snapshot = {
        'format': 'mygrain-song-part', 'version': 1, 'createdAt': str(tag),
        'state': {'modes': modes, 'sliders': sliders, 'selects': {'performanceBastardLoopMPlusFilterMode': str(tag)},
                  'toggles': {'lfo': {f'bastardLoop{prefix}Pitch': bool(tag % 2) for prefix in PREFIXES.values()}},
                  'bastardLoopTrace': {layer: {'sentinel': tag} for layer in PREFIXES},
                  'q': q, 'globalBpm': 100 + tag, 'patternLength': steps},
        'extra': {'sequencerSteps': [{'volume': tag}] * steps, 'heldNotes': ['C4'], 'controls': controls,
                  'performanceSourceLayerSolo': ['sample'], 'metadata': {asset['key']: {'tag': tag} for asset in assets}},
        'assets': assets
    }
    if portable:
        snapshot['extra'].update({'freezeStateVersion': 1, 'audioSlots': {key: f'audio/{key}.wav' in entries for keys in SONGS.LOOP_ASSETS.values() for key in keys}})
    entries['song-part.json'] = json.dumps(snapshot).encode()
    output = BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for path, body in entries.items():
            archive.writestr(path, body)
    return output.getvalue()


def unpack(body):
    with zipfile.ZipFile(BytesIO(body)) as archive:
        snapshot = json.loads(archive.read('song-part.json'))
        return snapshot, {asset['key']: archive.read(asset['path']) for asset in snapshot['assets']}


class LoopMergeTests(unittest.TestCase):
    def test_every_loop_replaces_only_its_complete_settings_original_audio_and_metadata(self):
        source_body, target_body = complete_part(1, 32), complete_part(2, 16)
        source, source_audio = unpack(source_body)
        target, target_audio = unpack(target_body)
        for layer, prefix in PREFIXES.items():
            with self.subTest(layer=layer):
                result = SONGS.paste_loop_archive(target_body, source_body, layer)
                SONGS.validate_part_zip(result)
                snapshot, audio = unpack(result)
                self.assertEqual(snapshot['state']['globalBpm'], target['state']['globalBpm'])
                self.assertEqual(snapshot['state']['patternLength'], 16)
                self.assertEqual(snapshot['extra']['sequencerSteps'], target['extra']['sequencerSteps'])
                self.assertEqual(snapshot['extra']['heldNotes'], target['extra']['heldNotes'])
                self.assertEqual(snapshot['state']['modes']['loopLayerSolo'], ['bastardx'])
                self.assertEqual(snapshot['extra']['performanceSourceLayerSolo'], ['sample'])
                for other, other_prefix in PREFIXES.items():
                    expected = source if other == layer else target
                    key = f'bastardLoop{other_prefix}PitchSemitones'
                    self.assertEqual(snapshot['state']['modes'][key], expected['state']['modes'][key])
                    self.assertEqual(snapshot['state']['modes'][f'bastardLoop{other_prefix}Sequence'], expected['state']['modes'][f'bastardLoop{other_prefix}Sequence'])
                    slider_id = f'performanceBastardLoop{other_prefix}Level'
                    self.assertEqual(snapshot['state']['sliders'][slider_id], expected['state']['sliders'][slider_id])
                    modulation_id = f'bastardLoop{other_prefix}Pitch'
                    self.assertEqual(snapshot['state']['toggles']['lfo'][modulation_id], expected['state']['toggles']['lfo'][modulation_id])
                    control_id = f'performanceBastard{other_prefix}DivisionHalf'
                    self.assertEqual(next(control for control in snapshot['extra']['controls'] if control['id'] == control_id), next(control for control in expected['extra']['controls'] if control['id'] == control_id))
                self.assertEqual(snapshot['state']['q'], (source if layer == 'Q' else target)['state']['q'])
                self.assertEqual(snapshot['state']['bastardLoopTrace'][layer], source['state']['bastardLoopTrace'][layer])
                for key, body in audio.items():
                    expected = source_audio if key in SONGS.LOOP_ASSETS[layer] else target_audio
                    self.assertEqual(body, expected[key])
                    self.assertEqual(snapshot['extra']['metadata'][key]['tag'], 1 if key in SONGS.LOOP_ASSETS[layer] else 2)
        self.assertEqual(unpack(source_body)[0], source)
        self.assertEqual(unpack(target_body)[0], target)

    def test_a_prefix_does_not_capture_p_pitch_l_level_or_other_loops(self):
        examples = {'bastardLoopPitchSemitones': 'A', 'performanceBastardLoopLevel': 'A',
                    'performanceBastardDivisionQuarter': 'A', 'bastardLoopMPlusLevel': 'M+',
                    'bastardLoopMLevel': 'M', 'performanceBastardLoop2Level': 'B',
                    'performanceBastard3DivisionHalf': 'C', 'finalVolume': None}
        for key, layer in examples.items():
            self.assertEqual(SONGS.setting_loop_layer(key), layer)

    def test_empty_lane_removes_previous_raw_render_and_metadata_without_bleed(self):
        for layer in PREFIXES:
            with self.subTest(layer=layer):
                result = SONGS.paste_loop_archive(complete_part(2), complete_part(1, empty=(layer,)), layer)
                SONGS.validate_part_zip(result)
                snapshot, audio = unpack(result)
                for key in SONGS.LOOP_ASSETS[layer]:
                    self.assertNotIn(key, audio)
                    self.assertNotIn(key, snapshot['extra']['metadata'])
                    self.assertIs(snapshot['extra']['audioSlots'][key], False)
                self.assertFalse(snapshot['state']['modes'][f'bastardLoop{PREFIXES[layer]}Enabled'])

    def test_legacy_and_portable_snapshots_can_be_mixed_without_inheriting_target_audio(self):
        for source_portable, destination_portable in [(False, True), (True, False), (False, False)]:
            result = SONGS.paste_loop_archive(complete_part(2, portable=destination_portable), complete_part(1, empty=('M+',), portable=source_portable), 'M+')
            SONGS.validate_part_zip(result)
            self.assertNotIn('bastardMPlusRender', unpack(result)[1])

    def test_invalid_layer_malformed_audio_and_oversized_merge_fail_without_publication(self):
        with self.assertRaises(ValueError):
            SONGS.paste_loop_archive(complete_part(2), complete_part(1), 'unknown')
        with self.assertRaises(zipfile.BadZipFile):
            SONGS.paste_loop_archive(complete_part(2), b'bad archive', 'X')
        with patch.object(SONGS, 'MAX_UPLOAD', 30000):
            with self.assertRaises(ValueError):
                SONGS.paste_loop_archive(complete_part(2), complete_part(1), 'M')

    def test_malformed_optional_settings_are_rejected_as_bad_input(self):
        for section in ('sliders', 'selects', 'toggles', 'bastardLoopTrace'):
            with self.subTest(section=section):
                source = backend.rewrite_part(complete_part(1), lambda snapshot: snapshot['state'].update({section: []}))
                with self.assertRaises(ValueError):
                    SONGS.paste_loop_archive(complete_part(2), source, 'A')


class LoopEndpointTests(unittest.TestCase):
    setUp = backend.SongBackendTests.setUp
    tearDown = backend.SongBackendTests.tearDown
    request = backend.SongBackendTests.request
    create = backend.SongBackendTests.create
    reuse = backend.SongBackendTests.reuse

    def fixture(self):
        song = self.create()
        for name, tag, repeats in [('Source', 1, 2), ('Target', 2, 3)]:
            song = self.request('POST', f'/api/songs/{song["id"]}/parts?name={name}&repeats={repeats}', body=complete_part(tag)).response['song']
        source, target = song['parts']
        copied = {'sourceSongId': song['id'], 'sourcePartId': source['id'], 'sourceSha256': source['sha256'], 'layer': 'M+'}
        return song, source, target, copied

    def paste(self, song, target, copied, **kwargs):
        return self.request('POST', f'/api/songs/{song["id"]}/parts/{target["id"]}/paste-loop?sha256={target["sha256"]}', payload=copied, **kwargs)

    def test_paste_revisions_history_repeat_counts_and_shared_occurrences(self):
        song, source, target, copied = self.fixture()
        song = self.reuse(song, 1)
        target = song['parts'][1]
        song = self.request('POST', f'/api/songs/{song["id"]}/parts/{target["id"]}/render?sha256={target["sha256"]}&q=4', body=render_wav(target)).response['song']
        response = self.paste(song, song['parts'][2], copied)
        self.assertEqual(response.status, 200)
        changed = response.response['song']
        self.assertEqual(changed['revision'], song['revision'] + 1)
        self.assertEqual([part['repeats'] for part in changed['parts']], [2, 3, 3])
        self.assertEqual(changed['parts'][0], source)
        self.assertEqual(changed['parts'][1]['sha256'], changed['parts'][2]['sha256'])
        self.assertNotIn('render', changed['parts'][1])
        folder = SONGS.SONGS_ROOT / song['id']
        self.assertEqual(json.loads((folder / 'song.json').read_text())['history'][-1]['sha256'], target['sha256'])
        result = (folder / 'parts' / changed['parts'][1]['archive']).read_bytes()
        self.assertEqual(unpack(result)[1]['bastardMPlus'], unpack(complete_part(1))[1]['bastardMPlus'])

    def test_copy_pins_old_revision_even_after_source_amendment_and_deletion(self):
        song, source, target, copied = self.fixture()
        song = self.request('POST', f'/api/songs/{song["id"]}/parts/{source["id"]}/save?sha256={source["sha256"]}', body=complete_part(3)).response['song']
        current = song['parts'][0]
        song = self.request('POST', f'/api/songs/{song["id"]}/parts/{current["id"]}/delete?sha256={current["sha256"]}').response['song']
        response = self.paste(song, target, copied)
        self.assertEqual(response.status, 200)
        changed = response.response['song']['parts'][0]
        body = (SONGS.SONGS_ROOT / song['id'] / 'parts' / changed['archive']).read_bytes()
        self.assertEqual(unpack(body)[0]['state']['modes']['bastardLoopMPlusPitchSemitones'], 1)

    def test_cross_song_copy_is_allowed_only_inside_same_library(self):
        song, source, target, copied = self.fixture()
        other = self.create()
        other = self.request('POST', f'/api/songs/{other["id"]}/parts?name=Other&repeats=1', body=complete_part(3)).response['song']
        response = self.paste(other, other['parts'][0], copied)
        self.assertEqual(response.status, 200)
        outsider = Handler(path='/mygrain/api/songs', key='b' * 64, payload={'name': 'Private'})
        SONGS.handle_song_request(outsider, 'POST', '/api/songs')
        rejected = self.paste(song, target, {**copied, 'sourceSongId': outsider.response['song']['id']})
        self.assertIn(rejected.status, (403, 404))

    def test_bad_reference_or_corrupt_copied_archive_preserves_destination(self):
        song, source, target, copied = self.fixture()
        before = (SONGS.SONGS_ROOT / song['id'] / 'song.json').read_bytes()
        for changed in [{'layer': 'unknown'}, {'sourcePartId': '../bad'}, {'sourceSha256': '0' * 64}]:
            self.assertEqual(self.paste(song, target, {**copied, **changed}).status, 400)
            self.assertEqual((SONGS.SONGS_ROOT / song['id'] / 'song.json').read_bytes(), before)
        path = SONGS.SONGS_ROOT / song['id'] / 'parts' / source.get('archive', source['id'] + '.zip')
        path.write_bytes(b'corrupted')
        self.assertEqual(self.paste(song, target, copied).status, 400)
        self.assertEqual((SONGS.SONGS_ROOT / song['id'] / 'song.json').read_bytes(), before)

    def test_destination_requires_exact_part_revision_and_valid_editor(self):
        song, source, target, copied = self.fixture()
        self.assertEqual(self.paste(song, {**target, 'sha256': '0' * 64}, copied).status, 409)
        endpoint = f'/api/songs/{song["id"]}/parts/{target["id"]}/paste-loop?sha256={target["sha256"]}'
        missing = Handler(path='/mygrain' + endpoint, payload=copied)
        SONGS.handle_song_request(missing, 'POST', endpoint.split('?')[0])
        self.assertEqual(missing.status, 423)

    def test_stale_song_revision_and_expired_lease_cannot_publish_paste(self):
        song, source, target, copied = self.fixture()
        endpoint = f'/api/songs/{song["id"]}/parts/{target["id"]}/paste-loop?sha256={target["sha256"]}'
        handler = Handler(path='/mygrain' + endpoint, payload=copied)
        handler.headers.update({'X-Mygrain-Song-Device': '1' * 32, 'X-Mygrain-Song-Session': '2' * 32,
                               'X-Mygrain-Song-Lock': self.edit_tokens[song['id']], 'If-Match': f'"{song["revision"] - 1}"'})
        SONGS.handle_song_request(handler, 'POST', endpoint.split('?')[0])
        self.assertEqual(handler.status, 409)
        handler.headers['If-Match'] = f'"{song["revision"]}"'
        with patch.object(SONGS.time, 'time', return_value=10 ** 12):
            SONGS.handle_song_request(handler, 'POST', endpoint.split('?')[0])
        self.assertEqual(handler.status, 423)
        self.assertEqual(self.request('GET', f'/api/songs/{song["id"]}').response['song'], song)

    def test_corrupt_destination_archive_does_not_publish_an_amendment(self):
        song, source, target, copied = self.fixture()
        folder = SONGS.SONGS_ROOT / song['id']
        before = (folder / 'song.json').read_bytes()
        path = folder / 'parts' / target.get('archive', target['id'] + '.zip')
        path.write_bytes(complete_part(3))
        self.assertEqual(self.paste(song, target, copied).status, 400)
        self.assertEqual((folder / 'song.json').read_bytes(), before)

    def test_unchanged_paste_preserves_valid_render_and_removing_q_clears_capability(self):
        song, source, target, copied = self.fixture()
        song = self.request('POST', f'/api/songs/{song["id"]}/parts/{target["id"]}/render?sha256={target["sha256"]}&q=4', body=render_wav(target)).response['song']
        copied = {**copied, 'sourcePartId': target['id'], 'sourceSha256': target['sha256']}
        response = self.paste(song, target, copied)
        self.assertEqual(response.status, 200)
        saved = response.response['song']['parts'][1]
        self.assertEqual(saved['render']['sourceSha256'], saved['sha256'])
        song = self.request('POST', f'/api/songs/{song["id"]}/parts/{source["id"]}/save?sha256={source["sha256"]}', body=complete_part(1, empty=('Q',))).response['song']
        source = song['parts'][0]
        response = self.paste(song, saved, {**copied, 'sourcePartId': source['id'], 'sourceSha256': source['sha256'], 'layer': 'Q'})
        self.assertEqual(response.status, 200)
        self.assertNotIn('qVersion', response.response['song']['parts'][1])


if __name__ == '__main__':
    unittest.main()
