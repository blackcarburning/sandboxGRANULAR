import copy,io,json,unittest,wave,zipfile
import test_robot_timing as timing
import test_song_backend as backend
S=backend.SONGS;R=S.ROBOT

def source(method='peakPower',strength=100):
    raw,_=timing.source(False)
    with zipfile.ZipFile(io.BytesIO(raw)) as z: files={n:z.read(n) for n in z.namelist()}
    m=json.loads(files['song-part.json']);r=m['state']['modes']['robot'];r['snap']={'method':method,'strength':strength,'maxShiftMs':100};p=r['phrases'][0];p['voice']='kokoro_af_heart';p['lanes'][0]['markers']={'peakPower':.0005,'attack':.0003,'manual':.0007};files['song-part.json']=json.dumps(m).encode();out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for name,data in files.items():z.writestr(name,data)
    return out.getvalue(),r

class RobotAlignmentTests(unittest.TestCase):
    def test_schema_and_identity(self):
        for method in ['peakPower','attack','manual']:
            raw,r=source(method);before=copy.deepcopy(r);R.validate(r);self.assertEqual(r,before);self.assertEqual(R.render_version(r),36);d=S.validate_part_zip(raw);self.assertEqual(d['emberVersion'],36);self.assertAlmostEqual(d['robotPreRollSeconds'],r['phrases'][0]['lanes'][0]['markers'][method])
        for key,value in [('method','bad'),('strength',101),('strength',True),('maxShiftMs',201),('maxShiftMs',float('nan'))]:
            _,r=source();r['snap'][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):R.validate(r)
        for value in [-1,.01,float('inf'),True]:
            _,r=source();r['phrases'][0]['lanes'][0]['markers']['manual']=value
            with self.subTest(marker=value),self.assertRaises(ValueError):R.validate(r)
        raw,r=source(strength=0);self.assertEqual(R.render_version(r),34);self.assertNotIn('robotPreRollSeconds',S.validate_part_zip(raw))
        old={'legacy': {'emberVersion': 34, 'bpm': 120.0, 'patternSteps': 16, 'patternCycleMultiplier': 2, 'audioAssets': 2, 'contentSha256': '22b54a91b4967649ba857716fc34fd8036f65791ea12ae51645ff936a018bfd7'}, 'locked': {'emberVersion': 35, 'bpm': 120.0, 'patternSteps': 16, 'patternCycleMultiplier': 2, 'audioAssets': 2, 'contentSha256': '2de74d8d0b63c5843c20556fb25c465b8076f53fc2cca495313878eede2f503d'}, 'missing': {'bpm': 120.0, 'patternSteps': 16, 'patternCycleMultiplier': 1, 'audioAssets': 1, 'contentSha256': '2fedf24cb4e550b67441e4a538471d6f30d2317a2046d841418769da10c60d7d'}}
        for name,body in [('legacy',timing.source(False)[0]),('locked',timing.source(True)[0]),('missing',backend.part_zip())]:self.assertEqual(S.validate_part_zip(body),old[name])
    def test_prefix_upload_recall_and_disable(self):
        raw,r=source();f=backend.SongBackendTests();f.setUp()
        try:
            song=f.create();reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Aligned&repeats=1',body=raw);self.assertEqual(reply.status,201,reply.response);p=reply.response['song']['parts'][0]
            b=io.BytesIO();rate=44100;frames=round(60/p['bpm']*p['patternSteps']/4*p.get('patternCycleMultiplier',1)*rate)+round(p['robotPreRollSeconds']*rate)
            with wave.open(b,'wb') as wav:wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(b'\0'*(frames*4))
            url=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}&samplecuts=1'
            self.assertEqual(f.request('POST',url+'&ember=35',body=b.getvalue()).status,400)
            reply=f.request('POST',url+'&ember=36',body=b.getvalue());self.assertEqual(reply.status,200,reply.response);self.assertEqual(reply.response['song']['parts'][0]['render']['robotPreRollFrames'],round(.0005*rate));self.assertEqual(f.request('GET',url).status,200)
            self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),raw)
            off=source(strength=0)[0];reply=f.request('POST',f'/api/songs/{song["id"]}/parts/{p["id"]}/save?repeats=1&sha256={p["sha256"]}',body=off);self.assertEqual(reply.status,200,reply.response);self.assertNotIn('robotPreRollSeconds',reply.response['song']['parts'][0])
        finally:f.tearDown()
if __name__=='__main__':unittest.main()
