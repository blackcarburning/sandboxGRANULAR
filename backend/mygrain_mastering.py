"""Non-destructive, account-scoped offline LSP/FFmpeg mastering jobs."""
import concurrent.futures
import contextvars
import hashlib
import json
import math
import os
import re
from pathlib import Path
import secrets
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import wave

VERSION = 'lsp-1.2.14-ffmpeg-v3'
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


def chain(preset, gain, makeup=0, rate=48000):
    _, ratio, attack, release = PRESETS[preset]
    filters = [f'volume={gain}dB']
    if preset not in ('clean', 'level'):
        filters.append(lv2('compressor_stereo', f'al=0.251189|cr={ratio}|at={attack}|rt={release}|sla=0|mk=1|cwt=1|cdr=0'))
    elif preset == 'clean':
        filters.append(lv2('compressor_stereo', 'al=0.354813|cr=1.3|at=30|rt=140|sla=0|mk=1|cwt=1|cdr=0'))
    if preset != 'level':
        filters.append(f'volume={makeup}dB')
        filters.append(lv2('limiter_stereo', 'alr=0|boost=0|th=0.870964|ovs=16|lk=5|slink=100'))
        filters.append(f'aresample={rate * 4},alimiter=limit=0.881049:attack=1:release=20:level=0:latency=1,aresample={rate}')
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
    result = run(['-i', str(path), '-af', 'aformat=channel_layouts=stereo,' + chain(preset, 0, rate=rate), '-f', 'f32le', '-'])
    values = struct.unpack('<%df' % (len(result.stdout) // 4), result.stdout)[::2]
    delay = max(range(len(values)), key=lambda i: abs(values[i])) - rate // 4
    if not 0 <= delay <= rate // 5:
        raise ValueError('Unexpected plugin latency; mastering was not saved.')
    with LOCK:
        DELAYS[key] = delay
    return delay


def target_lufs(preset, value=None):
    if preset not in PRESETS:
        raise ValueError('Invalid mastering preset.')
    if value is None:
        return float(PRESETS[preset][0])
    if type(value) not in (int, float) or not math.isfinite(value) or not -24 <= value <= -6:
        raise ValueError('Target loudness must be between -24 and -6 LUFS.')
    return float(value)


def process(source, output, preset='clean', loop=True, target=None):
    if preset not in PRESETS or type(loop) is not bool:
        raise ValueError('Invalid mastering settings.')
    target = target_lufs(preset, target)
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
        gain = min(12, max(-24, target - before['lufs']))
        if preset == 'level':
            gain = min(gain, -1.2 - before['truePeakDb'])
        delay = latency(rate, preset, folder)
        warm_frames = math.ceil(max(2 * rate, frames) / frames) * frames if loop else 0
        # Repeat the source to settle envelope state, then take one exact cycle.
        # Full Songs instead start at zero and flush the lookahead with silence.
        filtered = folder / 'processed.wav'
        args = ['-stream_loop', '-1', '-i', str(decoded)] if loop else ['-i', str(decoded)]
        makeup = 0.0
        # Compensate compressor loss before limiting, not by raising saved peaks.
        # Re-render from the original each time; never repeatedly process a master.
        for attempt in range(12):
            filters = chain(preset, gain, makeup, rate) + f',atrim=start_sample={warm_frames + delay}:end_sample={warm_frames + delay + frames},asetpts=PTS-STARTPTS'
            if not loop:
                filters = f'apad=pad_len={delay + 1024},' + filters
            run([*args, '-af', filters, '-t', str(frames / rate), '-ar', str(rate), '-ac', '2', '-c:a', 'pcm_s24le', str(filtered)])
            after = measure(filtered)
            correction = min(0, -1.05 - after['truePeakDb'])
            if correction < 0:
                run(['-i', str(filtered), '-af', f'volume={correction}dB', '-c:a', 'pcm_s24le', str(output)])
            else:
                shutil.copyfile(filtered, output)
            after = measure(output)
            error = target - after['lufs']
            next_makeup = min(18.0, max(-12.0, makeup + error))
            if preset == 'level' or abs(error) <= .3 or abs(next_makeup - makeup) < .05 or attempt == 11:
                break
            makeup = next_makeup
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
        return {'engine': VERSION, 'preset': preset, 'loop': loop, 'frames': frames, 'sampleRate': rate, 'latencySamples': delay, 'seamStep': seam, 'before': before, 'after': after, 'comparisonGain': min(1, 10 ** ((before['lufs'] - after['lufs']) / 20)), 'originalGain': min(1, 10 ** ((after['lufs'] - before['lufs']) / 20)), 'gainDb': gain, 'makeupDb': makeup, 'targetLufs': target}


LIVE_VERSION = 'live-master-1'
LIVE_LIMITS = {'subcut': (0, 60), 'drive': (-24, 24), 'bass': (0, 100), 'compression': (0, 100), 'ceiling': (-6, -1)}


def live_settings(value):
    if not isinstance(value, dict) or set(value) != set(LIVE_LIMITS):
        raise ValueError('Provide all five live mastering controls.')
    for key, (low, high) in LIVE_LIMITS.items():
        if type(value[key]) not in (int, float) or not math.isfinite(value[key]) or not low <= value[key] <= high:
            raise ValueError('Invalid live mastering ' + key)
    return {key: float(value[key]) for key in LIVE_LIMITS}


def process_live(source, output, preset, loop, settings):
    settings = live_settings(settings)
    with tempfile.TemporaryDirectory(prefix='mygrain-live-audio-') as temporary:
        folder = Path(temporary)
        decoded, raw, rendered, config = [folder / name for name in ('decoded.wav', 'source.f32', 'result.f32', 'settings.json')]
        # One fixed audition/render rate. Browser decode and FFmpeg resampling
        # can differ slightly; both execute the identical DSP at 48 kHz.
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)], capture_output=True, timeout=15)
        if probe.returncode:
            raise ValueError('Invalid WAV audio.')
        info = json.loads(probe.stdout)
        streams = [x for x in info.get('streams', []) if x.get('codec_type') == 'audio']
        duration = float(info.get('format', {}).get('duration', 0))
        if len(streams) != 1 or int(streams[0].get('channels', 0)) not in (1, 2) or not .05 <= duration <= 600 or duration * 48000 * 6 > MAX_BYTES - 1024:
            raise ValueError('Use a mono/stereo WAV up to 10 minutes and 64 MB of output.')
        run(['-i', str(source), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s24le', str(decoded)])
        before = measure(decoded)
        if not all(math.isfinite(x) for x in before.values()):
            raise ValueError('No measurable audio. The original is unchanged.')
        run(['-i', str(source), '-ac', '2', '-ar', '48000', '-f', 'f32le', str(raw)])
        config.write_text(json.dumps({'settings': settings, 'loop': loop}))
        worker = subprocess.run(['node', str(Path(__file__).with_name('mastering-render.cjs')), str(raw), str(rendered), str(config)], capture_output=True, timeout=180)
        if worker.returncode:
            raise ValueError('Live mastering render failed. The original is unchanged.')
        report = json.loads(worker.stdout)
        run(['-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', str(rendered), '-c:a', 'pcm_s24le', str(output)])
        after = measure(output)
        if not all(math.isfinite(x) for x in after.values()):
            raise ValueError('These settings produced no measurable output. Reduce Sub cut or processing.')
        return {**report, 'preset': preset, 'loop': loop, 'before': before, 'after': after,
                'comparisonGain': min(1, 10 ** ((before['lufs'] - after['lufs']) / 20)),
                'originalGain': min(1, 10 ** ((after['lufs'] - before['lufs']) / 20)),
                'gainDb': settings['drive'], 'makeupDb': 0, 'targetLufs': None,
                'peakMode': 'sample', 'notice': 'Sample-peak ceiling; true peak is measured, not limited. No automatic loudness chasing.'}


def master_label(preset, target):
    return f'master-{preset}-minus{abs(float(target)):g}LUFS'


def metadata_path(root, name):
    root = Path(root)
    if not isinstance(name, str) or Path(name).name != name or name.startswith('.') or '\\' in name:
        raise ValueError('Invalid master filename.')
    folder = root / '.mastering-library'
    path = folder / (hashlib.sha256(name.encode()).hexdigest() + '.json')
    if root.is_symlink() or folder.is_symlink() or path.is_symlink() or (root / name).is_symlink():
        raise ValueError('Invalid master storage.')
    return path


def signature(path):
    stat = path.stat()
    return [stat.st_size, stat.st_mtime_ns, stat.st_ino]


def save_info(root, name, data):
    path = metadata_path(root, name)
    path.parent.mkdir(mode=0o700, exist_ok=True)
    safe = {key: data[key] for key in ('kind', 'preset', 'targetLufs', 'sourceName', 'engine', 'liveSettings') if key in data}
    safe['signature'] = signature(Path(root) / name)
    temp = path.with_suffix('.' + secrets.token_hex(8) + '.tmp')
    try:
        temp.write_text(json.dumps(safe)); temp.chmod(0o600)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def info(root, name):
    try:
        path = metadata_path(root, name)
        data = json.loads(path.read_text())
        if data['signature'] != signature(Path(root) / name) or data.get('kind') not in ('waves', 'reels'):
            return None
        if data.get('engine') == LIVE_VERSION:
            values = live_settings(data['liveSettings'])
            if data['preset'] not in PRESETS:
                return None
            return {**{k: data[k] for k in ('kind', 'preset', 'sourceName') if k in data}, 'engine': LIVE_VERSION, 'liveSettings': values, 'label': 'master-live-' + data['preset'] + '.wav'}
        target = target_lufs(data['preset'], data['targetLufs'])
        return {**{k: data[k] for k in ('kind', 'preset', 'sourceName') if k in data},
                'targetLufs': target, 'label': master_label(data['preset'], target) + '.wav'}
    except (OSError, KeyError, ValueError, TypeError):
        return None


def decorate(root, files):
    # Adopt hash-verified historical outputs without renaming originals or notes.
    root = Path(root)
    by_name = {f['name']: f for f in files}
    cache = root / '.mastering-cache'
    if cache.is_dir() and not cache.is_symlink():
        for path in cache.glob('*.json'):
            if path.is_symlink():
                continue
            try:
                entry = json.loads(path.read_text())
                name, report = entry['savedName'], entry['report']
                if name not in by_name or info(root, name):
                    continue
                metadata_path(root, name)
                if hashlib.sha256((root / name).read_bytes()).hexdigest() != entry['sha256']:
                    continue
                adopted = {'kind': entry.get('kind', 'waves'), 'preset': report['preset'],
                           'targetLufs': report.get('targetLufs', PRESETS[report['preset']][0])}
                if report.get('engine') == LIVE_VERSION:
                    adopted.update(engine=LIVE_VERSION, liveSettings=live_settings(report['settings']))
                save_info(root, name, adopted)
            except (OSError, ValueError, KeyError, TypeError):
                continue
    canonical = lambda name: re.fullmatch(r'master-(?:[a-z]+-minus[0-9.]+LUFS|live-[a-z]+)(?:-[0-9]+)?\.wav', name)
    used = {f['name'] for f in files if canonical(f['name'])}
    for file in files:
        data = info(root, file['name'])
        if data:
            label = file['name'] if canonical(file['name']) else data['label']
            if not canonical(file['name']):
                counter = 2
                while label in used:
                    label = data['label'][:-4] + f'-{counter}.wav'
                    counter += 1
            used.add(label)
            file['displayName'] = label
            file['mastering'] = data
    return files


def copy_info(source_root, source_name, target_root, target_name):
    data = info(source_root, source_name)
    if data:
        # Copy only mastering settings/category, never source notes or comments.
        save_info(target_root, target_name, {k: data[k] for k in ('kind', 'preset', 'targetLufs', 'engine', 'liveSettings') if k in data})


def rename_info(root, old, new):
    path = metadata_path(root, old)
    if path.is_file():
        data = json.loads(path.read_text())
        if data.get('signature') == signature(Path(root) / new):
            save_info(root, new, data)
        path.unlink(missing_ok=True)


def delete_info(root, name):
    metadata_path(root, name).unlink(missing_ok=True)


def handle(handler, method, inner, accounts, user, root, checked, reels=None):
    """Called after the normal authenticated/identity-pinned API gate."""
    owner = user['id']
    root = Path(root)
    if inner == '/api/mastering' and method == 'POST':
        payload = handler.read_json()
        if not isinstance(payload, dict):
            raise ValueError('Expected mastering settings.')
        name, preset, loop = payload.get('filename'), payload.get('preset', 'clean'), payload.get('loop', True)
        reel_id, reel_job = payload.get('reelId'), payload.get('reelJobId')
        is_reel = reel_id is not None or reel_job is not None
        if is_reel:
            if reels is None or name is not None or (reel_id is not None and reel_job is not None):
                raise ValueError('Choose one reel source.')
            source_path, name = reels.mastering_source(accounts, user, reel_id, reel_job)
        kind = 'reels' if is_reel else 'waves'
        if not isinstance(name, str) or not name or name.startswith('.') or '/' in name or '\\' in name or Path(name).suffix.lower() != '.wav' or preset not in PRESETS or type(loop) is not bool:
            raise ValueError('Invalid mastering request.')
        engine = payload.get('engine')
        if engine not in (None, LIVE_VERSION):
            raise ValueError('Invalid mastering engine.')
        live = live_settings(payload.get('liveSettings')) if engine == LIVE_VERSION else None
        loudness_target = None if live is not None else target_lufs(preset, payload.get('targetLufs'))
        metadata = {'kind': kind, 'preset': preset, 'targetLufs': loudness_target, 'sourceName': name}
        if live is not None:
            metadata.update(engine=LIVE_VERSION, liveSettings=live)
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
                source = checked(source_path if is_reel else Path(root) / name, root)
                if not source.is_file() or source.stat().st_size > MAX_BYTES:
                    raise ValueError('WAV missing or over 64 MB.')
                temp = tempfile.TemporaryDirectory(prefix='mygrain-master-job-')
                snapshot = Path(temp.name) / 'source.wav'
                shutil.copyfile(source, snapshot)
                if live is not None and (not isinstance(payload.get('sourceSha256'), str) or hashlib.sha256(snapshot.read_bytes()).hexdigest() != payload['sourceSha256']):
                    raise ValueError('The source WAV changed since preview. Reopen mastering and load again.')
            cache_settings = ['live-library-v1', LIVE_VERSION, kind, preset, loop, live] if live is not None else ['library-v1', VERSION, kind, preset, loop, loudness_target]
            digest = hashlib.sha256(snapshot.read_bytes() + json.dumps(cache_settings).encode()).hexdigest()
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
                                    save_info(root, saved, metadata)
                                    with LOCK:
                                        job.update(status='done', savedName=saved, report=entry['report'], cacheHit=True)
                                    return
                        except (ValueError, KeyError, OSError):
                            pass
                output = Path(temp.name) / 'master.wav'
                report = process_live(snapshot, output, preset, loop, live) if live is not None else process(snapshot, output, preset, loop, loudness_target)
                # Content-addressed, private result. Never replace an original or
                # attach an editable patch that misrepresents the mastered DSP.
                stem = ('master-live-' + preset) if live is not None else master_label(preset, loudness_target)
                with accounts.user_lock(user):
                    saved = stem + '.wav'
                    counter = 2
                    while (Path(root) / saved).exists():
                        saved = f'{stem}-{counter}.wav'
                        counter += 1
                    target = checked(Path(root) / saved, root)
                    staging = checked(Path(root) / ('.master-' + job_id), root)
                    try:
                        shutil.copyfile(output, staging)
                        os.replace(staging, target)
                    finally:
                        staging.unlink(missing_ok=True)
                    accounts.wav_created(saved)
                    save_info(root, saved, metadata)
                    cache.mkdir(mode=0o700, exist_ok=True)
                    cache_file.write_text(json.dumps({'savedName': saved, 'kind': kind, 'report': report, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
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
