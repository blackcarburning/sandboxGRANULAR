import copy,json,types,pathlib,os,unittest
from test_enemy_drone import source,fixture,ROOT
from test_enemy_drone_living import BASE,DRIFT
S=fixture.SONGS
class EnemyPhase(unittest.TestCase):
 def test_neutral_identity_and_selective_version(self):
  old=types.ModuleType('old');old.__file__=str(ROOT/'backend/mygrain_songs.py');exec(pathlib.Path(os.environ['ENEMY_BASELINE']).read_text(),old.__dict__)
  for extra in [{},{'transpose':7},{'drift':DRIFT}]:
   s={**copy.deepcopy(BASE),**extra};a=S.validate_part_zip(source(s));self.assertEqual(a,old.validate_part_zip(source(s)))
   for phase in [0,360]:
    z=copy.deepcopy(s)
    for voice in z['voices']:voice['phase']=phase
    self.assertEqual(a,S.validate_part_zip(source(z)))
  s=copy.deepcopy(BASE);s['voices'][0]['phase']=90;self.assertEqual(S.validate_part_zip(source(s))['enemyDroneVersion'],5)
  s['enabled']=False;self.assertEqual(S.validate_part_zip(source(s)),S.validate_part_zip(source()))
  s['enabled']=True;s['voices'][0]['on']=False;self.assertEqual(S.validate_part_zip(source(s))['enemyDroneVersion'],2)
  neutral=copy.deepcopy(s);neutral['voices'][0].pop('phase');self.assertEqual(S.validate_part_zip(source(s)),S.validate_part_zip(source(neutral)))
 def test_strict_phase(self):
  for value in [None,True,'90',-1,360.1,float('nan'),float('inf')]:
   s=copy.deepcopy(BASE);s['voices'][0]['phase']=value
   with self.subTest(value=value),self.assertRaises(ValueError):S.validate_part_zip(source(s))
  for value in [0,90,137.5,360]:
   s=copy.deepcopy(BASE);s['voices'][0]['phase']=value;S.validate_part_zip(source(s))
 def test_producer5_persistence_and_original_source_gates(self):
  f=fixture.SongBackendTests();f.setUp()
  try:
   song=f.create();s=copy.deepcopy(BASE);s['voices'][0]['phase']=137;raw=source(s);r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Phase&repeats=1',body=raw);self.assertEqual(r.status,201);song=r.response['song'];part=song['parts'][0];self.assertEqual(part['enemyDroneVersion'],5)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1'
   for version in ['', '&enemy=1','&enemy=2','&enemy=3','&enemy=4','&enemy=8']:self.assertEqual(f.request('POST',url+version,body=fixture.render_wav(part)).status,400)
   r=f.request('POST',url+'&enemy=5',body=fixture.render_wav(part));self.assertEqual(r.status,200);self.assertEqual(r.response['song']['revision'],song['revision']);self.assertEqual(r.response['song']['parts'][0]['render']['enemyDroneVersion'],5);self.assertEqual(f.request('GET',url).status,200)
   folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['enemyDroneVersion']=4;stored['parts'][0]['render']['enemyDroneVersion']=4;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',url).status,404);self.assertEqual(f.request('POST',url+'&enemy=4',body=fixture.render_wav(part)).status,400);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
