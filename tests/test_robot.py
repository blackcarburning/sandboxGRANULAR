import array
import copy
import importlib.util
import io
import json
import pathlib
import sys
import types
import unittest
import wave
import zipfile

import test_song_backend as backend
S = backend.SONGS
R = S.ROBOT

class RobotTests(unittest.TestCase):
    def test_local_voices_and_word_ranges(self):
        for voice in R.VOICES:
            audio, info = R.build({'text': 'hello robot', 'voice': voice, 'note': 60})
            self.assertEqual(len(info['lanes']), 2)
            with wave.open(io.BytesIO(audio)) as wav:
                pcm = array.array('h', wav.readframes(wav.getnframes()))
                self.assertGreater(max(abs(n) for n in pcm), 1000)
                self.assertAlmostEqual(sum(l['duration'] for l in info['lanes']), len(pcm)/wav.getframerate())

    def test_key_pitch_matches_selected_notes(self):
        import numpy as np
        for note in (48, 60, 72):
            body, _ = R.build({'text': 'you', 'voice': 'male1', 'note': note, 'speed': 150})
            with wave.open(io.BytesIO(body)) as wav:
                rate = wav.getframerate()
                data = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(float)
            start = int(len(data) * .3)
            signal = data[start:start + int(.08 * rate)]
            signal -= signal.mean()
            correlation = np.correlate(signal, signal, 'full')[len(signal)-1:]
            target = 440 * 2 ** ((note - 69) / 12)
            low, high = int(rate / (target * 1.15)), int(rate / (target * .85))
            lag = low + np.argmax(correlation[low:high])
            correction = .5 * (correlation[lag-1] - correlation[lag+1]) / (correlation[lag-1] - 2 * correlation[lag] + correlation[lag+1])
            cents = 1200 * np.log2(rate / (lag + correction) / target)
            self.assertLess(abs(cents), 15)

    def test_bounded_speech_requests(self):
        for payload in [{'text':' '},{'text':'word '*17},{'text':'a'*49},{'text':'hello','voice':'../../file'},{'text':'hello','note':True},{'text':'hello','note':200},{'text':'hello','speed':500},{'text':'...'}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                R.build(payload)

    def test_old_and_off_render_identity(self):
        source = backend.part_zip()
        legacy = S.validate_part_zip(source)
        off = backend.rewrite_part(source, lambda s: s['state']['modes'].update(robot={'version':1,'enabled':False,'level':.7,'phrases':[]}))
        self.assertEqual(legacy['contentSha256'], S.validate_part_zip(off)['contentSha256'])
        self.assertEqual(S.ember_render_version({'modes':{}}), 0)

    def test_maximiser_validation(self):
        for value in (0, 42, 100):
            R.validate({'version':1, 'enabled':False, 'level':.7, 'phrases':[], 'maximiser':value})
        for value in (-1, 101, True, float('nan'), '50'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                R.validate({'version':1, 'enabled':False, 'level':.7, 'phrases':[], 'maximiser':value})

    def test_render_admission_reads_source_not_stale_markers(self):
        raw=backend.part_zip()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            manifest=json.loads(z.read('song-part.json'));audio=z.read('audio/bastardL.wav')
        manifest['state']['modes']['robot']={'version':1,'enabled':True,'level':.7,'phrases':[{'id':'word','text':'hello','voice':'male1','note':None,'speed':210,'enabled':True,'lanes':[{'word':'hello','offset':0,'duration':.001,'pattern':[1]+[0]*15}]}]}
        manifest['assets'].append({'key':'robotWords','path':'audio/robotWords.wav','channels':1,'frames':128,'sampleRate':44100})
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            z.writestr('song-part.json',json.dumps(manifest));z.writestr('audio/bastardL.wav',audio);z.writestr('audio/robotWords.wav',audio)
        raw=out.getvalue();f=backend.SongBackendTests();f.setUp()
        try:
            song=f.create();r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Robot&repeats=1',body=raw)
            self.assertEqual(r.status,201,r.response);song=r.response['song'];part=song['parts'][0]
            url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1'
            self.assertEqual(f.request('POST',url+'&ember=33',body=backend.render_wav(part)).status,400)
            r=f.request('POST',url+'&ember=34',body=backend.render_wav(part));self.assertEqual(r.status,200)
            folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}))
            stored['parts'][0]['emberVersion']=33;stored['parts'][0]['render']['emberVersion']=33
            (folder/'song.json').write_text(json.dumps(stored))
            self.assertEqual(f.request('GET',url).status,404)
            self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
        finally:f.tearDown()

    def test_natural_recipes_and_independent_loop_cycles(self):
        recipe = {'version':1, 'enabled':True, 'level':.7, 'loopBars':4,
                  'phrases':[{'id':'natural', 'text':'hello', 'voice':'kokoro_af_heart',
                  'note':None, 'speed':170, 'enabled':True, 'lanes':[
                  {'word':'hello', 'offset':0, 'duration':.5, 'pattern':[1]+[0]*15}]}]}
        R.validate(recipe)
        self.assertEqual(R.render_version(recipe), 34)
        self.assertEqual(R.cycle_steps(recipe, 128), 64)
        self.assertEqual(S.merged_pattern_cycle({'state':{'patternLength':16, 'modes':{'robot':recipe}}}), 4)
        S.validate_drum_roll_cycle({'modes':{'robot':recipe}}, 4, 16)
        with self.assertRaises(ValueError):
            S.validate_drum_roll_cycle({'modes':{'robot':recipe}}, 1, 16)
        for voice in R.KOKORO_VOICES:
            recipe['phrases'][0]['voice'] = voice
            R.validate(recipe)
        for length in (0, True, 3, 32):
            with self.subTest(length=length), self.assertRaises(ValueError):
                R.validate({**recipe, 'loopBars':length})
        with self.assertRaises(ValueError):
            R.build({'text':'hello', 'voice':'kokoro_af_heart', 'note':60})
        del recipe['loopBars']
        self.assertEqual(R.render_version(recipe), 34)
        self.assertEqual(R.cycle_steps(recipe, 128), 128)

    def test_chain_cycle_and_asset_validation(self):
        recipe = {'version':1,'enabled':True,'level':.7,'phrases':[{'id':str(i),'text':'hello','voice':'male1','note':None,'speed':210,'enabled':True,'lanes':[{'word':'hello','offset':0,'duration':.1,'pattern':[1]+[0]*15}]} for i in range(16)]}
        R.validate(recipe)
        self.assertEqual(S.ember_render_version({'modes':{'robot':recipe}}), 34)
        S.validate_drum_roll_cycle({'modes':{'robot':recipe}},16,16)
        for count in [3,5,7,9,11,13,15]:
            r=copy.deepcopy(recipe);r['phrases']=r['phrases'][:count]
            S.validate_drum_roll_cycle({'modes':{'robot':r}},count,16)
        with self.assertRaises(ValueError): R.validate_asset(recipe,[])
        with self.assertRaises(ValueError): R.validate_asset(recipe,[{'key':'robotWords','channels':1,'frames':100,'sampleRate':44100}])
        R.validate_asset(recipe,[{'key':'robotWords','channels':1,'frames':44100,'sampleRate':44100}])
        bad=copy.deepcopy(recipe);bad['phrases'][0]['lanes'][0]['pattern'][0]=5
        with self.assertRaises(ValueError): R.validate(bad)
        bad=copy.deepcopy(recipe);bad['phrases'].append(copy.deepcopy(recipe['phrases'][0]))
        with self.assertRaises(ValueError): R.validate(bad)

if __name__=='__main__':unittest.main()
