"""New voice admission, explicit melody and bounded worker failure boundaries."""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch
import wave
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import mygrain_robot as R
import mygrain_robot_voices as V
import mygrain_robot_engine_workers as E
import mygrain_speech_workers as W

class EngineTests(unittest.TestCase):
    def recipe(self,voice='diffsinger_qixuan',duration=9):
        return dict(version=1,enabled=True,level=.7,phrases=[dict(id='test',text='hello world',voice=voice,note=None,speed=170,enabled=True,melody={'bpm':60,'notes':[{'note':60,'beats':4},{'note':64,'beats':4}]},lanes=[dict(word='Sung phrase',offset=0,duration=duration,pattern=[1]+[0]*15)])])
    def test_extended_singing_range_is_not_a_legacy_migration(self):
        r=self.recipe();R.validate(r)
        r['phrases'][0]['voice']='male1';del r['phrases'][0]['melody']
        with self.assertRaises(ValueError):R.validate(r)
    def test_every_id_survives_backend_admission(self):
        for voice in V.VOICES:
            r=self.recipe(voice,.5)
            if voice!='diffsinger_qixuan':del r['phrases'][0]['melody']
            R.validate(r)
    def test_bad_scores_rejected_before_worker_lease(self):
        with patch.object(R.pool,'acquire') as acquire:
            for score in [None,{'bpm':120,'notes':[]},{'bpm':60,'notes':[{'note':400,'beats':1}]}]:
                with self.assertRaises(ValueError):R.build({'text':'hello','voice':'diffsinger_qixuan','melody':score,'speed':170})
            acquire.assert_not_called()
    def test_failed_new_engine_releases_shared_lease(self):
        lease=Mock()
        with patch.object(R.pool,'acquire',return_value=lease),patch.object(E,'render',side_effect=ValueError('fixture failure')):
            with self.assertRaisesRegex(ValueError,'fixture failure'):R.build({'text':'hello','voice':'sam_classic','speed':170},owner='private-fixture')
        lease.close.assert_called_once_with('failed')
    def test_new_engine_pcm_and_boundaries_checked(self):
        lease=Mock()
        with patch.object(R.pool,'acquire',return_value=lease),patch.object(E,'render',return_value={'audioBase64':base64.b64encode(b'not a wave').decode()}):
            with self.assertRaises((ValueError,wave.Error,EOFError)):R.build({'text':'hello','voice':'sam_classic','speed':170})
        lease.close.assert_called_once_with('failed')
    def test_switch_closes_previous_model_before_next_render(self):
        worker=Mock();worker.engine='bark'
        with patch.object(E,'WORKER',worker):E.render('qwen',{'voice':'qwen_ryan'})
        worker.close.assert_called_once();self.assertEqual(worker.engine,'qwen');worker.render.assert_called_once()
    def test_new_timeout_and_oversize_kill_worker(self):
        original=subprocess.Popen
        for child,timeout in [('import time;time.sleep(4)',.05),('import sys;sys.stdout.write("x"*(16*1024**2));sys.stdout.flush()',2)]:
            def start(*a,**kw):return original([sys.executable,'-u','-c',child],**kw)
            w=W.SpeechWorker('sam')
            try:
                with patch.object(W.subprocess,'Popen',side_effect=start),patch.object(W,'EXTRA_TIMEOUT',timeout):
                    with self.assertRaises(ValueError):w.render({'words':['hello']})
                self.assertIsNone(w.process)
            finally:w.close()
    def test_concurrent_engine_request_does_not_start_second_model(self):
        E.GATE.acquire()
        try:
            with patch.object(E,'WORKER') as w:
                with self.assertRaisesRegex(ValueError,'busy'):E.render('qwen',{})
                w.render.assert_not_called()
        finally:E.GATE.release()

if __name__=='__main__':unittest.main()
