"""G-only INSTAREEL jobs. Existing live editor, Song sources and WAV players are untouched."""
import atexit
import hashlib
import importlib.util
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
import time
import wave
from urllib.parse import parse_qs, urlsplit

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = threading.RLock()
JOBS = {}
PRIVATE = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
LIMIT = 96 * 1024 * 1024
TTL = 3600


def checked(path, boundary):
    path, boundary = pathlib.Path(path).absolute(), pathlib.Path(boundary).absolute()
    if not path.is_relative_to(boundary) or '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Invalid reel storage path.')
    return path


def reel_root(accounts, user):
    wavs = checked(accounts.path_for('wavs', user=user), accounts.path_for('wavs', user=user))
    folder = checked(wavs / '.instareel', wavs)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    return folder


def plan(meta, seconds, variation, seed, options=None):
    if not math.isfinite(seconds) or not 30 <= seconds <= 60 or variation not in ('subtle', 'moderate', 'extreme'):
        raise ValueError('Choose 30–60 seconds and Subtle, Moderate or Extreme variation.')
    cycle = meta['patternSteps'] * meta.get('patternCycleMultiplier', 1) * 60 / meta['bpm'] / 4
    low, high = math.ceil((30 - 1e-8) / cycle), math.floor((60 + 1e-8) / cycle)
    if cycle > 60 or low > high:
        raise ValueError('This source cycle cannot fit a complete 30–60 second reel. Shorten its pattern.')
    repeats = max(low, min(high, math.floor(seconds / cycle + .5)))
    # Canonical musical plan is shared with Node unit tests and the worker.
    result = subprocess.run(['node', '-e', 'const p=require(process.argv[1]);process.stdout.write(JSON.stringify(p.plan(...JSON.parse(process.argv[2]))))',
                             str(ROOT / 'scripts/instareel-plan.cjs'), json.dumps([meta, seconds, variation, seed, options or {}])],
                            capture_output=True, timeout=5, check=True)
    value = json.loads(result.stdout)
    if abs(value['duration'] - cycle * repeats) > .00001:
        raise ValueError('Reel duration mismatch.')
    return value


def public(job):
    return {key: job[key] for key in ('id', 'state', 'message', 'plan', 'createdAt') if key in job}


def stop_job(job):
    process = job.get('process')
    if process and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def shutdown():
    with LOCK:
        for job in JOBS.values():
            stop_job(job)


atexit.register(shutdown)


def encode_preview(source, target):
    subprocess.run(['/usr/bin/ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', str(source),
                    '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-threads', '1',
                    '-movflags', '+faststart', '-y', str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20, check=True)
    target.chmod(0o600)


def run(job, payload):
    process = None
    try:
        with LOCK:
            if job['state'] == 'cancelled':
                return
            job.update(state='running', message='Starting isolated server render')
            process = subprocess.Popen(['node', str(ROOT / 'scripts/instareel-worker.cjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, start_new_session=True, cwd=ROOT)
            job['process'] = process
        process.stdin.write(json.dumps(payload).encode())
        process.stdin.close()
        deadline, pending, result = time.monotonic() + 240, b'', None
        while True:
            if time.monotonic() > deadline:
                raise ValueError('Reel rendering timed out. Your current patch is unchanged; try again.')
            if not select.select([process.stdout], [], [], min(1, max(0, deadline-time.monotonic())))[0]:
                continue
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            pending += chunk
            if len(pending) > 1048576:
                raise ValueError('Renderer response limit exceeded.')
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                item = json.loads(line)
                if item.get('error'):
                    raise ValueError(item['error'])
                if 'stage' in item:
                    with LOCK:
                        job['message'] = str(item['stage'])[:160]
                if 'result' in item:
                    result = item['result']
        if process.wait(timeout=10) or not result:
            raise ValueError('The isolated renderer stopped. Your current patch is unchanged.')
        with LOCK:
            if job['state'] == 'cancelled':
                return
        with wave.open(str(job['folder'] / 'reel.wav'), 'rb') as audio:
            if (audio.getnchannels() != 2 or audio.getsampwidth() != 2 or not 32000 <= audio.getframerate() <= 96000
                    or abs(audio.getnframes()/audio.getframerate() - job['plan']['duration']) > 1/audio.getframerate()):
                raise ValueError('Reel audio dimensions do not match the requested arrangement.')
        encode_preview(job['folder'] / 'reel.wav', job['folder'] / 'preview.m4a')
        with LOCK:
            if job['state'] != 'cancelled':
                job.update(state='done', message='Loopable reel ready. Preview it, then save or try another.', result=result)
    except Exception as error:
        with LOCK:
            if job['state'] != 'cancelled':
                job.update(state='failed', message=str(error)[:700])
    finally:
        if process:
            stop_job({'process': process})
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            process.stdout.close()
        with LOCK:
            job.pop('process', None)
        # This temporary upload is never an editable Song or original WAV.
        (job['folder'] / 'source.zip').unlink(missing_ok=True)
        payload.clear()


def cleanup(root):
    now = time.time()
    with LOCK:
        for key, job in list(JOBS.items()):
            if job['state'] not in ('queued', 'running') and now-job['createdAt'] > TTL:
                JOBS.pop(key)
        active = {str(j['folder']) for j in JOBS.values()}
    for folder in root.glob('job-*'):
        if folder.is_dir() and not folder.is_symlink() and str(folder) not in active and now-folder.stat().st_mtime > TTL:
            # Only this module's temporary artefacts, never saved/original audio.
            for name in ('source.zip', 'reel.wav', 'preview.m4a'):
                checked(folder / name, root).unlink(missing_ok=True)
            if not any(folder.iterdir()):
                folder.rmdir()


def saved_wavs(root):
    folder = checked(root / 'saved', root)
    folder.mkdir(mode=0o700, exist_ok=True)
    return folder


def read_library(root, wavs):
    path = checked(root / 'library.json', root)
    rows = json.loads(path.read_text()) if path.exists() else []
    saved, result = saved_wavs(root), []
    for row in rows:
        if not re.fullmatch(r'[a-f0-9]{32}', row['id']):
            continue
        target = checked(saved / row['filename'], saved)
        if not target.is_file():
            # Adopt only hash-verified library records from the old shared WAV root.
            # An unrelated or externally replaced WAV is never moved by its prefix.
            legacy = checked(wavs / row['filename'], wavs)
            if not legacy.is_file() or hashlib.sha256(legacy.read_bytes()).hexdigest() != row['sha256']:
                continue
            os.link(legacy, target)
            legacy.unlink()
        result.append(row)
    return result


def write_library(root, rows):
    temporary = checked(root / 'library.tmp', root)
    temporary.write_text(json.dumps(rows))
    temporary.chmod(0o600)
    os.replace(temporary, root / 'library.json')


def change_saved(root, wavs, ident, action, payload, accounts):
    # Caller owns the account storage lock. IDs never identify another account's files.
    rows = read_library(root, wavs)
    row = next((r for r in rows if r['id'] == ident), None)
    if row is None:
        raise FileNotFoundError('Saved reel not found.')
    saved = saved_wavs(root)
    source = checked(saved / row['filename'], saved)
    if hashlib.sha256(source.read_bytes()).hexdigest() != row['sha256']:
        raise ValueError('Saved audio changed. Refresh the INSTAREEL browser.')
    if action == 'rename':
        name = re.sub(r'[^A-Za-z0-9 _-]+', '', str(payload.get('name', ''))).strip()[:64]
        if not name:
            raise ValueError('Enter a reel name using letters, numbers, spaces, hyphens or underscores.')
        filename = f"INSTAREEL-{name}-{ident[:8]}.{row['bpm']:g}.wav"
        target = checked(saved / filename, saved)
        if target != source:
            # Exclusive hard link: a rename cannot overwrite any existing file.
            os.link(source, target)
        updated = dict(row, name=name, filename=filename)
        try:
            write_library(root, [updated if r['id'] == ident else r for r in rows])
        except Exception:
            if target != source:
                target.unlink()
            raise
        if target != source:
            source.unlink()
        return updated
    # Deletion removes the private library entry but retains recovery copies.
    trash = checked(root / 'trash', root)
    trash.mkdir(mode=0o700, exist_ok=True)
    folder = checked(trash / (ident + '-' + secrets.token_hex(4)), root)
    folder.mkdir(mode=0o700)
    (folder / 'metadata.json').write_text(json.dumps(row))
    preview = checked(root / (ident + '.m4a'), root)
    if preview.exists():
        shutil.copyfile(preview, folder / 'preview.m4a')
    target = folder / row['filename']
    os.replace(source, target)
    try:
        write_library(root, [r for r in rows if r['id'] != ident])
    except Exception:
        os.replace(target, source)
        raise
    preview.unlink(missing_ok=True)
    return row


def media(handler, path, content_type, download=None):
    with path.open('rb') as audio:
        handler.send_response(200)
        handler.send_header('Content-Type', content_type)
        handler.send_header('Content-Length', str(os.fstat(audio.fileno()).st_size))
        for key, value in PRIVATE.items():
            handler.send_header(key, value)
        if download:
            handler.send_header('Content-Disposition', 'attachment; filename="'+download+'"')
        handler.end_headers()
        try:
            shutil.copyfileobj(audio, handler.wfile, 65536)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            handler.close_connection = True


def handle(handler, accounts, songs):
    """Caller has authenticated, pinned identity and checked same-origin writes.

    Called before the account lock: no slow upload, render or download owns it.
    Only final saving is under the normal account storage lock.
    """
    try:
        user = handler.mygrain_user
        if not user:
            raise ValueError('Sign in before creating an INSTAREEL.')
        method, parsed = handler.command, urlsplit(handler.path)
        parts = parsed.path.split('/')[4:]
        query = parse_qs(parsed.query)
        root = reel_root(accounts, user)
        wavs = checked(accounts.path_for('wavs', user=user), accounts.path_for('wavs', user=user))
        if not parts or parts == ['']:
            if method != 'POST':
                raise ValueError('Use Make Reel to create an INSTAREEL.')
            seconds = float((query.get('seconds') or ['45'])[0])
            variation = (query.get('variation') or ['subtle'])[0]
            if not math.isfinite(seconds) or not 30 <= seconds <= 60 or variation not in ('subtle','moderate','extreme'):
                raise ValueError('Choose 30–60 seconds and Subtle, Moderate or Extreme variation.')
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= LIMIT:
                raise ValueError('Source snapshot exceeds the 96 MB upload limit. Shorten source samples.')
            with LOCK:
                if sum(j['state'] in ('queued','running') for j in JOBS.values()) >= 3 or any(j['owner']==user['id'] and j['state'] in ('queued','running') for j in JOBS.values()):
                    raise ValueError('A reel is already rendering or the queue is full. Wait or Cancel first.')
            cleanup(root)
            body = handler.rfile.read(length)
            if len(body) != length:
                raise ValueError('Incomplete source upload.')
            meta = songs.validate_part_zip(body)
            flags = {key:(query.get(key) or ['0'])[0] for key in ('notes','drums','recutV')}
            if any(value not in ('0','1') for value in flags.values()):
                raise ValueError('Choose valid reel variation options.')
            layout = plan(meta, seconds, variation, secrets.randbits(32), {key:value=='1' for key,value in flags.items()})
            ident = secrets.token_hex(16)
            folder = checked(root / ('job-'+ident), root)
            folder.mkdir(mode=0o700)
            (folder/'source.zip').write_bytes(body)
            (folder/'source.zip').chmod(0o600)
            job = {'id':ident,'owner':user['id'],'folder':folder,'state':'queued','message':'Queued for server rendering','createdAt':time.time(),'plan':layout}
            payload = {'id':ident,'baseUrl':f'http://127.0.0.1:{handler.server.server_address[1]}/mygrain/',
                       'cookie':handler.headers.get('Cookie',''),'outputPath':str(folder/'reel.wav'),'plan':layout}
            with LOCK:
                # Recheck under lock after upload so simultaneous taps cannot bypass admission.
                if sum(j['state'] in ('queued','running') for j in JOBS.values()) >= 3 or any(j['owner']==user['id'] and j['state'] in ('queued','running') for j in JOBS.values()):
                    (folder/'source.zip').unlink();folder.rmdir()
                    raise ValueError('A reel is already rendering. Wait or Cancel first.')
                JOBS[(user['id'],ident)] = job
                # Share the existing serialized server-render executor; never add parallel DSP load.
                songs.server_arm_module().EXECUTOR.submit(run, job, payload)
            return handler.send_json({'ok':True,'job':public(job)},status=202,extra_headers=PRIVATE)
        if parts == ['library'] and method == 'GET':
            with accounts.user_lock(user):
                rows = read_library(root,wavs)
            return handler.send_json({'ok':True,'reels':rows},extra_headers=PRIVATE)
        if len(parts)==3 and parts[0]=='library' and re.fullmatch(r'[a-f0-9]{32}',parts[1]) and parts[2] in ('rename','delete') and method=='POST':
            payload = handler.read_json()
            if not isinstance(payload, dict):
                raise ValueError('Expected a reel action object.')
            try:
                with accounts.user_lock(user):
                    row = change_saved(root, wavs, parts[1], parts[2], payload, accounts)
            except FileNotFoundError:
                raise
            except FileExistsError:
                raise ValueError('A WAV with that name already exists. Choose another name.') from None
            except OSError:
                raise ValueError('Saved reel could not be updated. Refresh the INSTAREEL browser and try again.') from None
            return handler.send_json({'ok':True,'reel':row},extra_headers=PRIVATE)
        if len(parts)==3 and parts[0]=='library' and re.fullmatch(r'[a-f0-9]{32}',parts[1]) and parts[2] in ('preview','wav') and method=='GET':
            with accounts.user_lock(user):
                row = next((r for r in read_library(root,wavs) if r['id']==parts[1]),None)
                if not row:
                    raise FileNotFoundError('Saved reel not found.')
                path = checked(saved_wavs(root)/row['filename'],root)
                if hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:
                    raise ValueError('Saved audio changed. Refresh the INSTAREEL browser.')
                target = checked(root/(row['id']+'.m4a'),root) if parts[2]=='preview' else path
            return media(handler,target,'audio/mp4' if parts[2]=='preview' else 'audio/wav',row['filename'] if parts[2]=='wav' else None)
        if not parts or not re.fullmatch(r'[a-f0-9]{32}',parts[0]):
            raise FileNotFoundError('Reel not found.')
        with LOCK:
            job = JOBS.get((user['id'],parts[0]))
            if not job:
                raise FileNotFoundError('Reel expired or rendering was interrupted. Make another reel.')
            action = parts[1] if len(parts)==2 else ''
            if not action and method=='GET':
                return handler.send_json({'ok':True,'job':public(job)},extra_headers=PRIVATE)
            if action=='cancel' and method=='POST':
                if job['state'] in ('queued','running'):
                    job.update(state='cancelled',message='Reel cancelled. Current patch unchanged.')
                    stop_job(job)
                return handler.send_json({'ok':True,'job':public(job)},extra_headers=PRIVATE)
            if action=='source' and method=='GET' and job['state'] in ('queued','running'):
                path, content = job['folder']/'source.zip','application/zip'
            elif action in ('preview','wav') and method=='GET' and job['state']=='done':
                path, content = job['folder']/('preview.m4a' if action=='preview' else 'reel.wav'), 'audio/mp4' if action=='preview' else 'audio/wav'
            elif action=='save' and method=='POST' and job['state']=='done':
                payload = handler.read_json()
                if not isinstance(payload, dict):
                    raise ValueError('Expected a reel name object.')
                name = re.sub(r'[^A-Za-z0-9 _-]+','',str(payload.get('name','Reel'))).strip()[:64] or 'Reel'
                with accounts.user_lock(user):
                    rows = read_library(root,wavs)
                    row = next((r for r in rows if r['id']==job['id']),None)
                    if row is None:
                        filename = f"INSTAREEL-{name}-{job['id'][:8]}.{job['plan']['bpm']:g}.wav"
                        target = checked(saved_wavs(root)/filename,root)
                        # Exclusive creation: saving can never overwrite an existing WAV.
                        with target.open('xb') as output, (job['folder']/'reel.wav').open('rb') as source:
                            shutil.copyfileobj(source,output)
                        target.chmod(0o600)
                        shutil.copyfile(job['folder']/'preview.m4a',checked(root/(job['id']+'.m4a'),root))
                        (root/(job['id']+'.m4a')).chmod(0o600)
                        row = {'id':job['id'],'filename':filename,'name':name,'duration':job['plan']['duration'],'bpm':job['plan']['bpm'],
                               'variation':job['plan']['variation'],'createdAt':time.time(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
                        rows.insert(0,row)
                        temporary = checked(root/'library.tmp',root);temporary.write_text(json.dumps(rows));temporary.chmod(0o600);os.replace(temporary,root/'library.json')
                return handler.send_json({'ok':True,'reel':row},extra_headers=PRIVATE)
            else:
                raise ValueError('This reel is not ready for that action.')
        return media(handler,path,content)
    except FileNotFoundError as error:
        return handler.send_json({'ok':False,'error':str(error)},status=404,extra_headers=PRIVATE)
    except (ValueError,OSError,subprocess.SubprocessError) as error:
        return handler.send_json({'ok':False,'error':str(error)},status=400,extra_headers=PRIVATE)
