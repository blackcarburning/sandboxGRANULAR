"""A single switchable extra engine process: at most one large model resident.

The caller owns a shared host render lease. No PCM, text or account cache.
Legacy Kokoro workers remain unchanged and have their own small bounded pool.
"""
import atexit
import threading
from mygrain_speech_workers import SpeechWorker

WORKER = SpeechWorker()
GATE = threading.Lock()


def render(engine, payload):
    if not GATE.acquire(timeout=1):
        raise ValueError('Robot voice server is busy. Please retry shortly.')
    try:
        if WORKER.engine != engine:
            WORKER.close()
            WORKER.engine = engine
        return WORKER.render(payload)
    finally:
        GATE.release()


atexit.register(WORKER.close)
