import copy,io,json,unittest,zipfile
import test_song_backend as backend
S=backend.SONGS
R=S.ROBOT

def source(lock=True):
    raw=backend.part_zip()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        manifest=json.loads(z.read('song-part.json'));audio=z.read('audio/bastardL.wav')
    robot={'version':1,'enabled':True,'level':.7,'loopBars':2,'phrases':[{'id':'word','text':'hello','voice':'male1','note':None,'speed':210,'enabled':True,'lanes':[{'word':'hello','offset':0,'duration':.001,'pattern':[1]+[0]*15}]}]}
    if lock:robot['timingBars']=1
    manifest['state']['modes']['robot']=robot
    manifest['extra']['patternCycleMultiplier']=2
    manifest['assets'].append({'key':'robotWords','path':'audio/robotWords.wav','channels':1,'frames':128,'sampleRate':44100})
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('song-part.json',json.dumps(manifest));z.writestr('audio/bastardL.wav',audio);z.writestr('audio/robotWords.wav',audio)
    return out.getvalue(),robot

class RobotTimingTests(unittest.TestCase):
    def test_optional_span_validation(self):
        _,s=source()
        for v in [1,2,4,8,16]:R.validate({**s,'timingBars':v})
        for v in [None,True,0,3,32,'1',float('nan')]:
            with self.subTest(value=v),self.assertRaises(ValueError):R.validate({**s,'timingBars':v})
    def test_version_and_cycle(self):
        raw,s=source();before=copy.deepcopy(s);R.validate(s);self.assertEqual(s,before)
        self.assertEqual(R.render_version(s),35);self.assertEqual(R.cycle_steps(s,16),32)
        self.assertEqual(S.validate_part_zip(raw)['emberVersion'],35)
        self.assertEqual(S.validate_part_zip(source(False)[0])['emberVersion'],34)
        s['enabled']=False;self.assertEqual(R.render_version(s),0)
    def test_producer_and_get_admission_and_source_immutable(self):
        raw,s=source();f=backend.SongBackendTests();f.setUp()
        try:
            song=f.create();r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Timing&repeats=1',body=raw);self.assertEqual(r.status,201,r.response)
            song=r.response['song'];p=song['parts'][0];wav=backend.render_wav({**p,'patternSteps':p['patternSteps']*p.get('patternCycleMultiplier',1)});url=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}&samplecuts=1'
            for suffix in ['', '&ember=34']:self.assertEqual(f.request('POST',url+suffix,body=wav).status,400)
            r=f.request('POST',url+'&ember=35',body=wav);self.assertEqual(r.status,200,r.response);self.assertEqual(r.response['song']['parts'][0]['render']['emberVersion'],35)
            self.assertEqual(f.request('GET',url).status,200)
            folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['emberVersion']=34;stored['parts'][0]['render']['emberVersion']=34;(folder/'song.json').write_text(json.dumps(stored))
            self.assertEqual(f.request('GET',url).status,404)
            self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),raw)
        finally:f.tearDown()
if __name__=='__main__':unittest.main()
