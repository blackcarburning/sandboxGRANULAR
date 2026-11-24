import copy, json, pathlib, subprocess, types, unittest, zipfile, os
from io import BytesIO
import test_song_backend as fixture
S=fixture.SONGS
ROOT=pathlib.Path(__file__).resolve().parents[1]
DEFAULT=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require('./enemy-drone-dsp.js').normalize({})))"],cwd=ROOT,text=True))
def source(v=None):
    raw=fixture.part_zip()
    if v is None:return raw
    with zipfile.ZipFile(BytesIO(raw)) as z:
        manifest=json.loads(z.read('song-part.json')); audio=z.read('audio/bastardL.wav')
    manifest['state']['modes']['enemyDrone']=v
    out=BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('song-part.json',json.dumps(manifest));z.writestr('audio/bastardL.wav',audio)
    return out.getvalue()
class EnemyDrone(unittest.TestCase):
    def test_legacy_and_off_identity(self):
        old=types.ModuleType('enemy_baseline');old.__file__=str(ROOT/'backend/mygrain_songs.py');exec(pathlib.Path(os.environ['ENEMY_BASELINE']).read_text(),old.__dict__)
        self.assertEqual(old.validate_part_zip(source()),S.validate_part_zip(source()))
        self.assertEqual(S.validate_part_zip(source()),S.validate_part_zip(source(DEFAULT)))
    def test_validation(self):
        active=copy.deepcopy(DEFAULT);active['enabled']=True
        self.assertEqual(S.validate_part_zip(source(active))['enemyDroneVersion'],1)
        for field,value in [('detune',101),('level',float('nan')),('routing','oops'),('voices',[])]:
            bad=copy.deepcopy(active);bad[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):S.validate_part_zip(source(bad))
        bad=copy.deepcopy(active);bad['voices'][0]['note']=69.5
        with self.assertRaises(ValueError):S.validate_part_zip(source(bad))
    def test_admission_and_stale_get(self):
        f=fixture.SongBackendTests();f.setUp()
        try:
            song=f.create();active=copy.deepcopy(DEFAULT);active['enabled']=True;raw=source(active)
            r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Enemy&repeats=1',body=raw);self.assertEqual(r.status,201);song=r.response['song'];p=song['parts'][0]
            url=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}&samplecuts=1'
            self.assertEqual(f.request('POST',url,body=fixture.render_wav(p)).status,400)
            r=f.request('POST',url+'&enemy=1',body=fixture.render_wav(p));self.assertEqual(r.status,200);self.assertEqual(r.response['song']['revision'],song['revision'])
            folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0].pop('enemyDroneVersion');stored['parts'][0]['render'].pop('enemyDroneVersion');(folder/'song.json').write_text(json.dumps(stored))
            self.assertEqual(f.request('GET',url).status,404)
            self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),raw)
        finally:f.tearDown()
if __name__=='__main__':unittest.main()
