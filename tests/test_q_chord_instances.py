import unittest
from test_q_piano import fixture, SONGS as songs
class QChordInstanceCompatibility(unittest.TestCase):
    def test_legacy_and_new_identity(self):
        state, assets = fixture()
        self.assertTrue(songs.validate_q_piano(state, assets))
        step = state['q']['sequence'][0]
        step.update(customChord=True, customChordId='saved-one', customChordColour=1375)
        self.assertTrue(songs.validate_q_piano(state, assets))
        self.assertEqual(step['customChordId'], 'saved-one')
    def test_invalid_metadata(self):
        for key, value in [('customChordId','<bad>'),('customChordId',1),('customChordColour',True),('customChordColour',3600),('customChordColour',-1)]:
            state, assets = fixture()
            state['q']['sequence'][0].update(customChord=True)
            state['q']['sequence'][0][key] = value
            with self.assertRaisesRegex(ValueError, 'custom chord'):
                songs.validate_q_piano(state, assets)
