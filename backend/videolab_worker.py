import http.client
import io
import ipaddress
import json
import math
import os
import pathlib
import re
import resource
import select
import signal
import socket
import ssl
import subprocess
import sys
import time
import wave
from urllib.parse import urljoin, urlsplit


MAX_BYTES = 64 * 1024 * 1024
MAX_METADATA_BYTES = 8 * 1024 * 1024
MAX_WIRE_BYTES = 128 * 1024 * 1024
RATE = 44100
CHANNELS = 1
FRAME_BYTES = CHANNELS * 2
ALLOWED_HOSTS = frozenset(('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtubei.youtube.com', 'youtubei.googleapis.com'))
GOOGLEVIDEO = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+googlevideo\.com\Z')
INSTAGRAM_HOSTS = frozenset(('instagram.com', 'www.instagram.com', 'i.instagram.com', 'm.instagram.com'))
INSTAGRAM_CDN = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:cdninstagram\.com|fbcdn\.net)\Z')


class PolicyError(ValueError):
    pass


class AccessRequired(PolicyError):
    pass


class NoSoundtrack(PolicyError):
    pass


def checked_target(url):
    if not isinstance(url, str) or len(url) > 32768 or any(ord(character) <= 32 or ord(character) >= 127 for character in url) or '\\' in url:
        raise PolicyError('Blocked outbound URL.')
    parsed = urlsplit(url)
    host = parsed.hostname or ''
    if parsed.scheme != 'https' or parsed.username is not None or parsed.password is not None or parsed.fragment or parsed.port not in (None, 443):
        raise PolicyError('Only allowed HTTPS endpoints are supported.')
    if host not in ALLOWED_HOSTS and host not in INSTAGRAM_HOSTS and not GOOGLEVIDEO.fullmatch(host) and not INSTAGRAM_CDN.fullmatch(host):
        raise PolicyError('Blocked outbound host.')
    if parsed.netloc not in (host, host + ':443'):
        raise PolicyError('Invalid outbound authority.')
    if host in INSTAGRAM_HOSTS and re.match(r'/(?:accounts/(?:login|signup)|challenge|checkpoint)(?:/|$)', parsed.path):
        raise AccessRequired('Instagram requires login.')
    return parsed, host


def public_addresses(host):
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    if not addresses or len(addresses) > 64:
        raise PolicyError('Invalid endpoint DNS result.')
    checked = []
    for family, kind, protocol, canonical, address in addresses:
        numeric = ipaddress.ip_address(address[0])
        if family not in (socket.AF_INET, socket.AF_INET6) or not numeric.is_global or numeric.is_multicast or numeric.is_unspecified or numeric.is_reserved or getattr(numeric, 'ipv4_mapped', None) is not None or getattr(numeric, 'sixtofour', None) is not None or getattr(numeric, 'teredo', None) is not None:
            raise PolicyError('Endpoint DNS contains a non-public address.')
        if numeric in ipaddress.ip_network('64:ff9b::/96') or numeric in ipaddress.ip_network('64:ff9b:1::/48'):
            raise PolicyError('Translated addresses are not supported.')
        checked.append((family, kind, protocol, address))
    return checked


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        if self._tunnel_host:
            raise PolicyError('Proxy tunnels are disabled.')
        addresses = public_addresses(self.host)
        last_error = None
        for family, kind, protocol, address in addresses:
            connection = socket.socket(family, kind, protocol)
            connection.settimeout(self.timeout)
            try:
                connection.connect(address)
                self.sock = self._context.wrap_socket(connection, server_hostname=self.host)
                return
            except OSError as error:
                connection.close()
                last_error = error
        raise PolicyError('Could not connect to a validated public endpoint.') from last_error


class BoundedBody(io.RawIOBase):
    def __init__(self, response, connection, director, maximum):
        super().__init__()
        self.response, self.connection, self.director = response, connection, director
        self.maximum, self.received = maximum, 0

    def readable(self):
        return True

    def read(self, size=-1):
        if self.closed:
            return b''
        if time.monotonic() >= self.director.deadline:
            raise PolicyError('Outbound deadline exceeded.')
        remaining = min(self.maximum - self.received, MAX_WIRE_BYTES - self.director.received)
        amount = remaining + 1 if size is None or size < 0 else min(size, remaining + 1)
        payload = self.response.read(amount)
        self.received += len(payload)
        self.director.received += len(payload)
        if self.received > self.maximum or self.director.received > MAX_WIRE_BYTES:
            raise PolicyError('Outbound byte limit exceeded.')
        return payload

    def close(self):
        self.response.close()
        self.connection.close()
        super().close()


class PinnedDirector:
    def __init__(self, headers, deadline):
        self.headers, self.deadline = dict(headers), deadline
        self.received, self.requests = 0, 0
        self.handlers, self.bodies = {}, []

    def send(self, request):
        from yt_dlp.networking.common import Response
        from yt_dlp.networking.exceptions import HTTPError, TransportError

        if request.proxies or request.extensions.get('impersonate') or request.method not in ('GET', 'HEAD', 'POST') or (request.data is not None and not isinstance(request.data, bytes)):
            raise PolicyError('Unsupported outbound request.')
        if request.data is not None and len(request.data) > MAX_METADATA_BYTES:
            raise PolicyError('Outbound request body too large.')
        url, method, data = request.url, request.method, request.data
        headers = {**self.headers, **dict(request.headers)}
        headers = {name: value for name, value in headers.items() if name.lower() not in ('authorization', 'cookie', 'proxy-authorization', 'host', 'accept-encoding', 'connection', 'content-length') and not name.lower().startswith('proxy-')}
        headers['Accept-Encoding'] = 'identity'
        for redirect in range(5):
            parsed, host = checked_target(url)
            self.requests += 1
            if self.requests > 80 or time.monotonic() >= self.deadline:
                raise PolicyError('Outbound request limit exceeded.')
            connection = PinnedHTTPSConnection(host, timeout=min(8, max(0.1, self.deadline - time.monotonic())), context=ssl.create_default_context())
            try:
                connection.request(method, parsed.path + ('?' + parsed.query if parsed.query else ''), body=data, headers=headers)
                response = connection.getresponse()
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader('Location')
                    if not location:
                        raise PolicyError('Invalid outbound redirect.')
                    target = urljoin(url, location)
                    target_parsed, target_host = checked_target(target)
                    if data is not None and target_host != host:
                        raise PolicyError('Cross-host POST redirect is disabled.')
                    url = target
                    if response.status == 303 or (response.status in (301, 302) and method == 'POST'):
                        method, data = 'GET', None
                    response.close()
                    connection.close()
                    continue
                if host in INSTAGRAM_HOSTS and response.status in (401, 403, 429):
                    response.close()
                    raise AccessRequired('Instagram anonymous access is restricted.')
                maximum = MAX_BYTES if GOOGLEVIDEO.fullmatch(host) or INSTAGRAM_CDN.fullmatch(host) else MAX_METADATA_BYTES
                length = response.getheader('Content-Length')
                if length is not None and (not re.fullmatch(r'[0-9]+', length) or int(length) > maximum):
                    raise PolicyError('Outbound response exceeds byte limit.')
                if response.getheader('Content-Encoding', 'identity').lower() != 'identity':
                    raise PolicyError('Encoded outbound response is not supported.')
                body = BoundedBody(response, connection, self, maximum)
                self.bodies.append(body)
                result = Response(body, url=url, headers=dict(response.headers), status=response.status)
                if response.status >= 400:
                    raise HTTPError(result)
                return result
            except Exception as error:
                connection.close()
                if isinstance(error, (PolicyError, HTTPError)):
                    raise
                raise TransportError('Validated outbound connection failed.') from None
        raise PolicyError('Too many outbound redirects.')

    def close(self):
        for body in self.bodies:
            body.close()
        self.bodies.clear()


class QuietLogger:
    def debug(self, message):
        pass

    def warning(self, message):
        if re.search(r'sign.?in|log.?in|logged.?in|\bbot\b|\b403\b|\b429\b|restrict|private|unavailable|not available|age.?limit|not granting access', str(message), re.I):
            raise AccessRequired('Anonymous access restriction; no workaround attempted.')

    def error(self, message):
        pass


def downloader_class():
    from yt_dlp import YoutubeDL
    from yt_dlp.globals import all_plugins_loaded, plugin_dirs

    plugin_dirs.value = []
    all_plugins_loaded.value = True

    class PinnedYoutubeDL(YoutubeDL):
        def build_request_director(self, handlers, preferences=None):
            return PinnedDirector(self.params['http_headers'], time.monotonic() + 115)

        @property
        def _opener(self):
            raise PolicyError('Unrestricted opener is disabled.')

    return PinnedYoutubeDL


def checked_metadata(info, video, start):
    if not isinstance(info, dict) or info.get('_type', 'video') != 'video' or info.get('id') != video or info.get('availability') != 'public' or info.get('age_limit') != 0 or info.get('live_status') != 'not_live' or info.get('is_live') or info.get('is_upcoming') or info.get('has_drm'):
        raise PolicyError('Only anonymous, public, non-live, unrestricted videos are supported.')
    duration = info.get('duration')
    if isinstance(duration, bool) or not isinstance(duration, (float, int)) or not math.isfinite(duration) or not 0 < duration <= 86400 * 366 or start >= duration:
        raise PolicyError('Invalid or unavailable video duration.')
    checked_audio_format(info)
    return float(duration)


def checked_audio_format(info):
    if info.get('requested_formats') or info.get('requested_downloads'):
        raise PolicyError('Multi-format downloads are disabled.')
    if info.get('protocol') != 'https' or info.get('vcodec') != 'none' or info.get('acodec') in (None, 'none') or info.get('ext') not in ('m4a', 'webm'):
        raise PolicyError('No useful direct HTTPS audio format is available.')
    parsed, host = checked_target(info.get('url'))
    if not GOOGLEVIDEO.fullmatch(host) or info.get('fragments'):
        raise PolicyError('Only direct Googlevideo audio downloads are supported.')
    for field in ('filesize', 'filesize_approx'):
        value = info.get(field)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 < value <= MAX_BYTES):
            raise PolicyError('Source audio exceeds 64 MiB.')


def original_audio_format(context):
    def language(audio):
        value = str(audio.get('language') or '').strip().lower()
        return value if value not in ('', 'und') else None

    def descriptive(audio):
        return (language(audio) or '').endswith('-desc') or audio.get('language_preference') == -10 or bool(re.search(r'\bdescriptive\b|\baudio description\b', str(audio.get('format_note') or ''), re.I))

    def original(audio):
        return audio.get('language_preference') == 10 or bool(re.search(r'\boriginal\b', str(audio.get('format_note') or ''), re.I))

    def dubbed(audio):
        return bool(re.search(r'\bdub(?:bed|bing)?\b|\btranslated\b', str(audio.get('format_note') or ''), re.I))

    def bitrate(audio):
        for field in ('abr', 'tbr'):
            value = audio.get(field)
            if not isinstance(value, bool) and isinstance(value, (float, int)) and math.isfinite(value) and value > 0:
                return value
        return math.inf

    audio_formats = [audio for audio in context['formats'] if audio.get('acodec') not in (None, 'none') and not descriptive(audio)]
    originals = [audio for audio in audio_formats if original(audio) and not dubbed(audio)]
    if originals:
        languages = {language(audio) for audio in originals if language(audio)}
        if len(languages) > 1:
            raise PolicyError('Original audio language is ambiguous.')
        candidates = [audio for audio in audio_formats if not dubbed(audio) and (original(audio) or language(audio) in languages)]
    else:
        languages = {language(audio) for audio in audio_formats}
        if len(languages) != 1 or any(dubbed(audio) for audio in audio_formats):
            raise PolicyError('Original audio language could not be identified.')
        candidates = audio_formats
    eligible = []
    for audio in candidates:
        if audio.get('has_drm'):
            continue
        try:
            checked_audio_format(audio)
        except ValueError:
            continue
        eligible.append(audio)
    if not eligible:
        raise PolicyError('No eligible direct audio format for the original language.')
    useful = [audio for audio in eligible if 32 <= bitrate(audio) < math.inf]
    yield min(useful or eligible, key=bitrate)


def checked_instagram_format(info):
    if (info.get('requested_formats') or info.get('requested_downloads') or info.get('fragments')
            or info.get('has_drm') or info.get('protocol') != 'https' or info.get('ext') not in ('mp4', 'm4a', 'webm')
            or info.get('acodec') == 'none'):
        raise PolicyError('No direct Reel soundtrack is available.')
    parsed, host = checked_target(info.get('url'))
    if not INSTAGRAM_CDN.fullmatch(host):
        raise PolicyError('Reel media must use an Instagram CDN.')
    for field in ('filesize', 'filesize_approx'):
        value = info.get(field)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 < value <= MAX_BYTES):
            raise PolicyError('Reel exceeds 64 MiB.')


def instagram_audio_format(context):
    eligible = []
    for audio in context['formats']:
        try:
            checked_instagram_format(audio)
            eligible.append(audio)
        except ValueError:
            continue
    if not eligible:
        if context['formats'] and all(audio.get('acodec') == 'none' for audio in context['formats']):
            raise NoSoundtrack('This Reel has no audio soundtrack.')
        raise PolicyError('No direct Reel soundtrack is available.')
    # Audio-only when offered, otherwise decode the soundtrack from one MP4.
    yield min(eligible, key=lambda f: (f.get('vcodec') != 'none', f.get('filesize') or f.get('filesize_approx') or math.inf, f.get('height') or math.inf))


def checked_instagram_metadata(info, video, start):
    if (not isinstance(info, dict) or info.get('_type', 'video') != 'video' or info.get('id') != video
            or info.get('availability') not in (None, 'public') or info.get('age_limit') not in (None, 0)
            or info.get('is_live') or info.get('is_upcoming') or info.get('has_drm')
            or info.get('live_status') not in (None, 'not_live')):
        raise AccessRequired('Only anonymously accessible public Reels are supported.')
    checked_instagram_format(info)
    duration = info.get('duration')
    if duration is None:
        return None  # Some logged-out Reel metadata omits duration; PCM remains bounded.
    if isinstance(duration, bool) or not isinstance(duration, (float, int)) or not math.isfinite(duration) or not start < duration <= 86400 * 366:
        raise PolicyError('Invalid Reel duration or start time.')
    return float(duration)


def decode(source, destination, start, duration):
    skip, remaining = int(start * RATE), int(duration * RATE)
    deadline = time.monotonic() + 110
    command = ['/usr/bin/gst-launch-1.0', '-q', 'fdsrc', 'fd=0', '!', 'decodebin', '!', 'audioconvert', '!', 'audioresample', '!',
               'audio/x-raw,format=S16LE,rate=44100,channels=1,layout=interleaved', '!', 'fdsink', 'fd=1', 'sync=false']
    with source.open('rb') as input_file:
        process = subprocess.Popen(command, stdin=input_file, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    pending, written, truncated = b'', 0, True
    try:
        with wave.open(str(destination), 'wb') as output:
            output.setparams((CHANNELS, 2, RATE, 0, 'NONE', 'not compressed'))
            while remaining:
                if time.monotonic() >= deadline:
                    raise PolicyError('Decode deadline exceeded.')
                ready, unused_write, unused_error = select.select([process.stdout], [], [], 0.5)
                if not ready:
                    continue
                payload = process.stdout.read1(65536)
                if not payload:
                    truncated = False
                    break
                pending += payload
                usable = len(pending) // FRAME_BYTES * FRAME_BYTES
                frames, pending = pending[:usable], pending[usable:]
                discarded = min(skip, len(frames) // FRAME_BYTES)
                skip -= discarded
                frames = frames[discarded * FRAME_BYTES:remaining * FRAME_BYTES + discarded * FRAME_BYTES]
                if frames:
                    output.writeframesraw(frames)
                    remaining -= len(frames) // FRAME_BYTES
                    written += len(frames) // FRAME_BYTES
            if written <= RATE * 0.02 or skip or pending and not truncated:
                raise PolicyError('Decoder did not produce finite PCM audio.')
        if not truncated and process.wait(timeout=2) != 0:
            raise PolicyError('Audio decode failed.')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=2)
        process.stdout.close()


def acquire(work, video, start, duration, source_type='youtube'):
    downloader = downloader_class()

    def progress(update):
        if update.get('downloaded_bytes', 0) > MAX_BYTES or update.get('total_bytes', 0) and update['total_bytes'] > MAX_BYTES:
            raise PolicyError('Source audio exceeds 64 MiB.')

    options = {'logger': QuietLogger(), 'quiet': True, 'noprogress': True, 'cachedir': False, 'noplaylist': True,
               'geo_bypass': False, 'socket_timeout': 8, 'retries': 0, 'extractor_retries': 0, 'fragment_retries': 0,
               'file_access_retries': 0, 'continuedl': False, 'max_filesize': MAX_BYTES, 'fixup': 'never',
               'format': instagram_audio_format if source_type == 'instagram' else original_audio_format,
               'outtmpl': str(work / 'source.%(ext)s'), 'js_runtimes': {'node': {'path': '/usr/bin/node'}},
               'remote_components': [], 'proxy': '', 'postprocessors': [], 'progress_hooks': [progress],
               'http_headers': {'Accept-Encoding': 'identity'}, 'enable_file_urls': False}
    with downloader(options) as extractor:
        source_url = 'https://www.instagram.com/reel/' + video + '/' if source_type == 'instagram' else 'https://www.youtube.com/watch?v=' + video
        info = extractor.extract_info(source_url, download=False)
        source_duration = checked_instagram_metadata(info, video, start) if source_type == 'instagram' else checked_metadata(info, video, start)
        extractor.process_info(info)
        source = work / ('source.' + info['ext'])
        details = source.lstat()
        if not source.is_file() or source.is_symlink() or not 0 < details.st_size <= MAX_BYTES:
            raise PolicyError('No finite source audio was downloaded.')
        title = re.sub(r'https?://\S+', '[link removed]', str(info.get('title') or ('Instagram Reel' if source_type == 'instagram' else 'YouTube video')), flags=re.I)
        title = ''.join(character for character in title if ord(character) >= 32 and ord(character) != 127)[:300] or 'YouTube video'
        decode(source, work / 'audio.wav', start, min(duration, source_duration - start) if source_duration is not None else duration)
        source_duration_known = source_duration is not None
        if source_duration is None:
            with wave.open(str(work / 'audio.wav'), 'rb') as audio:
                source_duration = start + audio.getnframes() / audio.getframerate()
        return {'ok': True, 'videoId': video, 'title': title, 'sourceDuration': source_duration, 'sourceDurationKnown': source_duration_known}


def restrict_process():
    if os.getuid() == 0 or os.geteuid() == 0 or os.getgroups():
        raise PolicyError('Video Lab processing must be unprivileged without supplementary groups.')
    import ctypes

    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0 or libc.prctl(4, 0, 0, 0, 0) != 0:
        raise PolicyError('Cannot apply no-new-privileges restriction.')
    status = pathlib.Path('/proc/self/status').read_text()
    if int(status.split('CapEff:')[1].splitlines()[0].strip(), 16) != 0:
        raise PolicyError('Video Lab processing must not have capabilities.')
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (100, 100))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))
    resource.setrlimit(resource.RLIMIT_AS, (64 * 1024 ** 3, 64 * 1024 ** 3))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    signal.alarm(118)


def main():
    try:
        restrict_process()
        work, video = pathlib.Path(sys.argv[1]), sys.argv[2]
        os.chdir(work)
        work = pathlib.Path('/proc/self/cwd')
        for name in ('HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'):
            os.environ[name] = str(work)
        os.environ['GST_REGISTRY'] = str(work / 'registry.bin')
        start, duration = float(sys.argv[3]), float(sys.argv[4])
        source_type = sys.argv[5] if len(sys.argv) > 5 else 'youtube'
        if source_type not in ('youtube', 'instagram') or not re.fullmatch(r'[A-Za-z0-9_-]{5,28}' if source_type == 'instagram' else r'[A-Za-z0-9_-]{11}', video) or not math.isfinite(start) or not math.isfinite(duration) or not 0 <= start <= 21600 or not 0.02 < duration <= 180:
            raise PolicyError('Invalid capture bounds.')
        print(json.dumps(acquire(work, video, start, duration, source_type), ensure_ascii=True), flush=True)
    except Exception as error:
        restricted = isinstance(error, AccessRequired) or bool(re.search(r'log.?in|logged.?in|sign.?in|rate.?limit|\b(?:401|403|429)\b|private|registered users', str(error), re.I))
        print(json.dumps({'ok': False, 'error': 'Public video import unavailable.', 'errorCode': 'no_audio' if isinstance(error, NoSoundtrack) else 'access_required' if restricted else 'unavailable'}), flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
