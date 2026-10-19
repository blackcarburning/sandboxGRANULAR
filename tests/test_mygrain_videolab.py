import contextlib
import http.client
import importlib.util
import io
import json
import os
import pathlib
import socket
import struct
import tempfile
import threading
import time
import unittest
import wave
from email.message import Message
from types import SimpleNamespace
from unittest.mock import Mock, patch


WORKSPACE = pathlib.Path(__file__).resolve().parents[2]


def load(name, path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


SERVER = load('videolab_test_server', WORKSPACE / 'fs7300-documenter/server.py')
LAB = SERVER._videolab_module
WORKER = load('videolab_test_worker', WORKSPACE / 'sandboxGRANULAR/backend/videolab_worker.py')
VIDEO = 'aqz-KE-bpKQ'
URL = 'https://www.youtube.com/watch?v=' + VIDEO


def wav_bytes(frames=800, rate=8000, channels=2, bits=16):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setparams((channels, bits // 8, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(b'\x01' * (frames * channels * (bits // 8)))
    return output.getvalue()


def headers(**values):
    result = Message()
    for name, value in values.items():
        result[name.replace('_', '-')] = str(value)
    return result


class Handler:
    def __init__(self, path, method='GET', body=b'', user='admin', cookie=None, origin=None):
        self.path, self.command, self.rfile = path, method, io.BytesIO(body)
        self.headers = headers(Content_Length=len(body), Host='localhost')
        if user is not None:
            self.headers['X-Mygrain-User'] = user
        if cookie:
            self.headers['Cookie'] = cookie
        if origin:
            self.headers['Origin'] = origin
        self.connection = Mock()
        self.client_address = ('127.0.0.1', 12345)
        self.wfile = io.BytesIO()
        self.reply = None
        self.close_connection = False
        self.sent_headers = {}

    def send_json(self, payload, status=200, extra_headers=None):
        self.reply = (status, SERVER._accounts_module.bind_media_urls(payload), extra_headers)

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.sent_headers[name] = value

    def end_headers(self):
        pass

    def dispatch_mygrain_request(self, dispatch, *args, **kwargs):
        return SERVER.DocumenterHandler.dispatch_mygrain_request(self, dispatch, *args, **kwargs)

    def handle_mygrain_auth(self, inner, user):
        return SERVER.DocumenterHandler.handle_mygrain_auth(self, inner, user)

    def read_json(self):
        return LAB.read_json(self)


class VideoLabTests(unittest.TestCase):
    def test_public_videolab_assets_do_not_expose_api_or_private_artifacts(self):
        for name in ('/videolab.js', '/videolab.css', '/radiolab.js', '/index.html'):
            self.assertTrue(SERVER.is_mygrain_public_asset(name))
        for name in ('/api/videolab/captures', '/backend/mygrain_videolab.py', '/videolab-panel.html', '/videolab.js/extra', '/videolab.css.bak'):
            self.assertFalse(SERVER.is_mygrain_public_asset(name))

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='mygrain-videolab-test-')
        self.root = pathlib.Path(self.temporary.name)
        self.store = SERVER.init_account_store(self.root)
        self.admin = self.store.lookup_user('admin')
        self.dan = self.store.lookup_user('dan')
        self.identity = SERVER._accounts_module.CURRENT_USER.set(self.admin)
        LAB.JOBS.clear()

    def tearDown(self):
        LAB.JOBS.clear()
        SERVER._accounts_module.CURRENT_USER.reset(self.identity)
        self.temporary.cleanup()

    @contextlib.contextmanager
    def as_user(self, user):
        token = SERVER._accounts_module.CURRENT_USER.set(user)
        try:
            yield
        finally:
            SERVER._accounts_module.CURRENT_USER.reset(token)

    def request(self, suffix, method='GET', payload=None, body=None, user='admin'):
        body = json.dumps(payload).encode() if payload is not None else (body or b'')
        handler = Handler('/mygrain/api/videolab' + suffix, method, body, user=user)
        self.assertTrue(LAB.handle_videolab_request(handler, method, '/api/videolab' + suffix.split('?')[0]))
        return handler

    def fake_job(self, identifier='a' * 32, token='session-one'):
        return {'id': identifier, 'owner': LAB.owner_snapshot(), 'session': LAB.session_key(token), 'status': 'working',
                'url': URL, 'video': VIDEO, 'startSeconds': 0, 'durationSeconds': 120,
                'createdAt': '2026-10-18T00:00:00Z', 'started': time.monotonic(), 'cancel': threading.Event(), 'running': True}

    def test_strict_canonical_video_parser(self):
        for value in (URL, 'https://youtu.be/' + VIDEO, 'https://m.youtube.com/shorts/' + VIDEO, 'https://www.youtube.com/embed/' + VIDEO):
            self.assertEqual(LAB.youtube_url(value, True), (URL, VIDEO, 0))
        self.assertEqual(LAB.youtube_url(URL + '&t=12.5s')[2], 12.5)
        self.assertEqual(LAB.youtube_url(URL + '#t=30')[2], 30)
        for value in ('http://www.youtube.com/watch?v=' + VIDEO, 'https://youtube.com.evil/watch?v=' + VIDEO,
                      'https://www.youtube.com@127.0.0.1/watch?v=' + VIDEO, URL + '&list=PL123', URL + '&v=' + VIDEO,
                      URL + '&t=NaN', URL + '&t=21601', URL + '&url=https://127.0.0.1/', URL + '\\evil',
                      'file:///etc/passwd', 'https://www.youtube.com:443/watch?v=' + VIDEO, URL + '\n',
                      'https://youtu.be/' + VIDEO + '/more', 'https://www.youtube.com/playlist?list=PL123'):
            with self.subTest(url=value), self.assertRaises((LAB.RequestError, ValueError)):
                LAB.youtube_url(value, True)

    def test_channel_bookmarks_have_clear_capture_error(self):
        self.assertEqual(LAB.youtube_url('https://www.youtube.com/@BBCArchive/videos')[0], LAB.BUILTIN['url'])
        with self.assertRaisesRegex(LAB.RequestError, 'channel.*Select a video'):
            LAB.youtube_url(LAB.BUILTIN['url'], True)

    def test_bookmark_seed_is_read_only_and_account_isolated(self):
        self.assertEqual(LAB.bookmarks(), [LAB.BUILTIN])
        self.assertFalse(LAB.sample_root().exists())
        added = self.request('/bookmarks', 'POST', {'name': 'Blender', 'url': URL})
        self.assertEqual(added.reply[0], 200)
        identifier = added.reply[1]['bookmarks'][1]['id']
        with self.as_user(self.dan):
            self.assertEqual(LAB.bookmarks(), [LAB.BUILTIN])
            self.assertEqual(self.request('/bookmarks/' + identifier, 'DELETE').reply[0], 404)
        self.assertEqual(self.request('/bookmarks/' + identifier, 'DELETE').reply[1]['bookmarks'], [LAB.BUILTIN])
        self.assertEqual(self.request('/bookmarks/bbc-archive', 'DELETE').reply[0], 404)

    def test_wav_normalization_retains_actual_pcm_and_strips_metadata(self):
        original = wav_bytes()
        chunk = b'JUNK' + struct.pack('<I', 4) + b'test'
        expanded = original[:4] + struct.pack('<I', len(original) + len(chunk) - 8) + original[8:] + chunk
        normalized, metadata = LAB.normalize_wav(expanded)
        self.assertEqual(normalized, original)
        self.assertEqual(metadata, {'duration': 0.1, 'sampleRate': 8000, 'channels': 2, 'bitsPerSample': 16})
        self.assertNotEqual(set(normalized[44:]), {0})

    def test_invalid_or_float_wav_never_saves(self):
        original = wav_bytes()
        floating = bytearray(original)
        struct.pack_into('<H', floating, 20, 3)
        broken_rate = bytearray(original)
        struct.pack_into('<I', broken_rate, 28, 1)
        for body in (original[:-1], original + b'extra', bytes(floating), bytes(broken_rate), b'URL https://example.com', wav_bytes(frames=160), wav_bytes(frames=8000 * 181)):
            with self.subTest(length=len(body)):
                handler = self.request('/samples?name=bad', 'POST', body=body)
                self.assertIn(handler.reply[0], (400, 413))
        self.assertFalse(LAB.sample_root().exists())

    def test_48khz_stereo_sample_saves_preserve_the_full_120_and_180_second_interval(self):
        for seconds in (120, 180):
            body = wav_bytes(frames=48000 * seconds, rate=48000, channels=2)
            response = self.request('/samples?name=Full%20stereo%20interval', 'POST', body=body)
            self.assertEqual(response.reply[0], 200)
            sample = response.reply[1]['sample']
            self.assertEqual(sample['duration'], seconds)
            self.assertEqual(sample['bytes'], 44 + 48000 * seconds * 4)
            download = self.request('/samples/' + sample['filename'])
            self.assertEqual(download.status, 200)
            self.assertEqual(download.wfile.getvalue(), body)

    def test_exact_180_second_capture_is_below_frontend_32_mib(self):
        body = wav_bytes(frames=44100 * 180, rate=44100, channels=1)
        self.assertLess(len(body), 32 * 1024 * 1024)
        self.assertLess(44100 * 180 * 4, LAB.MAX_PCM_BYTES)
        self.assertEqual(LAB.normalize_wav(body)[1]['duration'], 180)
        with self.assertRaises(LAB.RequestError):
            LAB.normalize_wav(wav_bytes(frames=44100 * 180 + 1, rate=44100, channels=1))

    def test_loop_chunks_and_duplicate_data_are_rejected(self):
        original = wav_bytes()
        looping = bytearray(36)
        struct.pack_into('<I', looping, 28, 1)
        for extra in (b'smpl' + struct.pack('<I', 36) + looping, b'data' + struct.pack('<I', 4) + b'1234'):
            body = original[:4] + struct.pack('<I', len(original) + len(extra) - 8) + original[8:] + extra
            with self.assertRaises(LAB.RequestError):
                LAB.normalize_wav(body)

    def test_sample_shape_save_read_delete_and_source_cache(self):
        SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE['samples_videolab'] = ['stale']
        SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE['samples_radiolab'] = ['untouched']
        handler = self.request('/samples?name=My%20clip', 'POST', body=wav_bytes())
        self.assertEqual(handler.reply[0], 200)
        sample = handler.reply[1]['sample']
        self.assertEqual(sample['name'], 'My clip')
        self.assertIn('mygrainUser=admin', sample['url'])
        self.assertNotIn('samples_videolab', SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE)
        self.assertEqual(SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE['samples_radiolab'], ['untouched'])
        filename = sample['filename']
        path, metadata = LAB.sample_paths(filename)
        self.assertEqual(path.parent.name, 'SAMPLES_VIDEOLAB')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertIn(filename, SERVER.list_bastardloop_source_files('samples_videolab', force_refresh=True))
        fetched = self.request('/samples/' + filename)
        self.assertEqual(fetched.wfile.getvalue(), wav_bytes())
        self.assertEqual(fetched.sent_headers['Content-Length'], str(len(wav_bytes())))
        with self.as_user(self.dan):
            self.assertEqual(self.request('/samples').reply[1]['samples'], [])
            self.assertEqual(self.request('/samples/' + filename).reply[0], 404)
            self.assertEqual(self.request('/samples/' + filename, 'DELETE').reply[0], 404)
        self.assertEqual(self.request('/samples/' + filename, 'DELETE').reply[0], 200)
        self.assertFalse(path.exists())
        self.assertFalse(metadata.exists())

    def test_nonadmin_source_cache_invalidation_is_scoped(self):
        with self.as_user(self.dan):
            key = (self.dan['id'], 'samples_videolab')
            SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE[key] = ['stale']
            SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE['samples_videolab'] = ['admin']
            LAB.save_sample('Dan clip', wav_bytes())
            self.assertNotIn(key, SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE)
            self.assertEqual(SERVER.MYGRAIN_BASTARDLOOP_SAMPLE_CACHE['samples_videolab'], ['admin'])

    def test_sample_symlink_and_path_traversal_fail_closed(self):
        root = LAB.sample_root(create=True)
        outside = self.root / 'keep.wav'
        outside.write_bytes(wav_bytes())
        (root / 'evil.wav').symlink_to(outside)
        for name in ('../keep.wav', 'evil.wav', '/etc/passwd', 'clip.wav/../x'):
            with self.assertRaises((ValueError, OSError)):
                LAB.sample_paths(name)
        self.assertEqual(outside.read_bytes(), wav_bytes())

    def test_save_failure_rolls_back_only_new_files(self):
        root = LAB.sample_root(create=True)
        sentinel = root / 'keep.txt'
        sentinel.write_text('keep')
        original = LAB.write_private

        def fail_metadata(path, body):
            if path.suffix == '.json':
                raise OSError('disk full signed=https://secret/')
            original(path, body)

        with patch.object(LAB, 'write_private', side_effect=fail_metadata):
            handler = self.request('/samples?name=broken', 'POST', body=wav_bytes())
        self.assertEqual(handler.reply[0], 400)
        self.assertNotIn('secret', json.dumps(handler.reply))
        self.assertEqual(list(root.iterdir()), [sentinel])

    def test_upload_length_and_json_bounds(self):
        handler = Handler('/unused', body=wav_bytes())
        handler.headers['Content-Length'] = str(len(wav_bytes()))
        with self.assertRaises(LAB.RequestError):
            LAB.read_body(handler, LAB.MAX_BYTES)
        for value in ('-1', 'NaN', '67108865'):
            handler = Handler('/unused')
            del handler.headers['Content-Length']
            handler.headers['Content-Length'] = value
            with self.assertRaises(LAB.RequestError):
                LAB.read_body(handler, LAB.MAX_BYTES)
        self.assertEqual(self.request('/captures', 'POST', payload=[]).reply[0], 400)

    def test_async_capture_returns_queued_without_worker_or_account_lock_hold(self):
        with patch.object(LAB.threading, 'Thread') as thread:
            handler = self.request('/captures', 'POST', {'url': URL})
        self.assertEqual(handler.reply[0], 202)
        capture = handler.reply[1]['capture']
        self.assertEqual(capture['status'], 'queued')
        self.assertNotIn('audioUrl', capture)
        self.assertEqual(capture['durationSeconds'], 120)
        self.assertTrue(thread.return_value.start.called)
        job = LAB.JOBS[capture['id']]
        with self.as_user(self.dan):
            self.assertEqual(self.request('/captures/' + capture['id']).reply[0], 404)
            self.assertEqual(self.request('/captures/' + capture['id'], 'DELETE').reply[0], 404)
        self.assertFalse(job['cancel'].is_set())
        self.assertEqual(self.request('/captures/' + capture['id'] + '/audio').reply[0], 409)
        self.assertEqual(self.request('/captures/' + capture['id'], 'DELETE').reply[1]['capture']['status'], 'cancelled')

    def test_capture_bounds_reject_nan_bool_infinity_and_channels(self):
        for field, value in (('durationSeconds', 181), ('durationSeconds', True), ('durationSeconds', float('nan')), ('startSeconds', float('inf')), ('startSeconds', -1)):
            self.assertEqual(self.request('/captures', 'POST', {'url': URL, field: value}).reply[0], 400)
        self.assertIn('Select a video', self.request('/captures', 'POST', {'url': LAB.BUILTIN['url']}).reply[1]['error'])

    def test_global_and_per_account_capture_limits(self):
        with patch.object(LAB.threading, 'Thread'):
            self.assertEqual(self.request('/captures', 'POST', {'url': URL}).reply[0], 202)
            self.assertEqual(self.request('/captures', 'POST', {'url': URL}).reply[0], 429)
            with self.as_user(self.dan):
                self.assertEqual(self.request('/captures', 'POST', {'url': URL}).reply[0], 202)
            with patch.object(LAB, 'USER_LIMIT', 5):
                self.assertEqual(self.request('/captures', 'POST', {'url': URL}).reply[0], 429)

    def test_cancelled_jobs_release_retained_quota_after_worker_exit(self):
        for index in range(LAB.MAX_USER_JOBS):
            job = self.fake_job(f'{index:032x}')
            job.update(status='cancelled', running=False)
            LAB.JOBS[job['id']] = job
        with patch.object(LAB.threading, 'Thread'):
            self.assertEqual(self.request('/captures', 'POST', {'url': URL}).reply[0], 202)
        self.assertEqual(len(LAB.JOBS), 1)

    def test_thread_start_failure_does_not_reserve_a_permanent_slot(self):
        with patch.object(LAB.threading, 'Thread') as thread:
            thread.return_value.start.side_effect = RuntimeError('too many threads')
            self.assertEqual(self.request('/captures', 'POST', {'url': URL}).reply[0], 503)
        self.assertEqual(LAB.JOBS, {})

    def test_logout_cancellation_kills_only_own_process_group(self):
        first, second = self.fake_job(), self.fake_job('b' * 32, token='session-two')
        first['process'], second['process'] = Mock(pid=123456), Mock(pid=654321)
        LAB.JOBS.update({first['id']: first, second['id']: second})
        with patch.object(LAB.os, 'killpg') as kill:
            LAB.cancel_session('session-one')
        kill.assert_called_once_with(123456, LAB.signal.SIGKILL)
        self.assertEqual(first['status'], 'cancelled')
        self.assertFalse(second['cancel'].is_set())

    def test_ready_audio_owned_and_cancel_deletes_only_ephemeral_directory(self):
        job = self.fake_job()
        directory = self.root / 'owned-job'
        directory.mkdir()
        (directory / 'audio.wav').write_bytes(wav_bytes())
        sentinel = self.root / 'existing-data'
        sentinel.write_text('keep')
        job.update(status='ready', directory=directory, running=False)
        LAB.JOBS[job['id']] = job
        self.assertIn('audioUrl', self.request('/captures/' + job['id']).reply[1]['capture'])
        self.assertEqual(self.request('/captures/' + job['id'] + '/audio').wfile.getvalue(), wav_bytes())
        with self.as_user(self.dan):
            self.assertEqual(self.request('/captures/' + job['id'] + '/audio').reply[0], 404)
        self.request('/captures/' + job['id'], 'DELETE')
        self.assertFalse(directory.exists())
        self.assertEqual(sentinel.read_text(), 'keep')

    def test_ttl_cleanup_never_deletes_saved_samples(self):
        sample = LAB.save_sample('Keep sample', wav_bytes())
        job = self.fake_job()
        directory = self.root / 'expired-job'
        directory.mkdir()
        job.update(status='ready', running=False, directory=directory, finished=time.monotonic() - LAB.TTL_SECONDS - 1)
        LAB.JOBS[job['id']] = job
        LAB.cleanup_jobs()
        self.assertFalse(directory.exists())
        self.assertFalse(LAB.JOBS)
        self.assertTrue(LAB.sample_paths(sample['filename'])[0].is_file())

    def test_partial_write_failure_leaves_no_partial_sample(self):
        path = self.root / 'new.wav'
        with patch.object(LAB.os, 'fsync', side_effect=OSError('disk full')), self.assertRaises(OSError):
            LAB.write_private(path, wav_bytes())
        self.assertFalse(path.exists())
        path.write_bytes(b'pre-existing')
        with self.assertRaises(FileExistsError):
            LAB.write_private(path, b'new')
        self.assertEqual(path.read_bytes(), b'pre-existing')

    def test_successful_supervision_validates_actual_pcm_and_sanitized_metadata(self):
        job = self.fake_job()
        process = Mock(pid=987654, returncode=0)
        process.stdout.fileno.return_value = 123
        process.poll.return_value = 0
        result = json.dumps({'ok': True, 'videoId': VIDEO, 'title': 'Blender fixture', 'sourceDuration': 635}).encode()
        audio = wav_bytes(frames=4410, rate=44100, channels=1)

        def spawn(command, **kwargs):
            (pathlib.Path(command[4]) / 'audio.wav').write_bytes(audio)
            return process

        with patch.dict(os.environ, {'MYGRAIN_VIDEOLAB_JOBS_ROOT': str(self.root / 'jobs')}), patch.object(LAB.subprocess, 'Popen', side_effect=spawn), patch.object(LAB.os, 'chown'), patch.object(LAB.os, 'set_blocking'), patch.object(LAB.os, 'read', side_effect=[result, b'']), patch.object(LAB, 'terminate'):
            LAB.run_capture(job, 'session-token', Mock(session_user=Mock(return_value=self.admin)))
        self.assertEqual(job['status'], 'ready')
        self.assertEqual(job['metadata']['duration'], 0.1)
        self.assertEqual(job['metadata']['sourceDuration'], 635)
        self.assertEqual(job['metadata']['source']['title'], 'Blender fixture')
        self.assertEqual((job['directory'] / 'audio.wav').read_bytes(), audio)
        self.assertFalse((job['directory'] / 'worker').exists())
        self.assertNotIn('owner', LAB.public_capture(job))
        self.assertNotIn('directory', LAB.public_capture(job))
        LAB.cancel_job(job)

    def test_revoked_session_cancels_and_cleans_mocked_worker(self):
        job = self.fake_job()
        process = Mock(pid=987654)
        process.stdout.fileno.return_value = 123
        with patch.dict(os.environ, {'MYGRAIN_VIDEOLAB_JOBS_ROOT': str(self.root / 'jobs')}), patch.object(LAB.subprocess, 'Popen', return_value=process), patch.object(LAB.os, 'chown'), patch.object(LAB.os, 'set_blocking'), patch.object(LAB, 'terminate') as terminate:
            LAB.run_capture(job, 'revoked-token', Mock(session_user=Mock(return_value=None)))
        self.assertEqual(job['status'], 'cancelled')
        self.assertFalse(job['running'])
        self.assertTrue(terminate.called)
        self.assertEqual(list((self.root / 'jobs').iterdir()), [])

    def test_deadline_prevents_stale_job_from_launching(self):
        job = self.fake_job()
        job['started'] -= LAB.DEADLINE_SECONDS + 1
        with patch.object(LAB.subprocess, 'Popen') as spawn:
            LAB.run_capture(job, 'token', self.store)
        spawn.assert_not_called()
        self.assertEqual(job['status'], 'error')
        self.assertIn('deadline', job['error'])

    def test_native_audio_urls_still_require_matching_account_binding(self):
        session = self.store.new_session(self.admin)
        cookie = SERVER._accounts_module.COOKIE_NAME + '=' + session
        path = '/mygrain/api/videolab/captures/' + 'a' * 32 + '/audio'
        for query, expected in (('', False), ('?mygrainUser=dan', False), ('?mygrainUser=admin', True)):
            handler = Handler(path + query, user=None, cookie=cookie)
            dispatched = Mock()
            SERVER.DocumenterHandler.dispatch_mygrain_request(handler, dispatched)
            self.assertEqual(dispatched.called, expected)
            if not expected:
                self.assertEqual(handler.reply[0], 401)

    def test_existing_logout_handler_cancels_its_session_only(self):
        first_session = self.store.new_session(self.admin)
        second_session = self.store.new_session(self.admin)
        first, second = self.fake_job(token=first_session), self.fake_job('b' * 32, token=second_session)
        LAB.JOBS.update({first['id']: first, second['id']: second})
        cookie = SERVER._accounts_module.COOKIE_NAME + '=' + first_session
        handler = Handler('/mygrain/api/auth/logout', 'POST', cookie=cookie)
        SERVER.DocumenterHandler.dispatch_mygrain_request(handler, lambda *args: self.fail('unexpected dispatch'))
        self.assertEqual(handler.reply[0], 200)
        self.assertTrue(first['cancel'].is_set())
        self.assertFalse(second['cancel'].is_set())
        self.assertIsNone(self.store.session_user(first_session))
        self.assertIsNotNone(self.store.session_user(second_session))

    def test_worker_environment_does_not_inherit_credentials_proxies_or_pythonpath(self):
        with patch.dict(os.environ, {'HTTP_PROXY': 'http://secret', 'YOUTUBE_COOKIE': 'secret', 'PYTHONPATH': '/evil', 'GST_PLUGIN_PATH': '/evil'}):
            environment = LAB.worker_environment(self.root)
        self.assertNotIn('HTTP_PROXY', environment)
        self.assertNotIn('YOUTUBE_COOKIE', environment)
        self.assertNotIn('PYTHONPATH', environment)
        self.assertEqual(environment['GST_PLUGIN_PATH'], '')

    def test_supervisor_spawn_drops_privilege_and_reports_only_safe_errors(self):
        job = self.fake_job()
        process = Mock(pid=987654)
        process.stdout = io.BytesIO(b'{"ok":false,"error":"https://signed-secret/"}')
        process.poll.return_value = 1
        process.returncode = 1
        with patch.dict(os.environ, {'MYGRAIN_VIDEOLAB_JOBS_ROOT': str(self.root / 'jobs')}), patch.object(LAB.subprocess, 'Popen', return_value=process) as spawn, patch.object(LAB.os, 'geteuid', return_value=0), patch.object(LAB.os, 'chown'), patch.object(LAB.os, 'set_blocking'), patch.object(LAB.os, 'read', return_value=b''), patch.object(LAB, 'terminate'):
            LAB.run_capture(job, 'token', Mock(session_user=Mock(return_value=self.admin)))
        arguments = spawn.call_args.kwargs
        self.assertEqual(arguments['user'], 65534)
        self.assertEqual(arguments['group'], 65534)
        self.assertEqual(arguments['extra_groups'], ())
        self.assertTrue(arguments['start_new_session'])
        self.assertEqual(len(arguments['pass_fds']), 2)
        self.assertIn('-I', spawn.call_args.args[0])
        self.assertEqual(job['status'], 'error')
        self.assertNotIn('signed-secret', job['error'])
        self.assertEqual(list((self.root / 'jobs').iterdir()), [])

    def test_auth_origin_and_account_pin_wrapper_applies_to_all_videolab_routes(self):
        session = self.store.new_session(self.admin)
        cookie_name = SERVER._accounts_module.session_cookie(Handler('/unused'), session).split('=', 1)[0]
        cookie = cookie_name + '=' + session
        for method, path in (('GET', '/mygrain/api/videolab/bookmarks'), ('POST', '/mygrain/api/videolab/captures'), ('DELETE', '/mygrain/api/videolab/captures/' + 'a' * 32)):
            handler = Handler(path, method, user='admin')
            SERVER.DocumenterHandler.dispatch_mygrain_request(handler, lambda *args: self.fail('unauthenticated dispatch'))
            self.assertEqual(handler.reply[0], 401)
            handler = Handler(path, method, user='dan', cookie=cookie)
            SERVER.DocumenterHandler.dispatch_mygrain_request(handler, lambda *args: self.fail('wrong account dispatch'))
            self.assertEqual(handler.reply[0], 401)
            if method != 'GET':
                handler = Handler(path, method, user='admin', cookie=cookie, origin='https://evil.invalid')
                SERVER.DocumenterHandler.dispatch_mygrain_request(handler, lambda *args: self.fail('cross-origin dispatch'))
                self.assertEqual(handler.reply[0], 403)
        handler = Handler('/mygrain/api/videolab/bookmarks', user=None, cookie=cookie)
        SERVER.DocumenterHandler.dispatch_mygrain_request(handler, lambda *args: self.fail('missing pin dispatch'))
        self.assertEqual(handler.reply[0], 401)


class EgressTests(unittest.TestCase):
    def request(self, url, **kwargs):
        from yt_dlp.networking.common import Request

        return Request(url, **kwargs)

    def response(self, status=200, body=b'public', **values):
        return SimpleNamespace(status=status, headers=headers(**values), getheader=lambda name, default=None: values.get(name.replace('-', '_'), default),
                               read=io.BytesIO(body).read, close=Mock())

    def test_outbound_host_scheme_port_credentials_and_protocol_allowlist(self):
        for url in ('https://www.youtube.com/watch?v=' + VIDEO, 'https://youtubei.googleapis.com/youtubei/v1/player', 'https://rr1---sn-a5mekn7z.googlevideo.com/videoplayback?signature=private'):
            WORKER.checked_target(url)
        for url in ('https://evil.googlevideo.com.evil.invalid/', 'https://googlevideo.com/', 'http://www.youtube.com/',
                    'https://www.youtube.com:444/', 'https://user:password@www.youtube.com/', 'https://127.0.0.1/',
                    'https://www.youtube.com./', 'file:///etc/passwd', 'https://youtube.com\\@127.0.0.1/',
                    'https://www.youtube.com/\r\nX: evil', 'https://www.youtube.com/#fragment', 'https://www.youtube.com%2eevil/'):
            with self.subTest(url=url), self.assertRaises((WORKER.PolicyError, ValueError)):
                WORKER.checked_target(url)

    def test_dns_rejects_mixed_private_loopback_linklocal_ipv6_and_translation(self):
        for address in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '0.0.0.0', '224.0.0.1',
                        '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:0808:0808::1'):
            family = socket.AF_INET6 if ':' in address else socket.AF_INET
            answer = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('8.8.8.8', 443)),
                      (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (address, 443))]
            with self.subTest(address=address), patch.object(WORKER.socket, 'getaddrinfo', return_value=answer), self.assertRaises(WORKER.PolicyError):
                WORKER.public_addresses('www.youtube.com')

    def test_connection_pins_numeric_address_and_tls_uses_original_hostname(self):
        answer = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('8.8.8.8', 443))]
        context, connection = Mock(), Mock()
        with patch.object(WORKER.socket, 'getaddrinfo', return_value=answer) as dns, patch.object(WORKER.socket, 'socket', return_value=connection):
            target = WORKER.PinnedHTTPSConnection('www.youtube.com', timeout=1, context=context)
            target.connect()
        self.assertEqual(dns.call_count, 1)
        connection.connect.assert_called_once_with(('8.8.8.8', 443))
        context.wrap_socket.assert_called_once_with(connection, server_hostname='www.youtube.com')

    def test_every_redirect_revalidates_url_and_blocks_before_second_connection(self):
        for destination in ('https://127.0.0.1/internal', 'http://www.youtube.com/insecure', 'https://evil.invalid/steal', 'file:///etc/passwd'):
            response = self.response(302, Location=destination)
            connection = Mock(getresponse=Mock(return_value=response))
            with self.subTest(destination=destination), patch.object(WORKER, 'PinnedHTTPSConnection', return_value=connection) as connector:
                director = WORKER.PinnedDirector({}, time.monotonic() + 5)
                with self.assertRaises(WORKER.PolicyError):
                    director.send(self.request(URL))
                self.assertEqual(connector.call_count, 1)

    def test_redirects_to_allowlisted_hosts_still_check_and_pin_dns(self):
        first = Mock(getresponse=Mock(return_value=self.response(302, Location='https://rr1.googlevideo.com/audio')))
        second = Mock(getresponse=Mock(return_value=self.response()))
        with patch.object(WORKER, 'PinnedHTTPSConnection', side_effect=[first, second]) as connector:
            director = WORKER.PinnedDirector({}, time.monotonic() + 5)
            result = director.send(self.request(URL))
            self.assertEqual(result.read(), b'public')
            self.assertEqual([call.args[0] for call in connector.call_args_list], ['www.youtube.com', 'rr1.googlevideo.com'])
            director.close()

    def test_credentials_and_proxy_headers_are_removed_no_proxy_fallback(self):
        connection = Mock(getresponse=Mock(return_value=self.response()))
        with patch.object(WORKER, 'PinnedHTTPSConnection', return_value=connection):
            director = WORKER.PinnedDirector({'Cookie': 'bad', 'Authorization': 'bad'}, time.monotonic() + 5)
            director.send(self.request(URL, headers={'Proxy-Authorization': 'bad', 'Host': '127.0.0.1'}))
            sent = connection.request.call_args.kwargs['headers']
            self.assertEqual(sent, {'Accept-Encoding': 'identity'})
            with self.assertRaises(WORKER.PolicyError):
                director.send(self.request(URL, proxies={'https': 'http://127.0.0.1'}))
            director.close()

    def test_oversized_and_unknown_length_responses_are_bounded(self):
        connection = Mock(getresponse=Mock(return_value=self.response(Content_Length=str(WORKER.MAX_METADATA_BYTES + 1))))
        with patch.object(WORKER, 'PinnedHTTPSConnection', return_value=connection), self.assertRaises(WORKER.PolicyError):
            WORKER.PinnedDirector({}, time.monotonic() + 5).send(self.request(URL))
        director = WORKER.PinnedDirector({}, time.monotonic() + 5)
        stream = WORKER.BoundedBody(self.response(body=b'12345'), Mock(), director, 4)
        with self.assertRaises(WORKER.PolicyError):
            stream.read()
        stream.close()

    def test_pinned_ytdlp_has_no_default_transport_or_plugin_fallback(self):
        downloader = WORKER.downloader_class()
        with downloader({'quiet': True, 'cachedir': False, 'js_runtimes': {}, 'remote_components': []}) as extractor:
            self.assertIsInstance(extractor._request_director, WORKER.PinnedDirector)
            self.assertEqual(extractor._request_director.handlers, {})
            with self.assertRaises(WORKER.PolicyError):
                unused = extractor._opener
            with self.assertRaises(WORKER.PolicyError):
                extractor.urlopen('https://127.0.0.1/')
        from yt_dlp.globals import plugin_dirs

        self.assertEqual(plugin_dirs.value, [])

    def test_public_metadata_gate_rejects_access_restrictions_and_non_direct_audio(self):
        valid = {'id': VIDEO, 'availability': 'public', 'age_limit': 0, 'live_status': 'not_live', 'duration': 635,
                 'protocol': 'https', 'vcodec': 'none', 'acodec': 'mp4a.40.5', 'ext': 'm4a', 'url': 'https://rr1.googlevideo.com/audio'}
        self.assertEqual(WORKER.checked_metadata(valid, VIDEO, 0), 635)
        for field, value in (('availability', 'unlisted'), ('availability', 'private'), ('availability', None), ('age_limit', 18),
                             ('live_status', 'is_live'), ('live_status', 'post_live'), ('_type', 'playlist'), ('has_drm', True),
                             ('protocol', 'm3u8_native'), ('duration', float('nan')), ('filesize', WORKER.MAX_BYTES + 1),
                             ('url', 'https://www.youtube.com/not-a-cdn'), ('requested_formats', [{}]), ('fragments', [{}])):
            with self.subTest(field=field), self.assertRaises(WORKER.PolicyError):
                WORKER.checked_metadata({**valid, field: value}, VIDEO, 0)
        with self.assertRaises(WORKER.PolicyError):
            WORKER.checked_metadata(valid, VIDEO, 635)

    def test_root_worker_is_rejected_before_media_or_network(self):
        with patch.object(WORKER.os, 'getuid', return_value=0), patch.object(WORKER, 'acquire') as acquire, self.assertRaises(WORKER.PolicyError):
            WORKER.restrict_process()
        acquire.assert_not_called()

    def test_restriction_warnings_stop_without_leaking_urls(self):
        for message in ('Sign in to confirm', 'HTTP 403 https://signed-secret/', 'bot challenge', 'video unavailable'):
            with self.assertRaises(WORKER.PolicyError) as caught:
                WORKER.QuietLogger().warning(message)
            self.assertNotIn('https://', str(caught.exception))

    def test_decode_reads_only_local_bytes_and_preserves_exact_offset_and_duration(self):
        with tempfile.TemporaryDirectory(prefix='videolab-decode-test-') as temporary:
            root = pathlib.Path(temporary)
            source, target = root / 'source.m4a', root / 'audio.wav'
            source.write_bytes(b'local compressed fixture')
            pcm = b''.join(struct.pack('<h', value) for value in range(2400))
            process = Mock(stdout=io.BytesIO(pcm))
            process.poll.return_value = 0
            process.wait.return_value = 0
            with patch.object(WORKER, 'RATE', 8000), patch.object(WORKER.subprocess, 'Popen', return_value=process) as spawn, patch.object(WORKER.select, 'select', return_value=([process.stdout], [], [])):
                WORKER.decode(source, target, 0.1, 0.1)
            with wave.open(str(target), 'rb') as audio:
                self.assertEqual(audio.getnframes(), 800)
                self.assertEqual(audio.getnchannels(), 1)
                self.assertEqual(audio.readframes(800), pcm[1600:3200])
            command = spawn.call_args.args[0]
            self.assertIn('fdsrc', command)
            self.assertNotIn('uridecodebin', command)
            self.assertFalse(any('https://' in argument for argument in command))

    def test_decode_failure_never_synthesizes_pcm(self):
        with tempfile.TemporaryDirectory(prefix='videolab-decode-test-') as temporary:
            root = pathlib.Path(temporary)
            source, target = root / 'source.m4a', root / 'audio.wav'
            source.write_bytes(b'corrupt source')
            process = Mock(stdout=io.BytesIO(b''))
            process.poll.return_value = 0
            process.wait.return_value = 1
            with patch.object(WORKER.subprocess, 'Popen', return_value=process), patch.object(WORKER.select, 'select', return_value=([process.stdout], [], [])), self.assertRaises(WORKER.PolicyError):
                WORKER.decode(source, target, 0, 120)
            with wave.open(str(target), 'rb') as audio:
                self.assertEqual(audio.getnframes(), 0)

    def test_access_gate_runs_before_any_media_download(self):
        extractor = Mock()
        extractor.extract_info.return_value = {'id': VIDEO, 'availability': 'private'}
        context = Mock()
        context.__enter__ = Mock(return_value=extractor)
        context.__exit__ = Mock(return_value=False)
        with patch.object(WORKER, 'downloader_class', return_value=Mock(return_value=context)), patch.object(WORKER, 'decode') as decode, self.assertRaises(WORKER.PolicyError):
            WORKER.acquire(pathlib.Path('/not-used'), VIDEO, 0, 120)
        extractor.extract_info.assert_called_once_with(URL, download=False)
        extractor.process_info.assert_not_called()
        decode.assert_not_called()

    def test_process_restrictions_are_applied_before_extractor_or_decoder(self):
        libc = Mock()
        libc.prctl.return_value = 0
        with patch.object(WORKER.os, 'getuid', return_value=65534), patch.object(WORKER.os, 'geteuid', return_value=65534), patch.object(WORKER.os, 'getgroups', return_value=[]), patch('ctypes.CDLL', return_value=libc), patch.object(WORKER.pathlib.Path, 'read_text', return_value='CapEff:\t0000000000000000\n'), patch.object(WORKER.resource, 'setrlimit') as limit, patch.object(WORKER.signal, 'alarm') as alarm:
            WORKER.restrict_process()
        self.assertEqual([call.args[0] for call in libc.prctl.call_args_list], [38, 4])
        applied = {call.args[0]: call.args[1] for call in limit.call_args_list}
        self.assertEqual(applied[WORKER.resource.RLIMIT_FSIZE], (WORKER.MAX_BYTES, WORKER.MAX_BYTES))
        self.assertEqual(applied[WORKER.resource.RLIMIT_CORE], (0, 0))
        self.assertEqual(applied[WORKER.resource.RLIMIT_NOFILE], (128, 128))
        self.assertEqual(applied[WORKER.resource.RLIMIT_NPROC], (64, 64))
        alarm.assert_called_once_with(118)


if __name__ == '__main__':
    unittest.main()
