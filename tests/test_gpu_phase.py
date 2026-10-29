"""Run CPU-path tests normally; MYGRAIN_TEST_CUDA=1 includes actual CUDA/audio benchmark."""
import importlib.util
import os
import pathlib
import sys
import time
import unittest
from unittest.mock import patch
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import mygrain_gpu_phase as GPU


class GpuPhaseTests(unittest.TestCase):
    def tearDown(self):
        GPU.close()

    def test_disabled_keeps_reference_path_and_allocates_no_worker(self):
        samples = np.zeros((96000, 2), np.float32)
        marker = object()
        with patch.dict(os.environ, {'MYGRAIN_GPU': 'off'}):
            self.assertIs(GPU.stretch(samples, .8, lambda *args: marker), marker)
        self.assertFalse(GPU.diagnostics()['running'])

    def test_small_and_extreme_work_keeps_cpu_path(self):
        marker = object()
        for samples, rate in [(np.zeros((100, 2), np.float32), .8), (np.zeros((96000, 2), np.float32), .1)]:
            self.assertIs(GPU.stretch(samples, rate, lambda *args: marker), marker)
        self.assertFalse(GPU.diagnostics()['running'])

    def test_busy_gpu_is_not_a_queue(self):
        GPU._lock.acquire()
        try:
            self.assertIsNone(GPU.phase(np.zeros((1025, 96), np.complex64), .8, 512, 2048, _allow_start=True))
        finally:
            GPU._lock.release()

    def test_missing_worker_uses_cpu_with_bounded_retry(self):
        with patch.dict(os.environ, {'MYGRAIN_GPU_PYTHON': '/no/such/cuda-python'}):
            before = GPU._stats['fallbacks']
            self.assertIsNone(GPU.phase(np.zeros((1025, 96), np.complex64), .8, 512, 2048, _allow_start=True))
            self.assertEqual(GPU._stats['fallbacks'], before + 1)
            self.assertGreater(GPU._retry_at, time.monotonic())
        GPU._retry_at = 0

    @unittest.skipUnless(os.environ.get('MYGRAIN_TEST_CUDA') == '1', 'optional CUDA runtime')
    def test_native_cuda_reconstruction_matches_reference(self):
        spec = importlib.util.spec_from_file_location('gpu_test_server', ROOT.parent / 'fs7300-documenter/server.py')
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        server._gpu_phase.close()
        rng = np.random.default_rng(8)
        samples = (rng.normal(size=(96000, 2)) * .06).astype(np.float32)
        GPU.phase(np.zeros((1025, 96), np.complex64), .9, 512, 2048, _allow_start=True)
        for rate in [.5, .83, 1.25, 2.]:
            original = server.time_stretch_audio_preserve_pitch_cpu(samples, rate)
            accelerated = GPU.stretch(samples, rate, server.time_stretch_audio_preserve_pitch_cpu)
            self.assertEqual(original.shape, accelerated.shape)
            snr = 10 * np.log10(np.mean(original ** 2) / np.mean((original - accelerated) ** 2))
            self.assertGreater(snr, 90)
            self.assertLess(float(np.max(np.abs(original - accelerated))), 2e-5)
        self.assertGreaterEqual(GPU.diagnostics()['gpuJobs'], 9)
        self.assertEqual(GPU.diagnostics()['lastError'], '')


if __name__ == '__main__':
    unittest.main()
