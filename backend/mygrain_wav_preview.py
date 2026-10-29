"""Dedicated iPhone listening previews; originals/DSP/Song renders are untouched.

Runs separately from documenter so general account locks, render jobs and slow
uploads cannot queue auditions. The cache is private, stat-keyed and authenticated
on every read. A low-priority watcher prebuilds new/changed WAVs, while requests
use independent foreground encoder capacity without a polling delay.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from mygrain_accounts import Accounts, AccountError, checked_path, request_token

ROUTE = '/mygrain/api/wav-preview-fast'
VERSION = 'aac-192-v1'


def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


class PreviewStore:
    def __init__(self, accounts, cache_root, ffmpeg='/usr/bin/ffmpeg'):
        self.accounts = accounts
        self.cache = checked_path(cache_root)
        self.cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.cache.chmod(0o700)
        self.ffmpeg = ffmpeg
        self.foreground = threading.BoundedSemaphore(2)
        self.pending_lock = threading.Lock()
        self.pending = {}
        self.stopped = threading.Event()

    def open_source(self, user, name):
        if (not isinstance(name, str) or not name or name.startswith('.')
                or '/' in name or '\\' in name or not name.lower().endswith('.wav')
                or len(name) > 255):
            raise AccountError('Invalid WAV filename.', 400)
        root = self.accounts.path_for('wavs', user=user)
        source = checked_path(root / name, root)
        try:
            # The open descriptor is a stable snapshot across rename/delete.
            fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                os.close(fd)
                raise AccountError('WAV not found.', 404)
            return source, os.fdopen(fd, 'rb')
        except FileNotFoundError:
            raise AccountError('WAV not found.', 404)

    def preview(self, user, name, *, background=False):
        source, media = self.open_source(user, name)
        with media:
            original = signature(os.fstat(media.fileno()))
            key = hashlib.sha256(json.dumps([VERSION, user['id'], str(source), original]).encode()).hexdigest()
            target = checked_path(self.cache / (key + '.m4a'), self.cache)
            cache_hit = target.is_file()
            if not cache_hit:
                with self.pending_lock:
                    future = self.pending.get(key)
                    if future is None:
                        future = self.pending[key] = concurrent.futures.Future()
                        producer = True
                    else:
                        producer = False
                if not producer:
                    future.result(timeout=25)
                else:
                    temporary = self.cache / (key + '.' + secrets.token_hex(8) + '.tmp')
                    acquired = False
                    try:
                        # The watcher has its own encoder: no background queue
                        # or general app lock stands ahead of a user's click.
                        if not background:
                            acquired = self.foreground.acquire(timeout=3)
                            if not acquired:
                                raise AccountError('Preview encoders are busy. Please retry.', 503)
                        command = [self.ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error',
                                   '-threads', '1', '-i', f'/proc/self/fd/{media.fileno()}',
                                   '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
                                   '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k',
                                   '-threads', '1', '-movflags', '+faststart', '-f', 'ipod', '-y', str(temporary)]
                        if background:
                            command = ['/usr/bin/nice', '-n', '10', *command]
                        result = subprocess.run(command, pass_fds=(media.fileno(),),
                                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20)
                        if result.returncode or not temporary.is_file() or not temporary.stat().st_size:
                            raise AccountError('Could not prepare a listening preview.', 422)
                        if signature(os.fstat(media.fileno())) != original:
                            raise AccountError('WAV changed during preview preparation. Please retry.', 409)
                        temporary.chmod(0o600)
                        os.replace(temporary, target)
                        future.set_result(True)
                    except BaseException as error:
                        future.set_exception(error)
                        # Mark the producer's exception retrieved too.
                        future.exception()
                        raise
                    finally:
                        temporary.unlink(missing_ok=True)
                        if acquired:
                            self.foreground.release()
                        with self.pending_lock:
                            self.pending.pop(key, None)
            # Do not return cached bytes after a deletion/replacement. Never
            # trust a cache entry as authority for access to a source file.
            try:
                if signature(checked_path(source, source.parent).stat()) != original:
                    raise AccountError('WAV changed. Please retry.', 409)
            except FileNotFoundError:
                raise AccountError('WAV not found.', 404)
            preview = target.open('rb')
            os.utime(target, None)
            return preview, cache_hit, original[2]

    def warm_once(self):
        with self.accounts.connection() as connection:
            users = [dict(row) for row in connection.execute(
                "SELECT id,username,is_admin FROM users WHERE approval_status='active'")]
        sources = []
        for user in users:
            root = checked_path(self.accounts.path_for('wavs', user=user))
            if not root.is_dir():
                continue
            with os.scandir(root) as entries:
                for entry in entries:
                    if not entry.name.startswith('.') and entry.name.lower().endswith('.wav') and entry.is_file(follow_symlinks=False):
                        try:
                            sources.append((entry.stat(follow_symlinks=False).st_mtime_ns, user, entry.name))
                        except FileNotFoundError:
                            continue
        for _, user, name in sorted(sources, key=lambda item: item[0], reverse=True):
            if self.stopped.is_set():
                return
            try:
                media, _, _ = self.preview(user, name, background=True)
                media.close()
            except (ValueError, OSError, subprocess.TimeoutExpired, TimeoutError):
                continue
        # This directory contains derived listening copies only, not user data.
        files = sorted(self.cache.glob('*.m4a'), key=lambda path: path.stat().st_mtime)
        total = sum(path.stat().st_size for path in files)
        for path in files:
            if total <= 512 * 1024 * 1024:
                break
            size = path.stat().st_size
            path.unlink(missing_ok=True)
            total -= size

    def watch(self):
        while not self.stopped.is_set():
            try:
                self.warm_once()
            except (ValueError, OSError):
                pass
            self.stopped.wait(5)


def handle(handler, store):
    """Used by this daemon and the isolated real-app test server."""
    try:
        parsed = urlsplit(handler.path)
        if parsed.path != ROUTE or handler.command not in ('GET', 'HEAD'):
            raise AccountError('Not found.', 404)
        query = parse_qs(parsed.query, keep_blank_values=True)
        user = store.accounts.session_user(request_token(handler))
        if user is None:
            raise AccountError('Login required.', 401)
        if handler.headers.get('X-Mygrain-User') != user['username']:
            raise AccountError('The active account changed. Reload this tab.', 401)
        if any(name != user['username'] for name in query.get('mygrainUser', [])):
            raise AccountError('The active account changed. Reload this tab.', 401)
        name = (query.get('filename') or [''])[0]
        started = time.monotonic()
        media, hit, original_size = store.preview(user, name)
        with media:
            length = os.fstat(media.fileno()).st_size
            handler.send_response(200)
            handler.send_header('Content-Type', 'audio/mp4')
            handler.send_header('Content-Length', str(length))
            handler.send_header('Cache-Control', 'private, no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            handler.send_header('X-Mygrain-Preview', VERSION)
            handler.send_header('X-Mygrain-Preview-Cache', 'hit' if hit else 'miss')
            handler.send_header('X-Mygrain-Original-Bytes', str(original_size))
            handler.send_header('Server-Timing', f'preview;dur={(time.monotonic() - started) * 1000:.1f}')
            handler.end_headers()
            if handler.command != 'HEAD':
                while chunk := media.read(65536):
                    handler.wfile.write(chunk)
    except (BrokenPipeError, ConnectionResetError, TimeoutError):
        handler.close_connection = True
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        code = error.status if isinstance(error, AccountError) else 503
        body = json.dumps({'ok': False, 'error': str(error) if isinstance(error, AccountError) else 'Listening preview is unavailable.'}).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Cache-Control', 'private, no-store')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        if handler.command != 'HEAD':
            handler.wfile.write(body)


class PreviewHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.connection.settimeout(15)
        handle(self, self.server.preview_store)

    do_HEAD = do_GET


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--test-root', type=pathlib.Path)
    args = parser.parse_args()
    workspace = pathlib.Path(__file__).resolve().parents[2]
    if args.test_root:
        root = checked_path(args.test_root, '/tmp')
        if root == pathlib.Path('/tmp'):
            raise ValueError('Use a dedicated isolated test directory.')
        database, users = root / 'auth/accounts.sqlite3', root / 'users'
        wavs, cache = root / 'admin/wavs', root / 'preview-cache'
    else:
        database = workspace / 'fs7300-documenter/data/mygrain-accounts/accounts.sqlite3'
        users = pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-users')
        wavs, cache = pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-loops'), pathlib.Path('/var/cache/mygrain-wav-preview')
    store = PreviewStore(Accounts(database, users, {'wavs': wavs}), cache)
    server = PreviewServer(('127.0.0.1', args.port), PreviewHandler)
    server.preview_store = store
    watcher = threading.Thread(target=store.watch, name='wav-preview-prewarm', daemon=True)
    watcher.start()
    print(f'MYGRAIN iPhone preview service listening on 127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    finally:
        store.stopped.set()
        server.server_close()


if __name__ == '__main__':
    main()
