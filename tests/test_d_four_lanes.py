"""D's additive lanes, legacy identities and stale render admission."""
import copy, importlib.util, json, os, pathlib, unittest, zipfile
from io import BytesIO
import test_song_backend as fixture
S=fixture.SONGS

def part(d=None, keys=('bastardD',)):
    with zipfile.ZipFile(BytesIO(fixture.part_zip())) as z:
        manifest=json.loads(z.read('song-part.json'));audio=z.read('audio/bastardL.wav')
    manifest['state']['modes']['loopD']=d or {'enabled':True}
    manifest['assets']=[{'key':key,'path':f'audio/{key}.wav'} for key in keys]
    out=BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('song-part.json',json.dumps(manifest))
        for a in manifest['assets']:z.writestr(a['path'],audio)
    return out.getvalue()

def lanes():return [{'enabled':True,'level':1,'pan':0,'speed':1,'fill':'repeat','repository':'samples_loopstore','metadata':None} for _ in range(3)]

class DFour(unittest.TestCase):
    def test_legacy_default_and_maximiser_content_identity(self):
        spec=importlib.util.spec_from_file_location('d4_baseline',os.environ['MYGRAIN_D4_BASELINE']);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
        for d in [{'enabled':False},{'enabled':True},{'enabled':True,'maximiser':100}]:
            body=part(d);self.assertEqual(S.validate_part_zip(body),old.validate_part_zip(body))
        plain=part();neutral=part({'enabled':True,'mix':{'enabled':True,'level':1,'pan':0},'lanes':[{**v,'enabled':False} for v in lanes()]})
        self.assertEqual(S.validate_part_zip(plain),S.validate_part_zip(neutral))
    def test_version_and_validation(self):
        for keys in [('bastardD','bastardD2','bastardD3','bastardD4'),('bastardD2',)]:
            body=part({'enabled':True,'lanes':lanes()},keys);self.assertEqual(S.validate_part_zip(body)['loopDVersion'],3)
        self.assertEqual(S.validate_part_zip(part({'enabled':True,'mix':{'enabled':True,'level':.5,'pan':0}}))['loopDVersion'],3)
        for bad in [[],[{}],{},{'enabled':True}]:
            with self.assertRaises(ValueError):S.validate_part_zip(part({'enabled':True,'lanes':bad}))
        for field,value in [('speed',3),('pan',2),('level',float('nan')),('enabled',1),('repository','elsewhere')]:
            bad=lanes();bad[0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):S.validate_part_zip(part({'enabled':True,'lanes':bad}))
    def test_render_admission_and_stale_get(self):
        f=fixture.SongBackendTests();f.setUp()
        try:
            song=f.create();original=part({'enabled':True,'lanes':lanes()},('bastardD2',));reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=D4&repeats=1',body=original);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0]
            path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}&samplecuts=1'
            self.assertEqual(f.request('POST',path+'&loopd=2',body=fixture.render_wav(p)).status,400)
            saved=f.request('POST',path+'&loopd=3',body=fixture.render_wav(p));self.assertEqual(saved.status,200)
            folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0].pop('loopDVersion');stored['parts'][0]['render']['loopDVersion']=2;(folder/'song.json').write_text(json.dumps(stored))
            self.assertEqual(f.request('GET',path).status,404)
            self.assertEqual(f.request('POST',path+'&loopd=2',body=fixture.render_wav(p)).status,400)
            self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),original)
            self.assertEqual(saved.response['song']['revision'],song['revision']);self.assertEqual(saved.response['song']['parts'][0]['sha256'],p['sha256'])
        finally:f.tearDown()
if __name__=='__main__':unittest.main()
