import copy,json,types,pathlib,os,unittest
from test_enemy_drone import source,fixture,ROOT
from test_enemy_drone_living import BASE
S=fixture.SONGS
LFO={'enabled':True,'depth':25,'rate':.125,'shape':'ramp','range':'up'}
class EnemyPitchLfo(unittest.TestCase):
 def test_identity_and_selective_version(self):
  old=types.ModuleType('old');old.__file__=str(ROOT/'backend/mygrain_songs.py');exec(pathlib.Path(os.environ['ENEMY_BASELINE']).read_text(),old.__dict__)
  for extra in [{},{'transpose':7},{'voices':[dict(x,phase=90) for x in BASE['voices']]}]:
   s={**copy.deepcopy(BASE),**extra};prior=old.validate_part_zip(source(s));self.assertEqual(prior,S.validate_part_zip(source(s)))
   for lfo in [dict(LFO,enabled=False),dict(LFO,depth=0)]:
    self.assertEqual(prior,S.validate_part_zip(source(dict(s,pitchLfo=lfo))))
  s=dict(copy.deepcopy(BASE),pitchLfo=LFO);self.assertEqual(S.validate_part_zip(source(s))['enemyDroneVersion'],6)
  s['enabled']=False;self.assertEqual(S.validate_part_zip(source(s)),S.validate_part_zip(source()))
 def test_strict_inventory(self):
  for key,values in {'enabled':[None,1],'depth':[None,True,'25',-1,101,float('nan'),float('inf')],'rate':[0,8.1,None,True],'shape':['sine',None],'range':['negative',None]}.items():
   for value in values:
    with self.subTest(key=key,value=value),self.assertRaises(ValueError):S.validate_part_zip(source(dict(copy.deepcopy(BASE),pitchLfo=dict(LFO,**{key:value}))))
  for shape in ['ramp','rectifiedSine','saw']:
   for mode in ['up','bipolar','down']:S.validate_part_zip(source(dict(copy.deepcopy(BASE),pitchLfo=dict(LFO,shape=shape,range=mode,depth=37.5))))
 def test_render_capability_and_stale_admission(self):
  f=fixture.SongBackendTests();f.setUp()
  try:
   song=f.create();raw=source(dict(copy.deepcopy(BASE),pitchLfo=LFO));r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=PitchLFO&repeats=1',body=raw);self.assertEqual(r.status,201);song=r.response['song'];part=song['parts'][0];self.assertEqual(part['enemyDroneVersion'],6)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1'
   for version in ['', '&enemy=1','&enemy=5','&enemy=8']:self.assertEqual(f.request('POST',url+version,body=fixture.render_wav(part)).status,400)
   self.assertEqual(f.request('POST',url+'&enemy=6',body=fixture.render_wav(part)).status,200);self.assertEqual(f.request('GET',url).status,200)
   folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['enemyDroneVersion']=5;stored['parts'][0]['render']['enemyDroneVersion']=5;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',url).status,404);self.assertEqual(f.request('POST',url+'&enemy=5',body=fixture.render_wav(part)).status,400);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
