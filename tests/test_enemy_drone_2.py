import copy,json,subprocess,unittest,os,types,pathlib
from test_enemy_drone import source,fixture,ROOT
S=fixture.SONGS
NEW=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require('./enemy-drone-dsp.js').defaults()))"],cwd=ROOT,text=True));NEW['enabled']=True
OLD=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require('./enemy-drone-dsp.js').normalize({enabled:true})))"],cwd=ROOT,text=True))
class EnemyDrone2(unittest.TestCase):
 def test_identity_and_schema(self):
  prior=types.ModuleType('prior');prior.__file__=str(ROOT/'backend/mygrain_songs.py');exec(pathlib.Path(os.environ['ENEMY_BASELINE']).read_text(),prior.__dict__)
  self.assertEqual(prior.validate_part_zip(source(OLD)),S.validate_part_zip(source(OLD)))
  self.assertEqual(S.validate_part_zip(source(NEW))['enemyDroneVersion'],2)
  off=copy.deepcopy(NEW);off['enabled']=False;self.assertEqual(S.validate_part_zip(source(off)),S.validate_part_zip(source()))
  for change in [dict(engineRevision=3),dict(distortion={'drive':2,'mix':.5}),dict(distortion={'drive':.2}),dict(engineRevision=True)]:
   bad={**copy.deepcopy(NEW),**change}
   with self.assertRaises(ValueError):S.validate_part_zip(source(bad))
  bad=copy.deepcopy(OLD);bad['delay']['feedback']=.985
  with self.assertRaises(ValueError):S.validate_part_zip(source(bad))
  high=copy.deepcopy(NEW);high['delay']['feedback']=.985;high['reverb']['decay']=.995;S.validate_part_zip(source(high))
 def test_upload_and_stale_get(self):
  f=fixture.SongBackendTests();f.setUp()
  try:
   song=f.create();raw=source(NEW);r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Modern&repeats=1',body=raw);self.assertEqual(r.status,201);song=r.response['song'];p=song['parts'][0]
   url=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}&samplecuts=1'
   self.assertEqual(f.request('POST',url+'&enemy=1',body=fixture.render_wav(p)).status,400)
   r=f.request('POST',url+'&enemy=2',body=fixture.render_wav(p));self.assertEqual(r.status,200);self.assertEqual(r.response['song']['revision'],song['revision'])
   folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['enemyDroneVersion']=1;stored['parts'][0]['render']['enemyDroneVersion']=1;(folder/'song.json').write_text(json.dumps(stored))
   self.assertEqual(f.request('GET',url).status,404)
   self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),raw)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
