"""V's two next-load libraries retain original PCM and legacy render identities."""
import importlib.util,json,pathlib,sys,types,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'fs7300-documenter'),str(ROOT/'sandboxGRANULAR/tests')]
spec=importlib.util.spec_from_file_location('vocal_library_server',ROOT/'fs7300-documenter/server.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
from test_song_backend import part_zip,rewrite_part
ai=s._ai_patch_module
class VocalLibraries(unittest.TestCase):
 def test_exact_edited_inventory_shared_for_accounts(self):
  expected=ROOT/'SAMPLES_NCRVOCALS/READY_TO_USE'
  self.assertEqual(s.get_bastardloop_local_source_root('samples_ncrvocals'),expected)
  for admin in [True,False]:
   with patch.object(s._accounts_module,'current_user',return_value={'id':'isolated','is_admin':admin}),patch.object(s.subprocess,'run',side_effect=AssertionError('No remote fallback')):
    files=s.list_bastardloop_source_files('samples_ncrvocals',force_refresh=True)
    self.assertEqual(len(files),3335);self.assertTrue(all(p.endswith('.wav') for p in files));self.assertFalse(any('ORIGINALS/' in p or '_work/' in p for p in files))
    chosen=files[0];self.assertEqual(s.fetch_bastardloop_sample_bytes('samples_ncrvocals',chosen),(expected/chosen).read_bytes())
 def test_source_boundary_does_not_expose_originals_or_traversal(self):
  for path in ['../REPORT.pdf','../ORIGINALS/test.wav','/etc/passwd','../../_work/PROCEDURE.md']:
   with self.subTest(path=path),self.assertRaises((ValueError,OSError,RuntimeError)):s.fetch_bastardloop_sample_bytes('samples_ncrvocals',path)
 def test_missing_new_pack_does_not_use_remote_or_old_collection(self):
  with patch.object(s,'resolve_existing_bastardloop_local_source_root',return_value=None),patch.object(s.subprocess,'run',side_effect=AssertionError('No remote fallback')):
   s.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE['samples_ncrvocals']={'files':[],'expires_at':0}
   self.assertEqual(s.list_bastardloop_source_files('samples_ncrvocals',force_refresh=True),[])
 def test_v_library_does_not_invalidate_stored_audio_render(self):
  body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(loopSampleRepositories={'A':'sampledrop','B':'sampledrop2','C':'splice_claw','W':'samples_modular'}))
  expected=s._song_module.validate_part_zip(body)
  for repository in ['samples_vocal','samples_ncrvocals']:
   new=rewrite_part(body,lambda m:m['state']['modes']['loopSampleRepositories'].update(V=repository));before=bytes(new)
   self.assertEqual(s._song_module.validate_part_zip(new),expected);self.assertEqual(new,before)
 def test_invalid_saved_v_library_rejected(self):
  for value in ['user_ftp','../ORIGINALS',False,{},None]:
   body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(loopSampleRepositories={'V':value}))
   with self.subTest(value=value),self.assertRaisesRegex(ValueError,'Loop V library'):s._song_module.validate_part_zip(body)
 def test_ai_inventory_accepts_selected_library_not_recipe_switches(self):
  current={k:v['min'] for k,v in ai.CONTROLS.items()};inventory={k:{'enabled':False,'loaded':False,'samples':[]} for k in ai.LOOPS}
  for repo in ['samples_ncrvocals','samples_vocal']:
   lanes={**inventory,'V':{**inventory['V'],'repository':repo}}
   self.assertEqual(ai.validate_request({'prompt':'vocals','current':current,'loops':lanes})[2]['V']['repository'],repo)
  with self.assertRaisesRegex(ValueError,'Loop V repository'):ai.validate_request({'prompt':'vocals','current':current,'loops':{**inventory,'V':{**inventory['V'],'repository':'user_ftp'}}})
  with self.assertRaises(ValueError):ai.validate_recipe({'title':'fixture','description':'fixture','parameters':{},'loops':{'V':{'repository':'samples_vocal','reload':True}}})
 def test_ai_uses_selected_v_repository_for_catalogue(self):
  current={k:v['min'] for k,v in ai.CONTROLS.items()};current['hpfCutoff']=20;current['lpfCutoff']=12000
  inventory={k:{'enabled':False,'loaded':False,'samples':[]} for k in ai.LOOPS}
  for repo in ['samples_ncrvocals','samples_vocal']:
   context={'status':'fallback','reason':'fixture','catalogueCount':0,'eligibleCount':0,'candidates':{},'entries':{},'sourceRoot':None}
   with patch.object(ai.catalogue,'retrieve',return_value=context) as retrieve,patch.object(ai.catalogue,'with_x_repository',side_effect=lambda c,*a:c),patch.object(ai,'run_model',return_value={'title':'fixture','parameters':{},'loops':{'V':{'enabled':True,'reload':True}}}):
    ai.generate('vocals',current,{**inventory,'V':{**inventory['V'],'repository':repo}})
    self.assertEqual(retrieve.call_args.kwargs['v_repository'],repo)
if __name__=='__main__':unittest.main()
