import copy,json,unittest,types,os
from pathlib import Path
import test_ember as e
class EmberPulseEngine(unittest.TestCase):
 def recipe(self):return dict(e.recipe,enabled=True,cables=[{'from':'osc1','to':'directL','amount':.7},{'from':'osc2','to':'directR','amount':.7}])
 def test_optional_arrays_strict_validation_and_versions(self):
  a=self.recipe();self.assertEqual(e.s.validate_part_zip(e.body(a))['emberVersion'],8)
  for key,valid,invalid in [('pulseWidths',[.00001,.00005,.001,.005,.1,1],[None,[],[.005]*5,[True]*6,[-1]*6,[2]*6,[float('nan')]*6,[float('inf')]*6]),('pulseCrossMod',[True,False,False,True,False,False],[None,[],[True]*5,[1]*6,'111111'])]:
   v=dict(a,**{key:valid});before=copy.deepcopy(v);e.s.validate_ember(v);self.assertEqual(v,before)
   for bad in invalid:
    with self.assertRaises(ValueError):e.s.validate_ember(dict(a,**{key:bad}))
  for extra in [dict(pulseCrossMod=[True]*6),dict(cables=[{'from':'pulse1','to':'directL','amount':1}]),dict(cables=[{'from':'noise','to':'directL','amount':1}]),dict(lfo=dict(enabled=True,inverse=False,wave='triangle',rate=.2,depth=.5,targets=[dict(key='lfoRate',inverse=True),dict(key='width0',inverse=False)]))]:
   v=dict(a,**extra);self.assertEqual(e.s.validate_part_zip(e.body(v))['emberVersion'],9 if e.s.ember_cross_mod_active(v) else 8);self.assertNotIn('emberVersion',e.s.validate_part_zip(e.body(dict(v,enabled=False))))
 @unittest.skipUnless(os.environ.get('TASK'),'Exact before-backend artifact required')
 def test_changed_active_oscillator_and_unchanged_inactive_identity(self):
  path=Path(os.environ['TASK'])/'before/backend/mygrain_songs.py';old=types.ModuleType('old_pulse_backend');old.__file__=str(Path(e.s.__file__));exec(compile(path.read_text(),old.__file__,'exec'),old.__dict__)
  for level in [0,.37,1]:
   for enabled in [False,True]:
    v=dict(self.recipe(),level=level,enabled=enabled);previous=old.validate_part_zip(e.body(v));current=e.s.validate_part_zip(e.body(v))
    if previous.get('emberVersion'):self.assertEqual(current['emberVersion'],8);self.assertEqual(previous['contentSha256'],current['contentSha256'])
    else:self.assertEqual(previous,current)
    neutral=dict(v,pulseCrossMod=[False]*6,pulseWidths=[.005]*6);self.assertEqual(e.s.validate_part_zip(e.body(v)),e.s.validate_part_zip(e.body(neutral)))
 def test_admission_inspects_original_noise_source_and_does_not_rewrite_it(self):
  f=e.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();v=dict(self.recipe(),cables=[{'from':'noise','to':'directL','amount':1}]);source=e.body(v);reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=RetiredNoise&repeats=1',body=source);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0];self.assertEqual(p['emberVersion'],8);path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}';wav=e.fixtures.render_wav(p)
   for version in ['',1,2,3,4,5,6,7,11]:self.assertEqual(f.request('POST',path+('&ember='+str(version) if version!='' else ''),body=wav).status,400)
   self.assertEqual(f.request('POST',path+'&ember=8',body=wav).status,200);folder,stored=e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=6;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',path).status,404);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),source);self.assertEqual(e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}))[1]['revision'],revision)
  finally:f.tearDown()
