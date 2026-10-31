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
 def test_protected_layers_survive_python_node_planning(self):
  meta={'bpm':120,'patternSteps':16,'patternCycleMultiplier':1}
  self.assertEqual(REELS.plan(meta,30,'subtle',123,{'protectedLayers':['V','L']})['options']['protectedLayers'],['V','L'])
  with self.assertRaises(ValueError):REELS.plan(meta,30,'subtle',123,{'protectedLayers':['foreign']})
 def test_plan_rounds_cycles_and_bounds_the_target(self):
  meta={'bpm':120,'patternSteps':16,'patternCycleMultiplier':1}
  self.assertEqual(REELS.plan(meta,45,'none',123)['duration'],45)
  self.assertEqual(REELS.plan(meta,45,'subtle',123)['duration'],46)
  self.assertEqual(REELS.plan(meta,30,'subtle',123,{'notes':True,'drums':True})['options'],{'notes':True,'drums':True,'recutV':False})
  self.assertEqual(REELS.plan(meta,30,'subtle',123)['fills'],[])
  self.assertEqual(REELS.plan(meta,30,'extreme',123)['variation'],'extreme')
  with self.assertRaises(ValueError):REELS.plan(meta,30,'unsupported',123)
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
 def test_mastering_sources_are_completed_owner_only_and_hash_verified(self):
  import contextlib, hashlib
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);(root/'alice').mkdir();(root/'bob').mkdir()
   accounts=Mock();accounts.path_for.side_effect=lambda key,user:root/user['id'];accounts.user_lock.side_effect=lambda user:contextlib.nullcontext()
   alice={'id':'alice'};bob={'id':'bob'};folder=REELS.reel_root(accounts,alice);ident='e'*32
   job_folder=folder/('job-'+ident);job_folder.mkdir();audio=job_folder/'reel.wav';audio.write_bytes(b'EXACT-REEL')
   job={'id':ident,'owner':'alice','state':'running','folder':job_folder};REELS.JOBS[('alice',ident)]=job
   try:
    with self.assertRaises(ValueError):REELS.mastering_source(accounts,alice,job_id=ident)
    job['state']='done';path,name=REELS.mastering_source(accounts,alice,job_id=ident);self.assertEqual(path.read_bytes(),b'EXACT-REEL')
    with self.assertRaises(ValueError):REELS.mastering_source(accounts,bob,job_id=ident)
    saved=REELS.saved_wavs(folder)/'Saved.wav';saved.write_bytes(audio.read_bytes())
    REELS.write_library(folder,[{'id':ident,'filename':saved.name,'sha256':hashlib.sha256(saved.read_bytes()).hexdigest()}])
    self.assertEqual(REELS.mastering_source(accounts,alice,library_id=ident)[0],saved)
    with self.assertRaises(ValueError):REELS.mastering_source(accounts,bob,library_id=ident)
    saved.write_bytes(b'CHANGED')
    with self.assertRaises(ValueError):REELS.mastering_source(accounts,alice,library_id=ident)
    with self.assertRaises(ValueError):REELS.mastering_source(accounts,alice,job_id='../escape')
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
    self.assertEqual(first,second);self.assertEqual((REELS.saved_wavs(root)/first['filename']).read_bytes(),b'EXACT-WAV');self.assertEqual(len(json.loads((root/'library.json').read_text())),1);self.assertEqual(accounts.wav_created.call_count,0);self.assertEqual(list(wavs.glob('*.wav')),[])
   finally:REELS.JOBS.clear()
 def test_saved_rename_delete_preserve_bytes_reject_conflicts_and_keep_recovery(self):
  import json,hashlib
  with tempfile.TemporaryDirectory() as directory:
   wavs=pathlib.Path(directory);root=wavs/'.instareel';root.mkdir();ident='c'*32;original='original.wav';data=b'EXACT-AUDIO'
   (wavs/original).write_bytes(data);(root/(ident+'.m4a')).write_bytes(b'PREVIEW')
   row={'id':ident,'name':'Original','filename':original,'bpm':120,'sha256':hashlib.sha256(data).hexdigest()}
   REELS.write_library(root,[row]);accounts=Mock()
   renamed=REELS.change_saved(root,wavs,ident,'rename',{'name':'New Name'},accounts)
   self.assertEqual((REELS.saved_wavs(root)/renamed['filename']).read_bytes(),data);self.assertFalse((wavs/original).exists());self.assertEqual(renamed['name'],'New Name')
   with self.assertRaises(FileNotFoundError):REELS.change_saved(root,wavs,'d'*32,'delete',{},accounts)
   conflict=REELS.saved_wavs(root)/f'INSTAREEL-Conflict-{ident[:8]}.120.wav';conflict.write_bytes(b'OTHER')
   with self.assertRaises(FileExistsError):REELS.change_saved(root,wavs,ident,'rename',{'name':'Conflict'},accounts)
   self.assertEqual(conflict.read_bytes(),b'OTHER');self.assertEqual(REELS.read_library(root,wavs)[0]['name'],'New Name')
   with self.assertRaises(ValueError):REELS.change_saved(root,wavs,ident,'rename',{'name':'////'},accounts)
   REELS.change_saved(root,wavs,ident,'delete',{},accounts)
   self.assertEqual(REELS.read_library(root,wavs),[]);self.assertFalse((REELS.saved_wavs(root)/renamed['filename']).exists());self.assertFalse((root/(ident+'.m4a')).exists())
   saved=list((root/'trash').glob('*'));self.assertEqual(len(saved),1);self.assertEqual((saved[0]/renamed['filename']).read_bytes(),data);self.assertEqual((saved[0]/'preview.m4a').read_bytes(),b'PREVIEW')
 def test_rename_rolls_back_if_library_write_fails(self):
  import hashlib
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as directory:
   wavs=pathlib.Path(directory);root=wavs/'.instareel';root.mkdir();ident='e'*32;source=REELS.saved_wavs(root)/'original.wav';source.write_bytes(b'PCM')
   REELS.write_library(root,[{'id':ident,'name':'Old','filename':source.name,'bpm':120,'sha256':hashlib.sha256(b'PCM').hexdigest()}])
   with patch.object(REELS,'write_library',side_effect=OSError('storage unavailable')):
    with self.assertRaises(OSError):REELS.change_saved(root,wavs,ident,'rename',{'name':'New'},Mock())
    with self.assertRaises(OSError):REELS.change_saved(root,wavs,ident,'delete',{},Mock())
   self.assertEqual(source.read_bytes(),b'PCM');self.assertEqual(REELS.read_library(root,wavs)[0]['name'],'Old');self.assertEqual(len(list(REELS.saved_wavs(root).glob('*.wav'))),1)
 def test_saved_action_errors_do_not_expose_filesystem_paths(self):
  import contextlib
  from types import SimpleNamespace
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as directory:
   accounts=Mock();accounts.path_for.return_value=pathlib.Path(directory);accounts.user_lock.side_effect=lambda user:contextlib.nullcontext()
   handler=SimpleNamespace(mygrain_user={'id':'alice'},command='POST',path='/mygrain/api/instareel/library/'+'f'*32+'/rename',read_json=lambda:{'name':'Conflict'},send_json=Mock())
   with patch.object(REELS,'change_saved',side_effect=FileExistsError(17,'File exists',directory+'/private.wav')):
    REELS.handle(handler,accounts,Mock())
   self.assertEqual(handler.send_json.call_args.kwargs['status'],400);self.assertNotIn(directory,str(handler.send_json.call_args));self.assertIn('already exists',handler.send_json.call_args.args[0]['error'])
 def test_legacy_reels_move_out_of_normal_wavs_only_when_record_and_hash_match(self):
  import hashlib
  with tempfile.TemporaryDirectory() as directory:
   wavs=pathlib.Path(directory);root=wavs/'.instareel';root.mkdir();name='INSTAREEL-legacy.wav';unrelated=wavs/'INSTAREEL-unrelated.wav';unrelated.write_bytes(b'KEEP')
   original=wavs/name;original.write_bytes(b'REEL');REELS.write_library(root,[{'id':'a'*32,'filename':name,'sha256':hashlib.sha256(b'REEL').hexdigest()}])
   self.assertEqual(len(REELS.read_library(root,wavs)),1);self.assertFalse(original.exists());self.assertEqual((REELS.saved_wavs(root)/name).read_bytes(),b'REEL');self.assertEqual(unrelated.read_bytes(),b'KEEP')
   self.assertEqual(len(REELS.read_library(root,wavs)),1)
   replacement=wavs/'changed.wav';replacement.write_bytes(b'OTHER');REELS.write_library(root,[{'id':'b'*32,'filename':replacement.name,'sha256':hashlib.sha256(b'REEL').hexdigest()}])
   self.assertEqual(REELS.read_library(root,wavs),[]);self.assertEqual(replacement.read_bytes(),b'OTHER')
 def test_cleanup_only_removes_expired_generated_scratch(self):
  import os,time
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);scratch=root/'job-123';scratch.mkdir();(scratch/'source.zip').write_bytes(b'private scratch');original=root/'INSTAREEL-original.wav';original.write_bytes(b'ORIGINAL')
   os.utime(scratch,(time.time()-REELS.TTL-10,)*2);REELS.cleanup(root)
   self.assertFalse(scratch.exists());self.assertEqual(original.read_bytes(),b'ORIGINAL')

if __name__=='__main__':unittest.main()
