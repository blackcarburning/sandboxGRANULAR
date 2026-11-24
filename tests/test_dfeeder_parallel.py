"""Real child-process scheduling with ordered publication and failure cleanup."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

backend = Path(__file__).resolve().parents[1] / 'backend'
sys.path.insert(0, str(backend))
spec = importlib.util.spec_from_file_location('parallel_dfeeder_fixture', backend / 'mygrain_dfeeder.py')
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

CHILD = '''
import json,sys,time,pathlib,os
for line in sys.stdin:
 w=json.loads(line);i=w['indices'][0]
 with open(w['events'],'a') as f:f.write(json.dumps([time.monotonic(),i,1,os.getpid()])+'\\n')
 print(json.dumps({'stage':str(i)}),flush=True)
 time.sleep(w.get('hold', .5 if w.get('fail')==i else .4 if i==0 else .12))
 if w.get('fail')==i:
  print(json.dumps({'error':'intentional renderer failure'}),flush=True);sys.exit(1)
 print(json.dumps({'sample':{'index':i,'bpm':w['bpms'][i]}}),flush=True)
 with open(w['events'],'a') as f:f.write(json.dumps([time.monotonic(),i,-1,os.getpid()])+'\\n')
 if w.get('dirty')==i:
  print(json.dumps({'idle':True,'contexts':1}),flush=True)
 elif w.get('noidle')==i:sys.exit(0)
 else:print(json.dumps({'idle':True,'contexts':0}),flush=True)
'''



class ParallelDfeederTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = self.root / 'scratch'
        self.folder.mkdir()
        self.env = patch.dict(os.environ, {'MYGRAIN_WORKER_DB': str(self.root / 'queue.sqlite3'),
                                          'MYGRAIN_MIN_AVAILABLE_MB': '0'})
        self.env.start()
        D.STOPPING.clear()
        self.job = dict(id='e'*32, ownerId='owner', username='fixture', count=10, completed=0,
                        bpms=list(range(100, 110)), files=[], state='queued', createdAt=time.time())
        self.worker = dict(id=self.job['id'], bpms=self.job['bpms'], outputDir=str(self.folder),
                           events=str(self.root/'events'), cookie='private-cookie')
        self.published = []
        original = subprocess.Popen
        self.popen = patch.object(D.subprocess, 'Popen', lambda args, **kw: original([sys.executable, '-c', CHILD], **kw))
        self.env_child = patch.object(D.pool, 'child_env', return_value=dict(os.environ))
        self.publish = patch.object(D, 'publish', side_effect=self.publish_sample)
        self.popen.start();self.env_child.start();self.publish.start()

    def tearDown(self):
        D.close_idle_workers()
        self.popen.stop();self.env_child.stop();self.publish.stop();self.env.stop()
        self.temp.cleanup()

    def publish_sample(self, root, job, item, library):
        self.assertEqual(item['bpm'], job['bpms'][item['index']])
        self.assertEqual(item['index'], len(self.published))
        self.published.append(item['index'])
        return f"loop-{item['index']}.wav"

    def test_ten_overlapping_children_publish_in_original_index_order(self):
        D.run(self.root, self.job, self.worker, None)
        self.assertEqual((self.job['state'], self.job['completed']), ('done', 10))
        self.assertEqual(self.published, list(range(10)))
        self.assertEqual(self.job['peakActiveWorkers'], 10)
        active = maximum = 0
        events = sorted(json.loads(line) for line in (self.root/'events').read_text().splitlines())
        for _, _, delta, _ in events:
            active += delta
            maximum = max(maximum, active)
            self.assertLessEqual(active, 10)
        self.assertEqual((active, maximum), (0, 10))
        self.assertGreater(self.job['startedAt'], self.job['createdAt'])
        self.assertEqual(D.pool.status()['used'], 0)
        self.assertEqual(self.worker, {})
        self.assertFalse(self.folder.exists())
        self.assertNotIn('private-cookie', D.job_path(self.root,self.job['id']).read_text())
        self.assertNotIn('private-cookie', (self.root/'queue.sqlite3').read_bytes().decode(errors='ignore'))

    def test_two_generations_share_ten_slots_without_exceeding_global_budget(self):
        other_folder = self.root / 'scratch-other'
        other_folder.mkdir()
        other_job = {**self.job, 'id': 'f'*32, 'ownerId': 'other-owner', 'files': []}
        other_worker = {**self.worker, 'id': other_job['id'], 'outputDir': str(other_folder),
                        'events': str(self.root/'events-other'), 'hold': .35}
        self.worker['hold'] = .35
        published = {self.job['id']: [], other_job['id']: []}
        def publish(root, job, item, library):
            self.assertEqual(item['index'], len(published[job['id']]))
            self.assertEqual(item['bpm'], job['bpms'][item['index']])
            published[job['id']].append(item['index'])
            return f"loop-{item['index']}.wav"
        D.publish.side_effect = publish
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(D.run, self.root, job, worker, None)
                       for job, worker in [(self.job, self.worker), (other_job, other_worker)]]
            for future in futures:
                future.result(timeout=15)
        events = []
        for job, filename in [(self.job, 'events'), (other_job, 'events-other')]:
            self.assertEqual((job['state'], job['completed']), ('done', 10))
            self.assertLessEqual(job['peakActiveWorkers'], 10)
            self.assertEqual(published[job['id']], list(range(10)))
            events.extend((stamp, job['id'], delta) for stamp, _, delta, _ in
                          (json.loads(line) for line in (self.root/filename).read_text().splitlines()))
        active = {self.job['id']: 0, other_job['id']: 0}
        maximum = 0
        for _, ident, delta in sorted(events):
            active[ident] += delta
            self.assertLessEqual(active[ident], 10)
            self.assertLessEqual(sum(active.values()), 10)
            maximum = max(maximum, sum(active.values()))
        self.assertEqual(maximum, 10)
        self.assertEqual(sum(active.values()), 0)
        self.assertEqual(D.pool.status()['used'], 0)

    def test_failed_child_stops_siblings_and_releases_all_slots(self):
        self.worker['fail'] = 4
        D.run(self.root, self.job, self.worker, None)
        self.assertEqual(self.job['state'], 'failed')
        self.assertGreater(self.job['completed'], 0)
        self.assertEqual(self.job['completed'], len(self.published))
        self.assertEqual(self.job['activeWorkers'], 0)
        self.assertEqual(D.pool.status()['used'], 0)
        self.assertEqual(D.pool.status()['queued'], 0)
        self.assertNotIn(self.job['id'], D.RUNNING)
        self.assertFalse(self.folder.exists())

    def test_warm_worker_reused_between_accounts_without_credentials_on_disk(self):
        self.job['count'] = 1
        D.run(self.root, self.job, self.worker, None)
        self.assertEqual(self.job['state'], 'done')
        self.assertEqual(self.job['warmWorkerStarts'], 1)
        self.assertEqual(len(D.WARM_IDLE), 1)
        pid = D.WARM_IDLE[0]['process'].pid
        self.folder.mkdir()
        other_job = {**self.job, 'id': 'f'*32, 'ownerId': 'other-owner', 'completed': 0, 'files': []}
        other_worker = dict(id=other_job['id'], bpms=other_job['bpms'], outputDir=str(self.folder),
                            events=str(self.root/'events-other'), cookie='different-private-cookie')
        self.published.clear()
        D.run(self.root, other_job, other_worker, None)
        self.assertEqual(other_job['state'], 'done')
        self.assertEqual((other_job['warmWorkerStarts'], other_job['warmWorkerReuses']), (0, 1))
        self.assertEqual(D.WARM_IDLE[0]['process'].pid, pid)
        self.assertNotIn('different-private-cookie', D.job_path(self.root, other_job['id']).read_text())

    def test_dirty_context_and_exit_without_idle_are_rejected(self):
        for flag in ['dirty', 'noidle']:
            self.folder.mkdir(exist_ok=True)
            self.job.update(completed=0, files=[], state='queued', count=1)
            self.worker.update(id=self.job['id'], bpms=self.job['bpms'], outputDir=str(self.folder),
                               events=str(self.root/'events'), cookie='private-cookie', **{flag: 0})
            self.published.clear()
            D.run(self.root, self.job, self.worker, None)
            self.assertEqual(self.job['state'], 'failed')
            self.assertEqual(self.published, [])
            self.assertEqual(D.WARM_IDLE, [])
            self.assertEqual(D.pool.status()['used'], 0)

    def test_expired_idle_worker_is_replaced(self):
        self.job['count'] = 1
        D.run(self.root, self.job, self.worker, None)
        old = D.WARM_IDLE[0]['process']
        D.WARM_IDLE[0]['last_used'] = 0
        deck, reused = D.borrow_warm_worker()
        try:
            self.assertFalse(reused)
            self.assertIsNotNone(old.poll())
            self.assertNotEqual(deck['process'].pid, old.pid)
        finally:
            D.close_warm_worker(deck)

    def test_shutdown_cancels_active_workers_and_destroys_idle_cache(self):
        self.worker['hold'] = 10
        thread = threading.Thread(target=D.run, args=(self.root, self.job, self.worker, None))
        thread.start()
        try:
            for _ in range(200):
                if D.RUNNING.get(self.job['id']):
                    break
                time.sleep(.01)
            self.assertTrue(D.RUNNING.get(self.job['id']))
            D.shutdown()
            thread.join(12)
            self.assertFalse(thread.is_alive())
            self.assertEqual(self.job['state'], 'failed')
            self.assertEqual(D.pool.status()['used'], 0)
            self.assertEqual(D.WARM_IDLE, [])
            self.assertNotIn(self.job['id'], D.RUNNING)
        finally:
            D.STOPPING.clear()

    def test_shutdown_cancels_queued_batch_without_consuming_cooldown(self):
        leases = [D.pool.acquire('external-work', units=n) for n in (4, 4, 2)]
        thread = threading.Thread(target=D.run, args=(self.root, self.job, self.worker, None))
        thread.start()
        try:
            for _ in range(200):
                if D.pool.status()['queued']:
                    break
                time.sleep(.01)
            self.assertNotIn('startedAt', self.job)
            D.shutdown()
            thread.join(5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(self.job['state'], 'failed')
            self.assertEqual(D.pool.status()['queued'], 0)
            self.assertEqual(D.pool.status()['used'], 10)
        finally:
            for lease in leases:
                lease.close()
            D.STOPPING.clear()


if __name__ == '__main__':
    unittest.main()
