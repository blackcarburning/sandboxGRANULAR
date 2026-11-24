import copy,json,unittest,types,os
from pathlib import Path
import test_ember as e
class EmberClean(unittest.TestCase):
 def recipe(self):return dict(e.recipe,enabled=True)
 def test_all_audible_sources_require_v8(self):
  for from_ in ['osc1','pulse1','ring12','and1','noise','touch']:
   v=dict(self.recipe(),cables=[dict(from_=from_)])
   v['cables']=[{'from':from_,'to':'directL','amount':.7}]
   self.assertEqual(e.s.validate_part_zip(e.body(v))['emberVersion'],8)
   for inactive in [dict(v,enabled=False),dict(v,level=0),dict(v,cables=[])]:self.assertNotIn('emberVersion',e.s.validate_part_zip(e.body(inactive)))
 def test_legacy_ranges_and_current_modulation_fields_accepted_without_source_mutation(self):
  v=dict(self.recipe(),frequencies=[8000,4000,1200,.03,.01],pulseFrequencies=[2560,.01,None,17,55,110],pulseWidths=[.00001,.00005,.001,.005,.1,1],pulseCrossMod=[True,False,True,False,False,True],crossMod=[True,False,False,True,False],crossModDepth=1,lfo=dict(enabled=True,inverse=True,wave='triangle',rate=.37,depth=1,targets=[dict(key='width0',inverse=True),dict(key='lfoRate',inverse=False)],sync=dict(enabled=True,divide=8,multiply=3)))
  old=copy.deepcopy(v);e.s.validate_ember(v);self.assertEqual(v,old)
  for extra in [dict(frequencies=[float('nan')]*5),dict(pulseWidths=[0]*6),dict(pulseCrossMod=[1]*6),dict(crossModDepth=1.1),dict(pulseFrequencies=[2561]*6)]:
   with self.assertRaises(ValueError):e.s.validate_ember(dict(v,**extra))
 @unittest.skipUnless(os.environ.get('TASK'),'Exact previous backend required')
 def test_inactive_identities_remain_exact_previous_engine(self):
  path=Path(os.environ['TASK'])/'before/backend/mygrain_songs.py';old=types.ModuleType('old_clean_backend');old.__file__=str(Path(e.s.__file__));exec(compile(path.read_text(),old.__file__,'exec'),old.__dict__)
  for v in [dict(self.recipe(),enabled=False),dict(self.recipe(),level=0),dict(self.recipe(),cables=[])]:self.assertEqual(old.validate_part_zip(e.body(v)),e.s.validate_part_zip(e.body(v)))
 def test_v8_upload_admission_and_stale_get_use_original_snapshot_and_preserve_zip_revision(self):
  f=e.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=e.body(self.recipe());reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=CleanFixture&repeats=1',body=source);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0];self.assertEqual(p['emberVersion'],8);path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}';wav=e.fixtures.render_wav(p)
   for version in ['',1,2,3,4,5,6,7,11]:self.assertEqual(f.request('POST',path+('&ember='+str(version) if version!='' else ''),body=wav).status,400)
   self.assertEqual(f.request('POST',path+'&ember=8',body=wav).status,200);folder,stored=e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=7;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',path).status,404);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),source);self.assertEqual(e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}))[1]['revision'],revision)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
