import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import Mock

SPEC=importlib.util.spec_from_file_location('instareel_test',pathlib.Path(__file__).resolve().parents[1]/'backend/mygrain_instareel.py')
REELS=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(REELS)

class ReelTests(unittest.TestCase):
 def test_account_paths_are_isolated_and_reject_symlinks(self):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);a=root/'alice';b=root/'bob';a.mkdir();b.mkdir()
   accounts=Mock();accounts.path_for.side_effect=lambda key,user:root/user['id']
   self.assertNotEqual(REELS.reel_root(accounts,{'id':'alice'}),REELS.reel_root(accounts,{'id':'bob'}))
   (a/'link').symlink_to(b,target_is_directory=True)
   with self.assertRaises(ValueError):REELS.checked(a/'link'/'private.wav',a)
   with self.assertRaises(ValueError):REELS.checked(b/'private.wav',a)
 def test_public_jobs_never_include_credentials_or_server_paths(self):
  public=REELS.public({'id':'a'*32,'state':'queued','message':'Ready','plan':{},'createdAt':1,'folder':'/private','owner':'someone','cookie':'SECRET','process':object()})
  self.assertEqual(set(public),{'id','state','message','plan','createdAt'})
  self.assertNotIn('SECRET',str(public))
 def test_plan_rounds_cycles_and_bounds_the_target(self):
  meta={'bpm':120,'patternSteps':16,'patternCycleMultiplier':1}
  self.assertEqual(REELS.plan(meta,45,'subtle',123)['duration'],46)
  for seconds in (0,29,61,float('nan'),float('inf')):
   with self.assertRaises(ValueError):REELS.plan(meta,seconds,'subtle',123)
 def test_job_and_library_reads_cannot_cross_account_scope(self):
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);(root/'alice').mkdir();(root/'bob').mkdir()
   accounts=Mock();accounts.path_for.side_effect=lambda key,user:root/user['id']
   handler=SimpleNamespace(mygrain_user={'id':'bob'},command='GET',path='/mygrain/api/instareel/'+'a'*32,send_json=Mock())
   REELS.JOBS[('alice','a'*32)]={'id':'a'*32,'owner':'alice','state':'done','folder':root/'alice'}
   try:
    REELS.handle(handler,accounts,Mock());self.assertEqual(handler.send_json.call_args.kwargs['status'],404)
   finally:REELS.JOBS.clear()
 def test_save_is_idempotent_and_retains_exact_wav_bytes(self):
  import contextlib,json
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as directory:
   wavs=pathlib.Path(directory);accounts=Mock();accounts.path_for.return_value=wavs;accounts.user_lock.side_effect=lambda user:contextlib.nullcontext()
   user={'id':'alice'};root=REELS.reel_root(accounts,user);ident='b'*32;folder=root/('job-'+ident);folder.mkdir();(folder/'reel.wav').write_bytes(b'EXACT-WAV');(folder/'preview.m4a').write_bytes(b'PREVIEW')
   job={'id':ident,'owner':'alice','state':'done','folder':folder,'plan':{'bpm':120,'duration':30,'variation':'subtle'}}
   handler=SimpleNamespace(mygrain_user=user,command='POST',path='/mygrain/api/instareel/'+ident+'/save',send_json=Mock(),read_json=lambda:{'name':'Keep Me'})
   REELS.JOBS[('alice',ident)]=job
   try:
    REELS.handle(handler,accounts,Mock());first=handler.send_json.call_args.args[0]['reel'];REELS.handle(handler,accounts,Mock());second=handler.send_json.call_args.args[0]['reel']
    self.assertEqual(first,second);self.assertEqual((wavs/first['filename']).read_bytes(),b'EXACT-WAV');self.assertEqual(len(json.loads((root/'library.json').read_text())),1);self.assertEqual(accounts.wav_created.call_count,2)
   finally:REELS.JOBS.clear()
 def test_cleanup_only_removes_expired_generated_scratch(self):
  import os,time
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);scratch=root/'job-123';scratch.mkdir();(scratch/'source.zip').write_bytes(b'private scratch');original=root/'INSTAREEL-original.wav';original.write_bytes(b'ORIGINAL')
   os.utime(scratch,(time.time()-REELS.TTL-10,)*2);REELS.cleanup(root)
   self.assertFalse(scratch.exists());self.assertEqual(original.read_bytes(),b'ORIGINAL')

if __name__=='__main__':unittest.main()
