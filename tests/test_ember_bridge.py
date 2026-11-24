import copy,json,os,pathlib,types,unittest
import test_ember as E
import test_ember_save_eq as Q
class EmberBridge(unittest.TestCase):
 def test_validation_and_unchanged_legacy_hashes(self):
  old=types.ModuleType('old_bridge');old.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),old.__file__,'exec'),old.__dict__)
  for recipe in [dict(E.recipe,enabled=True),dict(E.recipe,enabled=False),dict(E.recipe,enabled=True,crossMod=[False,False,False,False,True])]:
   data=E.body(recipe);self.assertEqual(old.validate_part_zip(data),E.s.validate_part_zip(data));self.assertEqual(E.s.validate_part_zip(data),E.s.validate_part_zip(E.body(dict(recipe,cableStrengthBypass=False))))
  for value in [None,0,1,'true',[],{}]:
   with self.assertRaises(ValueError):E.s.validate_ember(dict(E.recipe,cableStrengthBypass=value))
 def test_versions_zero_amount_and_content_identity_without_mutation(self):
  v=dict(E.recipe,enabled=True,cableStrengthBypass=True,cables=[dict(c,amount=0) for c in E.recipe['cables']]);before=copy.deepcopy(v);a=E.s.validate_part_zip(E.body(v));self.assertEqual(a['emberVersion'],10);self.assertEqual(v,before)
  self.assertEqual(a,E.s.validate_part_zip(E.body(dict(v,cables=[dict(c,amount=1) for c in v['cables']]))))
  self.assertNotIn('emberVersion',E.s.validate_part_zip(E.body(dict(v,cableStrengthBypass=False))))
  for change in [dict(enabled=False),dict(level=0),dict(cables=[])]:self.assertNotIn('emberVersion',E.s.validate_part_zip(E.body(dict(v,**change))))
 def test_real_upload_declaration_raw_get_guard_and_source_immutable(self):
  f=E.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=E.body(dict(E.recipe,enabled=True,cableStrengthBypass=True));base=f'/api/songs/{song["id"]}';reply=f.request('POST',base+'/parts?name=Bypass',body=source);self.assertEqual(reply.status,201);part=reply.response['song']['parts'][0];url=base+f'/parts/{part["id"]}';query=f'/render?sha256={part["sha256"]}';wav=E.fixtures.render_wav(part)
   for version in ['', '8','9','14']:self.assertEqual(f.request('POST',url+query+'&ember='+version,body=wav).status,400)
   current=f.request('POST',url+query+'&ember=10',body=wav);self.assertEqual(current.status,200);self.assertEqual(current.response['song']['parts'][0]['render']['emberVersion'],10)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=9;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(f.request('GET',url+'/render').status,404);self.assertEqual(f.request('POST',url+query+'&ember=9',body=wav).status,400);self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
   refreshed=f.request('POST',url+query+'&ember=10',body=wav);self.assertEqual(refreshed.status,200);self.assertEqual(refreshed.response['song']['revision'],revision)
  finally:f.tearDown()
 def test_private_library_retains_override_and_original_amounts(self):
  f=Q.EmberPatchLibrary();f.setUp()
  try:
   f.settings['ember']['cableStrengthBypass']=True;status,result,_=f.save();self.assertEqual(status,200);saved=result['patches'][0]['settings']['ember'];self.assertTrue(saved['cableStrengthBypass']);self.assertEqual(saved['cables'],f.settings['ember']['cables']);self.assertEqual(f.request()[1]['patches'],result['patches'])
  finally:f.doCleanups()
