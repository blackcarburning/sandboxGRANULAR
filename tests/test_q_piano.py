import copy
import importlib.util
import json
import pathlib
import unittest
import wave
import zipfile
from io import BytesIO


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'backend' / 'mygrain_songs.py'
SPEC = importlib.util.spec_from_file_location('q_song_validation', SOURCE)
SONGS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SONGS)


def fixture():
    samples = [{'id': 'C3v12', 'midi': 48, 'velocity': 95, 'offset': 0, 'frames': 100},
               {'id': 'Ds3v12', 'midi': 51, 'velocity': 95, 'offset': 100, 'frames': 100},
               {'id': 'Fs3v12', 'midi': 54, 'velocity': 95, 'offset': 200, 'frames': 100}]
    state = {'q': {'version': 1, 'enabled': True, 'transpose': 0, 'accentAmount': .25,
                   'sequence': [{'notes': [48, 52, 55], 'velocity': 96, 'gate': 4}] + [None] * 63,
                   'bank': {'version': 1, 'sampleRate': 44100, 'samples': samples}}}
    assets = [{'key': 'bastardQ', 'channels': 2, 'frames': 300, 'sampleRate': 44100}]
    return state, assets


class QPianoValidation(unittest.TestCase):
    def test_complete_polyphonic_bank_is_accepted(self):
        self.assertTrue(SONGS.validate_q_piano(*fixture()))

    def test_old_songs_have_no_q_requirement(self):
        self.assertFalse(SONGS.validate_q_piano({}, []))

    def test_default_empty_q_needs_no_sample_bank(self):
        self.assertFalse(SONGS.validate_q_piano({'q': {'version': 1, 'enabled': False, 'sequence': [None] * 64, 'bank': None}}, []))

    def test_missing_audio_and_orphan_audio_are_rejected(self):
        state, assets = fixture()
        for saved, audio in [(state, []), ({}, assets)]:
            with self.assertRaises(ValueError):
                SONGS.validate_q_piano(saved, audio)

    def test_incomplete_pitch_velocity_or_frame_inventory_is_rejected(self):
        state, assets = fixture()
        for mutate in [lambda saved: saved['q']['bank']['samples'].pop(),
                       lambda saved: saved['q']['bank']['samples'][1].update(velocity=64),
                       lambda saved: saved['q']['bank']['samples'][1].update(midi=52),
                       lambda saved: saved['q']['bank']['samples'][2].update(offset=100),
                       lambda saved: saved['q']['bank']['samples'][2].update(frames=500)]:
            with self.subTest(mutate=mutate):
                altered = copy.deepcopy(state)
                mutate(altered)
                with self.assertRaises(ValueError):
                    SONGS.validate_q_piano(altered, assets)

    def test_unknown_versions_and_invalid_notes_are_rejected(self):
        state, assets = fixture()
        for mutate in [lambda saved: saved['q'].update(version=2),
                       lambda saved: saved['q'].update(sequence=[]),
                       lambda saved: saved['q']['sequence'][0].update(notes=[0, 200]),
                       lambda saved: saved['q']['sequence'][0].update(velocity=128),
                       lambda saved: saved['q'].update(transpose=100)]:
            altered = copy.deepcopy(state)
            mutate(altered)
            with self.assertRaises(ValueError):
                SONGS.validate_q_piano(altered, assets)

    def test_mono_piano_bank_is_rejected(self):
        state, assets = fixture()
        assets[0]['channels'] = 1
        with self.assertRaises(ValueError):
            SONGS.validate_q_piano(state, assets)

    def test_accent_rounding_matches_javascript_at_velocity_layer_boundaries(self):
        state, assets = fixture()
        state['q']['accentAmount'] = .2125
        state['q']['sequence'][0].update(velocity=40, accent=True)
        for sample in state['q']['bank']['samples']:
            sample.update(id=sample['id'].replace('v12', 'v8'), velocity=64)
        self.assertTrue(SONGS.validate_q_piano(state, assets))

    def test_new_arp_settings_and_legacy_defaults_are_accepted(self):
        state, assets = fixture()
        state['q'].update(arpEnabled=True, arpPattern='updown', arpRepeat='until-next', arpDivision=1 / 6)
        self.assertTrue(SONGS.validate_q_piano(state, assets))

    def test_dotted_and_triplet_delay_settings_are_accepted(self):
        for beats in [1 / 12, 1 / 6, 1 / 3, .75, 1.5, 3, 6]:
            with self.subTest(beats=beats):
                state, assets = fixture()
                state['q'].update(room=1, delay=1, feedback=.8, delayBeats=beats)
                self.assertTrue(SONGS.validate_q_piano(state, assets))

    def test_invalid_effect_settings_are_rejected(self):
        for key, value in [('room', '1'), ('room', True), ('room', float('nan')), ('delay', 2), ('feedback', .9), ('delayBeats', 0), ('delayBeats', 7)]:
            with self.subTest(key=key, value=value):
                state, assets = fixture()
                state['q'][key] = value
                with self.assertRaises(ValueError):
                    SONGS.validate_q_piano(state, assets)

    def test_saved_parts_require_corrected_arp_freezes_and_preserve_block_compatibility(self):
        for enabled, room, expected_version in [(False, 0, 1), (True, 0, 3), (False, .2, 4), (True, 1, 4), (True, 0, 6)]:
            with self.subTest(arp_enabled=enabled, room=room):
                state, assets = fixture()
                state.update(modes={}, globalBpm=120, patternLength=16)
                state['q']['arpEnabled'] = enabled
                state['q']['room'] = room
                if expected_version == 6:
                    state['q'].update(performanceVersion=6, arpPattern='custom', arpSteps=[3, 0, 1])
                    state['q']['sequence'][1] = {'kind': 'accent', 'notes': [], 'accent': True}
                assets[0]['path'] = 'audio/bastardQ.wav'
                snapshot = {'format': 'mygrain-song-part', 'version': 1, 'state': state,
                            'extra': {'sequencerSteps': [None] * 16}, 'assets': assets}
                audio = BytesIO()
                with wave.open(audio, 'wb') as output:
                    output.setnchannels(2)
                    output.setsampwidth(2)
                    output.setframerate(44100)
                    output.writeframes(b'\0\0\0\0' * 300)
                archive = BytesIO()
                with zipfile.ZipFile(archive, 'w') as output:
                    output.writestr('song-part.json', json.dumps(snapshot))
                    output.writestr('audio/bastardQ.wav', audio.getvalue())
                self.assertEqual(SONGS.validate_part_zip(archive.getvalue())['qVersion'], expected_version)

    def test_invalid_arp_settings_are_rejected(self):
        for key, value in [('arpEnabled', 'yes'), ('arpPattern', 'random'), ('arpRepeat', 'forever'), ('arpDivision', 0), ('arpDivision', True), ('arpDivision', float('nan'))]:
            with self.subTest(key=key, value=value):
                state, assets = fixture()
                state['q'][key] = value
                with self.assertRaises(ValueError):
                    SONGS.validate_q_piano(state, assets)

    def test_custom_gaps_and_accent_only_cells_are_portable(self):
        state, assets = fixture()
        state['q'].update(performanceVersion=6, arpEnabled=True, arpPattern='custom', arpSteps=[3, 0, 1, 8])
        state['q']['sequence'][1] = {'kind': 'accent', 'notes': [], 'accent': True}
        self.assertTrue(SONGS.validate_q_piano(state, assets))
        for steps in [[], [True], [9], [1.2], [0] * 33]:
            invalid = copy.deepcopy(state)
            invalid['q']['arpSteps'] = steps
            with self.assertRaises(ValueError):
                SONGS.validate_q_piano(invalid, assets)
        invalid = copy.deepcopy(state)
        invalid['q']['sequence'][1]['accent'] = False
        with self.assertRaises(ValueError):
            SONGS.validate_q_piano(invalid, assets)

    def test_only_accent_markers_need_no_audio_bank(self):
        state = {'q': {'version': 1, 'enabled': True, 'sequence': [{'kind': 'accent', 'notes': [], 'accent': True}] + [None] * 63}}
        self.assertFalse(SONGS.validate_q_piano(state, []))


if __name__ == '__main__':
    unittest.main()
