"""One bounded loopback Chromium render at a time, using the existing app DSP."""
import json
import os
import pathlib
import shutil
import signal
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'server-arm-worker.cjs'
LOCK = threading.RLock()
JOBS = {}
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix='mygrain-server-arm')
MAX_PENDING = 4
TTL = 15 * 60


def available():
    return SCRIPT.is_file() and pathlib.Path('/snap/bin/chromium').is_file() and shutil.which('node') is not None


def _public(job):
    return {key: job[key] for key in ('state', 'message', 'createdAt', 'updatedAt')}


def _run(key, payload, timeout):
    with LOCK:
        JOBS[key].update(state='running', message='Preparing audio on the server', updatedAt=time.time())
    process = None
    try:
        process = subprocess.Popen(['node', str(SCRIPT)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, text=True, start_new_session=True, cwd=SCRIPT.parents[1])
        output, _ = process.communicate(json.dumps(payload), timeout=timeout)
        messages = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
        result = next((message['result'] for message in reversed(messages) if 'result' in message), None)
        if process.returncode or not result:
            error = next((message['error'] for message in reversed(messages) if 'error' in message), 'The server audio renderer failed. Arm Cache can retry.')
            raise ValueError(error)
        if result.get('sourceSha256') != payload['sourceSha256'] or result.get('partId') != payload['partId']:
            raise ValueError('Server renderer returned a different saved part. Nothing was accepted.')
        with LOCK:
            JOBS[key].update(state='done', message='Server playback render ready', updatedAt=time.time())
    except subprocess.TimeoutExpired:
        if process:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
        with LOCK:
            JOBS[key].update(state='failed', message='Server audio preparation timed out. Saved source audio is unchanged; Arm Cache can retry.', updatedAt=time.time())
    except Exception as error:
        with LOCK:
            JOBS[key].update(state='failed', message=str(error)[:700], updatedAt=time.time())
    # Credentials exist only in this task's stdin payload, never job status, argv or files.
    finally:
        payload.clear()


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
