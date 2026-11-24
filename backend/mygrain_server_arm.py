"""Bounded loopback Chromium workers using the unchanged canonical app DSP."""
import atexit
import select
import json
import os
import pathlib
import shutil
import signal
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import sys
if str(pathlib.Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mygrain_worker_pool as pool

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'server-arm-worker.cjs'
LOCK = threading.RLock()
JOBS = {}
EXECUTOR = ThreadPoolExecutor(max_workers=pool.workers(), thread_name_prefix='mygrain-server-arm')
MAX_PENDING = 32 if pool.enabled() else 4
TTL = 15 * 60


def available():
    return SCRIPT.is_file() and pathlib.Path('/snap/bin/chromium').is_file() and shutil.which('node') is not None


def _public(job):
    return {key: job[key] for key in ('state', 'message', 'createdAt', 'updatedAt')}


_LOCAL = threading.local()
_WORKER_STATES = []


def worker_state():
    if not hasattr(_LOCAL, 'state'):
        from types import SimpleNamespace
        _LOCAL.state = SimpleNamespace(worker=None, pending=b'', last_used=0.0)
        with LOCK:
            _WORKER_STATES.append(_LOCAL.state)
    return _LOCAL.state


def close_worker(state=None):
    state = state or worker_state()
    if state.worker is not None:
        try:
            os.killpg(state.worker.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        state.worker.wait()
        state.worker.stdin.close()
        state.worker.stdout.close()
    state.worker, state.pending = None, b''


def close_all_workers():
    for state in list(_WORKER_STATES):
        close_worker(state)


atexit.register(close_all_workers)


def render(payload, timeout, stage=lambda message: None):
    """One persistent process per executor thread; fresh context per credential payload."""
    state = worker_state()
    # Retire before the Node idle deadline to avoid a write/idle-exit race.
    if state.worker is None or state.worker.poll() is not None or time.monotonic() - state.last_used >= 55:
        close_worker()
        state.worker = subprocess.Popen(['node', str(SCRIPT), '--persistent'], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   start_new_session=True, cwd=SCRIPT.parents[1], env=pool.child_env())
    try:
        state.worker.stdin.write((json.dumps(payload) + '\n').encode())
        state.worker.stdin.flush()
        deadline, result, error = time.monotonic() + timeout, None, None
        while True:
            if b'\n' not in state.pending:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([state.worker.stdout], [], [], remaining)[0]:
                    raise subprocess.TimeoutExpired('warm server renderer', timeout)
                chunk = os.read(state.worker.stdout.fileno(), 65536)
                if not chunk:
                    raise ValueError('Server audio worker exited. Arm Cache can retry.')
                state.pending += chunk
                if len(state.pending) > 1048576:
                    raise ValueError('Server audio worker response limit')
                continue
            line, state.pending = state.pending.split(b'\n', 1)
            message = json.loads(line)
            if 'stage' in message:
                stage(str(message['stage'])[:160])
            if 'result' in message:
                result = message['result']
            if 'error' in message:
                error = message['error']
            if message.get('idle'):
                if message.get('contexts') != 0:
                    raise ValueError('Server renderer did not release its account context')
                if error or not result:
                    raise ValueError(error or 'The server audio renderer failed. Arm Cache can retry.')
                state.last_used = time.monotonic()
                return result
    except Exception:
        close_worker()
        raise


def _run(key, payload, timeout):
    def stage(message):
        with LOCK:
            JOBS[key].update(message=message, updatedAt=time.time())
    lease = None
    try:
        lease = pool.acquire('song-arm', key[0], waiting=lambda position: stage(f'Queued for shared audio worker · position {position}'))
        with LOCK:
            JOBS[key].update(state='running', message='Preparing audio on the server', updatedAt=time.time())
        result = render(payload, timeout, stage)
        if result.get('sourceSha256') != payload['sourceSha256'] or result.get('partId') != payload['partId']:
            close_worker()
            raise ValueError('Server renderer returned a different saved part. Nothing was accepted.')
        with LOCK:
            JOBS[key].update(state='done', message='Server playback render ready', updatedAt=time.time())
    except subprocess.TimeoutExpired:
        with LOCK:
            JOBS[key].update(state='failed', message='Server audio preparation timed out. Saved source audio is unchanged; Arm Cache can retry.', updatedAt=time.time())
    except Exception as error:
        with LOCK:
            JOBS[key].update(state='failed', message=str(error)[:700], updatedAt=time.time())
    finally:
        payload.clear()
        if lease:
            lease.close('done' if JOBS[key]['state'] == 'done' else 'failed')


def status(scope, song_id, part_id, digest):
    with LOCK:
        job = JOBS.get((scope, song_id, part_id, digest))
        return _public(job) if job else {'state': 'missing', 'message': 'Server preparation was interrupted. Arm Cache can retry.', 'createdAt': 0, 'updatedAt': 0}


def start(scope, song_id, part, base_url, cookie, occurrence_id=None):
    if not available():
        raise ValueError('Server audio preparation is unavailable on this host.')
    if not cookie:
        raise ValueError('Sign into MYGRAIN before preparing audio on the server.')
    key = (scope, song_id, part['id'], part['sha256'])
    with LOCK:
        now = time.time()
        for old_key, job in list(JOBS.items()):
            if job['state'] in ('done', 'failed') and now - job['updatedAt'] > TTL:
                JOBS.pop(old_key)
        existing = JOBS.get(key)
        # A fresh POST means the client still needs a compatible render. A previous
        # completed result may have been removed or superseded without a new source
        # hash; do not pin that client to an unusable result until TTL expiry.
        if existing and existing['state'] in ('queued', 'running'):
            return _public(existing)
        if sum(job['state'] in ('queued', 'running') for job in JOBS.values()) >= MAX_PENDING:
            raise ValueError('The server audio queue is full. Try Arm Cache again after the current preparations finish.')
        if len(JOBS) >= 64:
            for old_key in list(JOBS):
                if JOBS[old_key]['state'] in ('done', 'failed'):
                    JOBS.pop(old_key)
                    break
        JOBS[key] = {'state': 'queued', 'message': 'Waiting for the server audio renderer', 'createdAt': now, 'updatedAt': now}
        payload = {'baseUrl': base_url, 'cookie': cookie, 'songId': song_id,
                   'partId': occurrence_id or part['id'], 'sourceSha256': part['sha256']}
        duration = part['patternSteps'] * part.get('patternCycleMultiplier', 1) * 60 / part['bpm'] / 4
        EXECUTOR.submit(_run, key, payload, min(600, max(120, duration * 3 + 90)))
        return _public(JOBS[key])
