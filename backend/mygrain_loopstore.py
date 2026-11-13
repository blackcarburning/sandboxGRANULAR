"""Shared, authenticated PCM loop library. No notes, reactions or private WAV copies."""
import hashlib
import json
import math
import pathlib
import re
import struct
import tempfile
import threading
import time
import uuid
from urllib.parse import parse_qs, quote, unquote, urlparse

ROUTE = '/mygrain-loopstore'
ROOT = pathlib.Path('/srv/sftp/mark_sftp/files/SAMPLES_LOOPSTORE')
LOCK = threading.RLock()
MAX_BYTES = 64 * 1024 * 1024


def wav_info(body, bpm=None, steps=None):
    """Validate actual RIFF frames, optionally against the renderer's sample grid."""
    if len(body) < 44 or body[:4] != b'RIFF' or body[8:12] != b'WAVE':
        raise ValueError('Expected a PCM WAV file.')
    if struct.unpack_from('<I', body, 4)[0] + 8 != len(body):
        raise ValueError('Incomplete WAV or trailing bytes.')
    offset, fmt, data_size = 12, None, None
    while offset + 8 <= len(body):
        kind, size = struct.unpack_from('<4sI', body, offset)
        offset += 8
        if offset + size > len(body):
            raise ValueError('Incomplete WAV chunk.')
        if kind == b'fmt ':
            if fmt is not None or size < 16:
                raise ValueError('Invalid WAV format chunk.')
            fmt = struct.unpack_from('<HHIIHH', body, offset)
        if kind == b'data':
            if data_size is not None:
                raise ValueError('Multiple WAV data chunks are not supported.')
            data_size = size
        offset += size + (size & 1)
    # Some writers omit the final pad for an odd-sized terminal data chunk.
    if offset not in (len(body), len(body) + 1) or fmt is None or data_size is None:
        raise ValueError('Invalid WAV chunks.')
    encoding, channels, rate, byte_rate, block, bits = fmt
    if not (encoding == 1 and bits in (16, 24, 32) or encoding == 3 and bits == 32):
        raise ValueError('Use uncompressed PCM16/24/32 or float32 WAV.')
    if channels not in (1, 2) or not 8000 <= rate <= 192000:
        raise ValueError('Use mono/stereo WAV at 8–192 kHz.')
    if block != channels * bits // 8 or byte_rate != rate * block or not data_size or data_size % block:
        raise ValueError('Invalid WAV sample alignment.')
    frames = data_size // block
    info = dict(sampleRate=rate, frames=frames, channels=channels, bits=bits,
                durationSeconds=frames / rate, sha256=hashlib.sha256(body).hexdigest(), exactCut=False)
    if bpm is not None or steps is not None:
        if not str(bpm or '').isdigit() or not str(steps or '').isdigit():
            raise ValueError('Rendered loops require integer BPM and steps.')
        bpm, steps = int(bpm), int(steps)
        if not 1 <= bpm <= 300 or not 1 <= steps <= 65536:
            raise ValueError('Invalid loop BPM or length.')
        # Same operation order and positive-number rounding as the JS renderer.
        exact = (60 / bpm) * 4 * (steps / 16) * rate
        expected = math.floor(exact) + int(exact - math.floor(exact) >= .5)
        if frames != expected:
            raise ValueError(f'Loop cut is not exact: {frames} frames; expected {expected}.')
        info.update(bpm=bpm, steps=steps, bars=steps / 16, exactCut=True)
    return info


def safe_name(value):
    value = str(value or '')
    if not value or '/' in value or '\\' in value or value.startswith('.'):
        raise ValueError('Invalid loop filename.')
    name = re.sub(r'[^A-Za-z0-9._-]+', '-', re.sub(r'\.wav$', '', value, flags=re.I)).strip('._-')
    if not name or len(name) > 160:
        raise ValueError('Use a loop name of 1–160 characters.')
    return name + '.wav'


def unique_name(root, name):
    candidate, n = name, 1
    while (root / candidate).exists():
        candidate = f'{pathlib.Path(name).stem}-{n}.wav'
        n += 1
    return candidate


def metadata_path(root, name):
    directory = root / '.metadata'
    if directory.is_symlink():
        raise ValueError('Invalid metadata directory.')
    directory.mkdir(exist_ok=True)
    path = directory / (name + '.json')
    if path.is_symlink():
        raise ValueError('Invalid loop metadata.')
    return path


def read_metadata(root, name):
    try:
        return json.loads(metadata_path(root, name).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def can_manage(user, meta):
    return bool(user.get('is_admin') or meta.get('ownerId') == user['id'])


def list_files(root, user):
    result = []
    for path in sorted(root.iterdir(), key=lambda p: p.name):
        if path.is_symlink() or not path.is_file() or path.name.startswith('.') or path.suffix.lower() != '.wav':
            continue
        stat, meta = path.stat(), read_metadata(root, path.name)
        result.append(dict(name=path.name, size=stat.st_size, modified=stat.st_mtime,
            url=f'{ROUTE}/{quote(path.name)}', loopStore=meta.get('audio', {}),
            addedBy=meta.get('username'), canManage=can_manage(user, meta)))
    return sorted(result, key=lambda f: f['modified'], reverse=True)


def handle(handler, method, inner, user, checked_path):
    """Called only after ordinary MYGRAIN session + pinned-identity checks."""
    root = pathlib.Path(ROOT)
    root.mkdir(parents=True, exist_ok=True)
    query = parse_qs(urlparse(handler.path).query)
    headers = {'Cache-Control': 'private, no-store'}
    def reply(data, status=200):
        return handler.send_json(data, status=status, extra_headers=headers)
    try:
        if inner == '/api/list' and method in ('GET', 'HEAD'):
            with LOCK:
                return reply(dict(ok=True, files=list_files(root, user), shared=True, comments=False))
        if inner == '/api/upload' and method == 'POST':
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BYTES:
                return reply(dict(ok=False, error='WAV must be 1 byte to 64 MB.'), 413)
            name = safe_name((query.get('filename') or [handler.headers.get('X-Filename', '')])[0])
            body = handler.rfile.read(length)
            if len(body) != length:
                raise ValueError('Incomplete upload.')
            info = wav_info(body, (query.get('bpm') or [None])[0], (query.get('steps') or [None])[0])
            with LOCK:
                name = unique_name(root, name)
                target = checked_path(root / name, root)
                meta = dict(ownerId=user['id'], username=user['username'], created=time.time(), audio=info)
                # Publish the complete WAV last. Interrupted writes stay hidden,
                # and the shared lock serializes names across every account.
                with tempfile.TemporaryDirectory(prefix='.pending-', dir=root) as pending:
                    pending = pathlib.Path(pending)
                    (pending / 'audio.wav').write_bytes(body)
                    (pending / 'info.json').write_text(json.dumps(meta))
                    (pending / 'info.json').replace(metadata_path(root, name))
                    (pending / 'audio.wav').replace(target)
            return reply(dict(ok=True, savedName=name, url=f'{ROUTE}/{quote(name)}', size=length, loopStore=info))
        if inner in ('/api/rename', '/api/delete') and method in ('POST', 'DELETE'):
            if (inner == '/api/rename' and method != 'POST') or (inner == '/api/delete' and method != 'DELETE'):
                return reply(dict(ok=False, error='Method not allowed.'), 405)
            payload = handler.read_json() if method == 'POST' else {}
            if not isinstance(payload, dict):
                raise ValueError('Expected a JSON object.')
            name = safe_name(payload.get('from') if method == 'POST' else (query.get('filename') or [''])[0])
            with LOCK:
                path = checked_path(root / name, root)
                if not path.is_file() or path.is_symlink():
                    return reply(dict(ok=False, error='Loop not found.'), 404)
                meta = read_metadata(root, name)
                if not can_manage(user, meta):
                    return reply(dict(ok=False, error='Only the contributor or owner can change this loop.'), 403)
                if method == 'POST':
                    new = safe_name(payload.get('to'))
                    if new != name:
                        new = unique_name(root, new)
                        path.rename(root / new)
                        try:
                            old_meta = metadata_path(root, name)
                            if old_meta.exists():
                                old_meta.rename(metadata_path(root, new))
                            else:
                                metadata_path(root, new).write_text(json.dumps(meta))
                        except Exception:
                            (root / new).rename(path)
                            raise
                    return reply(dict(ok=True, oldName=name, savedName=new, url=f'{ROUTE}/{quote(new)}'))
                trash = root / '.trash'
                if trash.is_symlink():
                    raise ValueError('Invalid recovery directory.')
                trash.mkdir(exist_ok=True)
                recovery = trash / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex)
                recovery.mkdir()
                path.rename(recovery / name)
                try:
                    old_meta = metadata_path(root, name)
                    if old_meta.exists():
                        old_meta.rename(recovery / (name + '.json'))
                    else:
                        (recovery / (name + '.json')).write_text(json.dumps(meta))
                except Exception:
                    (recovery / name).rename(path)
                    raise
                return reply(dict(ok=True, deleted=name))
        if not inner.startswith('/api/') and method in ('GET', 'HEAD'):
            name = unquote(inner).lstrip('/')
            if safe_name(name) != name:
                raise ValueError('Invalid loop download.')
            with LOCK:
                path = checked_path(root / name, root)
                if not path.is_file() or path.is_symlink():
                    return reply(dict(ok=False, error='Loop not found.'), 404)
                stream = path.open('rb')
            with stream:
                return handler.send_mygrain_media(stream)
        # In particular, notes/reactions/sharing/mastering APIs do not exist here.
        return reply(dict(ok=False, error='Loop Store does not support this action.'), 405)
    except (ValueError, OSError) as error:
        return reply(dict(ok=False, error=str(error)), 400)
