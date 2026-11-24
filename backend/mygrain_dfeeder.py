"""Server-owned Dfeeder queue and reviewed, exact-cut shared loop candidates."""
import atexit
import hashlib
import json
import math
import os
import pathlib
import re
import secrets
import select
import shutil
import signal
import subprocess
import threading
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import numpy as np
from urllib.parse import parse_qs, quote, urlparse
import sys
if str(pathlib.Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mygrain_worker_pool as pool

ROOT = pathlib.Path('/srv/sftp/mark_sftp/files/SAMPLES_DFEEDER')
APP = pathlib.Path(__file__).resolve().parents[1]
LOCK = threading.RLock()
RUNNING = {}
STOPPING = threading.Event()
PRIVATE = {'Cache-Control': 'private, no-store'}
ALLOWED = {'bastarda', 'bastardb', 'bastardc', 'bastardd', 'bastardw', 'dropbox'}
MODES = {'native', 'loop', 'ember', 'drone'}
DRONE_CHORDS = {'single': [0], 'major': [0, 4, 7], 'minor': [0, 3, 7], 'power': [0, 7], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8], 'six': [0, 4, 7, 9], 'min6': [0, 3, 7, 9], 'seven': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11], 'min7': [0, 3, 7, 10], 'minmaj7': [0, 3, 7, 11], 'halfdim': [0, 3, 6, 10], 'dim7': [0, 3, 6, 9], 'sevenSus': [0, 5, 7, 10], 'add9': [0, 4, 7, 14], 'minadd9': [0, 3, 7, 14], 'nine': [0, 4, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14], 'min9': [0, 3, 7, 10, 14], 'eleven': [0, 3, 7, 10, 14, 17], 'thirteen': [0, 4, 7, 10, 14, 17, 21]}
DRONE_KEYS = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')
GENRES = {row['id']: row for row in json.loads((APP / 'genre-presets.json').read_text())}


def safe_dir(path):
    path = pathlib.Path(path).absolute()
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('Invalid Dfeeder storage path.')
    path.mkdir(parents=True, exist_ok=True)
    return path


def atomic_json(path, value):
    tmp = path.with_name('.' + path.name + '-' + secrets.token_hex(6))
    try:
        tmp.write_text(json.dumps(value, indent=2) + '\n')
        tmp.chmod(0o600)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def job_path(root, ident):
    if not re.fullmatch('[a-f0-9]{32}', ident):
        raise ValueError('Invalid Dfeeder batch.')
    return safe_dir(root / '.jobs') / (ident + '.json')


def read_jobs(root):
    rows = []
    for path in safe_dir(root / '.jobs').glob('*.json'):
        if path.is_symlink():
            continue
        row = json.loads(path.read_text())
        if row['state'] in ('queued', 'running') and row['id'] not in RUNNING:
            row.update(state='interrupted', message='Server restarted. Completed samples are retained; generate another batch to continue.')
            atomic_json(path, row)
        rows.append(row)
    return sorted(rows, key=lambda row: row['createdAt'], reverse=True)


def options(payload):
    if not isinstance(payload, dict) or set(payload) - {'count', 'bpm', 'mode', 'key', 'tone', 'pot', 'genre', 'chord', 'octaves'}:
        raise ValueError('Use count, optional BPM, mode, drone key and tone/Cooking Pot steering.')
    count, bpm = payload.get('count', 10), payload.get('bpm')
    if type(count) is not int or not 1 <= count <= 100:
        raise ValueError('Choose 1–100 loops per batch.')
    if bpm is not None and (type(bpm) is not int or not 68 <= bpm <= 178):
        raise ValueError('BPM override must be a whole number from 68 to 178, or blank for random.')
    mode, key = payload.get('mode', 'native'), payload.get('key', 'random')
    if not isinstance(mode, str) or mode not in MODES:
        raise ValueError('Choose a valid generation mode.')
    if not isinstance(key, str) or key not in (*DRONE_KEYS, 'random') or mode != 'drone' and key != 'random':
        raise ValueError('Choose a drone note or Random.')
    chord, octaves = payload.get('chord', 'single'), payload.get('octaves', 4)
    if not isinstance(chord, str) or chord not in DRONE_CHORDS or type(octaves) is not int or octaves not in (1, 2, 3, 4) or mode != 'drone' and (chord != 'single' or octaves != 4):
        raise ValueError('Choose a Drone chord and a one-to-four octave spread.')
    tone,pot=payload.get('tone','minimal'),payload.get('pot','legacy')
    if tone not in ('minimal','tonal') or tone=='tonal' and mode!='loop':
        raise ValueError('Tonal steering is available for Loop mode only.')
    if pot not in ('legacy','off','random') or mode=='native' and pot!='legacy':
        raise ValueError('Choose Cooking Pot Off or Random for the shop.')
    genre = payload.get('genre', '')
    if not isinstance(genre, str) or genre and (genre not in GENRES or mode != 'loop'):
        raise ValueError('Choose a supported Genre steer in Loop mode.')
    return count, bpm


def publish(root, job, item, loopstore):
    index = item.get('index')
    if type(index) is not int or not 0 <= index < job['count']:
        raise ValueError('Invalid rendered sample index.')
    if item.get('bpm') != job['bpms'][index] or item.get('steps') != 64 or item.get('quality') != 'full':
        raise ValueError('Rendered sample does not match its Dfeeder plan.')
    layers, mode = item.get('layers', []), job.get('mode', 'native')
    tone,pot=job.get('tone','minimal'),job.get('pot','legacy')
    allowed = ALLOWED | {'bastarde'} | ({'bastardp','bastardo','bastardl','bastardx'} if tone=='tonal' else set()) if mode == 'loop' else {'bastarde'} if mode == 'ember' else {'enemy'} if mode == 'drone' else ALLOWED
    drums = mode in ('native', 'loop')
    if mode not in MODES or not isinstance(layers, list) or not layers or not set(layers) <= allowed or item.get('drums') is not drums:
        raise ValueError('A render enabled a source outside the selected generation mode.')
    if mode != 'native' and item.get('mode') != mode:
        raise ValueError('Rendered generation mode does not match its batch.')
    if item.get('tone','minimal')!=tone or item.get('pot','legacy')!=pot:
        raise ValueError('Rendered steering does not match its batch.')
    if item.get('genre', '') != job.get('genre', '') or job.get('genre') and item.get('genreModel') != 'openai/gpt-6.1-sol':
        raise ValueError('Rendered genre does not match its native LLM plan.')
    if tone=='tonal' and (mode!='loop' or not {'bastardl','bastardx'}<=set(layers) or len(set(layers)&{'bastardp','bastardo'})!=1):
        raise ValueError('Tonal loops require L, X and exactly one of piano/orchestra.')
    powered={k for k,v in item.get('recipes',{}).get('effects',{}).items() if v.get('enabled')}
    if pot in ('off','random') and powered!=set(item.get('effects',[])):
        raise ValueError('Cooking Pot powered recipes do not match the selection.')
    if pot=='off' and item.get('effects'):
        raise ValueError('Cooking Pot Off rendered powered effects.')
    if pot=='random':
        effects=item.get('effects',[]);recipes=item.get('recipes',{}).get('effects',{})
        source_keys={'bastarda':'A','bastardb':'B','bastardc':'C','bastardw':'W','dropbox':'sample','bastarde':'E','enemy':'Enemy','bastardp':'P','bastardo':'O','bastardl':'L','bastardx':'X'}
        eligible={source_keys[k] for k in layers if k in source_keys}
        count=3 if mode=='loop' else min(3,len(eligible))
        if len(effects)!=count or len(set(effects))!=count or not set(effects)<={'mutilator','bassFace','turntable','resonator','wireWorld','sonicCrystal','bubbleChamber','playground','henrysHose','heavyLifter'}:
            raise ValueError('Expected random Cooking Pot effects on three individual tracks (one for single-source modes).')
        targets=[]
        for effect in effects:
            recipe=recipes.get(effect,{})
            inputs=[s.get('source','drumKick') for s in recipe.get('slots',[]) if s.get('enabled') and s.get('level',0)>0] if effect=='resonator' else [recipe.get('input',recipe.get('source','all'))]
            if not recipe.get('enabled') or len(set(inputs))!=1 or not set(inputs)<=eligible or effect=='playground' and recipe.get('routeKick'):
                raise ValueError('Random Cooking Pot must isolate eligible individual tracks, never drums, D or the whole mix.')
            targets.append(inputs[0])
        if len(set(targets))!=count:
            raise ValueError('Random Cooking Pot must choose distinct source tracks.')
    if mode in ('loop','ember') and ('bastarde' not in layers or item.get('recipes',{}).get('ember',{}).get('level') != .4):
        raise ValueError('Expected Ember starting at 40 percent before the render balance trim.')
    if mode in ('loop','ember'):
        balance=item.get('balance',{})
        def finite(value): return type(value) in (int,float) and math.isfinite(value)
        final=balance.get('finalMix',{})
        if balance.get('version')!=1 or balance.get('startLevel')!=.4 or not finite(final.get('lufs')) or final.get('frames')!=item.get('frames'):
            raise ValueError('Missing final loop loudness analysis.')
        if mode=='loop':
            gain=balance.get('gain')
            if item.get('drumLevels',{}).get('bus')!=1 or balance.get('status')!='balanced' or not finite(gain) or not .0001<=gain<=2.5 or balance.get('targetLu')!=-6 or not finite(balance.get('effectiveLevel')) or abs(balance['effectiveLevel']-.4*gain)>1e-9:
                raise ValueError('Expected drums at 100 percent and a bounded analysed Ember balance.')
            for stage in (balance,balance.get('verified',{})):
                for source in ('drums','ember'):
                    metric=stage.get(source,{})
                    if not finite(metric.get('lufs')) or not finite(metric.get('rms')) or metric['rms']<=1e-7 or not finite(metric.get('peak')) or metric['peak']<=0 or not finite(metric.get('frames')) or metric['frames']<.4*item.get('sampleRate',48000):
                        raise ValueError('Missing audible drum/Ember loudness analysis.')
        elif balance.get('status')!='single-source' or balance.get('effectiveLevel')!=.4:
            raise ValueError('Ember-only mode must not invent a drum reference.')
    if mode=='loop' and 'bastardd' in layers:
        d=item.get('balance',{}).get('d',{})
        if item.get('recipes',{}).get('d',{}).get('level')!=1 or d.get('status')!='balanced' or d.get('startLevel')!=1 or d.get('targetLu')!=0 or not finite(d.get('gain')) or not .0001<=d['gain']<=1 or d.get('effectiveLevel')!=d['gain']:
            raise ValueError('D must start at 100 percent with a downward-only drum-reference trim.')
        for stage in (d,d.get('verified',{})):
            for source in ('drums','d'):
                metric=stage.get(source,{})
                if not finite(metric.get('lufs')) or not finite(metric.get('peak')) or metric['peak']<=0 or not finite(metric.get('rms')) or metric['rms']<=1e-7 or not finite(metric.get('frames')) or metric['frames']<.4*item.get('sampleRate',48000):
                    raise ValueError('Missing D/drum loudness analysis.')
        actual=d['verified']
        if actual['d']['lufs']>actual['drums']['lufs']+.15 or actual['d']['peak']>actual['drums']['peak']*1.02:
            raise ValueError('D is louder than the recorded drum reference.')
    if mode in ('native','loop') and 'dropbox' in layers:
        rb=item.get('balance',{}).get('restructure',{})
        def finite_r(value): return type(value) in (int,float) and math.isfinite(value)
        if rb.get('status')!='balanced' or rb.get('sourceTap')!='post-fx' or rb.get('referenceTap')!='post-fx' or rb.get('targetLu')!=0 or not finite_r(rb.get('gain')) or not .0001<=rb['gain']<=1 or not finite_r(rb.get('startLevel')) or not 0<rb['startLevel']<=.7 or not finite_r(rb.get('effectiveLevel')) or abs(rb['effectiveLevel']-rb['startLevel']*rb['gain'])>1e-9:
            raise ValueError('Restructure needs a downward-only post-FX drum-reference balance.')
        for stage in (rb,rb.get('verified',{})):
            for source in ('drums','restructure'):
                metric=stage.get(source,{})
                if not finite_r(metric.get('lufs')) or not finite_r(metric.get('peak')) or metric['peak']<=0 or not finite_r(metric.get('rms')) or metric['rms']<=1e-7 or not finite_r(metric.get('frames')) or metric['frames']<.4*item.get('sampleRate',48000):
                    raise ValueError('Missing audible Restructure/drum post-FX analysis.')
        actual=rb['verified']
        if actual['restructure']['lufs']>actual['drums']['lufs']+.15 or actual['restructure']['peak']>actual['drums']['peak']*1.02:
            raise ValueError('Restructure is louder than the recorded post-FX drum reference.')
    if mode == 'loop' and item.get('drumLevels',{}).get('cymbals') != 0:
        raise ValueError('Loop randomisation must keep cymbals silent.')
    if mode in ('ember','drone') and set(layers) != allowed:
        raise ValueError('A single-source render included other sources.')
    if mode == 'drone':
        key = job.get('key','random')
        if item.get('key') != key:
            raise ValueError('Drone key does not match its batch.')
        chord, octaves = job.get('chord', 'single'), job.get('octaves', 4)
        if item.get('chord', 'single') != chord or item.get('octaves', 4) != octaves:
            raise ValueError('Drone harmony does not match its batch.')
        if key != 'random' or chord != 'single':
            recipe = item.get('recipes',{}).get('enemy',{})
            voices = recipe.get('voices',[])
            root_note = key if key != 'random' else item.get('harmonyRoot')
            if root_note not in DRONE_KEYS:
                raise ValueError('Drone chord needs its generated root.')
            base = 36 + DRONE_KEYS.index(root_note)
            expected = {(base + offset) % 12 for offset in DRONE_CHORDS[chord]}
            if len(voices) != 8 or recipe.get('transpose',0) != 0 or any(type(v.get('note')) is not int or not base <= v['note'] < base + 12 * octaves or v['note'] % 12 not in expected or v.get('fine',0) != 0 for v in voices) or {v['note'] % 12 for v in voices if v.get('on') and v.get('level',0)>0} != expected:
                raise ValueError('Drone voices must cover the chosen note/chord within its octave spread.')
    folder = safe_dir(pool.pending(root, job['id']))
    path = folder / f'{index:04d}.wav'
    if path.is_symlink() or not path.is_file() or not 44 < path.stat().st_size <= loopstore.MAX_BYTES:
        raise ValueError('Rendered sample missing or oversized.')
    data = path.read_bytes()
    audio = loopstore.wav_info(data, str(item['bpm']), '64')
    if mode in ('loop','ember') and (item.get('frames')!=audio['frames'] or item.get('sampleRate')!=audio['sampleRate']):
        raise ValueError('Loudness analysis does not match the saved PCM window.')
    if audio['bits'] != 24 or audio['channels'] != 2 or not .99999 <= item.get('peak', 0) <= 1.000001 or item.get('rms', 0) <= 1e-7:
        raise ValueError('Expected non-silent, stereo-linked peak-normalised PCM24.')
    if data[36:40] != b'data':
        raise ValueError('Expected the canonical PCM24 writer.')
    packed = np.frombuffer(data, dtype=np.uint8, offset=44).reshape(-1, 3).astype(np.int32)
    samples = packed[:, 0] | packed[:, 1] << 8 | packed[:, 2] << 16
    samples = ((samples ^ 0x800000) - 0x800000).astype(np.float64) / 8388608
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples * samples)))
    if peak < .99999 or peak > 1 or rms <= 1e-7:
        raise ValueError('Rendered PCM is not non-silent and peak-normalised.')
    item = {**item, 'peak': peak, 'rms': rms}
    name = f"DFEEDER_{item['bpm']}BPM_{job['id'][:8]}_{index+1:03d}.wav"
    target = root / name
    if target.exists():
        raise ValueError('Dfeeder candidate already exists.')
    meta = dict(ownerId=job['ownerId'], username=job['username'], created=time.time(), audio=audio,
                dfeeder={**item, 'jobId': job['id'], 'normalisation': 'stereo-linked 0 dBFS peak', 'warmupCycles': 1})
    atomic_json(loopstore.metadata_path(root, name), meta)
    source = folder / f'{index:04d}.zip'
    if source.is_file() and not source.is_symlink():
        import zipfile
        if source.stat().st_size > 192 * 1024**2:
            raise ValueError('Source snapshot exceeds 192 MiB.')
        with zipfile.ZipFile(source) as archive:
            if 'song-part.json' not in archive.namelist():
                raise ValueError('Invalid DAW source snapshot.')
        sources = safe_dir(root / '.sources')
        source.chmod(0o600)
        pool.publish_file(source, sources / (name + '.zip'), 0o600)
    path.chmod(0o660)  # Retain the shared SFTP directory's inherited named-user ACLs.
    pool.publish_file(path, target, 0o660)
    return name


def review(root, name, user, approve, loopstore, checked_path):
    if loopstore.safe_name(name) != name:
        raise ValueError('Invalid candidate name.')
    with LOCK, loopstore.LOCK:
        path = checked_path(root / name, root)
        if path.is_symlink() or not path.is_file():
            raise FileNotFoundError('Candidate no longer exists. Refresh the list.')
        meta = loopstore.read_metadata(root, name)
        if not meta.get('dfeeder') or not loopstore.can_manage(user, meta):
            raise PermissionError('Only the contributor or an admin can review this candidate.')
        if hashlib.sha256(path.read_bytes()).hexdigest() != meta['audio']['sha256']:
            raise ValueError('Candidate changed since generation; it was not moved or removed.')
        if approve:
            destination = safe_dir(loopstore.ROOT)
            new = loopstore.unique_name(destination, name)
            target = checked_path(destination / new, destination)
            record = {**meta, 'dfeeder': {**meta['dfeeder'], 'approvedBy': user['username'], 'approvedAt': time.time()}}
            atomic_json(loopstore.metadata_path(destination, new), record)
            try:
                # Both shared libraries are sibling directories on the same filesystem.
                # Complete original PCM is renamed, never re-encoded or normalised again.
                pool.publish_file(path, target, 0o660)
            except Exception:
                loopstore.metadata_path(destination, new).unlink(missing_ok=True)
                raise
            loopstore.metadata_path(root, name).unlink(missing_ok=True)
            return dict(ok=True, approved=name, savedName=new, url=f'{loopstore.ROUTE}/{quote(new)}')
        recovery = safe_dir(root / '.trash' / (str(int(time.time())) + '-' + secrets.token_hex(8)))
        path.replace(recovery / name)
        try:
            loopstore.metadata_path(root, name).replace(recovery / (name + '.json'))
        except Exception:
            (recovery / name).replace(path)
            raise
        return dict(ok=True, deleted=name)


def stop_process(process):
    if process and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


# Service-local warm transport cache; admission remains the single shared pool.
# Only zero-context workers are cached, never credential payloads or pages.
WARM_IDLE = []


def close_warm_worker(deck):
    process = deck['process']
    stop_process(process)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
    process.stdin.close()
    process.stdout.close()
    deck['errors'].close()


def close_idle_workers():
    with LOCK:
        decks, WARM_IDLE[:] = list(WARM_IDLE), []
    for deck in decks:
        close_warm_worker(deck)


def borrow_warm_worker():
    # Retire before the Node 60-second exit deadline, avoiding idle/write races.
    with LOCK:
        while WARM_IDLE:
            deck = WARM_IDLE.pop()
            if deck['process'].poll() is None and time.monotonic() - deck['last_used'] < 45:
                return deck, True
            close_warm_worker(deck)
    errors = tempfile.TemporaryFile(dir=pool.child_env().get('TMPDIR'))
    try:
        process = subprocess.Popen(['node', str(APP / 'scripts/dfeeder-worker.cjs'), '--persistent'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, cwd=APP,
            start_new_session=True, env=pool.child_env())
    except BaseException:
        errors.close()
        raise
    return dict(process=process, errors=errors, last_used=0), False


def return_warm_worker(deck):
    with LOCK:
        if not STOPPING.is_set() and len(WARM_IDLE) < pool.workers() and deck['process'].poll() is None:
            deck['last_used'] = time.monotonic()
            WARM_IDLE.append(deck)
            return
    close_warm_worker(deck)


def shutdown():
    STOPPING.set()
    with LOCK:
        for value in RUNNING.values():
            for process in value if isinstance(value, set) else (value,):
                stop_process(process)
    close_idle_workers()


atexit.register(shutdown)


def run(root, job, worker, loopstore):
    if pool.enabled():
        return run_parallel(root, job, worker, loopstore)
    return run_serial(root, job, worker, loopstore)


def run_parallel(root, job, worker, loopstore):
    """One fair queued admission; additional per-loop decks borrow idle slots.

    Each deck yields its lease after one loop. Out-of-order results wait on
    scratch until the contiguous prefix can be published with stable IDs/BPMs.
    """
    aborted = threading.Event()
    ready, futures = {}, set()
    next_index = 0
    deadline = None
    folder = pathlib.Path(worker['outputDir'])

    def cancelled():
        return aborted.is_set() or STOPPING.is_set()

    def update(**fields):
        with LOCK:
            job.update(**fields)
            atomic_json(job_path(root, job['id']), job)

    def render(index, lease):
        deck, process, success, clean_idle = None, None, False, False
        try:
            if cancelled():
                raise pool.Cancelled('Batch stopped. Completed samples are retained.')
            deck, reused = borrow_warm_worker()
            process = deck['process']
            with LOCK:
                RUNNING[job['id']].add(process)
                field = 'warmWorkerReuses' if reused else 'warmWorkerStarts'
                update(**{field: job.get(field, 0) + 1})
            process.stdin.write((json.dumps({**worker, 'indices': [index]}) + '\n').encode())
            process.stdin.flush()
            pending, sample = b'', None
            while not clean_idle:
                if cancelled():
                    raise pool.Cancelled('Batch stopped. Completed samples are retained.')
                if time.monotonic() > deadline:
                    raise ValueError('Dfeeder loop timed out. Completed samples are retained.')
                if not select.select([process.stdout], [], [], .5)[0]:
                    continue
                chunk = os.read(process.stdout.fileno(), 65536)
                if not chunk:
                    raise ValueError('Dfeeder renderer stopped before releasing its account context.')
                pending += chunk
                if len(pending) > 1048576:
                    raise ValueError('Dfeeder response limit exceeded.')
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    item = json.loads(line)
                    if 'error' in item:
                        raise ValueError(item['error'])
                    if 'stage' in item:
                        with LOCK:
                            retry = 1 if 'retryError' in item else 0
                            update(message=f"{job['completed']}/{job['count']} saved · {job['activeWorkers']} workers · {str(item['stage'])[:160]}",
                                   retryCount=job.get('retryCount', 0) + retry)
                    if 'sample' in item:
                        if sample is not None or item['sample'].get('index') != index:
                            raise ValueError('Unexpected Dfeeder sample index.')
                        sample = item['sample']
                    if item.get('idle'):
                        if item.get('contexts') != 0 or sample is None or pending:
                            raise ValueError('Dfeeder renderer did not cleanly release its account context.')
                        clean_idle = True
            with LOCK:
                ready[index] = sample
                # Preserve canonical index/BPM identity despite out-of-order work.
                while job['completed'] in ready:
                    item = ready.pop(job['completed'])
                    name = publish(root, job, item, loopstore)
                    update(completed=job['completed'] + 1, files=job['files'] + [name])
            success = True
        finally:
            if process:
                with LOCK:
                    RUNNING[job['id']].discard(process)
            # Reuse only after an explicit zero-context acknowledgement and
            # successful publication; malformed/failed/cancelled decks die.
            if deck:
                if success and clean_idle and not cancelled():
                    return_warm_worker(deck)
                else:
                    close_warm_worker(deck)
            lease.close('done' if success else 'failed')
            with LOCK:
                update(activeWorkers=job['activeWorkers'] - 1)

    try:
        with LOCK:
            RUNNING[job['id']] = set()
        update(activeWorkers=0, peakActiveWorkers=0, retryCount=0, warmWorkerStarts=0, warmWorkerReuses=0, scheduling='spare-slots-per-loop')
        worker_limit = min(pool.workers(), job['count'])
        with ThreadPoolExecutor(max_workers=worker_limit, thread_name_prefix='dfeeder-loop') as executor:
            try:
                while next_index < job['count'] or futures:
                    if cancelled():
                        raise pool.Cancelled('Batch stopped. Completed samples are retained.')
                    done = {f for f in futures if f.done()}
                    for future in done:
                        future.result()
                    futures -= done
                    if next_index < job['count'] and len(futures) < worker_limit:
                        lease = (pool.try_acquire('generation', job['ownerId']) if futures else
                                 pool.acquire('generation', job['ownerId'], cancelled=cancelled,
                                     waiting=lambda position: update(message=f'Queued for shared audio worker · position {position}')))
                        if lease is not None:
                            try:
                                with LOCK:
                                    active = job['activeWorkers'] + 1
                                    if deadline is None:
                                        # Keep the original whole-batch retry/genre budget.
                                        deadline = time.monotonic() + job['count'] * 240 + 90
                                    update(state='running', startedAt=job.get('startedAt', time.time()),
                                           activeWorkers=active, peakActiveWorkers=max(active, job['peakActiveWorkers']),
                                           message=f"{job['completed']}/{job['count']} saved · {active} full-quality workers")
                                futures.add(executor.submit(render, next_index, lease))
                                next_index += 1
                            except BaseException:
                                lease.close('failed')
                                raise
                            continue
                    if futures:
                        wait(futures, timeout=.2, return_when=FIRST_COMPLETED)
                if job['completed'] != job['count']:
                    raise ValueError('Dfeeder batch incomplete. Completed samples are retained.')
            except BaseException:
                aborted.set()
                raise
        update(state='done', finishedAt=time.time(), message=f"{job['completed']} loops ready for review")
    except Exception as error:
        update(state='failed', finishedAt=time.time(), message=str(error)[:700])
    finally:
        with LOCK:
            RUNNING.pop(job['id'], None)
        worker.clear()  # Cookies remain in memory/stdin only, never job/queue JSON.
        if folder.is_dir() and not folder.is_symlink():
            shutil.rmtree(folder)


def run_serial(root, job, worker, loopstore):
    process = None
    lease = None
    def update(**fields):
        with LOCK:
            job.update(**fields)
            atomic_json(job_path(root, job['id']), job)
    try:
        lease = pool.acquire('generation', job['ownerId'], waiting=lambda position: update(message=f'Queued for shared audio worker · position {position}'))
        process = subprocess.Popen(['node', str(APP / 'scripts/dfeeder-worker.cjs')], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=APP, start_new_session=True, env=pool.child_env(worker['outputDir']))
        with LOCK:
            RUNNING[job['id']] = process
        update(state='running', startedAt=time.time(), message='Starting isolated full-quality audio engine')
        process.stdin.write(json.dumps(worker).encode())
        process.stdin.close()
        deadline, pending = time.monotonic() + job['count'] * 240 + 90, b''
        while True:
            if time.monotonic() > deadline:
                raise ValueError('Dfeeder batch timed out. Completed samples are retained.')
            if not select.select([process.stdout], [], [], 1)[0]:
                continue
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            pending += chunk
            if len(pending) > 1048576:
                raise ValueError('Dfeeder response limit exceeded.')
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                item = json.loads(line)
                if 'error' in item:
                    raise ValueError(item['error'])
                if 'stage' in item:
                    update(message=str(item['stage'])[:200])
                if 'sample' in item:
                    if item['sample'].get('index') != job['completed']:
                        raise ValueError('Unexpected Dfeeder sample order.')
                    with LOCK:
                        name = publish(root, job, item['sample'], loopstore)
                        update(completed=job['completed'] + 1, files=job['files'] + [name])
        if process.wait(timeout=10) or job['completed'] != job['count']:
            detail = process.stderr.read(2000).decode(errors='replace') if process.poll() is not None else ''
            raise ValueError('Dfeeder renderer stopped before the batch completed. ' + detail[:400])
        update(state='done', message=f"{job['completed']} loops ready for review")
    except Exception as error:
        update(state='failed', message=str(error)[:700])
    finally:
        stop_process(process)
        if process:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            process.stdout.close()
            process.stderr.close()
        with LOCK:
            RUNNING.pop(job['id'], None)
        if lease:
            lease.close('done' if job['state'] == 'done' else 'failed')
        folder = pathlib.Path(worker['outputDir'])
        worker.clear()  # Ephemeral session cookie is never persisted or logged.
        if folder.is_dir() and not folder.is_symlink():
            shutil.rmtree(folder)


def create(root, user, payload, base, cookie, loopstore):
    count, bpm = options(payload)
    with LOCK:
        jobs = read_jobs(root)
        if any(row['state'] in ('queued', 'running') and (not pool.enabled() or row['ownerId'] == user['id']) for row in jobs):
            raise BlockingIOError('A Dfeeder batch is already running. Its progress appears here.')
        if pool.enabled() and sum(row['state'] in ('queued', 'running') for row in jobs) >= 32:
            raise BlockingIOError('The generation queue is full. Retry shortly.')
        ident = secrets.token_hex(16)
        genre = payload.get('genre', '')
        low, high = ([max(68, GENRES[genre]['bpm'][0]), min(178, GENRES[genre]['bpm'][1])] if genre else [68, 178])
        bpms = [bpm if bpm is not None else low + secrets.randbelow(high-low+1) for _ in range(count)]
        job = dict(id=ident, ownerId=user['id'], username=user['username'], count=count, completed=0,
            bpm=bpm, bpms=bpms, mode=payload.get('mode','native'), key=payload.get('key','random'), tone=payload.get('tone','minimal'), pot=payload.get('pot','legacy'), files=[], createdAt=time.time(), state='queued', message='Queued for server generation')
        if job['mode'] == 'drone':
            job.update(chord=payload.get('chord','single'), octaves=payload.get('octaves',4))
        if pool.enabled():
            job['workerPool'] = True
        if genre:
            job.update(genre=genre, orchestral=secrets.choice(('P', 'O')), message='Preparing native LLM genre direction…')
        folder = safe_dir(pool.pending(root, ident))
        atomic_json(job_path(root, ident), job)
        worker = dict(id=ident, baseUrl=base, cookie=cookie, username=user['username'], bpms=bpms,
                      outputDir=str(folder), retainSource=payload.get('mode','native')!='native', seed=secrets.randbits(32), mode=job['mode'], key=job['key'], tone=job['tone'], pot=job['pot'])
        if job['mode'] == 'drone':
            worker.update(chord=job['chord'], octaves=job['octaves'])
        if genre:
            worker['genre'] = genre
        RUNNING[ident] = None
        threading.Thread(target=run, args=(root, job, worker, loopstore), daemon=True).start()
        return dict(job)


def handle(handler, method, inner, user, loopstore, checked_path):
    root = safe_dir(ROOT)
    path = urlparse(handler.path)
    query = parse_qs(path.query)
    def reply(data, status=200):
        return handler.send_json(data, status=status, extra_headers=PRIVATE)
    try:
        if inner == '/api/dfeeder/list' and method in ('GET', 'HEAD'):
            with LOCK:
                files = [row for row in loopstore.list_files(root, user) if loopstore.read_metadata(root, row['name']).get('dfeeder')]
                for row in files:
                    row['url'] = '/mygrain/api/dfeeder/audio/' + quote(row['name'])
                    row['dfeeder'] = loopstore.read_metadata(root, row['name']).get('dfeeder', {})
                return reply(dict(ok=True, files=files, jobs=read_jobs(root)[:10]))
        if inner == '/api/dfeeder/generate' and method == 'POST':
            job = create(root, user, handler.read_json(), f'http://127.0.0.1:{handler.server.server_address[1]}/mygrain/',
                         handler.headers.get('Cookie', ''), loopstore)
            return reply(dict(ok=True, job=job), 202)
        if inner in ('/api/dfeeder/approve', '/api/dfeeder/reject') and method == 'POST':
            payload = handler.read_json()
            if not isinstance(payload, dict) or set(payload) != {'filename'}:
                raise ValueError('Expected only a filename.')
            return reply(review(root, payload.get('filename'), user, inner.endswith('/approve'), loopstore, checked_path))
        if inner.startswith('/api/dfeeder/audio/') and method in ('GET', 'HEAD'):
            name = inner[len('/api/dfeeder/audio/'):]
            if loopstore.safe_name(name) != name:
                raise ValueError('Invalid candidate name.')
            with LOCK:
                target = checked_path(root / name, root)
                if not target.is_file() or target.is_symlink():
                    raise FileNotFoundError('Candidate no longer exists.')
                stream = target.open('rb')
            with stream:
                return handler.send_mygrain_media(stream)
        return reply(dict(ok=False, error='Unknown Dfeeder action.'), 405)
    except PermissionError as error:
        return reply(dict(ok=False, error=str(error)), 403)
    except FileNotFoundError as error:
        return reply(dict(ok=False, error=str(error)), 404)
    except BlockingIOError as error:
        return reply(dict(ok=False, error=str(error)), 409)
    except (ValueError, OSError) as error:
        return reply(dict(ok=False, error=str(error)), 400)
