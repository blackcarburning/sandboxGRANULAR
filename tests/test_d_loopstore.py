"""D's shared source, next-load selector and portable-audio compatibility."""
import json,os,pathlib,sys,tempfile,types,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2] if not os.environ.get('MYGRAIN_TEST_STAGE') else pathlib.Path('/root/.openclaw/workspace')
STAGE=pathlib.Path(os.environ.get('MYGRAIN_TEST_STAGE',ROOT))
SERVER=ROOT/'fs7300-documenter/server.py'
sys.path.insert(0,str(SERVER.parent));sys.path.insert(0,str(ROOT/'sandboxGRANULAR/tests'))
s=types.ModuleType('dstore_unit_server');s.__file__=str(SERVER);sys.modules[s.__name__]=s
exec(compile((STAGE/'fs7300-documenter/server.py').read_text(),str(SERVER),'exec'),s.__dict__)
old=types.ModuleType('dstore_before_songs');old.__file__=s._song_module.__file__
exec(compile(pathlib.Path(old.__file__).read_text(),old.__file__,'exec'),old.__dict__)
for module,name in [(s._song_module,'mygrain_songs.py'),(s._ai_patch_module,'mygrain_ai_patch.py')]:
 exec(compile((STAGE/'sandboxGRANULAR/backend'/name).read_text(),module.__file__,'exec'),module.__dict__)
ai=s._ai_patch_module;ai.SCHEMA=json.loads((STAGE/'sandboxGRANULAR/ai-patch-controls.json').read_text());ai.LOOPS=ai.SCHEMA['loops']
from test_song_backend import part_zip,rewrite_part
class DLoopStore(unittest.TestCase):
 def test_published_shared_wavs_only_and_fresh_arrivals(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder)/'shared';root.mkdir();(root/'one.wav').write_bytes(b'one')
   for path in ['.trash/old.wav','.pending-x/unfinished.wav','.metadata/private.wav','nested/not-published.wav']:
    p=root/path;p.parent.mkdir(exist_ok=True);p.write_bytes(b'not-published')
   outside=pathlib.Path(folder)/'outside.wav';outside.write_bytes(b'private');(root/'symlink.wav').symlink_to(outside)
   with patch.object(s._loopstore_module,'ROOT',root),patch.object(s.subprocess,'run',side_effect=AssertionError('No remote fallback')):
    self.assertEqual(s.list_bastardloop_source_files('samples_loopstore'),['one.wav'])
    (root/'two.wav').write_bytes(b'two');self.assertEqual(set(s.list_bastardloop_source_files('samples_loopstore')),{'one.wav','two.wav'})
    self.assertEqual(s.resolve_bastardloop_source_sample('samples_loopstore',relative_path='two.wav')['bytes'],b'two')
    for value in ['../outside.wav','.trash/old.wav','/outside.wav','symlink.wav','nested/not-published.wav']:
     with self.subTest(value=value),self.assertRaises((ValueError,OSError)):s.fetch_bastardloop_sample_bytes('samples_loopstore',value)
 def test_shared_root_does_not_depend_on_account_mirror(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);(root/'shared').mkdir();(root/'shared/one.wav').write_bytes(b'public-loop')
   with patch.object(s._loopstore_module,'ROOT',root/'shared'),patch.object(s,'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT',root/'other-account'):
    for user in [{'id':'a','is_admin':True},{'id':'b','is_admin':False}]:
     with patch.object(s._accounts_module,'current_user',return_value=user):
      self.assertEqual(s.get_bastardloop_local_source_root('samples_loopstore'),root/'shared')
      self.assertEqual(s.choose_bastardloop_source_sample('samples_loopstore')['bytes'],b'public-loop')
 def test_empty_store_does_not_fall_back_or_reuse_cache(self):
  with tempfile.TemporaryDirectory() as folder,patch.object(s._loopstore_module,'ROOT',pathlib.Path(folder)/'missing'),patch.object(s.subprocess,'run',side_effect=AssertionError('No remote fallback')):
   self.assertEqual(s.list_bastardloop_source_files('samples_loopstore'),[])
   with self.assertRaisesRegex(RuntimeError,'SAMPLES_LOOPSTORE is empty'):s.choose_bastardloop_source_sample('samples_loopstore')
 def test_store_bpm_is_available_without_changing_original_bytes(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);(root/'x.wav').write_bytes(b'original');(root/'.metadata').mkdir();(root/'.metadata/x.wav.json').write_text(json.dumps({'audio':{'bpm':137}}))
   with patch.object(s._loopstore_module,'ROOT',root):
    result=s.resolve_bastardloop_source_sample('samples_loopstore',relative_path='x.wav');self.assertEqual(result['bytes'],b'original');self.assertEqual(s.bastardloop_sample_response_headers(result)['X-Mygrain-Source-Bpm'],'137')
 def test_library_selection_keeps_legacy_render_identity_and_does_not_mutate(self):
  for enabled in [False,True]:
   legacy=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(loopD={'version':1,'enabled':enabled,'speed':.5,'metadata':{'sourceKey':'samples_loops','fileName':'legacy.wav'}}))
   expected=old.validate_part_zip(legacy)
   for repo in ['samples_loopstore','samples_loops']:
    body=rewrite_part(legacy,lambda m:m['state']['modes']['loopD'].update(repository=repo));before=bytes(body)
    self.assertEqual(s._song_module.validate_part_zip(body),expected);self.assertEqual(body,before)
 def test_unknown_saved_library_is_rejected(self):
  for repo in ['user_ftp','../private',False,{},[]]:
   body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(loopD={'repository':repo}))
   with self.subTest(repo=repo),self.assertRaisesRegex(ValueError,'Loop D library'):s._song_module.validate_part_zip(body)
 def test_ai_inventory_accepts_both_libraries_but_recipe_cannot_switch(self):
  current={k:v['min'] for k,v in ai.CONTROLS.items()};inventory={k:{'enabled':False,'loaded':False,'samples':[]} for k in ai.LOOPS}
  for repo in ['samples_loopstore','samples_loops']:
   lanes={**inventory,'D':{**inventory['D'],'repository':repo}};self.assertEqual(ai.validate_request({'prompt':'warm loops','current':current,'loops':lanes})[2]['D']['repository'],repo)
  with self.assertRaises(ValueError):ai.validate_recipe({'title':'Keep selected library','description':'No folder switching','parameters':{},'loops':{'D':{'repository':'samples_loops'}}})
  with self.assertRaisesRegex(ValueError,'Loop D repository'):ai.validate_request({'prompt':'warm loops','current':current,'loops':{**inventory,'D':{**inventory['D'],'repository':'user_ftp'}}})
if __name__=='__main__':unittest.main()
