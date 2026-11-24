"""Process lifecycle and admission failure checks without a neural model."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import mygrain_speech_workers as W
import mygrain_robot as R

CHILD = '''import sys,json
for line in sys.stdin:
 p=json.loads(line)
 if p.get('timeout'):
  import time; time.sleep(5)
 if p.get('bad'):
  print(json.dumps({'error':'synthetic failure'}),flush=True);break
 print(json.dumps({'audioBase64':'eA==','voice':p.get('voice')}),flush=True)
'''


class SpeechWorkerTests(unittest.TestCase):
    def setUp(self):
        self.original = subprocess.Popen
        def start(*args, **kwargs):
            return self.original([sys.executable, '-u', '-c', CHILD], **kwargs)
        self.mock = patch.object(W.subprocess, 'Popen', side_effect=start)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.worker = W.SpeechWorker()
        self.addCleanup(self.worker.close)

    def test_worker_reuse_does_not_reuse_previous_response(self):
        self.assertEqual(self.worker.render({'voice':'one'})['voice'], 'one')
        process = self.worker.process
        self.assertEqual(self.worker.render({'voice':'two'})['voice'], 'two')
        self.assertIs(self.worker.process, process)

    def test_failure_discards_process_and_next_job_recovers(self):
        self.worker.render({'voice':'one'})
        process = self.worker.process
        with self.assertRaisesRegex(ValueError, 'synthetic failure'):
            self.worker.render({'bad':True})
        self.assertIsNotNone(process.poll())
        self.assertIsNone(self.worker.process)
        self.assertEqual(self.worker.render({'voice':'three'})['voice'], 'three')
        self.assertNotEqual(self.worker.process.pid, process.pid)

    def test_timeout_kills_worker(self):
        with patch.object(W, 'TIMEOUT', .1), self.assertRaisesRegex(ValueError, 'timed out'):
            self.worker.render({'timeout':True})
        self.assertIsNone(self.worker.process)

    def test_idle_worker_retires_without_killing_new_checkout(self):
        with patch.object(W, 'IDLE_SECONDS', .15):
            self.worker.render({'voice':'one'})
            old_generation = self.worker.generation
            self.worker.render({'voice':'two'})
            process = self.worker.process
            self.worker._expire(old_generation)
            self.assertIsNone(process.poll())
            time.sleep(.25)
            self.assertIsNotNone(process.poll())
            self.assertIsNone(self.worker.process)

    def test_neural_failure_releases_shared_worker_lease(self):
        lease = Mock()
        with patch.object(R.pool, 'acquire', return_value=lease) as admission, patch.object(R.speech_workers, 'render', side_effect=ValueError('render failed')):
            with self.assertRaisesRegex(ValueError, 'render failed'):
                R.build({'text':'hello', 'voice':'kokoro_af_nicole', 'speed':170},owner='private-owner')
            admission.assert_called_once_with('robot-speech', 'private-owner', timeout=90)
            lease.close.assert_called_once_with('failed')

    def test_invalid_neural_audio_cannot_be_saved(self):
        lease = Mock()
        with patch.object(R.pool,'acquire',return_value=lease), patch.object(R.speech_workers,'render',return_value={'audioBase64':base64.b64encode(b'not a wav').decode()}):
            with self.assertRaises((ValueError,wave.Error,EOFError)):
                R.build({'text':'hello','voice':'kokoro_af_nicole','speed':170},owner='private-owner')
            lease.close.assert_called_once_with('failed')


if __name__ == '__main__':
    unittest.main()
