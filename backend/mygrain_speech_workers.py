"""Two reusable, isolated Robot speech processes; no utterance/disk cache.

Active jobs still take one host-wide MYGRAIN render lease. Idle processes have no
lease and retire after 45s, releasing model/CUDA allocations. Text stays on stdin.
"""
import atexit
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

CPU_PYTHON = '/opt/openclaw-kokoro/venv/bin/python'
CUDA_PYTHON = '/opt/openclaw-kokoro/venv-cuda/bin/python'
IDLE_SECONDS = 45
TIMEOUT = 90
EXTRA_TIMEOUT = 300


class SpeechWorker:
    def __init__(self, engine=None):
        self.engine = engine
        self.lock = threading.RLock()
        self.process = None
        self.responses = None
        self.timer = None
        self.generation = 0

    def _stop(self):
        if self.timer:
            self.timer.cancel()
            self.timer = None
        process, self.process = self.process, None
        if process:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            process.stdin.close()
            process.stdout.close()

    def close(self):
        with self.lock:
            self._stop()

    def _expire(self, generation):
        with self.lock:
            if self.generation == generation:
                self._stop()

    def _start(self):
        python = CUDA_PYTHON if Path(CUDA_PYTHON).is_file() else CPU_PYTHON
        if self.engine:
            folder = self.engine if self.engine in ('qwen', 'bark', 'diffsinger') else 'piper'
            python = '/opt/openclaw-robot/' + folder + '/venv/bin/python'
        env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
               'TOKENIZERS_PARALLELISM': 'false', 'PYTHONUNBUFFERED': '1'}
        if python == CPU_PYTHON:
            env['CUDA_VISIBLE_DEVICES'] = ''
        if self.engine:
            env.update(OMP_NUM_THREADS='2', MKL_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2')
        self.responses = responses = queue.Queue(maxsize=2)
        self.process = process = subprocess.Popen(
            ([python, str(Path(__file__).with_name('mygrain_robot_engine.py')), self.engine]
             if self.engine else [python, str(Path(__file__).with_name('mygrain_kokoro.py')), '--worker']),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)

        def read():
            try:
                while True:
                    line = process.stdout.readline(16 * 1024**2)
                    if not line:
                        break
                    if not line.endswith(b'\n'):
                        raise ValueError('Natural voice returned an oversized response.')
                    responses.put_nowait(json.loads(line))
            except (ValueError, OSError, queue.Full):
                pass
            finally:
                try:
                    responses.put_nowait({'error': 'Natural voice worker stopped. Please retry.'})
                except queue.Full:
                    pass

        threading.Thread(target=read, daemon=True, name='robot-speech-output').start()

    def render(self, payload):
        with self.lock:
            self.generation += 1
            if self.timer:
                self.timer.cancel()
                self.timer = None
            if self.process is None or self.process.poll() is not None:
                self._stop()
                self._start()
            started = time.monotonic()
            try:
                self.process.stdin.write(json.dumps(payload).encode() + b'\n')
                self.process.stdin.flush()
                result = self.responses.get(timeout=EXTRA_TIMEOUT if self.engine else TIMEOUT)
                if not isinstance(result, dict) or result.get('error') or not result.get('audioBase64'):
                    raise ValueError(result.get('error', 'Natural voice returned invalid audio.') if isinstance(result, dict) else 'Natural voice returned invalid audio.')
                result['serverSeconds'] = round(time.monotonic() - started, 3)
                if result.get('retire'):
                    self._stop()
                else:
                    self.timer = threading.Timer(IDLE_SECONDS, self._expire, (self.generation,))
                    self.timer.daemon = True
                    self.timer.start()
                return result
            except queue.Empty:
                self._stop()
                raise ValueError('Natural voice timed out. Try a shorter phrase.') from None
            except (OSError, ValueError):
                self._stop()
                raise


WORKERS = [SpeechWorker(), SpeechWorker()]
# Prefer an already-warm child; create the second process only under overlap.
AVAILABLE = queue.LifoQueue(maxsize=len(WORKERS))
for _worker in WORKERS:
    AVAILABLE.put(_worker)


def render(payload):
    try:
        worker = AVAILABLE.get(timeout=1)
    except queue.Empty:
        raise ValueError('Natural voice workers are busy. Please try again shortly.') from None
    try:
        return worker.render(payload)
    finally:
        AVAILABLE.put_nowait(worker)


def close():
    for worker in WORKERS:
        worker.close()


atexit.register(close)
