import io,json,unittest,zipfile
import test_song_backend as F
S=F.SONGS

def body(pan=None):
    with zipfile.ZipFile(io.BytesIO(F.part_zip())) as z: files={n:z.read(n) for n in z.namelist()}
    m=json.loads(files['song-part.json']);m['state']['modes']['drumMachineEnabled']=True
    if pan is not None:m['state']['modes']['drumPan']=pan
    files['song-part.json']=json.dumps(m).encode();out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for n,b in files.items():z.writestr(n,b)
    return out.getvalue()

class DrumPan(unittest.TestCase):
    def test_legacy_identity_and_neutral_optional_state(self):
        before=S.validate_part_zip(body());neutral=S.validate_part_zip(body({'version':1,'lanes':{},'hatSteps':[None,0]}))
        self.assertEqual(before,neutral)
        self.assertNotIn('drumPanVersion',before)
    def test_nondefault_version_and_validation(self):
        self.assertEqual(S.validate_part_zip(body({'version':1,'lanes':{'hat':.4,'roll':-1},'hatSteps':[-1,None,1,0]}))['drumPanVersion'],1)
        for bad in [{'version':True},{'version':1,'lanes':{'unknown':0}}, {'version':1,'hatSteps':[True]}, {'version':1,'lanes':{'hat':2}}, {'version':1,'hatSteps':[0]*65}]:
            with self.assertRaises(ValueError):S.validate_part_zip(body(bad))
    def test_render_capability_admission_stale_get_and_immutable_source(self):
        f=F.SongBackendTests();f.setUp()
        try:
            song=f.create();source=body({'version':1,'lanes':{'hat':.5},'hatSteps':[-1,1]});base=f'/api/songs/{song["id"]}'
            reply=f.request('POST',base+'/parts?name=Pan',body=source);self.assertEqual(reply.status,201)
            part=reply.response['song']['parts'][0];url=base+f'/parts/{part["id"]}';query=f'/render?sha256={part["sha256"]}';wav=F.render_wav(part)
            self.assertEqual(f.request('POST',url+query,body=wav).status,400)
            self.assertEqual(f.request('POST',url+query+'&drumpan=1',body=wav).status,200)
            folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('drumPanVersion');stored['parts'][0]['render'].pop('drumPanVersion');S.write_song(folder,stored,advance_revision=False)
            self.assertEqual(f.request('GET',url+'/render').status,404)
            self.assertEqual(f.request('POST',url+query,body=wav).status,400)
            self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
            result=f.request('POST',url+query+'&drumpan=1',body=wav);self.assertEqual(result.status,200);self.assertEqual(result.response['song']['revision'],revision)
        finally:f.tearDown()
if __name__=='__main__':unittest.main()
