"""Private, account-owned plugin bins and strictly opt-in numeric audio telemetry.

No audio telemetry reading/listing route. Bins never enter the public sample
libraries or ordinary Song/source format. SQLite owns each bin's bytes atomically;
auto-vacuum reclaims deleted snapshots without orphaned asset files.
"""
import datetime
import importlib.util
import pathlib
import io
import hashlib
import json
import math
import os
import re
import secrets
import sqlite3
import time
import wave
import zipfile
from urllib.parse import parse_qs, urlparse

_scratchpad_spec = importlib.util.spec_from_file_location('mygrain_scratchpad', pathlib.Path(__file__).with_name('mygrain_scratchpad.py'))
SCRATCHPAD = importlib.util.module_from_spec(_scratchpad_spec)
_scratchpad_spec.loader.exec_module(SCRATCHPAD)

# No independent per-bin byte cap: a bin shares the existing account quota.
MAX_BINS = 16
MAX_LIBRARY = 512 * 1024 * 1024
MAX_ARCHIVE = MAX_LIBRARY
PRIVATE = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
METRICS = set('elapsedMs timerDelayMs audioTime audioAdvanceMs clockRatio sampleRate baseLatencyMs outputLatencyMs heapBytes lateTicks skippedSteps maxLatenessMs lookaheadMs grains oscillators longTasks longTaskMaxMs errors rate clock epoch target tempo ppq bufferMs driftPpm underruns overflows received leadMs latencySamples latencyMs mix inputPeakLeft inputPeakRight lateReturns missingBlocks inputDrops timelineJumps cycleWraps projectRevision projectBytes projectDurationMs projectTransferBytes projectStores potMask'.split())
FLAGS = set('visible online connected armed running active playing offline browserReady bypass ready storing historyBusy renderBusy'.split())
ENUMS = {'plugin': {'web', 'bridge', 'fx'}, 'contextState': {'unavailable', 'suspended', 'running', 'closed', 'interrupted'}, 'mode': {'live', 'rendered', 'fx', 'web'}}


class LibraryError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(c) < 32 for c in value):
        raise LibraryError('Use a bin name of 1–80 characters.')
    return value.strip()


def instant(value):
    if not isinstance(value, str) or len(value) > 40:
        raise LibraryError('Invalid capture time.')
    try:
        date = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo is None:
            raise ValueError()
    except ValueError as error:
        raise LibraryError('Invalid capture time.') from error
    return value


def validate_bin(body, validate_part):
    if len(body) < 22:
        raise LibraryError('Incomplete Parts Bin archive.')
    if len(body) > MAX_ARCHIVE:
        raise LibraryError('This bin alone exceeds the 512 MiB universal storage quota for your account.', 413)
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            entries = archive.infolist()
            paths = {p.filename for p in entries}
            if not 1 <= len(entries) <= 65 or len(paths) != len(entries):
                raise LibraryError('Invalid bin entries.')
            if sum(p.file_size for p in entries) > MAX_LIBRARY or any(p.compress_type != zipfile.ZIP_STORED or p.flag_bits & 9 for p in entries):
                raise LibraryError('Bins must contain bounded, unencrypted stored assets.')
            if archive.getinfo('parts-bin.json').file_size > 65536:
                raise LibraryError('Bin manifest is too large.')
            manifest = json.loads(archive.read('parts-bin.json'))
            if not isinstance(manifest, dict) or set(manifest) != {'format', 'version', 'parts'} or manifest['format'] != 'mygrain-parts-bin' or type(manifest['version']) is not int or manifest['version'] != 1:
                raise LibraryError('Invalid bin format.')
            parts = manifest['parts']
            if not isinstance(parts, list) or not 0 <= len(parts) <= 32:
                raise LibraryError('A universal bin holds up to 32 parts.')
            allowed, ids, total = {'parts-bin.json'}, set(), 0
            for part in parts:
                if not isinstance(part, dict) or set(part) != {'id', 'name', 'createdAt', 'bpm', 'bars', 'patch', 'render'}:
                    raise LibraryError('Invalid part metadata.')
                ident = part['id']
                if not isinstance(ident, str) or not re.fullmatch('[a-f0-9]{32}', ident) or ident in ids:
                    raise LibraryError('Invalid part identity.')
                ids.add(ident)
                name(part['name'])
                instant(part['createdAt'])
                for key, maximum in [('bpm', 300), ('bars', 1024)]:
                    value = part[key]
                    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= maximum:
                        raise LibraryError('Invalid part timing.')
                a, b = 'parts-bin/' + ident + '.zip', 'parts-bin/' + ident + '.wav'
                if part['patch'] != a or part['render'] != b:
                    raise LibraryError('Invalid part paths.')
                allowed.update((a, b))
                total += archive.getinfo(a).file_size + archive.getinfo(b).file_size
                if total > MAX_LIBRARY:
                    raise LibraryError('This bin alone exceeds the 512 MiB universal storage quota for your account.', 413)
                validate_part(archive.read(a))  # Includes strict ordinary source admission: no nested bins.
                preview = archive.read(b)
                if len(preview) < 44 or preview[:4] != b'RIFF' or preview[8:12] != b'WAVE' or int.from_bytes(preview[4:8], 'little') + 8 != len(preview):
                    raise LibraryError('Incomplete preview WAV.')
                with wave.open(io.BytesIO(preview), 'rb') as audio:
                    if audio.getnchannels() not in (1, 2) or audio.getsampwidth() not in (2, 3, 4) or not 8000 <= audio.getframerate() <= 192000 or audio.getnframes() < 1 or len(audio.readframes(audio.getnframes())) != audio.getnframes() * audio.getnchannels() * audio.getsampwidth():
                        raise LibraryError('Invalid preview audio.')
            if paths != allowed:
                raise LibraryError('Unlisted bin assets.')
            return len(parts)
    except (zipfile.BadZipFile, KeyError, TypeError, UnicodeError, json.JSONDecodeError, wave.Error, EOFError, OverflowError) as error:
        raise LibraryError('Corrupt Parts Bin archive.') from error


def connect(accounts, user, checked_path, telemetry=False):
    # Admin and other accounts use the same identity-based private boundary.
    directory = checked_path(accounts.users_root / user['id'] / 'plugin-library', accounts.users_root)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    path = checked_path(directory / ('telemetry.sqlite3' if telemetry else 'bins.sqlite3'), directory)
    db = sqlite3.connect(path, timeout=10)
    try:
        db.execute('PRAGMA auto_vacuum=FULL')
        db.execute('PRAGMA secure_delete=ON')
        if telemetry:
            db.execute('CREATE TABLE IF NOT EXISTS batches (session TEXT, seq INTEGER, received REAL, started TEXT, build TEXT, body TEXT, PRIMARY KEY(session,seq))')
        else:
            db.execute('CREATE TABLE IF NOT EXISTS bins (id TEXT PRIMARY KEY, name TEXT, folded TEXT UNIQUE, created REAL, parts INTEGER, bytes INTEGER, body BLOB)')
        db.commit()
        os.chmod(path, 0o600)
        return db
    except BaseException:
        db.close()
        raise


def read_body(handler, maximum, content_type):
    lengths = handler.headers.get_all('Content-Length', [])
    if handler.headers.get('Transfer-Encoding') or handler.headers.get('Content-Encoding') or len(lengths) != 1 or not lengths[0].isdigit():
        raise LibraryError('A plain content length is required.', 411)
    size = int(lengths[0])
    if not 0 < size <= maximum:
        raise LibraryError('Upload exceeds its byte limit.', 413)
    if handler.headers.get('Content-Type', '').split(';')[0].strip().lower() != content_type:
        raise LibraryError('Invalid upload content type.', 415)
    body = handler.rfile.read(size)
    if len(body) != size:
        raise LibraryError('Incomplete upload.')
    return body


def read_json(handler, maximum=32768):
    def reject(value):
        raise LibraryError('Non-finite diagnostic data.')
    return json.loads(read_body(handler, maximum, 'application/json'), parse_constant=reject)


def validate_telemetry(payload):
    if not isinstance(payload, dict) or set(payload) != {'sessionId', 'sequence', 'startedAt', 'build', 'samples'}:
        raise LibraryError('Invalid telemetry envelope.')
    if not isinstance(payload['sessionId'], str) or not re.fullmatch('[a-f0-9]{32}', payload['sessionId']):
        raise LibraryError('Invalid telemetry session.')
    if type(payload['sequence']) is not int or not 0 <= payload['sequence'] <= 1000000:
        raise LibraryError('Invalid telemetry sequence.')
    instant(payload['startedAt'])
    if not isinstance(payload['build'], str) or not re.fullmatch('v[0-9A-Za-z._-]{1,79}', payload['build']):
        raise LibraryError('Invalid telemetry build.')
    samples = payload['samples']
    if not isinstance(samples, list) or not 1 <= len(samples) <= 10:
        raise LibraryError('Telemetry batches contain 1–10 samples.')
    previous = -1
    for sample in samples:
        if not isinstance(sample, dict) or set(sample) - (METRICS | FLAGS | set(ENUMS)) or 'elapsedMs' not in sample:
            raise LibraryError('Invalid audio telemetry fields.')
        for key, value in sample.items():
            if key in METRICS and (type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e16):
                raise LibraryError('Telemetry metrics must be finite numbers.')
            if key in FLAGS and type(value) is not bool:
                raise LibraryError('Invalid telemetry flag.')
            if key in ENUMS and (not isinstance(value, str) or value not in ENUMS[key]):
                raise LibraryError('Invalid telemetry status.')
        if sample['elapsedMs'] < previous or not 0 <= sample['elapsedMs'] <= 31 * 86400000:
            raise LibraryError('Invalid telemetry interval.')
        previous = sample['elapsedMs']
    return payload


def telemetry(handler, accounts, user, checked_path):
    if handler.command != 'POST':
        raise LibraryError('Telemetry is write-only.', 405)
    payload = validate_telemetry(read_json(handler))
    now = time.time()
    with accounts.user_lock(user):
        db = connect(accounts, user, checked_path, telemetry=True)
        try:
            with db:
                db.execute('DELETE FROM batches WHERE received < ?', (now - 7 * 86400,))
                existing = db.execute('SELECT started,build FROM batches WHERE session=? LIMIT 1', (payload['sessionId'],)).fetchone()
                if existing and existing != (payload['startedAt'], payload['build']):
                    raise LibraryError('Telemetry session metadata changed.', 409)
                seen = db.execute('SELECT body FROM batches WHERE session=? AND seq=?', (payload['sessionId'], payload['sequence'])).fetchone()
                encoded = json.dumps(payload['samples'], separators=(',', ':'), allow_nan=False)
                if seen and json.loads(seen[0]) != payload['samples']:
                    raise LibraryError('Telemetry batch identity was reused.', 409)
                if not seen:
                    if db.execute('SELECT COUNT(*) FROM batches WHERE received>?', (now - 60,)).fetchone()[0] >= 120:
                        raise LibraryError('Telemetry rate limit. Try again in a minute.', 429)
                    db.execute('INSERT INTO batches VALUES (?,?,?,?,?,?)', (payload['sessionId'], payload['sequence'], now, payload['startedAt'], payload['build'], encoded))
                    # About five hours at one batch/5s; old data is bounded and private.
                    db.execute('DELETE FROM batches WHERE rowid IN (SELECT rowid FROM batches ORDER BY received DESC LIMIT -1 OFFSET 4000)')
        finally:
            db.close()
    return {'ok': True, 'sessionId': payload['sessionId'], 'sequence': payload['sequence'], 'samples': len(payload['samples'])}


def revision(body):
    return hashlib.sha256(body).hexdigest()


def unpack_bin(body):
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        manifest = json.loads(z.read('parts-bin.json'))
        return [(p, z.read(p['patch']), z.read(p['render'])) for p in manifest['parts']]


def pack_bin(parts):
    out = io.BytesIO()
    manifest, assets = [], []
    for metadata, patch, preview in parts:
        p = dict(metadata)
        p['patch'], p['render'] = 'parts-bin/' + p['id'] + '.zip', 'parts-bin/' + p['id'] + '.wav'
        manifest.append(p)
        assets.extend([(p['patch'], patch), (p['render'], preview)])
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_STORED) as z:
        z.writestr('parts-bin.json', json.dumps({'format': 'mygrain-parts-bin', 'version': 1, 'parts': manifest}, separators=(',', ':')))
        for path, data in assets:
            z.writestr(path, data)
    return out.getvalue()


def handle(handler, method, inner, accounts, user, checked_path, validate_part):
    if inner == '/api/plugin-library/scratchpad' or inner.startswith('/api/plugin-library/scratchpad/'):
        return SCRATCHPAD.handle(handler, method, inner, accounts, user, checked_path, validate_part)
    try:
        if inner == '/api/audio-telemetry':
            return handler.send_json(telemetry(handler, accounts, user, checked_path), status=201, extra_headers=PRIVATE)
        match = re.fullmatch(r'/api/plugin-library/bins(?:/([a-f0-9]{32})(/(?:rename|replace|append))?)?', inner)
        if not match:
            raise LibraryError('Unknown plugin library route.', 404)
        ident, action = match.groups()
        payload, part_count, bin_name, move = None, 0, None, None
        creating = method == 'POST' and not ident
        writing = method == 'POST' and (creating or action in ('/replace', '/append'))
        if writing:
            query = parse_qs(urlparse(handler.path).query, keep_blank_values=True)
            allowed = ({'name'} if creating else set()) | {'moveFrom', 'revision', 'part'}
            if set(query) - allowed or any(len(v) != 1 for v in query.values()):
                raise LibraryError('Invalid bin save options.')
            if creating:
                if 'name' not in query:
                    raise LibraryError('Name the bin before saving it.')
                bin_name = name(query['name'][0])
            fields = set(query) & {'moveFrom', 'revision', 'part'}
            if fields:
                if fields != {'moveFrom', 'revision', 'part'} or action == '/replace':
                    raise LibraryError('Invalid move options.')
                move = {key: query[key][0] for key in fields}
                if not re.fullmatch('[a-f0-9]{32}', move['moveFrom']) or not re.fullmatch('[a-f0-9]{32}', move['part']) or not re.fullmatch('[a-f0-9]{64}', move['revision']) or move['moveFrom'] == ident:
                    raise LibraryError('Choose a different destination bin.')
            payload = read_body(handler, MAX_ARCHIVE, 'application/zip')
            part_count = validate_bin(payload, validate_part)
            expected = handler.headers.get('If-Match', '').strip('"')
            if action == '/replace' and not re.fullmatch('[a-f0-9]{64}', expected):
                raise LibraryError('Reopen this bin before saving changes.', 428)
        elif method == 'POST' and action == '/rename':
            value = read_json(handler, 1024)
            if not isinstance(value, dict) or set(value) != {'name'}:
                raise LibraryError('Choose a new bin name.')
            bin_name = name(value['name'])
        elif not ((method == 'GET' and not action) or (method == 'DELETE' and ident and not action)):
            raise LibraryError('Method not allowed.', 405)
        with accounts.user_lock(user):
            db = connect(accounts, user, checked_path)
            try:
                with db:
                    if method in ('POST', 'DELETE'):
                        db.execute('BEGIN IMMEDIATE')
                    target = db.execute('SELECT name,body FROM bins WHERE id=?', (ident,)).fetchone() if ident else None
                    if ident and target is None:
                        raise LibraryError('This saved bin no longer exists. Refresh the list.', 404)
                    if writing:
                        source_body, source_parts, copied = None, None, {}
                        incoming = unpack_bin(payload)
                        if move:
                            source = db.execute('SELECT body FROM bins WHERE id=?', (move['moveFrom'],)).fetchone()
                            if not source:
                                raise LibraryError('The source bin no longer exists.', 404)
                            if revision(source[0]) != move['revision']:
                                raise LibraryError('The source bin changed in another instance. Reopen it before moving; nothing was changed.', 409)
                            source_parts = unpack_bin(source[0])
                            selected = [p for p in source_parts if p[0]['id'] == move['part']]
                            if len(incoming) != 1 or len(selected) != 1 or selected[0][1:] != incoming[0][1:]:
                                raise LibraryError('The moved part no longer matches the source bin. Nothing was changed.', 409)
                            source_parts = [p for p in source_parts if p[0]['id'] != move['part']]
                            source_body = pack_bin(source_parts)
                        if action == '/replace' and revision(target[1]) != expected:
                            raise LibraryError('This bin changed in another instance. Reopen it or save as a new bin; nothing was overwritten.', 409)
                        if action == '/append':
                            destination = unpack_bin(target[1])
                            for metadata, patch, preview in incoming:
                                new_id = secrets.token_hex(16)
                                copied[metadata['id']] = new_id
                                destination.append((dict(metadata, id=new_id), patch, preview))
                            payload = pack_bin(destination)
                            part_count = validate_bin(payload, validate_part)
                        count, size = db.execute('SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM bins').fetchone()
                        final_size = size - (len(target[1]) if target else 0) + len(payload)
                        if move:
                            final_size += len(source_body) - len(source[0])
                        if (creating and count >= MAX_BINS) or final_size > MAX_LIBRARY:
                            raise LibraryError('Universal storage is full (16 bins / 512 MiB). Delete an unused bin first.', 507)
                        if creating:
                            ident = secrets.token_hex(16)
                            db.execute('INSERT INTO bins (id,name,folded,created,parts,bytes,body) VALUES (?,?,?,?,?,?,?)', (ident, bin_name, bin_name.casefold(), time.time(), part_count, len(payload), payload))
                        else:
                            bin_name = target[0]
                            db.execute('UPDATE bins SET parts=?,bytes=?,body=? WHERE id=?', (part_count, len(payload), payload, ident))
                        if move:
                            db.execute('UPDATE bins SET parts=?,bytes=?,body=? WHERE id=?', (len(source_parts), len(source_body), source_body, move['moveFrom']))
                        result = {'ok': True, 'id': ident, 'name': bin_name, 'revision': revision(payload), 'copied': copied, 'sourceRevision': revision(source_body) if move else None}
                    elif method == 'POST':
                        db.execute('UPDATE bins SET name=?,folded=? WHERE id=?', (bin_name, bin_name.casefold(), ident))
                        result = {'ok': True, 'id': ident, 'name': bin_name}
                    elif method == 'DELETE':
                        db.execute('DELETE FROM bins WHERE id=?', (ident,))
                        result = {'ok': True, 'deleted': ident}
                    elif ident:
                        result = target[1]
                    else:
                        rows = db.execute('SELECT id,name,created,parts,bytes FROM bins ORDER BY created DESC').fetchall()
                        result = {'ok': True, 'bins': [dict(zip(('id', 'name', 'createdAt', 'parts', 'bytes'), row)) for row in rows], 'maxBins': MAX_BINS, 'maxBytes': MAX_LIBRARY}
            finally:
                db.close()
        if isinstance(result, bytes):
            return handler.send_mygrain_bytes(result, 'application/zip')
        return handler.send_json(result, status=201 if creating else 200, extra_headers=PRIVATE)
    except sqlite3.IntegrityError:
        handler.close_connection = True
        return handler.send_json({'ok': False, 'error': 'A universal bin with that name already exists. Choose another name.'}, status=409, extra_headers=PRIVATE)
    except (LibraryError, ValueError, OSError, sqlite3.Error) as error:
        handler.close_connection = True
        message = str(error) if isinstance(error, LibraryError) else 'Invalid request or unavailable plugin storage.'
        return handler.send_json({'ok': False, 'error': message}, status=getattr(error, 'status', 400), extra_headers=PRIVATE)
