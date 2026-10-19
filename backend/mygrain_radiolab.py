import datetime
import contextvars
import errno
import functools
import http.client
import ipaddress
import json
import os
import pathlib
import queue
import re
import secrets
import select
import socket
import ssl
import stat
import struct
import subprocess
import threading
import time
from contextlib import contextmanager
from urllib.parse import parse_qs, quote, urljoin, urlsplit


FOLDER = 'SAMPLES_RADIOLAB'
SOURCE_ROOT = None
ACCOUNTS = None
INVALIDATE_SOURCE_CACHE = lambda: None
MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_DURATION_SECONDS = 180
MAX_STREAM_SECONDS = 30 * 60
MAX_STREAM_BYTES = 256 * 1024 * 1024
MAX_PCM_SECONDS = 120
MAX_PCM_BYTES = 32 * 1024 * 1024
PCM_SAMPLE_RATE = 44100
PCM_CHANNELS = 2
PCM_FRAME_BYTES = PCM_CHANNELS * 2
PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_FRAME_BYTES
PCM_CHUNK_BYTES = 16 * 1024
PCM_START_TIMEOUT = 10
DECODER_COMMAND = (
    '/usr/bin/gst-launch-1.0', '-q', 'fdsrc', 'fd=0', '!', 'decodebin', '!',
    'audioconvert', '!', 'audioresample', '!',
    'audio/x-raw,format=S16LE,rate=44100,channels=2,layout=interleaved', '!',
    'fdsink', 'fd=1', 'sync=false',
)
MAX_USER_STREAMS = 4
MAX_GLOBAL_STREAMS = 8
CONNECT_TIMEOUT = 8
READ_TIMEOUT = 8
WRITE_TIMEOUT = 5
REPLACE_TIMEOUT = 2
STREAM_SCOPE_SECONDS = 60 * 60
MAX_USER_STREAM_SCOPES = 64
MAX_STREAM_SCOPES = 1024
MAX_REDIRECTS = 3
STATIONS = (
    {'id': 'vesti-fm', 'name': 'Вести FM / Vesti FM', 'language': 'Russian', 'kind': 'State broadcaster · news/talk', 'url': 'https://icecast-vgtrk.cdnvideo.ru/vestifm_mp3_192kbps'},
    {'id': 'radio-rossii', 'name': 'Радио России / Radio Rossii', 'language': 'Russian', 'kind': 'State broadcaster · talk/culture', 'url': 'https://icecast-vgtrk.cdnvideo.ru/rrzonam_mp3_192kbps'},
    {'id': 'radio-mayak', 'name': 'Маяк / Radio Mayak', 'language': 'Russian', 'kind': 'State broadcaster · talk/mixed', 'url': 'https://icecast-vgtrk.cdnvideo.ru/mayakfm_mp3_192kbps'},
    {'id': 'sputnik-russian', 'name': 'Радио Sputnik', 'language': 'Russian', 'kind': 'State broadcaster · news/talk', 'url': 'https://icecast-rian.cdnvideo.ru/voicerus'},
    {'id': 'rfi-chinese', 'name': 'RFI 中文', 'language': 'Mandarin Chinese', 'kind': 'Public international broadcaster · news/talk', 'url': 'https://rfichinois96k.ice.infomaniak.ch/rfichinois-96k.mp3'},
    {'id': 'jbreeze-global', 'name': 'J-Breeze Global (formerly Sakura Radio)', 'language': 'Japanese', 'kind': 'News/talk/culture · some music', 'url': 'https://streamer.radio.co/s5d7f2937d/low'},
    {'id': 'kzoo', 'name': 'KZOO Hawaii', 'language': 'Japanese', 'kind': 'Community news/talk · some music', 'url': 'https://us2.streamingpulse.com/ssl/KZOO'},
    {'id': 'lbc', 'name': 'LBC UK', 'language': 'English', 'kind': 'Talk/call-in', 'url': 'https://media-ice.musicradio.com/LBCUKMP3'},
    {'id': 'bbc-world', 'name': 'BBC World Service', 'language': 'English', 'kind': 'Public broadcaster · news/talk', 'url': 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service'},
    {'id': 'shanghai-news', 'name': '上海新闻广播 / Shanghai News Radio', 'language': 'Mandarin Chinese', 'kind': 'State broadcaster · news/talk', 'url': 'https://lhttp.qingting.fm/live/270/64k.mp3'},
    {'id': 'dongguang-news', 'name': '长三角之声 / Dongguang News', 'language': 'Mandarin Chinese', 'kind': 'State broadcaster · regional news/talk', 'url': 'https://lhttp.qingting.fm/live/275/64k.mp3'},
    {'id': 'rthk-radio1', 'name': '香港電台第一台 / RTHK Radio 1', 'language': 'Cantonese', 'kind': 'Government public broadcaster · news/talk', 'url': 'https://stm.rthk.hk/radio1', 'sourceUrl': 'https://app4.rthk.hk/about/rthkeverywhere/internetradio_e.htm'},
    {'id': 'rnz-pacific', 'name': 'RNZ Pacific (New Zealand)', 'language': 'English / Pacific languages', 'kind': 'Public broadcaster · Pacific news/talk', 'url': 'https://stream-ice.radionz.co.nz/international.mp3', 'sourceUrl': 'https://stream-ice.radionz.co.nz/'},
    {'id': 'channel-africa', 'name': 'Channel Africa (South Africa)', 'language': 'English / African languages / French / Portuguese', 'kind': 'State broadcaster (SABC-managed) · African news/talk', 'url': 'https://28033.live.streamtheworld.com/CA247.mp3?dist=sabc-web-app', 'sourceUrl': 'https://www.channelafrica.co.za/channelafrica/'},
    {'id': 'rfi-monde', 'name': 'RFI Monde (France)', 'language': 'French', 'kind': 'Public international broadcaster · news/talk', 'url': 'https://rfimonde64k.ice.infomaniak.ch/rfimonde-64.mp3', 'sourceUrl': 'https://www.rfi.fr/fr/direct-monde'},
    {'id': 'france-culture', 'name': 'France Culture', 'language': 'French', 'kind': 'Public broadcaster · culture/documentary/drama', 'url': 'https://icecast.radiofrance.fr/franceculture-lofi.mp3?id=openapi', 'sourceUrl': 'https://developers.radiofrance.fr/doc/en/tutorial-by-example/list-brands'},
    {'id': 'wfmu-freeform', 'name': 'WFMU Freeform (New Jersey)', 'language': 'English', 'kind': 'Independent nonprofit · freeform/experimental music/talk', 'url': 'https://stream0.wfmu.org/freeform-128k', 'sourceUrl': 'https://www.wfmu.org/audiostream.shtml'},
    {'id': 'resonance-fm', 'name': 'Resonance FM (London)', 'language': 'English / multilingual programmes', 'kind': 'Community arts broadcaster · experimental sound/talk', 'url': 'https://stream.resonance.fm/resonance', 'sourceUrl': 'https://www.resonancefm.com/news/urlchange2020'},
    {'id': 'wrmi-9955', 'name': 'WRMI Radio Miami International · 9955 kHz service', 'language': 'English / Spanish / multilingual programmes', 'kind': 'Private shortwave broadcaster · brokered religious/talk/music', 'url': 'http://wrmi.listen.creek.fm/stream', 'sourceUrl': 'https://wrmi.net/'},
    {'id': 'tilos-radio', 'name': 'Tilos Rádió (Budapest)', 'language': 'Hungarian / multilingual programmes', 'kind': 'Community broadcaster · underground/freeform music/talk', 'url': 'https://stream.tilos.hu/tilos_128.mp3', 'sourceUrl': 'https://stream.tilos.hu/'},
    {'id': 'fsk-hamburg', 'name': 'FSK Freies Sender Kombinat (Hamburg)', 'language': 'German / multilingual programmes', 'kind': 'Community broadcaster · experimental arts/politics/music', 'url': 'https://streaming.fueralle.org/fsk.mp3', 'sourceUrl': 'https://www.fsk-hh.org/'},
)
STREAM_LOCK = threading.Lock()
ACTIVE_STREAMS = {}
STREAM_SCOPES = {}
STREAM_CONTEXT = contextvars.ContextVar('radiolab_stream', default=None)
DNS_SLOTS = threading.BoundedSemaphore(4)
NO_CACHE = {
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Vary': 'Cookie, X-Mygrain-User',
}
FILENAME_PATTERN = re.compile(r'[a-z0-9][a-z0-9-]{0,47}-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}\.wav')
SAMPLE_LOCK = threading.RLock()


class RequestError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class StorageError(ValueError):
    pass


class RelayError(ValueError):
    def __init__(self, message='This station is temporarily unavailable.', status=502):
        super().__init__(message)
        self.status = status


def station_by_id(station_id):
    for station in STATIONS:
        if station['id'] == station_id:
            return station
    raise RequestError('Choose a station from the RadioLab catalog.')


def one_query(query, name, required=False):
    values = query.get(name, [])
    if len(values) > 1 or (required and (not values or not values[0])):
        raise RequestError(f'Provide one {name}.')
    return values[0] if values else ''


def checked_storage_path(root, child):
    try:
        return ACCOUNTS.checked_path(pathlib.Path(root) / child, root)
    except ValueError as error:
        raise StorageError('Invalid RadioLab storage path.') from error


def sample_root(create=False):
    root = checked_storage_path(SOURCE_ROOT, FOLDER)
    if create:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root.chmod(0o700)
    return root


def sample_path(filename):
    if not isinstance(filename, str) or not FILENAME_PATTERN.fullmatch(filename):
        raise RequestError('Choose a saved RadioLab WAV filename.')
    root = sample_root()
    return checked_storage_path(root, filename)


def open_regular(path, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode) or not 0 < details.st_size <= maximum:
            raise StorageError('Invalid RadioLab file.')
        return os.fdopen(descriptor, 'rb')
    except BaseException:
        os.close(descriptor)
        raise


def checked_wav(body):
    if not 44 <= len(body) <= MAX_UPLOAD_BYTES or body[:4] != b'RIFF' or body[8:12] != b'WAVE':
        raise RequestError('Upload a complete PCM WAV recording, at most 64 MB.')
    if struct.unpack_from('<I', body, 4)[0] + 8 != len(body):
        raise RequestError('The WAV recording has an invalid length.')
    offset = 12
    format_fields = None
    data_size = None
    chunk_count = 0
    while offset < len(body):
        chunk_count += 1
        if chunk_count > 1024 or offset + 8 > len(body):
            raise RequestError('Invalid WAV chunk structure.')
        kind, length = struct.unpack_from('<4sI', body, offset)
        offset += 8
        if offset + length > len(body):
            raise RequestError('The WAV recording is incomplete.')
        if kind == b'fmt ':
            if format_fields is not None or length not in (16, 18):
                raise RequestError('Save an uncompressed PCM WAV recording.')
            format_fields = struct.unpack_from('<HHIIHH', body, offset)
            if length == 18 and body[offset + 16:offset + 18] != b'\x00\x00':
                raise RequestError('Save an uncompressed PCM WAV recording.')
        elif kind == b'data':
            if data_size is not None or format_fields is None:
                raise RequestError('Invalid WAV audio data.')
            data_size = length
        elif kind == b'smpl':
            if length < 36 or struct.unpack_from('<I', body, offset + 28)[0]:
                raise RequestError('RadioLab samples must be non-looping WAV recordings.')
        offset += length + (length % 2)
    if offset != len(body) or format_fields is None or data_size is None:
        raise RequestError('The WAV recording is incomplete.')
    encoding, channels, rate, byte_rate, alignment, bits = format_fields
    if encoding != 1 or channels not in (1, 2) or not 8000 <= rate <= 192000 or bits not in (8, 16, 24, 32):
        raise RequestError('Save a mono or stereo 8/16/24/32-bit PCM WAV recording at 8–192 kHz.')
    if alignment != channels * (bits // 8) or byte_rate != rate * alignment or data_size % alignment:
        raise RequestError('The WAV PCM format is inconsistent.')
    duration = data_size / byte_rate
    if not 0.02 < duration <= MAX_DURATION_SECONDS:
        raise RequestError(f'Recordings must be longer than 0.02 seconds and at most {MAX_DURATION_SECONDS} seconds.')
    return {'duration': duration, 'sampleRate': rate, 'channels': channels, 'bitsPerSample': bits}


def checked_name(name):
    if not isinstance(name, str):
        raise RequestError('Provide a sample name.')
    name = name.strip()
    if name.lower().endswith('.wav'):
        name = name[:-4].rstrip()
    if not name or len(name) > 100 or name in ('.', '..') or any(ord(character) < 32 or ord(character) == 127 or 0xD800 <= ord(character) <= 0xDFFF for character in name):
        raise RequestError('Use a sample name of 1–100 characters without control characters, not just dots.')
    return name


def locked_samples(operation):
    @functools.wraps(operation)
    def locked(*args, **kwargs):
        with SAMPLE_LOCK:
            return operation(*args, **kwargs)
    return locked


def download_name(name):
    return (re.sub(r'[<>:"/\\|?*]', '-', checked_name(name)).strip(' .') or 'radio-sample') + '.wav'


@locked_samples
def read_sample(filename):
    path = sample_path(filename)
    metadata_path = checked_storage_path(path.parent, path.name + '.json')
    with open_regular(metadata_path, 16 * 1024) as metadata_file:
        try:
            sample = json.loads(metadata_file.read(16 * 1024 + 1))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise StorageError('Invalid RadioLab sample metadata.') from error
    if not isinstance(sample, dict) or sample.get('filename') != filename or not isinstance(sample.get('name'), str):
        raise StorageError('Invalid RadioLab sample metadata.')
    if not isinstance(sample.get('duration'), (int, float)) or not 0.02 < sample['duration'] <= MAX_DURATION_SECONDS:
        raise StorageError('Invalid RadioLab sample duration.')
    if not isinstance(sample.get('createdAt'), str) or sample.get('bytes') != path.stat().st_size:
        raise StorageError('Invalid RadioLab sample metadata.')
    return {**sample, 'downloadName': download_name(sample['name']), 'url': '/mygrain/api/radiolab/file?name=' + quote(filename)}


@locked_samples
def list_samples():
    root = sample_root()
    if not root.exists():
        return []
    samples = []
    for path in root.glob('*.wav'):
        if path.is_symlink() or not FILENAME_PATTERN.fullmatch(path.name):
            continue
        try:
            samples.append(read_sample(path.name))
        except (OSError, ValueError):
            continue
    return sorted(samples, key=lambda sample: (sample['createdAt'], sample['filename']), reverse=True)


def write_private(path, body):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


@locked_samples
def save_sample(query, body):
    name = checked_name(one_query(query, 'name', required=True))
    source_filename = one_query(query, 'sourceFilename', required='sourceFilename' in query)
    try:
        source = read_sample(source_filename) if source_filename else {}
    except FileNotFoundError as error:
        raise RequestError('RadioLab source sample not found.', 404) from error
    station_id = one_query(query, 'station')
    if station_id:
        station_by_id(station_id)
    metadata = checked_wav(body)
    now = datetime.datetime.now(datetime.timezone.utc)
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:48].rstrip('-') or 'radio-sample'
    filename = f'{slug}-{now.strftime("%Y%m%dT%H%M%SZ")}-{secrets.token_hex(8)}.wav'
    root = sample_root(create=True)
    path = sample_path(filename)
    metadata_path = checked_storage_path(root, filename + '.json')
    sample = {
        **{key: value for key, value in source.items() if key not in ('url', 'downloadName')},
        'name': name, 'filename': filename, 'createdAt': now.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'bytes': len(body), **metadata,
    }
    if source_filename:
        sample['sourceFilename'] = source_filename
    elif station_id:
        sample['station'] = station_id
    created = []
    try:
        write_private(path, body)
        created.append(path)
        write_private(metadata_path, json.dumps(sample, ensure_ascii=False).encode('utf-8'))
        created.append(metadata_path)
    except BaseException:
        for target in created:
            target.unlink(missing_ok=True)
        raise
    INVALIDATE_SOURCE_CACHE()
    return {**sample, 'downloadName': download_name(name), 'url': '/mygrain/api/radiolab/file?name=' + quote(filename)}


@locked_samples
def rename_sample(filename, name):
    name = checked_name(name)
    sample = read_sample(filename)
    path = sample_path(filename)
    with open_regular(path, MAX_UPLOAD_BYTES):
        pass
    if sample['name'] == name:
        return sample
    metadata_path = checked_storage_path(path.parent, filename + '.json')
    temporary = checked_storage_path(path.parent, 'radiolab-rename-' + secrets.token_hex(16) + '.tmp')
    with open_regular(metadata_path, 16 * 1024) as metadata_file:
        metadata = json.loads(metadata_file.read(16 * 1024 + 1))
    metadata['name'] = name
    created = False
    try:
        write_private(temporary, json.dumps(metadata, ensure_ascii=False).encode('utf-8'))
        created = True
        os.replace(temporary, metadata_path)
    finally:
        if created:
            temporary.unlink(missing_ok=True)
    INVALIDATE_SOURCE_CACHE()
    return {**sample, 'name': name, 'downloadName': download_name(name)}


@locked_samples
def delete_sample(filename):
    path = sample_path(filename)
    metadata_path = checked_storage_path(path.parent, path.name + '.json')
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    deleted = False
    try:
        targets = []
        for name in (path.name, metadata_path.name):
            try:
                details = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(details.st_mode):
                raise StorageError('Invalid RadioLab sample file.')
            targets.append(name)
        if not targets:
            raise FileNotFoundError(errno.ENOENT, 'RadioLab sample not found.')
        for name in targets:
            try:
                os.unlink(name, dir_fd=descriptor)
                deleted = True
            except FileNotFoundError:
                pass
    finally:
        os.close(descriptor)
        if deleted:
            INVALIDATE_SOURCE_CACHE()


def read_upload(handler):
    lengths = handler.headers.get_all('Content-Length', [])
    if handler.headers.get('Transfer-Encoding') or len(lengths) != 1:
        raise RequestError('Provide one fixed WAV upload length.')
    try:
        length = int(lengths[0])
    except ValueError as error:
        raise RequestError('Invalid upload length.') from error
    if not 44 <= length <= MAX_UPLOAD_BYTES:
        raise RequestError('Upload a PCM WAV recording, at most 64 MB.')
    body = handler.rfile.read(length)
    if len(body) != length:
        raise RequestError('The WAV upload was incomplete; nothing was saved.')
    return body


def read_rename(handler):
    lengths = handler.headers.get_all('Content-Length', [])
    if handler.headers.get('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]+', lengths[0]):
        raise RequestError('Provide one fixed rename request length.')
    try:
        length = int(lengths[0])
    except ValueError as error:
        raise RequestError('Invalid rename request size.') from error
    if not 1 <= length <= 8192:
        raise RequestError('Invalid rename request size.')
    body = handler.rfile.read(length)
    if len(body) != length:
        raise RequestError('Incomplete rename request.')
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, ValueError) as error:
        raise RequestError('Provide a JSON rename object.') from error
    if not isinstance(payload, dict) or set(payload) != {'filename', 'name'}:
        raise RequestError('Provide one filename and one sample name.')
    return payload


def handle_radiolab_request(handler, method, inner):
    prefix = '/api/radiolab'
    if inner != prefix and not inner.startswith(prefix + '/'):
        return False
    try:
        query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
        if inner == prefix + '/stations' and method == 'GET':
            user = ACCOUNTS.current_user()
            stations = [{
                **{key: station[key] for key in ('id', 'name', 'language', 'kind')},
                'streamUrl': '/mygrain/radiolab/stream/' + quote(station['id'], safe='') + '?_mygrain_user=' + quote(user['username']),
            } for station in STATIONS]
            handler.send_json({'ok': True, 'stations': stations, 'rewindSeconds': 15,
                               'maxDurationSeconds': MAX_DURATION_SECONDS, 'maxUploadBytes': MAX_UPLOAD_BYTES}, extra_headers=NO_CACHE)
        elif inner == prefix + '/samples' and method == 'GET':
            handler.send_json({'ok': True, 'samples': list_samples(), 'folder': FOLDER}, extra_headers=NO_CACHE)
        elif inner == prefix + '/stream/release' and method == 'POST':
            client, generation = stream_identity(query, required=True)
            handler.close_connection = True
            released = release_stream(ACCOUNTS.current_user()['id'], client, generation)
            handler.send_json({'ok': True, 'released': released}, extra_headers=NO_CACHE)
        elif inner == prefix + '/samples' and method == 'POST':
            sample = save_sample(query, read_upload(handler))
            handler.send_json({'ok': True, 'sample': sample, 'folder': FOLDER}, status=201, extra_headers=NO_CACHE)
        elif inner == prefix + '/rename' and method == 'POST':
            payload = read_rename(handler)
            sample = rename_sample(payload['filename'], payload['name'])
            handler.send_json({'ok': True, 'sample': sample, 'folder': FOLDER}, extra_headers=NO_CACHE)
        elif inner == prefix + '/samples' and method == 'DELETE':
            filename = one_query(query, 'name', required=True)
            delete_sample(filename)
            handler.send_json({'ok': True, 'deleted': True, 'filename': filename, 'folder': FOLDER}, extra_headers=NO_CACHE)
        elif inner == prefix + '/file' and method == 'GET':
            filename = one_query(query, 'name', required=True)
            sample = read_sample(filename)
            with open_regular(sample_path(filename), MAX_UPLOAD_BYTES) as source:
                payload = source.read(MAX_UPLOAD_BYTES + 1)
            handler.send_response(200)
            handler.send_header('Content-Type', 'audio/wav')
            handler.send_header('Content-Length', str(len(payload)))
            fallback = re.sub(r'[^A-Za-z0-9._-]', '-', sample['downloadName'])
            handler.send_header('Content-Disposition', 'inline; filename="' + fallback + '"; filename*=UTF-8\'\'' + quote(sample['downloadName'], safe=''))
            for name, value in NO_CACHE.items():
                handler.send_header(name, value)
            handler.end_headers()
            handler.wfile.write(payload)
        else:
            handler.send_json({'ok': False, 'error': 'Unknown RadioLab endpoint or method.'}, status=404, extra_headers=NO_CACHE)
    except RequestError as error:
        handler.close_connection = True
        handler.send_json({'ok': False, 'error': str(error)}, status=error.status, extra_headers=NO_CACHE)
    except RelayError as error:
        handler.close_connection = True
        handler.send_json({'ok': False, 'error': str(error)}, status=error.status, extra_headers=NO_CACHE)
    except (StorageError, OSError) as error:
        handler.close_connection = True
        if isinstance(error, FileNotFoundError) and ((inner in (prefix + '/file', prefix + '/rename') and method in ('GET', 'POST')) or (inner == prefix + '/samples' and method == 'DELETE')):
            status, message = 404, 'RadioLab sample not found.'
        else:
            handler.log_error('RadioLab private storage failure (%s, errno=%s)', type(error).__name__, getattr(error, 'errno', None))
            if getattr(error, 'errno', None) in (errno.ENOSPC, errno.EDQUOT):
                status, message = 507, 'RadioLab private storage is full. Contact the administrator, then retry Save.'
            elif getattr(error, 'errno', None) in (errno.EACCES, errno.EPERM, errno.EROFS):
                status, message = 503, 'RadioLab private storage cannot be accessed. Contact the administrator.'
            else:
                status, message = 503, 'RadioLab private storage is unavailable. Try again later or contact the administrator.'
        handler.send_json({'ok': False, 'error': message}, status=status, extra_headers=NO_CACHE)
    return True


def stream_identity(query, required=False):
    client = one_query(query, '_radiolab_client')
    generation = one_query(query, '_radiolab_generation')
    if not required and '_radiolab_client' not in query and '_radiolab_generation' not in query:
        return '', None
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,96}', client) or not re.fullmatch(r'[1-9][0-9]{0,15}', generation) or int(generation) > 9007199254740991:
        raise RequestError('Provide one valid RadioLab page client and generation.')
    return client, int(generation)


def close_transport(transport):
    try:
        transport.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    try:
        transport.close()
    except OSError:
        pass


class StreamLease:
    def __init__(self, downstream=None):
        self.downstream = downstream
        self.transports = []
        self.lock = threading.Lock()
        self.cancelled = threading.Event()
        self.done = threading.Event()
        self.decoder = None

    def check(self):
        if self.cancelled.is_set():
            raise RelayError('This RadioLab tune was superseded or stopped.', 409)

    def track(self, transport):
        with self.lock:
            if not self.cancelled.is_set():
                self.transports.append(transport)
                return
        close_transport(transport)
        self.check()

    def cancel(self):
        with self.lock:
            self.cancelled.set()
            transports = [*self.transports]
            if self.downstream is not None:
                transports.append(self.downstream)
            decoder = self.decoder
        if decoder is not None:
            decoder.cancel()
        for transport in transports:
            close_transport(transport)

    def track_decoder(self, decoder):
        with self.lock:
            self.decoder = decoder
            cancelled = self.cancelled.is_set()
        if cancelled:
            decoder.cancel()
            self.check()

    def close_upstreams(self):
        with self.lock:
            transports = self.transports
            self.transports = []
        for transport in transports:
            close_transport(transport)

    def close(self):
        self.close_upstreams()
        if self.decoder is not None:
            self.decoder.close()
        with self.lock:
            self.downstream = None


class PCMDecoder:
    def __init__(self, lease, response):
        self.lease = lease
        self.response = response
        self.process = None
        self.worker = None
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.error = None
        self.closed = False
        self.deadline = time.monotonic() + MAX_PCM_SECONDS

    def start(self):
        with self.lock:
            self.lease.check()
            if self.stopped.is_set():
                raise RelayError('RadioLab recording stopped.', 409)
            try:
                self.process = subprocess.Popen(DECODER_COMMAND, stdin=subprocess.PIPE,
                                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                                bufsize=0, close_fds=True)
            except OSError as error:
                raise RelayError('RadioLab PCM decoder is unavailable.', 503) from error
            os.set_blocking(self.process.stdin.fileno(), False)
            os.set_blocking(self.process.stdout.fileno(), False)
            self.worker = threading.Thread(target=self.feed, name='radiolab-pcm-input', daemon=True)
            self.worker.start()

    def cancel(self):
        self.stopped.set()
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                try:
                    self.process.kill()
                except ProcessLookupError:
                    pass

    def close(self):
        if self.closed:
            return
        self.cancel()
        self.lease.close_upstreams()
        if self.process is not None:
            try:
                self.process.wait(timeout=1)
            except subprocess.TimeoutExpired as error:
                raise RelayError('RadioLab PCM decoder did not stop.') from error
        if self.worker is not None:
            self.worker.join(READ_TIMEOUT + WRITE_TIMEOUT + 1)
            if self.worker.is_alive():
                raise RelayError('RadioLab PCM input did not stop.')
        if self.process is not None:
            try:
                self.process.stdin.close()
            finally:
                self.process.stdout.close()
        self.closed = True

    def feed(self):
        try:
            while not self.stopped.is_set() and time.monotonic() < self.deadline:
                chunk = self.response.read1(32 * 1024)
                if not chunk:
                    if self.response.length not in (None, 0):
                        raise RelayError('RadioLab PCM upstream audio was truncated.')
                    break
                pending = memoryview(chunk)
                write_deadline = time.monotonic() + WRITE_TIMEOUT
                while pending and not self.stopped.is_set():
                    now = time.monotonic()
                    if now >= min(write_deadline, self.deadline):
                        raise RelayError('RadioLab PCM input timed out.')
                    if select.select([], [self.process.stdin], [], min(.1, write_deadline - now))[1]:
                        try:
                            written = os.write(self.process.stdin.fileno(), pending)
                        except BlockingIOError:
                            continue
                        pending = pending[written:]
                        write_deadline = time.monotonic() + WRITE_TIMEOUT
        except (RelayError, OSError, ValueError, http.client.HTTPException) as error:
            if not self.stopped.is_set():
                self.error = error
        finally:
            self.process.stdin.close()

    def check(self):
        self.lease.check()
        downstream = self.lease.downstream
        try:
            if downstream is not None and select.select([downstream], [], [], 0)[0]:
                if not downstream.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT):
                    raise RelayError('RadioLab recording disconnected.', 409)
        except BlockingIOError:
            pass
        except (OSError, ValueError) as error:
            raise RelayError('RadioLab recording disconnected.', 409) from error
        if self.error is not None:
            raise RelayError('RadioLab PCM upstream or decoder failed.') from self.error
        if self.process.poll() not in (None, 0):
            raise RelayError('RadioLab PCM decoder failed.')

    def chunks(self):
        remaining = min(MAX_PCM_BYTES, int(MAX_PCM_SECONDS * PCM_SAMPLE_RATE) * PCM_FRAME_BYTES)
        remaining -= remaining % PCM_FRAME_BYTES
        startup_deadline = min(self.deadline, time.monotonic() + PCM_START_TIMEOUT)
        idle_deadline = startup_deadline
        pending = b''
        emitted = 0
        clock = None
        while remaining:
            self.check()
            now = time.monotonic()
            if now >= self.deadline:
                break
            if now >= idle_deadline:
                raise RelayError('RadioLab PCM audio timed out.')
            if not select.select([self.process.stdout], [], [], min(.05, self.deadline - now))[0]:
                continue
            chunk = os.read(self.process.stdout.fileno(), min(PCM_CHUNK_BYTES, remaining))
            if not chunk:
                try:
                    result = self.process.wait(timeout=1)
                except subprocess.TimeoutExpired as error:
                    raise RelayError('RadioLab PCM decoder failed to finish.') from error
                self.check()
                if result or pending:
                    raise RelayError('RadioLab PCM decoder returned incomplete audio.')
                break
            pending += chunk
            complete = len(pending) - len(pending) % PCM_FRAME_BYTES
            if not complete:
                continue
            chunk, pending = pending[:complete], pending[complete:]
            if clock is None:
                clock = time.monotonic()
            target = clock + (emitted + len(chunk)) / PCM_BYTES_PER_SECOND
            while time.monotonic() < min(target, self.deadline):
                self.check()
                self.stopped.wait(min(.05, max(0, min(target, self.deadline) - time.monotonic())))
            self.check()
            if time.monotonic() >= self.deadline:
                break
            yield chunk
            emitted += len(chunk)
            remaining -= len(chunk)
            idle_deadline = time.monotonic() + READ_TIMEOUT
        if not emitted:
            raise RelayError('RadioLab station produced no decoded PCM audio.')


def stream_scope(user_id, client):
    now = time.monotonic()
    expired = [key for key, scope in STREAM_SCOPES.items()
               if not scope['leases'] and now - scope['touched'] >= STREAM_SCOPE_SECONDS]
    for key in expired:
        del STREAM_SCOPES[key]
    key = (user_id, client)
    if key not in STREAM_SCOPES:
        if len(STREAM_SCOPES) >= MAX_STREAM_SCOPES or sum(owner == user_id for owner, page in STREAM_SCOPES) >= MAX_USER_STREAM_SCOPES:
            raise RelayError('RadioLab page limit reached. Reuse this page or try again later.', 429)
        STREAM_SCOPES[key] = {'generation': 0, 'closed': False, 'station': None, 'leases': set(), 'touched': now}
    scope = STREAM_SCOPES[key]
    scope['touched'] = now
    return scope


def release_stream(user_id, client, generation):
    with STREAM_LOCK:
        scope = stream_scope(user_id, client)
        if generation < scope['generation']:
            return False
        scope['generation'] = generation
        scope['closed'] = True
        leases = tuple(scope['leases'])
    released = False
    for lease in leases:
        if not lease.cancelled.is_set():
            lease.cancel()
            released = True
    return released


@contextmanager
def stream_slot(user_id, client='', generation=None, downstream=None, station=None):
    lease = StreamLease(downstream)
    scope = None
    counted = False
    context = None
    deadline = time.monotonic() + REPLACE_TIMEOUT
    try:
        if client:
            with STREAM_LOCK:
                scope = stream_scope(user_id, client)
                # One media load may make several HTTP requests (iPhone first
                # probes bytes=0-1, then retries the same URL without Range).
                # Only an explicit Stop closes the current generation. A retry
                # replaces its transport, never consumes an additional slot.
                if generation < scope['generation'] or (generation == scope['generation'] and scope['closed']):
                    raise RelayError('This RadioLab tune was superseded or stopped.', 409)
                if generation == scope['generation'] and station != scope['station']:
                    raise RelayError('This RadioLab tune belongs to another station.', 409)
                previous = tuple(scope['leases'])
                scope['generation'] = generation
                scope['closed'] = False
                scope['station'] = station
                scope['leases'].add(lease)
            for prior in previous:
                prior.cancel()
            for prior in previous:
                if not prior.done.wait(max(0, deadline - time.monotonic())):
                    raise RelayError('The previous RadioLab stream is still closing. Try again.', 429)
        while True:
            with STREAM_LOCK:
                lease.check()
                user_full = ACTIVE_STREAMS.get(user_id, 0) >= MAX_USER_STREAMS
                global_full = sum(ACTIVE_STREAMS.values()) >= MAX_GLOBAL_STREAMS
                if not user_full and not global_full:
                    ACTIVE_STREAMS[user_id] = ACTIVE_STREAMS.get(user_id, 0) + 1
                    counted = True
                    break
                draining = {prior for (owner, page), candidate in STREAM_SCOPES.items()
                            if global_full or owner == user_id
                            for prior in candidate['leases']
                            if prior.cancelled.is_set() and not prior.done.is_set()}
            if not draining:
                raise RelayError('RadioLab stream limit reached. Stop another station and try again.', 429)
            for prior in draining:
                if not prior.done.wait(max(0, deadline - time.monotonic())):
                    raise RelayError('The previous RadioLab stream is still closing. Try again.', 429)
        context = STREAM_CONTEXT.set(lease)
        yield lease
    finally:
        if context is not None:
            STREAM_CONTEXT.reset(context)
        try:
            lease.close()
        finally:
            with STREAM_LOCK:
                if counted:
                    remaining = ACTIVE_STREAMS[user_id] - 1
                    if remaining:
                        ACTIVE_STREAMS[user_id] = remaining
                    else:
                        del ACTIVE_STREAMS[user_id]
                if scope is not None:
                    scope['leases'].discard(lease)
                    scope['touched'] = time.monotonic()
                lease.done.set()


def resolve_public_addresses(host, port):
    if not DNS_SLOTS.acquire(blocking=False):
        raise RelayError()
    result = queue.Queue(maxsize=1)

    def resolve():
        try:
            result.put((socket.getaddrinfo(host, port, type=socket.SOCK_STREAM), None))
        except OSError as error:
            result.put((None, error))
        finally:
            DNS_SLOTS.release()

    threading.Thread(target=resolve, daemon=True).start()
    deadline = time.monotonic() + CONNECT_TIMEOUT
    while True:
        lease = STREAM_CONTEXT.get()
        if lease is not None:
            lease.check()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RelayError()
        try:
            addresses, error = result.get(timeout=min(.1, remaining))
            break
        except queue.Empty:
            continue
    if error or not addresses:
        raise RelayError()
    for family, socktype, protocol, canonical, address in addresses:
        public_ip = ipaddress.ip_address(address[0])
        if family not in (socket.AF_INET, socket.AF_INET6) or not public_ip.is_global or public_ip.is_multicast or public_ip.is_reserved or '%' in address[0]:
            raise RelayError()
    return addresses


def checked_station_url(url, station):
    if not isinstance(url, str) or not url.isascii() or len(url) > 2048 or any(ord(character) <= 32 or ord(character) == 127 for character in url) or '\\' in url:
        raise RelayError()
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or '').encode('idna').decode('ascii').lower()
        allowed = {urlsplit(station['url']).hostname, *station.get('redirectHosts', ())}
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        if parsed.scheme not in ('http', 'https') or port != (443 if parsed.scheme == 'https' else 80) or not host or host not in allowed or parsed.username is not None or parsed.password is not None or parsed.fragment:
            raise RelayError()
        if urlsplit(station['url']).scheme == 'https' and parsed.scheme != 'https':
            raise RelayError()
    except (ValueError, UnicodeError) as error:
        raise RelayError() from error
    return parsed, host, port


def open_pinned_connection(url, station):
    parsed, host, port = checked_station_url(url, station)
    addresses = resolve_public_addresses(host, port)
    deadline = time.monotonic() + CONNECT_TIMEOUT
    for family, socktype, protocol, canonical, address in addresses:
        connection = None
        transport = None
        try:
            lease = STREAM_CONTEXT.get()
            if lease is not None:
                lease.check()
            transport = socket.socket(family, socktype, protocol)
            if lease is not None:
                lease.track(transport)
            transport.settimeout(max(0.01, deadline - time.monotonic()))
            transport.connect(address)
            if parsed.scheme == 'https':
                transport = ssl.create_default_context().wrap_socket(transport, server_hostname=host, do_handshake_on_connect=False)
                if lease is not None:
                    lease.track(transport)
                transport.do_handshake()
                connection = http.client.HTTPSConnection(host, port, timeout=READ_TIMEOUT)
            else:
                connection = http.client.HTTPConnection(host, port, timeout=READ_TIMEOUT)
            transport.settimeout(READ_TIMEOUT)
            connection.sock = transport
            target = parsed.path or '/'
            if parsed.query:
                target += '?' + parsed.query
            connection.request('GET', target, headers={
                'User-Agent': 'MYGRAIN-RadioLab/1.0', 'Accept': 'audio/mpeg, audio/aac, audio/aacp',
                'Accept-Encoding': 'identity', 'Icy-MetaData': '0', 'Connection': 'close',
            })
            return connection, connection.getresponse()
        except (RelayError, OSError, http.client.HTTPException) as error:
            if connection is not None:
                connection.close()
            if transport is not None:
                transport.close()
            if isinstance(error, RelayError):
                raise
            if lease is not None:
                lease.check()
            if time.monotonic() >= deadline:
                break
    raise RelayError()


def open_station_stream(station):
    url = station['url']
    for redirect_count in range(MAX_REDIRECTS + 1):
        connection, response = open_pinned_connection(url, station)
        if response.status in (301, 302, 303, 307, 308):
            location = response.getheader('Location', '')
            response.close()
            connection.close()
            if not location or redirect_count == MAX_REDIRECTS:
                raise RelayError()
            url = urljoin(url, location)
            checked_station_url(url, station)
            continue
        content_type = response.getheader('Content-Type', '').split(';', 1)[0].strip().lower()
        if response.status != 200 or content_type not in ('audio/mpeg', 'audio/mp3', 'audio/aac', 'audio/aacp', 'audio/x-aac') or response.getheader('Content-Encoding', 'identity').lower() != 'identity':
            response.close()
            connection.close()
            raise RelayError()
        return connection, response, content_type
    raise RelayError()


def handle_stream_request(handler, inner):
    if handler.command != 'GET':
        return handler.send_json({'ok': False, 'error': 'Method not allowed.'}, status=405, extra_headers=NO_CACHE)
    station_id = inner.removeprefix('/radiolab/stream/')
    try:
        station = station_by_id(station_id)
    except RequestError:
        return handler.send_json({'ok': False, 'error': 'Unknown RadioLab station.'}, status=404, extra_headers=NO_CACHE)
    try:
        query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
        output_format = one_query(query, '_radiolab_format')
        if '_radiolab_format' in query and output_format != 'pcm':
            raise RequestError('The only supported RadioLab format is pcm.')
        client, generation = stream_identity(query)
    except RequestError as error:
        return handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=NO_CACHE)
    connection = None
    response = None
    decoder = None
    started = False
    handler.close_connection = True
    try:
        with stream_slot(ACCOUNTS.current_user()['id'], client, generation, handler.connection, station_id) as lease:
            try:
                connection, response, content_type = open_station_stream(station)
                lease.check()
                if output_format == 'pcm':
                    decoder = PCMDecoder(lease, response)
                    lease.track_decoder(decoder)
                    decoder.start()
                    chunks = decoder.chunks()
                    first = next(chunks)
                    handler.protocol_version = 'HTTP/1.1'
                handler.connection.settimeout(WRITE_TIMEOUT)
                handler.send_response(200)
                handler.send_header('Content-Type', 'application/octet-stream' if decoder else content_type)
                if decoder is not None:
                    handler.send_header('Transfer-Encoding', 'chunked')
                    handler.send_header('X-Radiolab-Sample-Rate', str(PCM_SAMPLE_RATE))
                    handler.send_header('X-Radiolab-Channels', str(PCM_CHANNELS))
                # This is a moving live stream, not a seekable finite file.
                # Ignore Range with an honest 200; never invent file lengths.
                handler.send_header('Accept-Ranges', 'none')
                handler.send_header('X-Accel-Buffering', 'no')
                handler.send_header('Connection', 'close')
                for name, value in NO_CACHE.items():
                    handler.send_header(name, value)
                handler.end_headers()
                started = True
                if decoder is not None:
                    handler.wfile.write(f'{len(first):X}\r\n'.encode('ascii') + first + b'\r\n')
                    handler.wfile.flush()
                    for chunk in chunks:
                        handler.wfile.write(f'{len(chunk):X}\r\n'.encode('ascii') + chunk + b'\r\n')
                        handler.wfile.flush()
                    decoder.check()
                    decoder.close()
                    handler.wfile.write(b'0\r\n\r\n')
                    handler.wfile.flush()
                    return
                deadline = time.monotonic() + MAX_STREAM_SECONDS
                remaining = MAX_STREAM_BYTES
                while remaining > 0 and time.monotonic() < deadline:
                    lease.check()
                    chunk = response.read1(min(32 * 1024, remaining))
                    if not chunk:
                        break
                    lease.check()
                    handler.wfile.write(chunk)
                    handler.wfile.flush()
                    remaining -= len(chunk)
            finally:
                try:
                    if decoder is not None:
                        decoder.close()
                finally:
                    try:
                        if response is not None:
                            response.close()
                    finally:
                        if connection is not None:
                            connection.close()
    except (RelayError, OSError, http.client.HTTPException) as error:
        if decoder is not None and (not isinstance(error, RelayError) or error.status != 409):
            handler.log_error('RadioLab PCM stream failed (%s)', type(error).__name__)
        if not started:
            status = error.status if isinstance(error, RelayError) else 502
            headers = {**NO_CACHE, **({'Retry-After': '10'} if status == 429 else {})}
            try:
                handler.send_json({'ok': False, 'error': str(error) if isinstance(error, RelayError) else 'This station is temporarily unavailable.'}, status=status, extra_headers=headers)
            except OSError:
                pass
