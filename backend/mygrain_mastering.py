"""Non-destructive, account-scoped offline LSP/FFmpeg mastering jobs."""
import concurrent.futures
import contextvars
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import wave

VERSION = 'lsp-1.2.14-ffmpeg-v1'
PRESETS = {'clean': (-16, 1.3, 30, 140), 'punch': (-14, 1.7, 25, 100), 'dense': (-11, 2.3, 12, 120), 'level': (-16, 1, 30, 140)}
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix='mastering')
LOCK = threading.Lock()
JOBS = {}
DELAYS = {}
MAX_BYTES = 64 * 1024 * 1024


def run(args, timeout=180):
    try:
        result = subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-v', 'info', '-threads', '1', '-filter_threads', '1', '-y', *args], capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ValueError('Mastering timed out. The original is unchanged.') from None
    if result.returncode:
        raise ValueError('Audio processing failed. The original is unchanged.')
    return result


def measure(path):
    with wave.open(str(path), 'rb') as wav:
        duration = wav.getnframes() / wav.getframerate()
    repeats = math.ceil(3 / duration) - 1 if duration < 3 else 0
    result = run(['-stream_loop', str(repeats), '-i', str(path), '-af', 'loudnorm=I=-16:TP=-1:print_format=json', '-f', 'null', '-'])
    text = result.stderr.decode(errors='replace')
    data = json.loads(text[text.rfind('{'):text.rfind('}') + 1])
    return {key: float(data[field]) for key, field in [('lufs', 'input_i'), ('truePeakDb', 'input_tp')]}


def lv2(name, controls):
    return "lv2=p='http\\://lsp-plug.in/plugins/lv2/" + name + "':c='" + controls + "'"


def chain(preset, gain):
    _, ratio, attack, release = PRESETS[preset]
    filters = [f'volume={gain}dB']
    if preset not in ('clean', 'level'):
        filters.append(lv2('compressor_stereo', f'al=0.251189|cr={ratio}|at={attack}|rt={release}|sla=0|mk=1|cwt=1|cdr=0'))
    elif preset == 'clean':
        filters.append(lv2('compressor_stereo', 'al=0.354813|cr=1.3|at=30|rt=140|sla=0|mk=1|cwt=1|cdr=0'))
    if preset != 'level':
        filters.append(lv2('limiter_stereo', 'alr=0|boost=0|th=0.870964|ovs=16|lk=5|slink=100'))
    return ','.join(filters)


def latency(rate, preset, folder):
    key = (rate, preset)
    with LOCK:
        known = DELAYS.get(key)
    if known is not None:
        return known
    path = folder / 'impulse.wav'
    samples = [0] * rate
    samples[rate // 4] = 100
    with wave.open(str(path), 'wb') as out:
        out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        out.writeframes(struct.pack('<%dh' % rate, *samples))
    result = run(['-i', str(path), '-af', 'aformat=channel_layouts=stereo,' + chain(preset, 0), '-f', 'f32le', '-'])
    values = struct.unpack('<%df' % (len(result.stdout) // 4), result.stdout)[::2]
    delay = max(range(len(values)), key=lambda i: abs(values[i])) - rate // 4
    if not 0 <= delay <= rate // 5:
        raise ValueError('Unexpected plugin latency; mastering was not saved.')
    with LOCK:
        DELAYS[key] = delay
    return delay


def process(source, output, preset='clean', loop=True):
    if preset not in PRESETS or type(loop) is not bool:
        raise ValueError('Invalid mastering settings.')
    with tempfile.TemporaryDirectory(prefix='mygrain-master-audio-') as temporary:
        folder = Path(temporary)
        decoded = folder / 'decoded.wav'
        # Decode at the source sample rate; stereo is the mastering contract.
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)], capture_output=True, timeout=15)
        if probe.returncode:
            raise ValueError('Invalid WAV audio.')
        info = json.loads(probe.stdout)
        streams = [s for s in info.get('streams', []) if s.get('codec_type') == 'audio']
        if len(streams) != 1 or not 8000 <= int(streams[0]['sample_rate']) <= 96000 or int(streams[0]['channels']) not in (1, 2):
            raise ValueError('Use a mono/stereo WAV at 8–96 kHz.')
        rate = int(streams[0]['sample_rate'])
        duration = float(info.get('format', {}).get('duration', 0))
        if not .05 <= duration <= 600 or duration * rate * 6 > MAX_BYTES - 1024:
            raise ValueError('Mastering supports up to 10 minutes and 64 MB of stereo PCM24 output.')
        run(['-i', str(source), '-map', '0:a:0', '-ac', '2', '-ar', str(rate), '-c:a', 'pcm_s24le', str(decoded)])
        with wave.open(str(decoded), 'rb') as wav:
            frames = wav.getnframes()
        before = measure(decoded)
        if not all(math.isfinite(v) for v in before.values()):
            raise ValueError('No measurable audio. The original is unchanged.')
        gain = min(12, max(-24, PRESETS[preset][0] - before['lufs']))
        if preset == 'level':
            gain = min(gain, -1.2 - before['truePeakDb'])
        delay = latency(rate, preset, folder)
        warm_frames = math.ceil(max(2 * rate, frames) / frames) * frames if loop else 0
        # Repeat the source to settle envelope state, then take one exact cycle.
        # Full Songs instead start at zero and flush the lookahead with silence.
        filtered = folder / 'processed.wav'
        filters = chain(preset, gain) + f',atrim=start_sample={warm_frames + delay}:end_sample={warm_frames + delay + frames},asetpts=PTS-STARTPTS'
        args = ['-stream_loop', '-1', '-i', str(decoded)] if loop else ['-i', str(decoded)]
        if not loop:
            filters = f'apad=pad_len={delay + 1024},' + filters
        # atrim bounds the otherwise infinite loop input.
        run([*args, '-af', filters, '-t', str(frames / rate), '-ar', str(rate), '-ac', '2', '-c:a', 'pcm_s24le', str(filtered)])
        after = measure(filtered)
        correction = min(0, -1.05 - after['truePeakDb'])
        if correction < 0:
            run(['-i', str(filtered), '-af', f'volume={correction}dB', '-c:a', 'pcm_s24le', str(output)])
        else:
            shutil.copyfile(filtered, output)
        after = measure(output)
        with wave.open(str(output), 'rb') as wav:
            if wav.getnframes() != frames or wav.getframerate() != rate:
                raise ValueError('Mastered length verification failed.')
            first = wav.readframes(1)
            wav.setpos(frames - 1)
            last = wav.readframes(1)
            seam = max(abs(int.from_bytes(first[i:i+3], 'little', signed=True) - int.from_bytes(last[i:i+3], 'little', signed=True)) / 8388608 for i in (0, 3))
        if not all(math.isfinite(v) for v in after.values()) or after['truePeakDb'] > -1.0:
            raise ValueError('Mastered peak verification failed.')
        return {'engine': VERSION, 'preset': preset, 'loop': loop, 'frames': frames, 'sampleRate': rate, 'latencySamples': delay, 'seamStep': seam, 'before': before, 'after': after, 'comparisonGain': min(1, 10 ** ((before['lufs'] - after['lufs']) / 20)), 'originalGain': min(1, 10 ** ((after['lufs'] - before['lufs']) / 20)), 'gainDb': gain}


def handle(handler, method, inner, accounts, user, root, checked):
    """Called after the normal authenticated/identity-pinned API gate."""
    owner = user['id']
    root = Path(root)
    if inner == '/api/mastering' and method == 'POST':
        payload = handler.read_json()
        if not isinstance(payload, dict):
            raise ValueError('Expected mastering settings.')
        name, preset, loop = payload.get('filename'), payload.get('preset', 'clean'), payload.get('loop', True)
        if not isinstance(name, str) or not name or name.startswith('.') or '/' in name or '\\' in name or Path(name).suffix.lower() != '.wav' or preset not in PRESETS or type(loop) is not bool:
            raise ValueError('Invalid mastering request.')
        with LOCK:
            now = time.time()
            for key in list(JOBS):
                if JOBS[key]['status'] != 'running' and now - JOBS[key]['created'] > 3600:
                    del JOBS[key]
            if len(JOBS) >= 256:
                return handler.send_json({'ok': False, 'error': 'Mastering queue is full. Try later.'}, status=429)
            if sum(j['status'] == 'running' for j in JOBS.values()) >= 4 or any(j['owner'] == owner and j['status'] == 'running' for j in JOBS.values()):
                return handler.send_json({'ok': False, 'error': 'A mastering job is already running. Please wait.'}, status=429)
            job_id = secrets.token_hex(16)
            job = {'owner': owner, 'created': now, 'status': 'running'}
            JOBS[job_id] = job
        try:
            with accounts.user_lock(user):
                source = checked(Path(root) / name, root)
                if not source.is_file() or source.stat().st_size > MAX_BYTES:
                    raise ValueError('WAV missing or over 64 MB.')
                temp = tempfile.TemporaryDirectory(prefix='mygrain-master-job-')
                snapshot = Path(temp.name) / 'source.wav'
                shutil.copyfile(source, snapshot)
            digest = hashlib.sha256(snapshot.read_bytes() + json.dumps([VERSION, preset, loop]).encode()).hexdigest()
        except Exception:
            with LOCK:
                JOBS.pop(job_id, None)
            raise

        def worker():
            try:
                cache = checked(Path(root) / '.mastering-cache', root)
                cache_file = checked(cache / (digest + '.json'), root)
                with accounts.user_lock(user):
                    if cache_file.is_file():
                        try:
                            entry = json.loads(cache_file.read_text())
                            saved = entry['savedName']
                            if '/' not in saved and '\\' not in saved and not saved.startswith('.'):
                                target = checked(Path(root) / saved, root)
                                if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == entry['sha256']:
                                    with LOCK:
                                        job.update(status='done', savedName=saved, report=entry['report'], cacheHit=True)
                                    return
                        except (ValueError, KeyError, OSError):
                            pass
                output = Path(temp.name) / 'master.wav'
                report = process(snapshot, output, preset, loop)
                # Content-addressed, private result. Never replace an original or
                # attach an editable patch that misrepresents the mastered DSP.
                saved = f'{Path(name).stem[:100]}.master-{preset}-{digest[:16]}.wav'
                with accounts.user_lock(user):
                    target = checked(Path(root) / saved, root)
                    if target.exists() and target.read_bytes() != output.read_bytes():
                        saved = f'{Path(name).stem[:90]}.master-{preset}-{secrets.token_hex(8)}.wav'
                        target = checked(Path(root) / saved, root)
                    staging = checked(Path(root) / ('.master-' + job_id), root)
                    try:
                        shutil.copyfile(output, staging)
                        os.replace(staging, target)
                    finally:
                        staging.unlink(missing_ok=True)
                    accounts.wav_created(saved)
                    cache.mkdir(mode=0o700, exist_ok=True)
                    cache_file.write_text(json.dumps({'savedName': saved, 'report': report, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
                with LOCK:
                    job.update(status='done', savedName=saved, report=report)
            except Exception as error:
                with LOCK:
                    job.update(status='error', error=str(error) if isinstance(error, ValueError) else 'Mastering failed. The original is unchanged.')
            finally:
                temp.cleanup()
        POOL.submit(contextvars.copy_context().run, worker)
        return handler.send_json({'ok': True, 'jobId': job_id, 'status': 'running'}, status=202, extra_headers={'Cache-Control': 'no-store'})
    if method == 'GET' and inner.startswith('/api/mastering/'):
        job_id = inner.rsplit('/', 1)[-1]
        with LOCK:
            job = JOBS.get(job_id)
            data = {k: v for k, v in job.items() if k not in ('owner', 'created')} if job and job['owner'] == owner else None
        if data is None:
            return handler.send_json({'ok': False, 'error': 'Mastering job not found.'}, status=404)
        return handler.send_json({'ok': True, **data}, extra_headers={'Cache-Control': 'no-store'})
    return handler.send_json({'ok': False, 'error': 'Method not allowed.'}, status=405)
