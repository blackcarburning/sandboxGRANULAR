"""Real cross-process admission, cancellation, crash recovery and publication."""
import concurrent.futures
import hashlib
import multiprocessing
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
import mygrain_worker_pool as pool


def occupy(db, units, log, hold=.6, crash=False):
    os.environ['MYGRAIN_WORKER_DB'] = db
    lease = pool.acquire('test', 'credential-must-not-persist', units=units)
    with open(log, 'a') as out:
        out.write(f'{time.monotonic()} +{units}\n')
    if crash:
        os._exit(0)
    time.sleep(hold)
    with open(log, 'a') as out:
        out.write(f'{time.monotonic()} -{units}\n')
    lease.close()


class WorkerPoolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temp.name)/'queue.sqlite3')
        self.env = patch.dict(os.environ, {'MYGRAIN_WORKER_DB': self.db, 'MYGRAIN_MIN_AVAILABLE_MB': '0'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_twelve_processes_share_ten_actual_slots(self):
        log = str(Path(self.temp.name)/'events')
        # Initialize schema before concurrent processes, as deployment does.
        pool.status()
        with concurrent.futures.ProcessPoolExecutor(max_workers=12) as executor:
            list(executor.map(occupy, [self.db]*12, [1]*12, [log]*12))
        used = maximum = 0
        for stamp, delta in sorted(line.split() for line in Path(log).read_text().splitlines()):
            used += int(delta)
            maximum = max(maximum, used)
            self.assertLessEqual(used, 10)
        self.assertEqual((maximum, used), (10, 0))
        self.assertEqual(pool.status()['used'], 0)
        self.assertNotIn(b'credential-must-not-persist', Path(self.db).read_bytes())

    def test_two_deck_jobs_reserve_two_and_crash_releases_capacity(self):
        log = str(Path(self.temp.name)/'events')
        pool.status()
        child = multiprocessing.Process(target=occupy, args=(self.db, 2, log, .1, True))
        child.start();child.join(10)
        self.assertEqual(child.exitcode, 0)
        self.assertEqual(pool.status()['used'], 0)
        with sqlite3.connect(self.db) as c:
            self.assertEqual(c.execute('SELECT state FROM jobs').fetchone()[0], 'interrupted')
        a = pool.acquire('two', units=2)
        b = pool.acquire('two', units=2)
        try:
            self.assertEqual(pool.status()['used'], 4)
            with self.assertRaises(pool.Cancelled):
                pool.acquire('cancelled', cancelled=lambda: True)
            self.assertEqual(pool.status()['queued'], 0)
        finally:
            a.close();b.close()

    def test_queue_wait_does_not_enter_until_capacity_and_cancels(self):
        a = pool.acquire('half', units=4)
        b = pool.acquire('half', units=4)
        extra = pool.acquire('remainder', units=2)
        cancel = multiprocessing.Event()
        positions = []
        def wait():
            return pool.acquire('waiting', cancelled=cancel.is_set, waiting=positions.append)
        try:
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(wait)
                for _ in range(100):
                    if positions:break
                    time.sleep(.02)
                self.assertEqual(positions, [1])
                self.assertEqual(pool.status()['queued'], 1)
                cancel.set()
                with self.assertRaises(pool.Cancelled):future.result(5)
        finally:
            a.close();b.close();extra.close()

    def test_borrowed_slots_are_bounded_and_never_barge_past_waiting_work(self):
        leases = [pool.try_acquire('borrow', 'account-a') for _ in range(10)]
        self.assertTrue(all(leases))
        self.assertIsNone(pool.try_acquire('overflow'))
        leases.pop().close()
        positions, cancel = [], threading.Event()
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(pool.acquire, 'other-account-checkout', 'account-b', 2,
                                     cancel.is_set, positions.append)
            try:
                for _ in range(100):
                    if positions:
                        break
                    time.sleep(.01)
                self.assertEqual(positions, [1])
                self.assertEqual(pool.status()['used'], 9)
                # One slot is idle, but a waiting two-deck task has priority.
                self.assertIsNone(pool.try_acquire('must-not-jump-queue'))
                leases.pop().close()
                other = future.result(5)
                self.assertEqual(pool.status()['used'], 10)
                other.close()
            finally:
                cancel.set()
                for lease in leases:
                    lease.close()
        self.assertEqual(pool.status()['used'], 0)
        with patch.dict(os.environ, {'MYGRAIN_MIN_AVAILABLE_MB': '999999999'}):
            self.assertIsNone(pool.try_acquire('memory'))

    def test_memory_pressure_defers_new_work_and_mount_failure_is_closed(self):
        with patch.dict(os.environ, {'MYGRAIN_MIN_AVAILABLE_MB': '999999999'}):
            with self.assertRaises(TimeoutError):pool.acquire('memory', timeout=.1)
        with patch.dict(os.environ, {'MYGRAIN_SCRATCH_ROOT': '/scratch/mygrain/test'}), patch.object(Path, 'is_mount', return_value=False):
            with self.assertRaises(ValueError):pool.scratch_root()

    def test_cross_filesystem_publish_and_failed_copy_does_not_replace_saved_wav(self):
        with tempfile.TemporaryDirectory(dir='/scratch', prefix='mygrain-publish-test-') as work:
            source = Path(work)/'source.wav';source.write_bytes(os.urandom(512*1024))
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            dest = Path(self.temp.name)/'saved.wav'
            self.assertNotEqual(source.stat().st_dev, dest.parent.stat().st_dev)
            pool.publish_file(source, dest, 0o660)
            self.assertEqual(hashlib.sha256(dest.read_bytes()).hexdigest(), digest)
            self.assertFalse(source.exists())
            source.write_bytes(b'new')
            with patch.object(pool.shutil, 'copyfileobj', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):pool.publish_file(source, dest, 0o660)
            self.assertEqual(hashlib.sha256(dest.read_bytes()).hexdigest(), digest)
            self.assertEqual(list(dest.parent.glob('*.pending')), [])


if __name__ == '__main__':
    unittest.main()
