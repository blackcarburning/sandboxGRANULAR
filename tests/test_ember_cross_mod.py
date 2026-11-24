import copy,json,unittest,importlib.util,os
from pathlib import Path
import test_ember as e
class EmberCrossMod(unittest.TestCase):
 def recipe(self):return dict(e.recipe,enabled=True,crossMod=[True,False,False,False,False],crossModDepth=.7)
 def test_validation_version_and_legacy_identity(self):
  a=self.recipe();before=copy.deepcopy(a);e.s.validate_ember(a);self.assertEqual(e.s.validate_part_zip(e.body(a))['emberVersion'],9);self.assertEqual(a,before)
  for key,values in [('crossMod',[None,[],[True]*4,[True]*6,[1]*5,'11111']),('crossModDepth',[None,True,-.01,1.01,float('nan'),float('inf')])]:
   for value in values:
    b=dict(a,**{key:value})
    with self.assertRaises(ValueError):e.s.validate_ember(b)
  for changes in [dict(crossMod=[False]*5),dict(crossModDepth=0)]:
   b=dict(a,**changes);old=copy.deepcopy(b);old.pop('crossMod');old.pop('crossModDepth');self.assertEqual(e.s.validate_part_zip(e.body(b)),e.s.validate_part_zip(e.body(old)))
  if os.environ.get('TASK'):
   path=Path(os.environ['TASK'])/'before/backend/mygrain_songs.py';import types;old=types.ModuleType('old_cross_backend');old.__file__=str(Path(e.s.__file__));exec(compile(path.read_text(),old.__file__,'exec'),old.__dict__)
   for seed in range(40):
    b=dict(e.recipe,enabled=True,frequencies=[110+seed,165,220,330,440],level=seed/40,cables=[{'from':'osc1','to':'directL','amount':.7},{'from':'osc2','to':'directR','amount':.7}])
    for lfo in [None,dict(enabled=True,wave='square',rate=.37,depth=.7,inverse=False,targets=[dict(key='level',inverse=False)]),dict(enabled=True,wave='sine',rate=.7,depth=.3,inverse=True,targets=[dict(key='freq1',inverse=True)],sync=dict(enabled=True,divide=8,multiply=3))]:
     v=dict(b,**(dict(lfo=lfo) if lfo else {}));body=e.body(v);previous=old.validate_part_zip(body);current=e.s.validate_part_zip(body)
     if previous.get('emberVersion'):self.assertEqual(current['emberVersion'],8);self.assertEqual(previous['contentSha256'],current['contentSha256'])
     else:self.assertEqual(previous,current)
 def test_current_admission_stale_get_and_immutable_source(self):
  f=e.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=e.body(self.recipe());reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=CrossMod&repeats=1',body=source);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0];self.assertEqual(p['emberVersion'],9);path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}'
   for decl in ['', '&ember=1', '&ember=2', '&ember=3', '&ember=4', '&ember=5', '&ember=6', '&ember=7', '&ember=8', '&ember=11']:self.assertEqual(f.request('POST',path+decl,body=e.fixtures.render_wav(p)).status,400)
   self.assertEqual(f.request('POST',path+'&ember=9',body=e.fixtures.render_wav(p)).status,200);folder,stored=e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=4;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',path).status,404);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),source);self.assertEqual(e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}))[1]['revision'],revision)
  finally:f.tearDown()
