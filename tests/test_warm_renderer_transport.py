"""Exercise real private IPC, process reuse, cleanup and retry without Chromium."""
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('transport_test', ROOT / 'backend/mygrain_server_arm.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.script = pathlib.Path(self.folder.name) / 'worker.cjs'
        self.script.write_text('''
const readline=require('node:readline');
(async()=>{for await(const line of readline.createInterface({input:process.stdin})){
 const job=JSON.parse(line);
 if(job.hang){await new Promise(r=>setTimeout(r,10000));continue}
 process.stdout.write(JSON.stringify({stage:'Rendering'})+'\\n');
 process.stdout.write(JSON.stringify({result:{partId:job.partId,sourceSha256:job.sourceSha256}})+'\\n');
 process.stdout.write(JSON.stringify({idle:true,contexts:job.leak?1:0})+'\\n');
}})();
''')
        self.patch = patch.object(service, 'SCRIPT', self.script)
        self.patch.start()

    def tearDown(self):
        service.close_worker()
        self.patch.stop()
        self.folder.cleanup()

    def test_reuse_but_reject_context_leak(self):
        job = {'partId': 'a', 'sourceSha256': 'b'}
        stages = []
        self.assertEqual(service.render(job, 2, stages.append), job)
        pid = service._worker.pid
        self.assertEqual(service.render(job, 2), job)
        self.assertEqual(service._worker.pid, pid)
        self.assertEqual(stages, ['Rendering'])
        with self.assertRaisesRegex(ValueError, 'release its account'):
            service.render(dict(job, leak=True), 2)
        self.assertIsNone(service._worker)
        service.render(job, 2)
        self.assertNotEqual(service._worker.pid, pid)

    def test_timeout_and_idle_retirement_recover(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            service.render({'hang': True}, .15)
        self.assertIsNone(service._worker)
        job = {'partId': 'a', 'sourceSha256': 'b'}
        service.render(job, 2)
        pid = service._worker.pid
        service._worker_last_used -= 56
        service.render(job, 2)
        self.assertNotEqual(service._worker.pid, pid)


if __name__ == '__main__':
    unittest.main()
