import unittest
from test_q_piano import fixture, SONGS as songs

class QHoldingPenCompatibility(unittest.TestCase):
    def test_legacy_and_custom_marker_roundtrip(self):
        state, assets = fixture()
        self.assertTrue(songs.validate_q_piano(state, assets))
        self.assertNotIn('customChord', state['q']['sequence'][0])
        state['q']['sequence'][0]['customChord'] = True
        self.assertTrue(songs.validate_q_piano(state, assets))
        self.assertIs(state['q']['sequence'][0]['customChord'], True)
        self.assertEqual(state['q']['sequence'][0]['notes'], [48,52,55])
    def test_invalid_origin_rejected(self):
        for value in ['true', 1, None, {}]:
            state, assets = fixture()
            state['q']['sequence'][0]['customChord'] = value
            with self.assertRaisesRegex(ValueError, 'custom chord origin'):
                songs.validate_q_piano(state, assets)

    def test_old_and_new_song_part_archives_remain_compatible(self):
        import json, zipfile, wave
        from io import BytesIO
        for custom in [False, True]:
            state, assets = fixture()
            state.update(modes={}, globalBpm=120, patternLength=16)
            if custom: state['q']['sequence'][0].update(customChord=True, customChordId='saved-one', customChordColour=1375)
            assets[0]['path'] = 'audio/bastardQ.wav'
            snapshot = {'format':'mygrain-song-part','version':1,'state':state,'extra':{'sequencerSteps':[None]*16},'assets':assets}
            audio=BytesIO()
            with wave.open(audio,'wb') as output:
                output.setnchannels(2);output.setsampwidth(2);output.setframerate(44100);output.writeframes(bytes(1200))
            body=BytesIO()
            with zipfile.ZipFile(body,'w') as archive:
                archive.writestr('song-part.json',json.dumps(snapshot));archive.writestr('audio/bastardQ.wav',audio.getvalue())
            self.assertEqual(songs.validate_part_zip(body.getvalue())['qVersion'],1)
            with zipfile.ZipFile(BytesIO(body.getvalue())) as archive:
                restored=json.loads(archive.read('song-part.json'))['state']['q']['sequence'][0]
                self.assertEqual(restored.get('customChord',False),custom)
                self.assertEqual(restored['notes'],[48,52,55])
                if custom:
                    self.assertEqual(restored['customChordId'], 'saved-one')
                    self.assertEqual(restored['customChordColour'], 1375)
