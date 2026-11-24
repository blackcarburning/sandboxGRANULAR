"""Public-library grain construction. Admission/scratch are shared with Song workers."""
import hashlib
import json
import math
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import wave
from io import BytesIO

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
import mygrain_worker_pool as pool

APP = Path(__file__).resolve().parents[1]
DIVISIONS = ('4', '2', '1', '1/2', '1/4', '1/8', '1/16', '1/32', 'uncut')


def normalize_divisions(value):
    if not isinstance(value, list) or not 1 <= len(value) <= len(DIVISIONS) or any(
            not isinstance(item, str) or item not in DIVISIONS for item in value):
        raise ValueError('Choose supported Restructure slice divisions.')
    return ['uncut'] if 'uncut' in value else [item for item in DIVISIONS if item in value]


def build(payload, *, owner, list_files, fetch_bytes):
    if not isinstance(payload, dict) or payload.get('source', 'samples_public') != 'samples_public':
        raise ValueError('Restructure uses samples_public only.')
    bpm = float(payload.get('bpm', 120))
    if not math.isfinite(bpm) or not 30 <= bpm <= 300:
        raise ValueError('Restructure BPM must be between 30 and 300.')
    divisions = normalize_divisions(payload.get('divisions', ['1/16']))
    seed = str(payload.get('seed', ''))[:128]
    rng = random.Random(seed)
    # Fixed source key through the existing account-scoped resolver, never a caller path.
    files = list_files('samples_public')
    if not files:
        raise ValueError('samples_public is empty. Previous audio is unchanged.')
    rng.shuffle(files)
    lease = pool.acquire('restructure', owner, timeout=90)
    folder = None
    try:
        folder = pool.workspace('mygrain-restructure-')
        try:
            sources = []
            for name in files[:24]:
                data = fetch_bytes('samples_public', name)
                if len(data) > 32 * 1024**2:
                    continue
                # Bound decoded memory before either scipy or CUDA sees the recording.
                try:
                    with wave.open(BytesIO(data)) as wav:
                        if not (1 <= wav.getnchannels() <= 2 and 8000 <= wav.getframerate() <= 192000
                                and .025 <= wav.getnframes() / wav.getframerate() <= 30):
                            continue
                except (wave.Error, EOFError):
                    continue
                target = folder / f'source-{len(sources)}.wav'
                target.write_bytes(data)
                sources.append({'file': target.name, 'relativePath': name,
                                'sha256': hashlib.sha256(data).hexdigest()})
                if len(sources) == 8:
                    break
            if not sources:
                raise ValueError('No supported public WAV sources. Previous audio is unchanged.')
            (folder / 'input.json').write_text(json.dumps({'bpm': bpm, 'seed': seed, 'sources': sources, 'divisions': divisions}))
            executable = os.environ.get('MYGRAIN_GPU_PYTHON', str(APP / '.venv-gpu/bin/python'))
            result = subprocess.run([executable, str(APP / 'scripts/restructure-gpu.py'), str(folder)],
                                    cwd=APP, env=pool.child_env(folder), stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
            if result.returncode:
                print('Restructure GPU worker failed: ' + result.stderr.decode(errors='replace')[-2000:], file=sys.stderr)
                raise RuntimeError('GPU restructuring failed. Previous audio is unchanged; retry shortly.')
            metadata = json.loads((folder / 'result.json').read_text())
            return (folder / 'result.wav').read_bytes(), metadata
        finally:
            shutil.rmtree(folder)
    finally:
        lease.close()
