import unittest
from test_q_piano import SONGS, fixture

class QSoundSources(unittest.TestCase):
    def external(self, source):
        state, assets = fixture()
        state['q'].update(soundSource=source, bank=None)
        return state, []

    def test_osc_needs_no_piano_bank(self):
        state, assets = self.external('osc')
        self.assertTrue(SONGS.validate_q_piano(state, assets))
        self.assertEqual(SONGS.q_render_version(state['q']), 9)

    def test_sample_requires_own_portable_audio(self):
        state, assets = self.external('sample')
        with self.assertRaisesRegex(ValueError, 'sample audio'):
            SONGS.validate_q_piano(state, assets)
        self.assertTrue(SONGS.validate_q_piano(state, [{'key':'qSourceSample'}]))
        with self.assertRaisesRegex(ValueError, 'sample audio'):
            SONGS.validate_q_piano(state, [{'key':'keyboardSample'}])

    def test_grain_requires_portable_source(self):
        state, assets = self.external('grain')
        with self.assertRaisesRegex(ValueError, 'grain audio'):
            SONGS.validate_q_piano(state, assets)
        self.assertTrue(SONGS.validate_q_piano(state, [{'key':'grainASample'}]))

    def test_legacy_and_invalid_source(self):
        state, assets = fixture()
        self.assertTrue(SONGS.validate_q_piano(state, assets))
        state['q']['soundSource']='unknown'
        with self.assertRaises(ValueError):
            SONGS.validate_q_piano(state, assets)

    def test_external_rejects_stale_piano_bank(self):
        state, assets=fixture()
        state['q']['soundSource']='osc'
        with self.assertRaisesRegex(ValueError, 'piano bank'):
            SONGS.validate_q_piano(state, assets)

    def test_q_copy_includes_own_sample(self):
        self.assertIn('qSourceSample', SONGS.LOOP_ASSETS['Q'])
