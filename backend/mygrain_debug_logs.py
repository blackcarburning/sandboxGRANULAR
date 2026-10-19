import collections
import datetime
import json
import os
import pathlib
import secrets
import shutil
import tempfile
import threading
import time
from urllib.parse import urlparse


LOGS_ROOT = pathlib.Path('/var/lib/mygrain/audio-debug-logs')
MAX_LOG_BYTES = 4 * 1024 * 1024
MAX_STORED_BYTES = 256 * 1024 * 1024
MAX_STORED_LOGS = 1000
MAX_UPLOADS_PER_MINUTE = 20
PUBLIC_ORIGIN = 'https://openclaw.blackcarburning.com'
LOG_FIELDS = {
    'schemaVersion', 'application', 'build', 'captureTime', 'currentState',
    'recentLogs', 'debugConsoleText', 'debugConsoleEvents', 'userAgent',
    'platform', 'phoneDiagnostics', 'runtimeDiagnostics', 'recoveryDiagnostics',
}
LOG_LOCK = threading.Lock()
UPLOAD_TIMES = collections.deque(maxlen=MAX_UPLOADS_PER_MINUTE)
ACCOUNT_UPLOAD_TIMES = {}
ACCOUNT_IDENTITY = lambda: None


class LogError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def validate_report(report):
    if not isinstance(report, dict) or set(report) - LOG_FIELDS:
        raise LogError('Invalid diagnostic report fields.')
    if type(report.get('schemaVersion')) is not int or report['schemaVersion'] != 1 or report.get('application') != 'MYGRAIN':
        raise LogError('Unsupported diagnostic report version.')
    for field, limit in [('build', 80), ('captureTime', 80), ('userAgent', 2048), ('platform', 256), ('debugConsoleText', MAX_LOG_BYTES)]:
        if not isinstance(report.get(field), str) or not 1 <= len(report[field]) <= limit:
            raise LogError(f'Invalid {field}.')
    try:
        datetime.datetime.fromisoformat(report['captureTime'].replace('Z', '+00:00'))
    except ValueError as error:
        raise LogError('Invalid capture time.') from error
    if report.get('currentState') is not None and not isinstance(report['currentState'], dict):
        raise LogError('Invalid audio state.')
    for field, limit in [('recentLogs', 20), ('debugConsoleEvents', 80)]:
        if not isinstance(report.get(field), list) or len(report[field]) > limit:
            raise LogError(f'Invalid {field}.')
    phone = report.get('phoneDiagnostics')
    if not isinstance(phone, dict) or phone.get('schemaVersion') != 1:
        raise LogError('Missing phone diagnostic capture.')
    for field in ('runtimeDiagnostics', 'recoveryDiagnostics'):
        if field in report and (not isinstance(report[field], dict) or type(report[field].get('schemaVersion')) is not int or report[field]['schemaVersion'] != 1):
            raise LogError(f'Invalid {field}.')
    return report


def trusted_request(handler):
    if getattr(handler, 'mygrain_user', None) is not None:
        return True
    origin = handler.headers.get('Origin', '')
    if handler.headers.get('Sec-Fetch-Site', 'same-origin') != 'same-origin':
        return False
    if origin == PUBLIC_ORIGIN:
        return True
    parsed = urlparse(origin)
    return (
        handler.client_address[0] in ('127.0.0.1', '::1')
        and parsed.scheme == 'http'
        and parsed.hostname in ('127.0.0.1', 'localhost', '::1')
        and origin == f"http://{handler.headers.get('Host', '')}"
    )


def reject_constant(value):
    raise ValueError('Non-finite JSON value.')


def save_report(report):
    with LOG_LOCK:
        account = ACCOUNT_IDENTITY()
        upload_times = ACCOUNT_UPLOAD_TIMES.setdefault(account['id'], collections.deque(maxlen=MAX_UPLOADS_PER_MINUTE)) if account else UPLOAD_TIMES
        instant = time.monotonic()
        while upload_times and instant - upload_times[0] >= 60:
            upload_times.popleft()
        if len(upload_times) >= MAX_UPLOADS_PER_MINUTE:
            raise LogError('Too many log submissions. Wait one minute and try again.', 429)
        if LOGS_ROOT.is_symlink():
            raise OSError('Diagnostic storage cannot be a symbolic link.')
        LOGS_ROOT.mkdir(parents=True, mode=0o700, exist_ok=True)
        LOGS_ROOT.chmod(0o700)
        received = datetime.datetime.now(datetime.timezone.utc)
        log_id = f"audio-{received.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(8)}"
        received_at = received.isoformat().replace('+00:00', 'Z')
        encoded = json.dumps({'schemaVersion': 1, 'logId': log_id, 'receivedAt': received_at, 'report': report},
                             ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
        reports = list(LOGS_ROOT.glob('*.json'))
        if len(reports) >= MAX_STORED_LOGS or sum(item.stat().st_size for item in reports) + len(encoded) > MAX_STORED_BYTES:
            raise LogError('The diagnostic log store is full. Keep a local copy and contact the administrator.', 507)
        if shutil.disk_usage(LOGS_ROOT).free < len(encoded) + 32 * 1024 * 1024:
            raise LogError('Diagnostic storage is temporarily unavailable. Keep a local copy.', 507)
        descriptor, temporary = tempfile.mkstemp(prefix='.upload-', dir=LOGS_ROOT)
        try:
            with os.fdopen(descriptor, 'wb') as output:
                output.write(encoded)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, LOGS_ROOT / f'{log_id}.json')
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        upload_times.append(instant)
        return {'ok': True, 'logId': log_id, 'receivedAt': received_at}


def handle_debug_log_request(handler, method, inner_path):
    if inner_path != '/api/debug-logs' and not inner_path.startswith('/api/debug-logs/'):
        return False
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
    try:
        if method != 'POST' or inner_path != '/api/debug-logs':
            headers['Allow'] = 'POST'
            raise LogError('Diagnostic logs cannot be read or listed over HTTP.', 405)
        if not trusted_request(handler) or handler.headers.get('X-Mygrain-Debug') != '1':
            raise LogError('Submit diagnostic logs from the MYGRAIN app.', 403)
        if handler.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            raise LogError('Diagnostic submissions must be JSON.', 415)
        if handler.headers.get('Transfer-Encoding') or handler.headers.get('Content-Encoding'):
            raise LogError('Encoded or chunked submissions are not supported.', 400)
        lengths = handler.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or not lengths[0].isdigit():
            raise LogError('A valid content length is required.', 411)
        length = int(lengths[0])
        if not 1 <= length <= MAX_LOG_BYTES:
            raise LogError('Diagnostic report exceeds the 4 MiB upload limit.', 413)
        previous_timeout = handler.connection.gettimeout()
        handler.connection.settimeout(10)
        try:
            raw = handler.rfile.read(length)
        finally:
            handler.connection.settimeout(previous_timeout)
        if len(raw) != length:
            raise LogError('Incomplete diagnostic report.')
        report = validate_report(json.loads(raw.decode('utf-8'), parse_constant=reject_constant))
        receipt = save_report(report)
        handler.send_json(receipt, status=201, extra_headers=headers)
    except LogError as error:
        handler.close_connection = True
        if error.status == 429:
            headers['Retry-After'] = '60'
        handler.send_json({'ok': False, 'error': str(error)}, status=error.status, extra_headers=headers)
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        handler.close_connection = True
        handler.send_json({'ok': False, 'error': 'Invalid diagnostic JSON.'}, status=400, extra_headers=headers)
    except OSError:
        handler.close_connection = True
        handler.send_json({'ok': False, 'error': 'Cannot save the log right now. Keep a local copy and try again later.'},
                          status=503, extra_headers=headers)
    return True
