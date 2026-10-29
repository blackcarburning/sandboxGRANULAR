"""Account-private DAW jobs. Bounded Chromium worker, streamed PCM24/ZIP assembly."""
import importlib.util
import json
import os
import pathlib
import re
import secrets
import shutil
import signal
import struct
import subprocess
import tempfile
import threading
import time
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor

JOBS = {}
LOCK = threading.RLock()
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix='mygrain-daw')
SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/daw-export-worker.cjs'
MAX_BYTES = 1024**3
RATE = 48000
IMPORT_GUIDES = '\n\nDAW IMPORT GUIDES\n\nBitwig Studio\n1. Unzip. Import MIDI/Arrangement.mid into a blank project at bar 1. Check the project tempo and any tempo automation against manifest.json; if your version does not import the map, enter its changes manually.\n2. Before importing audio, set Settings > Behavior > Audio Import to Original speed [Raw] and Start clip from: Sample Start. Place each audio/*.wav on its own Arranger track at bar 1; keep the initial silence.\n3. Load instruments for MIDI tracks. Use the named drum tracks and drum-map.json with your drum instrument.\nBitwig audio import settings: https://www.bitwig.com/userguide/latest/the_dashboard/\n\nAbleton Live\n1. Unzip. In Arrangement View, import MIDI/Arrangement.mid at 1.1.1 and accept the tempo/time-signature import prompt. Check the full tempo automation against manifest.json, especially songs ending in silence; enter any missing changes manually.\n2. Turn off Auto-Warp Long Samples and Create Fades on Clip Edges before importing. Drag audio/*.wav to 1.1.1; hold Cmd (Mac) or Ctrl (Windows) to put multiple files on separate tracks. Leave Warp off.\n3. Assign instruments to MIDI tracks and drum sounds using drum-map.json. Keep the optional stereo reference separate from the dry stems.\nLive tempo-map import: https://help.ableton.com/hc/en-us/articles/360003387979-Importing-a-tempo-map\nLive stem import: https://help.ableton.com/hc/en-us/articles/360000843404-Importing-and-exporting-stems\n\nFL Studio\n1. Unzip. Use File > Import > MIDI file for MIDI/Arrangement.mid in a new project. Select the required tracks and Create one channel per track where available. Leave Realign events off to preserve leading silence.\n2. Confirm the imported tempo and changes against manifest.json. If drum tracks are combined by channel, import the named drum tracks individually. Place the imported note patterns at the song start in the Playlist.\n3. Drag audio/*.wav onto separate Playlist tracks at bar 1. Keep their original duration; do not fit them to a detected tempo, stretch them or trim their initial silence. Assign instruments or samples for MIDI playback.\nFL Studio MIDI import: https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/automation_midiimport.htm\n\nAll DAWs: use 48 kHz, keep every WAV at bar 1 without normalization or automatic stretching. MIDI needs instruments. Verify tempo changes before editing.\n'


def public(job):
    return {k: v for k, v in job.items() if k in ('id', 'state', 'message', 'filename', 'path', 'createdAt', 'updatedAt')}


def vlq(n):
    result = [int(n) & 127]
    n = int(n) >> 7
    while n:
        result.insert(0, (n & 127) | 128)
        n >>= 7
    return bytes(result)


def midi_file(manifest):
    ppq = 960
    tempo = [(0, -2, b'\xff\x58\x04\x04\x02\x18\x08')]
    tracks = {}
    offset_beats = 0
    for occurrence in manifest['arrangement']:
        bpm = occurrence['bpm']
        start_tick = round(offset_beats * ppq)
        tempo.append((start_tick, -1, b'\xff\x51\x03' + round(60000000 / bpm).to_bytes(3, 'big')))
        name = occurrence['name'].encode('utf8')
        tempo.append((start_tick, 0, b'\xff\x06' + vlq(len(name)) + name))
        for event in manifest['parts'][occurrence['renderKey']]['midi']:
            if event['start'] >= occurrence['duration']:
                continue
            start = start_tick + round(event['start'] * bpm / 60 * ppq)
            end = min(start_tick + round(occurrence['duration'] * bpm / 60 * ppq), start + max(1, round(event['duration'] * bpm / 60 * ppq)))
            ch = 9 if event['drum'] else 0
            track = tracks.setdefault(event['track'], [])
            track.extend([(start, 1, bytes([0x90 | ch, int(event['note']), int(event['velocity'])])), (max(start + 1, end), 0, bytes([0x80 | ch, int(event['note']), 0]))])
        offset_beats += occurrence['duration'] * bpm / 60
    end_tick = round(offset_beats * ppq)
    def chunk(name, events):
        label = name.encode('utf8')
        data = bytearray(b'\x00\xff\x03' + vlq(len(label)) + label)
        last = 0
        for tick, order, body in sorted(events, key=lambda e: (e[0], e[1])):
            data.extend(vlq(tick - last) + body)
            last = tick
        data.extend(vlq(max(0, end_tick - last)) + b'\xff\x2f\x00')
        return b'MTrk' + struct.pack('>I', len(data)) + data
    chunks = [chunk('Tempo and arrangement', tempo)] + [chunk(name, events) for name, events in sorted(tracks.items())]
    return b'MThd' + struct.pack('>IHHH', 6, 1, len(chunks), ppq) + b''.join(chunks)


def assemble(folder, manifest, output, cancelled=lambda: False):
    import numpy as np
    parts = manifest['parts']
    arrangement = manifest['arrangement']
    duration = sum(item['duration'] for item in arrangement)
    tail = manifest.get('releaseTailSeconds', 2)
    frames = round((duration + tail) * RATE)
    stems = sorted({key for part in parts.values() for key in part['stems']})
    if not stems:
        raise ValueError('No audible tracks were found in this pattern/song.')
    if frames * 6 * len(stems) > MAX_BYTES - 64 * 1024**2:
        raise ValueError('The DAW package exceeds the 1 GiB export limit. Export a shorter song or fewer repeats.')
    offsets = []
    cursor = 0.0
    for item in arrangement:
        offsets.append((round(cursor * RATE), item))
        cursor += item['duration']
    clipping = {}
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for key in stems:
            if cancelled():
                raise ValueError('Export cancelled.')
            target = folder / 'aligned.wav'
            peak = 0
            with wave.open(str(target), 'wb') as dest:
                dest.setparams((2, 3, RATE, frames, 'NONE', 'not compressed'))
                readers = {}
                try:
                    for start in range(0, frames, 32768):
                        if cancelled():
                            raise ValueError('Export cancelled.')
                        end = min(frames, start + 32768)
                        block = np.zeros((end - start, 2), dtype=np.float64)
                        for offset, item in offsets:
                            path = parts[item['renderKey']]['stems'].get(key)
                            if not path:
                                continue
                            if path not in readers:
                                source = wave.open(str(folder / path), 'rb')
                                if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (2, 3, RATE):
                                    raise ValueError('DAW worker produced a non-48k stereo PCM24 stem.')
                                readers[path] = source
                            source = readers[path]
                            left, right = max(start, offset), min(end, offset + source.getnframes())
                            if right <= left:
                                continue
                            source.setpos(left - offset)
                            raw = np.frombuffer(source.readframes(right - left), dtype=np.uint8).reshape(-1, 3)
                            pcm = raw[:, 0].astype(np.int32) | raw[:, 1].astype(np.int32) << 8 | raw[:, 2].astype(np.int32) << 16
                            pcm = (pcm ^ 0x800000) - 0x800000
                            block[left - start:right - start] += pcm.reshape(-1, 2) / 8388608
                        peak = max(peak, float(np.max(np.abs(block))))
                        integers = np.rint(np.clip(block, -1, 1) * 8388607).astype(np.int32).reshape(-1)
                        packed = np.empty((len(integers), 3), dtype=np.uint8)
                        for shift in range(3):
                            packed[:, shift] = (integers >> (shift * 8)) & 255
                        dest.writeframesraw(packed.tobytes())
                finally:
                    for source in readers.values():
                        source.close()
            clipping[key] = peak
            archive.write(target, ('reference/' if key == 'Stereo Reference' else 'audio/') + key + '.wav')
            target.unlink()
        manifest.update(format='mygrain-daw-export', version=1, sampleRate=RATE, bitDepth=24, startBar=1, durationSeconds=duration, releaseTailSeconds=tail, wavFrames=frames, peaks=clipping, normalization='none')
        archive.writestr('MIDI/Arrangement.mid', midi_file(manifest))
        for part in parts.values():
            part['stems'] = {name: ('reference/' if name == 'Stereo Reference' else 'audio/') + name + '.wav' for name in part['stems']}
        archive.writestr('manifest.json', json.dumps(manifest, indent=2))
        archive.writestr('README.txt', 'MYGRAIN DAW export — Cubase / Bitwig / Ableton / FL Studio\n\nUnzip. Import MIDI/Arrangement.mid into a new project using its tempo map.\nImport every audio/*.wav at bar 1 on separate tracks. All are stereo 48 kHz PCM24.\nDo not auto-normalize. The optional reference is not a dry stem.\nDry excludes channel EQ, insert/send and master processing; instrument synthesis,\ntuning, envelopes and slicing are retained. No mix is normalized independently.\nNatural release is retained with a silence-checked tail; its length and the exact musical duration are in manifest.\nMIDI contains performed note events with named separate drum tracks (channel 10).\nLoops, vocals and K audio recordings are audio, not invented MIDI transcriptions.\nMIDI does not recreate MYGRAIN instruments or granular synthesis in your DAW.\nSamples are original saved PCM sources, not effects-processed stems; source-patches\nretain the complete editable snapshots. General MIDI drum notes are listed below.\nKick=36 Snare/Roll=38 Hat=42 Perc=75 Clap=39 Cymbals=49 ETC=56.\n\nSession notes:\n' + manifest.get('notes', '') + IMPORT_GUIDES + '\n')
        archive.writestr('drum-map.json', json.dumps({'channel': 10, 'notes': {'kick': 36, 'snare': 38, 'snareRoll': 38, 'hat': 42, 'perc': 75, 'clap': 39, 'cymbals': 49, 'etc': 56}}, indent=2))
        for patch in sorted(folder.glob('source-*.zip')):
            archive.write(patch, 'source-patches/' + patch.name)
            with zipfile.ZipFile(patch) as source:
                for entry in source.infolist():
                    if re.fullmatch(r'audio/[A-Za-z0-9+_-]+\.wav', entry.filename):
                        with source.open(entry) as inp, archive.open('samples/' + patch.stem + '/' + entry.filename[6:], 'w') as out:
                            while block := inp.read(1024 * 1024):
                                out.write(block)
        if archive.fp.tell() > MAX_BYTES:
            raise ValueError('The DAW package exceeds the 1 GiB private FTP limit.')
    return clipping


def run(job, payload, folder, ftp, accounts, user):
    process = None
    def cancelled():
        with LOCK:
            return job.get('cancel', False)
    def update(**fields):
        with LOCK:
            job.update(**fields, updatedAt=time.time())
    try:
        if cancelled():
            return
        update(state='running', message='Server: preparing saved sounds at 48 kHz')
        process = subprocess.Popen(['node', str(SCRIPT)], cwd=SCRIPT.parents[1], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
        with LOCK:
            job['process'] = process
        def kill():
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        timer = threading.Timer(7200, kill)
        timer.start()
        try:
            process.stdin.write(json.dumps(payload)); process.stdin.close()
            result = None
            for line in process.stdout:
                message = json.loads(line)
                if 'stage' in message:
                    update(message=message['stage'][:300])
                if 'result' in message:
                    result = message['result']
                if 'error' in message:
                    raise ValueError(message['error'])
            if process.wait() or not result:
                raise ValueError('Server DAW renderer interrupted. Saved songs and sources are unchanged.')
        finally:
            timer.cancel()
        if cancelled():
            return
        manifest = json.loads((folder / 'render-manifest.json').read_text())
        manifest['notes'] = payload['notes']
        manifest['name'] = payload['name']
        name = re.sub(r'[^A-Za-z0-9._-]+', '-', payload['name']).strip('.-_')[:75] or 'MYGRAIN'
        tempos = '-'.join(dict.fromkeys(str(item['bpm']) for item in manifest['arrangement']))
        if len(tempos) > 60:
            tempos = str(manifest['arrangement'][0]['bpm']) + '-tempo-map'
        filename = f'{name}-{tempos}bpm-{payload["scope"]}-DAW.zip'
        update(message='Assembling aligned dry audio, MIDI and source samples')
        output = folder / 'package.zip'
        peaks = assemble(folder, manifest, output, cancelled)
        if cancelled():
            return
        with accounts.user_lock(user), LOCK:
            if cancelled():
                return
            active = accounts.lookup_user(user['username'])
            if not active or active.get('id') != user['id'] or active.get('status', 'active') != 'active':
                raise ValueError('The account is no longer active.')
            base = filename[:-4]
            with ftp.directory(ftp.home(user), ftp.parts(payload['folder'])) as parent:
                for suffix in range(1000):
                    candidate = filename if suffix == 0 else f'{base}-{suffix + 1}.zip'
                    try:
                        os.stat(candidate, dir_fd=parent, follow_symlinks=False)
                    except FileNotFoundError:
                        filename = candidate
                        break
                else:
                    raise ValueError('Too many exports with this name. Choose another export name.')
            path = '/'.join(filter(None, [payload['folder'], filename]))
            with output.open('rb') as stream:
                ftp.upload(ftp.home(user), path, stream, output.stat().st_size)
            job.update(state='done', filename=filename, path=path, message=f'Saved to private FTP: {filename}' + (' · Some tracks reach full scale; check part levels.' if any(v >= .9999 for v in peaks.values()) else ''), updatedAt=time.time())
    except Exception as error:
        if not cancelled():
            update(state='failed', message=str(error)[:700])
    finally:
        if process and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        payload.clear()
        shutil.rmtree(folder)
        with LOCK:
            job.pop('process', None)
            job.pop('future', None)
            job.pop('cleanup', None)
            if cancelled():
                job.update(state='cancelled', message='DAW export cancelled. No new FTP file was published.', updatedAt=time.time())


def handle(handler, user, accounts, ftp, action, query):
    get = lambda k, default='': query.get(k, [default])[0]
    if action == 'daw-start' and handler.command == 'POST':
        scope = get('scope')
        if scope not in ('song', 'pattern'):
            raise ValueError('Choose song or pattern.')
        ftp.parts(get('folder'))
        with ftp.directory(ftp.home(user), ftp.parts(get('folder'))):
            pass
        with LOCK:
            now = time.time()
            for key, old in list(JOBS.items()):
                if old['state'] in ('done', 'failed', 'cancelled') and now - old['updatedAt'] > 86400:
                    JOBS.pop(key)
            active_states = ('uploading', 'queued', 'running')
            if sum(j['state'] in active_states for j in JOBS.values()) >= 3 or any(j['user'] == user['id'] and j['state'] in active_states for j in JOBS.values()):
                raise ValueError('An export is already running or the server queue is full. Wait for it to finish.')
            folder = pathlib.Path(tempfile.mkdtemp(prefix='mygrain-daw-'))
            identifier = secrets.token_hex(16)
            job = dict(id=identifier, user=user['id'], state='uploading', message='Receiving pattern source', createdAt=now, updatedAt=now)
            JOBS[identifier] = job
        # Reserve a queue slot, but never hold the global job lock during phone I/O.
        try:
            length = int(handler.headers.get('Content-Length', 0))
            if scope == 'pattern':
                if not 0 < length <= 192 * 1024**2:
                    raise ValueError('Pattern source ZIP must be between 1 byte and 192 MiB.')
                handler.connection.settimeout(120)
                with (folder / 'pattern.zip').open('wb') as dest:
                    remaining = length
                    while remaining:
                        block = handler.rfile.read(min(remaining, 1024**2))
                        if not block:
                            raise ValueError('Pattern upload interrupted.')
                        dest.write(block); remaining -= len(block)
            elif length:
                raise ValueError('Song exports use saved server sources, not an upload.')
            payload = dict(scope=scope, name=get('name', 'MYGRAIN')[:90], folder=get('folder'), notes=get('notes')[:2000], reference=get('reference') == '1', songId=get('songId'), revision=get('revision'), workdir=str(folder), baseUrl=f'http://127.0.0.1:{handler.server.server_address[1]}/mygrain/', cookie=handler.headers.get('Cookie', ''))
            def cleanup():
                payload.clear()
                shutil.rmtree(folder, ignore_errors=True)
            with LOCK:
                job.update(state='queued', message='DAW export queued on the server', updatedAt=time.time())
                job['cleanup'] = cleanup
                job['future'] = EXECUTOR.submit(run, job, payload, folder, ftp, accounts, dict(user))
                response = public(job)
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            with LOCK:
                JOBS.pop(identifier, None)
            raise
        return handler.send_json({'ok': True, 'job': response}, status=202, extra_headers=ftp.NO_CACHE)
    with LOCK:
        job = JOBS.get(get('id'))
        if not job or job['user'] != user['id']:
            raise FileNotFoundError('DAW job not found for this account.')
        if action == 'daw-cancel' and handler.command == 'POST' and job['state'] in ('queued', 'running'):
            job['cancel'] = True
            process = job.get('process')
            if process and process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            job.update(state='cancelled', message='Cancelling DAW export; no FTP file will be published.', updatedAt=time.time())
            future = job.get('future')
            if future and future.cancel():
                job.pop('cleanup')()
                job.pop('future', None)
                job.update(message='DAW export cancelled. No new FTP file was published.')
        elif action != 'daw-status' or handler.command not in ('GET', 'HEAD'):
            if action != 'daw-cancel':
                raise ValueError('Unknown DAW action.')
        return handler.send_json({'ok': True, 'job': public(job)}, extra_headers=ftp.NO_CACHE)
