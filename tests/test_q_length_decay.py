import copy
import json
import unittest
import wave
import zipfile
from io import BytesIO

from test_q_piano import SONGS, fixture


class QLengthDecayValidation(unittest.TestCase):
    def test_legacy_and_new_envelope_values_are_accepted(self):
        for settings in ({}, {'sampleLength': 1, 'sampleDecay': 1}, {'sampleLength': .05, 'sampleDecay': .3}):
            state, assets = fixture()
            state['q'].update(settings)
            self.assertTrue(SONGS.validate_q_piano(state, assets))

    def test_invalid_length_and_decay_are_rejected(self):
        for key in ('sampleLength', 'sampleDecay'):
            for value in (-1, 0, .049, 1.01, True, None, '.5', float('nan'), float('inf')):
                with self.subTest(key=key, value=value):
                    state, assets = fixture()
                    state['q'][key] = value
                    with self.assertRaises(ValueError):
                        SONGS.validate_q_piano(state, assets)

    def test_render_versions_preserve_old_parts_and_require_shortening_support(self):
        state, _ = fixture()
        for settings, expected in [({}, 1), ({'performanceVersion': 6}, 6), ({'performanceVersion': 6, 'sampleLength': 1, 'sampleDecay': 1}, 6), ({'sampleLength': .5}, 7), ({'sampleDecay': .3}, 7)]:
            piano = copy.deepcopy(state['q'])
            piano.update(settings)
            self.assertEqual(SONGS.q_render_version(piano), expected)

    def test_saved_part_zip_keeps_envelope_fields_and_requires_version_seven(self):
        state, assets = fixture()
        state.update(modes={}, globalBpm=120, patternLength=16)
        state['q'].update(sampleLength=.25, sampleDecay=.4)
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
        self.assertEqual(SONGS.validate_part_zip(archive.getvalue())['qVersion'], 7)


if __name__ == '__main__':
    unittest.main()
