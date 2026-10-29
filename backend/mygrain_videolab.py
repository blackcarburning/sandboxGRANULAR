import datetime
import functools
import hashlib
import json
import math
import os
import pathlib
import re
import secrets
import shutil
import signal
import stat
import struct
import subprocess
import tempfile
import threading
import time
from urllib.parse import parse_qs, quote, urlencode, urlsplit


FOLDER = 'SAMPLES_VIDEOLAB'
SOURCE_ROOT = None
ACCOUNTS = None
ACCOUNT_STORE = None
INVALIDATE_SOURCE_CACHE = lambda: None
MAX_BYTES = 64 * 1024 * 1024
MAX_PCM_BYTES = 32 * 1024 * 1024
MAX_SECONDS = 180
DEADLINE_SECONDS = 120
TTL_SECONDS = 900
GLOBAL_LIMIT = 2
USER_LIMIT = 1
MAX_JOBS = 128
MAX_USER_JOBS = 16
NO_CACHE = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}\Z')
IDENTIFIER = re.compile(r'[a-f0-9]{32}\Z')
FILENAME = re.compile(r'[a-z0-9][a-z0-9-]{0,100}\.wav\Z')
BUILTIN = {'id': 'bbc-archive', 'name': 'BBC video archive', 'url': 'https://www.youtube.com/@BBCArchive', 'builtin': True}
JOBS = {}
JOB_LOCK = threading.RLock()
SAMPLE_LOCK = threading.RLock()
JANITOR_STARTED = False


class RequestError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def finite_number(value, minimum, maximum, label):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise RequestError(f'{label} must be a finite number from {minimum} to {maximum}.')
    return float(value)


def youtube_url(value, capture=False):
    if not isinstance(value, str) or not 1 <= len(value) <= 2048 or any(ord(character) <= 32 or ord(character) >= 127 for character in value) or '\\' in value:
        raise RequestError('Provide a YouTube video or channel URL.')
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or parsed.netloc not in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'):
        raise RequestError('Only standard HTTPS YouTube links are supported.')
    query = parse_qs(parsed.query, keep_blank_values=True)
    if 'list' in query or 'index' in query or any(len(values) != 1 for values in query.values()):
        raise RequestError('Playlists are not supported. Select a single video.')
    if set(query) - {'v', 't', 'start', 'si', 'feature', 'app'}:
        raise RequestError('Use a direct YouTube video or channel link.')
    path = parsed.path.rstrip('/')
    video = None
    if parsed.netloc == 'youtu.be':
        video = path[1:]
    elif path == '/watch':
        video = query.get('v', [''])[0]
    else:
        match = re.fullmatch(r'/(?:shorts|embed)/([A-Za-z0-9_-]{11})', path)
        if match:
            video = match[1]
    if video is not None:
        if not VIDEO_ID.fullmatch(video):
            raise RequestError('Select a single valid YouTube video.')
        if 't' in query and 'start' in query:
            raise RequestError('Provide only one video start time.')
        offset = query.get('t', query.get('start', ['0']))[0]
        if parsed.fragment:
            if offset != '0' or not re.fullmatch(r't=[0-9]+(?:\.[0-9]+)?', parsed.fragment):
                raise RequestError('Use one numeric video start time.')
            offset = parsed.fragment[2:]
        if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?s?', offset):
            raise RequestError('Use a numeric video start time in seconds.')
        start = finite_number(float(offset.rstrip('s')), 0, 21600, 'Start time')
        return 'https://www.youtube.com/watch?' + urlencode({'v': video}), video, start
    if parsed.netloc != 'youtu.be' and not query and not parsed.fragment and re.fullmatch(r'/(?:@[A-Za-z0-9_.-]{1,100}|channel/UC[A-Za-z0-9_-]{22}|(?:c|user)/[A-Za-z0-9_-]{1,100})(?:/(?:videos|featured|shorts))?', path):
        if capture:
            raise RequestError('This is a channel. Select a video on that channel, then paste its video link.')
        return 'https://www.youtube.com' + re.sub(r'/(?:videos|featured|shorts)$', '', path), None, 0
    raise RequestError('Select a single YouTube video or channel link; playlists and live pages are not supported.')


def checked_path(root, name):
    return ACCOUNTS.checked_path(pathlib.Path(root) / name, root)


def source_url(value, capture=False):
    """Canonicalize a single public Reel or an existing YouTube bookmark."""
    if isinstance(value, str) and urlsplit(value).hostname in ('instagram.com', 'www.instagram.com', 'm.instagram.com'):
        parsed = urlsplit(value)
        match = re.fullmatch(r'/(?:reel|reels)/([A-Za-z0-9_-]{5,28})/?', parsed.path)
        if (len(value) > 2048 or any(ord(c) <= 32 or ord(c) >= 127 for c in value) or '\\' in value
                or parsed.scheme != 'https' or parsed.netloc not in ('instagram.com', 'www.instagram.com', 'm.instagram.com')
                or parsed.fragment or not match):
            raise RequestError('Use a direct HTTPS Instagram Reel link, not a profile, story or collection.')
        return 'https://www.instagram.com/reel/' + match[1] + '/', match[1], 0
    return youtube_url(value, capture=capture)


def sample_root(create=False):
    root = checked_path(pathlib.Path(SOURCE_ROOT), FOLDER)
    if create:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root.chmod(0o700)
    return root


def read_private(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode) or not 0 < details.st_size <= limit:
            raise RequestError('Invalid Video Lab file.')
        with os.fdopen(descriptor, 'rb') as source:
            descriptor = None
            body = source.read(limit + 1)
        if len(body) > limit:
            raise RequestError('Video Lab file is too large.')
        return body
    finally:
        if descriptor is not None:
            os.close(descriptor)


def write_private(path, body):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def normalize_wav(body):
    if not 44 <= len(body) <= MAX_BYTES or body[:4] != b'RIFF' or body[8:12] != b'WAVE' or struct.unpack_from('<I', body, 4)[0] + 8 != len(body):
        raise RequestError('Upload a complete finite PCM WAV, at most 64 MiB.')
    offset, count, fields, pcm = 12, 0, None, None
    while offset < len(body):
        count += 1
        if count > 1024 or offset + 8 > len(body):
            raise RequestError('Invalid WAV chunks.')
        kind, length = struct.unpack_from('<4sI', body, offset)
        offset += 8
        if offset + length > len(body):
            raise RequestError('Incomplete WAV audio.')
        if kind == b'fmt ':
            if fields is not None or length not in (16, 18) or (length == 18 and body[offset + 16:offset + 18] != b'\x00\x00'):
                raise RequestError('Use uncompressed integer PCM WAV.')
            fields = struct.unpack_from('<HHIIHH', body, offset)
        elif kind == b'data':
            if pcm is not None or fields is None:
                raise RequestError('Invalid WAV audio data.')
            pcm = body[offset:offset + length]
        elif kind == b'smpl':
            if length < 36 or struct.unpack_from('<I', body, offset + 28)[0]:
                raise RequestError('Video Lab samples must not contain loops.')
        offset += length + length % 2
    if offset != len(body) or fields is None or pcm is None:
        raise RequestError('Incomplete WAV audio.')
    encoding, channels, rate, byte_rate, alignment, bits = fields
    if encoding != 1 or channels not in (1, 2) or not 8000 <= rate <= 192000 or bits not in (8, 16, 24, 32):
        raise RequestError('Use mono/stereo 8/16/24/32-bit PCM WAV at 8–192 kHz.')
    if alignment != channels * (bits // 8) or byte_rate != rate * alignment or len(pcm) % alignment:
        raise RequestError('Inconsistent PCM WAV format.')
    duration = len(pcm) / byte_rate
    if not 0.02 < duration <= MAX_SECONDS:
        raise RequestError('WAV duration must be longer than 0.02 seconds and at most 180 seconds.')
    padded = pcm + (b'\x00' if len(pcm) % 2 else b'')
    normalized = b'RIFF' + struct.pack('<I', 36 + len(padded)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, *fields) + b'data' + struct.pack('<I', len(pcm)) + padded
    if len(normalized) > MAX_BYTES:
        raise RequestError('WAV exceeds 64 MiB.')
    return normalized, {'duration': duration, 'sampleRate': rate, 'channels': channels, 'bitsPerSample': bits}


def checked_name(value):
    if not isinstance(value, str):
        raise RequestError('Provide a sample or bookmark name.')
    name = value.strip()
    if name.lower().endswith('.wav'):
        name = name[:-4].rstrip()
    if not 1 <= len(name) <= 100 or name in ('.', '..') or any(ord(character) < 32 or ord(character) == 127 or 0xD800 <= ord(character) <= 0xDFFF for character in name):
        raise RequestError('Use a name of 1–100 characters without control characters.')
    return name


def sample_paths(filename):
    if not isinstance(filename, str) or not FILENAME.fullmatch(filename):
        raise RequestError('Choose a saved Video Lab WAV filename.')
    root = sample_root()
    return checked_path(root, filename), checked_path(root, filename + '.json')


def locked_samples(operation):
    @functools.wraps(operation)
    def locked(*args, **kwargs):
        with SAMPLE_LOCK:
            return operation(*args, **kwargs)
    return locked


def download_name(name):
    return (re.sub(r'[<>:"/\\|?*]', '-', checked_name(name)).strip(' .') or 'video-sample') + '.wav'


@locked_samples
def read_sample(filename):
    path, metadata_path = sample_paths(filename)
    sample = json.loads(read_private(metadata_path, 16384))
    if not isinstance(sample, dict) or sample.get('filename') != filename or not isinstance(sample.get('createdAt'), str) or sample.get('bytes') != path.stat().st_size:
        raise RequestError('Invalid Video Lab sample metadata.')
    checked_name(sample.get('name'))
    finite_number(sample.get('duration'), 0.02, MAX_SECONDS, 'Duration')
    return {**sample, 'downloadName': download_name(sample['name']), 'url': '/mygrain/api/videolab/samples/' + quote(filename)}


@locked_samples
def list_samples():
    samples = []
    for path in sample_root().glob('*.wav'):
        if path.is_symlink() or not FILENAME.fullmatch(path.name):
            continue
        try:
            samples.append(read_sample(path.name))
        except (OSError, ValueError):
            continue
    return sorted(samples, key=lambda sample: (sample['createdAt'], sample['filename']), reverse=True)


@locked_samples
def save_sample(name, body, source_filename=''):
    name = checked_name(name)
    source = read_sample(source_filename) if source_filename else {}
    normalized, metadata = normalize_wav(body)
    now = datetime.datetime.now(datetime.timezone.utc)
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:48].rstrip('-') or 'video-sample'
    filename = f'{slug}-{now.strftime("%Y%m%dt%H%M%Sz")}-{secrets.token_hex(8)}.wav'
    sample_root(create=True)
    path, metadata_path = sample_paths(filename)
    sample = {**{key: value for key, value in source.items() if key not in ('url', 'downloadName')},
              'filename': filename, 'name': name, 'createdAt': now.isoformat(timespec='milliseconds').replace('+00:00', 'Z'), 'bytes': len(normalized), **metadata}
    if source_filename:
        sample['sourceFilename'] = source_filename
    created = []
    try:
        write_private(path, normalized)
        created.append(path)
        write_private(metadata_path, json.dumps(sample, ensure_ascii=False).encode())
        created.append(metadata_path)
    except BaseException:
        for target in created:
            target.unlink(missing_ok=True)
        raise
    INVALIDATE_SOURCE_CACHE()
    return {**sample, 'downloadName': download_name(name), 'url': '/mygrain/api/videolab/samples/' + quote(filename)}


@locked_samples
def rename_sample(filename, name):
    name = checked_name(name)
    sample = read_sample(filename)
    path, metadata_path = sample_paths(filename)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode) or not 0 < details.st_size <= MAX_BYTES:
            raise RequestError('Invalid Video Lab sample file.')
    finally:
        os.close(descriptor)
    if sample['name'] == name:
        return sample
    temporary = checked_path(path.parent, 'videolab-rename-' + secrets.token_hex(16) + '.tmp')
    metadata = json.loads(read_private(metadata_path, 16384))
    metadata['name'] = name
    created = False
    try:
        write_private(temporary, json.dumps(metadata, ensure_ascii=False).encode())
        created = True
        os.replace(temporary, metadata_path)
    finally:
        if created:
            temporary.unlink(missing_ok=True)
    INVALIDATE_SOURCE_CACHE()
    return {**sample, 'name': name, 'downloadName': download_name(name)}


@locked_samples
def delete_sample(filename):
    paths = sample_paths(filename)
    if not any(path.exists() for path in paths):
        raise FileNotFoundError()
    for path in paths:
        if path.exists() and not stat.S_ISREG(path.lstat().st_mode):
            raise RequestError('Invalid Video Lab file.')
    for path in paths:
        path.unlink(missing_ok=True)
    INVALIDATE_SOURCE_CACHE()


def bookmarks():
    path = checked_path(sample_root(), 'videolab_bookmarks.json')
    if not path.exists():
        return [dict(BUILTIN)]
    items = json.loads(read_private(path, 128 * 1024))
    if not isinstance(items, list) or len(items) > 100:
        raise RequestError('Invalid Video Lab bookmarks.')
    validated = [dict(BUILTIN)]
    for item in items:
        if not isinstance(item, dict) or not IDENTIFIER.fullmatch(str(item.get('id', ''))):
            raise RequestError('Invalid Video Lab bookmark.')
        url, video, offset = source_url(item.get('url'))
        validated.append({'id': item['id'], 'name': checked_name(item.get('name')), 'url': url})
    return validated


def update_bookmarks(payload=None, remove=None):
    items = bookmarks()[1:]
    if remove is not None:
        if not IDENTIFIER.fullmatch(remove) or not any(item['id'] == remove for item in items):
            raise RequestError('Bookmark not found; the built-in bookmark cannot be deleted.', 404)
        items = [item for item in items if item['id'] != remove]
    else:
        if len(items) >= 100:
            raise RequestError('Video Lab supports up to 100 saved bookmarks.', 409)
        url, video, offset = source_url(payload.get('url'))
        items.append({'id': secrets.token_hex(16), 'name': checked_name(payload.get('name')), 'url': url})
    root = sample_root(create=True)
    destination = checked_path(root, 'videolab_bookmarks.json')
    temporary = checked_path(root, 'videolab_bookmarks-' + secrets.token_hex(16) + '.tmp')
    try:
        write_private(temporary, json.dumps(items, ensure_ascii=False).encode())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return [dict(BUILTIN), *items]


def session_key(token):
    return hashlib.sha256((token or '').encode()).hexdigest()


def owner_snapshot():
    user = ACCOUNTS.current_user()
    if user is None:
        raise RequestError('Login required.', 401)
    return (str(user['id']), str(pathlib.Path(SOURCE_ROOT).absolute()))


def public_capture(job):
    capture = {key: job[key] for key in ('id', 'status', 'url', 'startSeconds', 'durationSeconds', 'createdAt')}
    capture.update(job.get('metadata', {}))
    if job['status'] == 'ready':
        capture['audioUrl'] = '/mygrain/api/videolab/captures/' + job['id'] + '/audio'
    if job.get('error'):
        capture['error'] = job['error']
    return capture


def terminate(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def cancel_job(job):
    job['cancel'].set()
    job['status'] = 'cancelled'
    job['finished'] = time.monotonic()
    process = job.get('process')
    if process is not None:
        terminate(process)
    if job.get('directory') is not None and not job.get('running'):
        try:
            shutil.rmtree(job['directory'])
        except FileNotFoundError:
            pass
        except OSError:
            return
        job.pop('directory', None)


def cancel_session(token):
    key = session_key(token)
    with JOB_LOCK:
        for job in JOBS.values():
            if job['session'] == key:
                cancel_job(job)


def cleanup_jobs():
    now = time.monotonic()
    with JOB_LOCK:
        for identifier, job in list(JOBS.items()):
            if not job.get('running') and (job['status'] == 'cancelled' or now - job.get('finished', job['started']) > TTL_SECONDS):
                if job.get('directory') is not None:
                    try:
                        shutil.rmtree(job['directory'])
                    except FileNotFoundError:
                        pass
                    except OSError:
                        continue
                JOBS.pop(identifier)


def janitor():
    while True:
        time.sleep(30)
        try:
            cleanup_jobs()
        except OSError:
            pass


def start_capture(payload, token):
    global JANITOR_STARTED
    url, video, link_start = source_url(payload.get('url'), capture=True)
    source = 'instagram' if url.startswith('https://www.instagram.com/') else 'youtube'
    if payload.get('source', source) != source:
        raise RequestError('The selected source does not match this URL.')
    start = finite_number(payload.get('startSeconds', 0), 0, 21600, 'Start time') or link_start
    duration = finite_number(payload.get('durationSeconds', 120), 0.021, MAX_SECONDS, 'Duration')
    owner = owner_snapshot()
    cleanup_jobs()
    with JOB_LOCK:
        active = [job for job in JOBS.values() if job.get('running')]
        if len(active) >= GLOBAL_LIMIT or sum(job['owner'] == owner for job in active) >= USER_LIMIT:
            raise RequestError('A Video Lab capture is already running. Wait or cancel it first.', 429)
        if len(JOBS) >= MAX_JOBS or sum(job['owner'] == owner for job in JOBS.values()) >= MAX_USER_JOBS:
            raise RequestError('Video Lab capture storage is full. Delete old captures or wait for expiry.', 429)
        identifier = secrets.token_hex(16)
        job = {'id': identifier, 'owner': owner, 'session': session_key(token), 'status': 'queued', 'url': url,
               'video': video, 'source': source, 'startSeconds': start, 'durationSeconds': duration, 'started': time.monotonic(),
               'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'cancel': threading.Event(), 'running': True}
        JOBS[identifier] = job
        initial = public_capture(job)
        try:
            threading.Thread(target=run_capture, args=(job, token, ACCOUNT_STORE), name='videolab-' + identifier, daemon=True).start()
        except RuntimeError:
            JOBS.pop(identifier)
            raise RequestError('Video Lab cannot start another capture right now.', 503) from None
        if not JANITOR_STARTED:
            try:
                threading.Thread(target=janitor, name='videolab-cleanup', daemon=True).start()
                JANITOR_STARTED = True
            except RuntimeError:
                pass
        return initial


def get_capture(identifier):
    if not IDENTIFIER.fullmatch(identifier):
        raise RequestError('Capture not found.', 404)
    job = JOBS.get(identifier)
    if job is None or job['owner'] != owner_snapshot():
        raise RequestError('Capture not found.', 404)
    return job


def worker_environment(work):
    return {'PATH': '/usr/bin:/bin', 'HOME': str(work), 'TMPDIR': str(work), 'XDG_CONFIG_HOME': str(work),
            'XDG_CACHE_HOME': str(work), 'GST_REGISTRY': str(work / 'registry.bin'), 'GST_PLUGIN_PATH': '',
            'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1',
            'NODE_OPTIONS': '--max-old-space-size=128'}


def run_capture(job, token, store):
    process, directory, descriptor = None, None, None
    try:
        with JOB_LOCK:
            if job['cancel'].is_set():
                return
            if time.monotonic() >= job['started'] + DEADLINE_SECONDS:
                raise RequestError('Capture exceeded the 120-second deadline.')
            job['status'] = 'working'
        runtime = pathlib.Path(os.environ.get('MYGRAIN_VIDEOLAB_JOBS_ROOT', '/var/lib/mygrain-videolab/jobs'))
        if not runtime.is_absolute():
            raise RequestError('Video Lab jobs storage must use an absolute path.')
        ACCOUNTS.checked_path(runtime)
        runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        details = runtime.stat()
        if details.st_uid != os.geteuid() or details.st_mode & 0o077:
            raise RequestError('Video Lab jobs storage must be private to the server account.')
        directory = pathlib.Path(tempfile.mkdtemp(prefix='videolab-', dir=runtime))
        directory.chmod(0o700)
        work = directory / 'worker'
        work.mkdir(mode=0o700)
        if os.geteuid() == 0:
            os.chown(work, 65534, 65534)
        descriptor = os.open(pathlib.Path(__file__).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        work_descriptor = os.open(work, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            worker_path = f'/proc/self/fd/{descriptor}/videolab_worker.py'
            work_path = pathlib.Path(f'/proc/self/fd/{work_descriptor}')
            python = os.environ.get('MYGRAIN_VIDEOLAB_PYTHON', '/var/lib/mygrain-videolab/runtime/.venv/bin/python')
            if not pathlib.Path(python).is_absolute():
                raise RequestError('Video Lab runtime must use an absolute Python path.')
            command = [python, '-I', '-B', worker_path, str(work_path), job['video'], str(job['startSeconds']), str(job['durationSeconds'])]
            if job.get('source') == 'instagram':
                command.append('instagram')
            privilege = {'user': 65534, 'group': 65534, 'extra_groups': ()} if os.geteuid() == 0 else {}
            with JOB_LOCK:
                if job['cancel'].is_set():
                    return
                process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                           cwd='/', env=worker_environment(work_path), start_new_session=True,
                                           pass_fds=(descriptor, work_descriptor), umask=0o077, **privilege)
                job['process'] = process
        finally:
            os.close(work_descriptor)
        os.close(descriptor)
        descriptor = None
        deadline, output, last_session_check = job['started'] + DEADLINE_SECONDS, bytearray(), 0
        os.set_blocking(process.stdout.fileno(), False)
        while True:
            now = time.monotonic()
            if job['cancel'].is_set():
                return
            if now >= deadline:
                raise RequestError('Capture exceeded the 120-second deadline. Try a shorter public video.')
            if now - last_session_check >= 1:
                user = store.session_user(token)
                if user is None or str(user['id']) != job['owner'][0]:
                    with JOB_LOCK:
                        cancel_job(job)
                    return
                last_session_check = now
            try:
                chunk = os.read(process.stdout.fileno(), 8193)
            except BlockingIOError:
                chunk = b''
            output.extend(chunk)
            if len(output) > 8192:
                raise RequestError('Capture worker returned invalid output.')
            if process.poll() is not None and not chunk:
                break
            job['cancel'].wait(0.05)
        if process.returncode != 0:
            if job.get('source') == 'instagram':
                try:
                    failure = json.loads(output)
                except (ValueError, UnicodeError):
                    failure = {}
                if isinstance(failure, dict) and failure.get('errorCode') == 'access_required':
                    raise RequestError('Instagram requires login or has limited anonymous access to this Reel. Instagram login is not connected yet. Try another public Reel. Your previous take is unchanged.')
                if isinstance(failure, dict) and failure.get('errorCode') == 'no_audio':
                    raise RequestError('This Reel has no audio soundtrack to capture. Try another public Reel. Your previous take is unchanged.')
                raise RequestError('This public Reel could not be fetched. It may be unavailable, restricted, too large or temporarily blocked. Instagram login is not connected yet. Try another public Reel. Your previous take is unchanged.')
            raise RequestError('Unable to import this public video. Restricted, live, oversized or unavailable videos are not supported.')
        result = json.loads(output)
        if not isinstance(result, dict) or result.get('ok') is not True or result.get('videoId') != job['video']:
            raise RequestError('Capture worker returned invalid metadata.')
        body, metadata = normalize_wav(read_private(work / 'audio.wav', MAX_BYTES))
        if metadata['sampleRate'] != 44100 or metadata['channels'] != 1 or metadata['bitsPerSample'] != 16 or metadata['duration'] > job['durationSeconds'] + 1 / 44100 or metadata['duration'] * metadata['sampleRate'] * metadata['channels'] * 4 > MAX_PCM_BYTES:
            raise RequestError('Capture worker returned invalid PCM audio.')
        source_duration = finite_number(result.get('sourceDuration'), 0.021, 86400 * 366, 'Source duration')
        if result.get('sourceDurationKnown') is False:
            source_duration = None
        title = result.get('title')
        if not isinstance(title, str) or not 1 <= len(title) <= 300 or any(ord(character) < 32 for character in title) or re.search(r'https?://', title, re.I):
            raise RequestError('Capture worker returned invalid source title.')
        write_private(directory / 'audio.wav', body)
        shutil.rmtree(work)
        with JOB_LOCK:
            if job['cancel'].is_set():
                return
            job['metadata'] = {'title': title, 'sourceTitle': title, 'sourceDuration': source_duration,
                               'source': {'title': title, 'duration': source_duration, 'url': job['url'], 'videoId': job['video']},
                               **metadata, 'bytes': len(body)}
            job['directory'] = directory
            job['status'] = 'ready'
            directory = None
    except Exception as error:
        with JOB_LOCK:
            if not job['cancel'].is_set():
                job['status'] = 'error'
                job['error'] = str(error) if isinstance(error, RequestError) else 'Video Lab import failed. Check the server runtime and try a public video.'
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if process is not None:
            terminate(process)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
            process.stdout.close()
        if directory is not None:
            try:
                shutil.rmtree(directory)
            except FileNotFoundError:
                pass
            except OSError:
                with JOB_LOCK:
                    job['directory'] = directory
        with JOB_LOCK:
            job.pop('process', None)
            job['running'] = False
            job['finished'] = time.monotonic()
            if job['cancel'].is_set():
                cancel_job(job)


def read_body(handler, maximum, minimum=1):
    lengths = handler.headers.get_all('Content-Length', [])
    if handler.headers.get('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]+', lengths[0]):
        raise RequestError('Provide one fixed Content-Length.')
    length = int(lengths[0])
    if not minimum <= length <= maximum:
        raise RequestError('Invalid Video Lab request body size.', 413)
    body = handler.rfile.read(length)
    if len(body) != length:
        raise RequestError('Incomplete Video Lab request.')
    return body


def read_json(handler):
    payload = json.loads(read_body(handler, 8192))
    if not isinstance(payload, dict):
        raise RequestError('Provide a JSON object.')
    return payload


def send_audio(handler, body, filename=None):
    handler.send_response(200)
    handler.send_header('Content-Type', 'audio/wav')
    handler.send_header('Content-Length', str(len(body)))
    if filename is not None:
        fallback = re.sub(r'[^A-Za-z0-9._-]', '-', filename)
        handler.send_header('Content-Disposition', 'inline; filename="' + fallback + '"; filename*=UTF-8\'\'' + quote(filename, safe=''))
    for name, value in NO_CACHE.items():
        handler.send_header(name, value)
    handler.end_headers()
    handler.wfile.write(body)


def handle_videolab_request(handler, method, inner):
    prefix = '/api/videolab'
    if inner != prefix and not inner.startswith(prefix + '/'):
        return False
    try:
        query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
        suffix = inner[len(prefix):]
        if suffix == '/bookmarks' and method == 'GET':
            payload = {'ok': True, 'bookmarks': bookmarks()}
        elif suffix == '/bookmarks' and method == 'POST':
            payload = {'ok': True, 'bookmarks': update_bookmarks(read_json(handler))}
        elif suffix.startswith('/bookmarks/') and method == 'DELETE':
            payload = {'ok': True, 'bookmarks': update_bookmarks(remove=suffix[len('/bookmarks/'):])}
        elif suffix == '/captures' and method == 'POST':
            capture = start_capture(read_json(handler), ACCOUNTS.request_token(handler))
            handler.send_json({'ok': True, 'capture': capture}, status=202, extra_headers=NO_CACHE)
            return True
        elif suffix.startswith('/captures/'):
            parts = suffix.split('/')
            if len(parts) not in (3, 4) or (len(parts) == 4 and parts[3] != 'audio'):
                raise RequestError('Capture not found.', 404)
            with JOB_LOCK:
                job = get_capture(parts[2])
                if len(parts) == 4 and method == 'GET':
                    if job['status'] != 'ready':
                        raise RequestError('Capture audio is not ready.', 409)
                    body = read_private(job['directory'] / 'audio.wav', MAX_BYTES)
                elif len(parts) == 3 and method == 'DELETE':
                    cancel_job(job)
                    payload = {'ok': True, 'capture': public_capture(job)}
                elif len(parts) == 3 and method == 'GET':
                    payload = {'ok': True, 'capture': public_capture(job)}
                else:
                    raise RequestError('Method not allowed.', 405)
            if len(parts) == 4:
                send_audio(handler, body)
                return True
        elif suffix == '/samples' and method == 'GET':
            payload = {'ok': True, 'samples': list_samples(), 'folder': FOLDER}
        elif suffix == '/samples' and method == 'POST':
            names = query.get('name', [])
            if len(names) != 1:
                raise RequestError('Provide one sample name.')
            sources = query.get('sourceFilename', [])
            if len(sources) > 1 or (sources and not sources[0]):
                raise RequestError('Provide one source filename.')
            payload = {'ok': True, 'sample': save_sample(names[0], read_body(handler, MAX_BYTES, 44), sources[0] if sources else '')}
        elif suffix.startswith('/samples/') and suffix.endswith('/rename') and method == 'POST':
            fields = read_json(handler)
            if set(fields) != {'name'}:
                raise RequestError('Provide one sample name.')
            filename = suffix[len('/samples/'):-len('/rename')]
            payload = {'ok': True, 'sample': rename_sample(filename, fields['name'])}
        elif suffix.startswith('/samples/') and method in ('GET', 'DELETE'):
            filename = suffix[len('/samples/'):]
            path, metadata = sample_paths(filename)
            if method == 'GET':
                sample = read_sample(filename)
                body, info = normalize_wav(read_private(path, MAX_BYTES))
                send_audio(handler, body, sample['downloadName'])
                return True
            delete_sample(filename)
            payload = {'ok': True, 'filename': filename}
        else:
            raise RequestError('Unknown Video Lab endpoint or method.', 404)
        handler.send_json(payload, extra_headers=NO_CACHE)
    except FileNotFoundError:
        handler.close_connection = True
        handler.send_json({'ok': False, 'error': 'Video Lab item not found.'}, status=404, extra_headers=NO_CACHE)
    except (ValueError, OSError) as error:
        handler.close_connection = True
        message = str(error) if isinstance(error, RequestError) else 'Invalid Video Lab request or unavailable storage.'
        handler.send_json({'ok': False, 'error': message}, status=getattr(error, 'status', 400), extra_headers=NO_CACHE)
    return True
