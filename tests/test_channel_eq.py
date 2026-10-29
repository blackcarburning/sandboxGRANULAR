"""EQ migration, backend render gating, source preservation and lane-copy checks."""
import copy
import json
import pathlib
import subprocess
import unittest
import zipfile
from io import BytesIO
import test_song_backend as backend
from test_song_loop_copy import drum_part, unpack
from test_song_k_copy import k_part

SONGS = backend.SONGS
EQ = SONGS.CHANNEL_EQ


def replace_eq(body, settings):
    with zipfile.ZipFile(BytesIO(body)) as z:
        entries = {name: z.read(name) for name in z.namelist()}
    snapshot = json.loads(entries['song-part.json'])
    if settings is None:
        snapshot['state']['modes'].pop('channelEq', None)
    else:
        snapshot['state']['modes']['channelEq'] = settings
    entries['song-part.json'] = json.dumps(snapshot).encode()
    out = BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for name, value in entries.items():
            z.writestr(name, value)
    return out.getvalue()


class EqCodecTests(unittest.TestCase):
    def test_legacy_defaults_and_canonical_javascript_agree_for_all_26_channels(self):
        result = subprocess.run(['node', '-e', "process.stdout.write(JSON.stringify(require('./channel-eq.js').normalize()))"], cwd=pathlib.Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True)
        self.assertEqual(EQ.normalize(), json.loads(result.stdout))
        self.assertEqual(len(EQ.KEYS), 26)
        self.assertTrue(all(not c['enabled'] for c in EQ.normalize()['channels'].values()))

    def test_bypass_metadata_and_bypassed_edits_retain_legacy_audio_fingerprint(self):
        body = backend.part_zip()
        original = SONGS.validate_part_zip(body)
        eq = EQ.normalize()
        eq['channels']['L']['bands'][1].update(gain=18, frequency=1234, q=7)
        updated = SONGS.validate_part_zip(replace_eq(body, eq))
        self.assertEqual(original['contentSha256'], updated['contentSha256'])
        self.assertNotIn('eqVersion', updated)
        eq['channels']['L']['enabled'] = True
        enabled = SONGS.validate_part_zip(replace_eq(body, eq))
        self.assertNotEqual(original['contentSha256'], enabled['contentSha256'])
        self.assertEqual(enabled['eqVersion'], 1)

    def test_future_versions_and_invalid_band_count_are_rejected_before_audio_preparation(self):
        for value in ({'version': 2, 'channels': {}}, {'version': 1, 'channels': {'A': {'bands': []}}}):
            with self.assertRaises(ValueError):
                SONGS.validate_part_zip(replace_eq(backend.part_zip(), value))

    def test_loop_k_and_drum_lane_copies_change_only_selected_eq_and_leave_wav_bytes_exact(self):
        for layer in (*SONGS.LOOP_LAYERS, *SONGS.K_TRACKS, *SONGS.DRUM_LANES, 'drums'):
            with self.subTest(layer=layer):
                source_eq, target_eq = EQ.normalize(), EQ.normalize()
                for i, key in enumerate(EQ.KEYS):
                    source_eq['channels'][key]['enabled'] = True
                    source_eq['channels'][key]['bands'][0].update(gain=3, frequency=50+i)
                    target_eq['channels'][key]['bands'][0].update(gain=-3, frequency=100+i)
                source, target = replace_eq(k_part(1), source_eq), replace_eq(k_part(2), target_eq)
                original_source, source_audio = unpack(source)
                original_target, target_audio = unpack(target)
                result = SONGS.paste_loop_archive(target, source, [layer])
                saved, audio = unpack(result)
                expected = copy.deepcopy(target_eq)
                chosen = SONGS.DRUM_LANES if layer == 'drums' else [layer]
                for key in chosen:
                    expected['channels'][key] = source_eq['channels'][key]
                self.assertEqual(saved['state']['modes']['channelEq'], expected)
                self.assertEqual(set(audio), set(target_audio))
                for name, value in audio.items():
                    self.assertIn(value, (target_audio[name], source_audio[name]))
                SONGS.validate_part_zip(result)

    def test_copy_from_legacy_resets_only_the_chosen_channel_to_bypass(self):
        eq = EQ.normalize()
        for channel in eq['channels'].values():
            channel['enabled'] = True
        target = replace_eq(k_part(2), eq)
        saved, _ = unpack(SONGS.paste_loop_archive(target, k_part(1), ['A', 'K5', 'drumRoll']))
        actual = saved['state']['modes']['channelEq']
        for key in EQ.KEYS:
            self.assertEqual(actual['channels'][key]['enabled'], key not in ['A', 'K5', 'drumRoll'])


class EqSongApiTests(unittest.TestCase):
    setUp = backend.SongBackendTests.setUp
    tearDown = backend.SongBackendTests.tearDown
    request = backend.SongBackendTests.request
    create = backend.SongBackendTests.create
    def test_eq_aware_render_required_and_feature_marker_can_be_removed(self):
        eq = EQ.normalize(); eq['channels']['L']['enabled'] = True
        eq['channels']['L']['bands'][1]['gain'] = -12
        body = replace_eq(backend.part_zip(), eq)
        song = self.create(); base = f'/api/songs/{song["id"]}'
        song = self.request('POST', base+'/parts?name=EQ', body=body).response['song']; part = song['parts'][0]
        path = base+f'/parts/{part["id"]}/render?sha256={part["sha256"]}'
        rejected = self.request('POST', path, body=backend.render_wav(part))
        self.assertEqual(rejected.status, 400)
        accepted = self.request('POST', path+'&channeleq=1', body=backend.render_wav(part))
        self.assertEqual(accepted.status, 200)
        self.assertEqual(accepted.response['song']['parts'][0]['render']['channelEqVersion'], 1)
        corrected = self.request('POST', path+'&channeleq=2', body=backend.render_wav(part))
        self.assertEqual(corrected.status, 200)
        self.assertEqual(corrected.response['song']['parts'][0]['render']['channelEqVersion'], 2)
        saved = self.request('POST', base+f'/parts/{part["id"]}/save?sha256={part["sha256"]}', body=backend.part_zip())
        self.assertEqual(saved.status, 200)
        self.assertNotIn('eqVersion', saved.response['song']['parts'][0])
