"""Additive Q candidate settings; old Song archives need no conversion."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('q_quick_songs', pathlib.Path(__file__).resolve().parents[1] / 'backend' / 'mygrain_songs.py')
songs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(songs)

class QQuickControlsCompatibility(unittest.TestCase):
    def q(self):
        return {'version': 1, 'performanceVersion': 6, 'enabled': False, 'sequence': [None] * 64}

    def test_legacy_missing_field_is_accepted_without_mutation(self):
        q = self.q()
        self.assertFalse(songs.validate_q_piano({'q': q}, []))
        self.assertNotIn('paletteTranspose', q)

    def test_candidate_shift_round_trips_as_metadata_only(self):
        for shift in (-24, -1, 0, 1, 24):
            q = self.q()
            q['paletteTranspose'] = shift
            self.assertFalse(songs.validate_q_piano({'q': q}, []))
            self.assertEqual(q['paletteTranspose'], shift)
            self.assertEqual(q['sequence'], [None] * 64)

    def test_candidate_pitch_does_not_reinterpret_a_saved_playable_sample_bank(self):
        from test_q_piano import fixture
        state, assets = fixture()
        state['q']['paletteTranspose'] = 24
        self.assertTrue(songs.validate_q_piano(state, assets))
        self.assertEqual(state['q']['sequence'][0]['notes'], [48, 52, 55])

    def test_bad_candidate_shift_is_rejected(self):
        for value in (-25, 25, True, 1.5, '1', None):
            q = self.q()
            q['paletteTranspose'] = value
            with self.assertRaisesRegex(ValueError, 'candidate transpose'):
                songs.validate_q_piano({'q': q}, [])

if __name__ == '__main__':
    unittest.main()
