import copy
import unittest
from test_q_piano import SONGS, fixture

class QChordHold(unittest.TestCase):
    def test_hold_validation_is_optional_and_strict(self):
        for value in (None, False, True):
            state, assets = fixture()
            if value is not None:
                state['q']['chordHold'] = value
            self.assertTrue(SONGS.validate_q_piano(state, assets))
        for value in ('true', 1, 0, None, [], {}):
            state, assets = fixture()
            state['q']['chordHold'] = value
            with self.assertRaises(ValueError):
                SONGS.validate_q_piano(state, assets)

    def test_hold_requires_new_render_but_arp_and_old_parts_keep_their_versions(self):
        original, _ = fixture()
        for settings, expected in [({}, 1), ({'performanceVersion': 6}, 6), ({'sampleLength': .3}, 7), ({'chordHold': True}, 8), ({'chordHold': True, 'sampleDecay': .3}, 8), ({'chordHold': True, 'arpEnabled': True}, 3), ({'chordHold': False}, 1)]:
            q = copy.deepcopy(original['q']); q.update(settings)
            self.assertEqual(SONGS.q_render_version(q), expected)

if __name__ == '__main__':
    unittest.main()
