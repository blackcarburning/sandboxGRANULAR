import copy,os,pathlib,types,unittest
import test_ember as E
import test_ember_save_eq as Q
class EmberDividers(unittest.TestCase):
 def test_validation_hash_defaults_and_legacy_exact(self):
  old=types.ModuleType('old_dividers');old.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),old.__file__,'exec'),old.__dict__)
  for v in [dict(E.recipe,enabled=True),dict(E.recipe,enabled=False),dict(E.recipe,enabled=True,crossMod=[False,False,False,False,True]),dict(E.recipe,enabled=True,cableStrengthBypass=True)]:
   self.assertEqual(old.validate_part_zip(E.body(v)),E.s.validate_part_zip(E.body(v)))
   self.assertEqual(E.s.validate_part_zip(E.body(v)),E.s.validate_part_zip(E.body(dict(v,oscDivider=1,pulseDivider=1))))
  for key in ['oscDivider','pulseDivider']:
   for ratio in [1,2,4,6,8,10,12,14,16]:
    v=dict(E.recipe,enabled=True,**{key:ratio});E.s.validate_ember(v);self.assertEqual(E.s.validate_part_zip(E.body(v))['emberVersion'],8 if ratio==1 else 11)
   for bad in [None,True,False,'2',0,3,17,2.5,[],{},float('nan'),float('inf')]:
    with self.assertRaises(ValueError):E.s.validate_ember(dict(E.recipe,**{key:bad}))
  v=dict(E.recipe,enabled=True,oscDivider=4,pulseDivider=6);before=copy.deepcopy(v);a=E.s.validate_part_zip(E.body(v));self.assertEqual(v,before);self.assertNotEqual(a['contentSha256'],E.s.validate_part_zip(E.body(dict(v,oscDivider=2)))['contentSha256'])
 def test_real_upload_raw_freshness_and_immutable_zip(self):
  f=E.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=E.body(dict(E.recipe,enabled=True,oscDivider=4,pulseDivider=6));base=f'/api/songs/{song["id"]}';reply=f.request('POST',base+'/parts?name=Divided',body=source);self.assertEqual(reply.status,201);part=reply.response['song']['parts'][0];self.assertEqual(part['emberVersion'],11);url=base+f'/parts/{part["id"]}';query=f'/render?sha256={part["sha256"]}';wav=E.fixtures.render_wav(part)
   for version in ['', '8','9','10','14']:self.assertEqual(f.request('POST',url+query+'&ember='+version,body=wav).status,400)
   current=f.request('POST',url+query+'&ember=11',body=wav);self.assertEqual(current.status,200);self.assertEqual(current.response['song']['parts'][0]['render']['emberVersion'],11)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=10;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(f.request('GET',url+'/render').status,404);self.assertEqual(f.request('POST',url+query+'&ember=10',body=wav).status,400);self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
   refreshed=f.request('POST',url+query+'&ember=11',body=wav);self.assertEqual(refreshed.status,200);self.assertEqual(refreshed.response['song']['revision'],revision)
  finally:f.tearDown()
 def test_private_library_retains_both_ratios(self):
  f=Q.EmberPatchLibrary();f.setUp()
  try:
   f.settings['ember'].update(oscDivider=8,pulseDivider=14);status,result,_=f.save();self.assertEqual(status,200);saved=result['patches'][0]['settings']['ember'];self.assertEqual((saved['oscDivider'],saved['pulseDivider']),(8,14));self.assertEqual(f.request()[1]['patches'],result['patches'])
  finally:f.doCleanups()
