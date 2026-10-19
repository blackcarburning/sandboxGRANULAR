import http.client
import os
import select
import socket
import struct
import subprocess
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.parse import urlencode

import test_mygrain_radiolab as fixtures


RADIO = fixtures.RADIO


class EncodedStation(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def do_GET(self):
        with self.server.state_lock:
            self.server.entered += 1
            self.server.requests.append((self.path, dict(self.headers)))
        try:
            if self.path == '/upstream-error':
                self.send_error(503)
                return
            if self.path == '/redirect':
                self.send_response(302)
                self.send_header('Location', 'http://127.0.0.1/private')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            body = self.server.aac if self.path in ('/aac', '/live-aac') else self.server.mp3
            if self.path == '/bad':
                body = b'not compressed audio' * 100
            self.send_response(200)
            self.send_header('Content-Type', 'audio/aac' if self.path in ('/aac', '/live-aac') else 'audio/mpeg')
            self.send_header('Connection', 'close')
            if self.path in ('/chunked', '/badchunk'):
                self.send_header('Transfer-Encoding', 'chunked')
            elif self.path not in ('/live', '/live-aac', '/stall', '/headers'):
                self.send_header('Content-Length', str(len(body) + (4096 if self.path == '/truncated' else 0)))
            self.end_headers()
            if self.path in ('/chunked', '/badchunk'):
                for offset in range(0, len(body), 173):
                    chunk = body[offset:offset + 173]
                    self.wfile.write(f'{len(chunk):X}\r\n'.encode() + chunk + b'\r\n')
                self.wfile.write(b'invalid chunk\r\n' if self.path == '/badchunk' else b'0\r\n\r\n')
                self.wfile.flush()
                return
            if self.path not in ('/live', '/live-aac', '/stall', '/headers'):
                self.wfile.write(body)
                self.wfile.flush()
                return
            if self.path == '/stall':
                self.wfile.write(body * 3)
                self.wfile.flush()
            while not self.server.finish.is_set():
                if self.path in ('/live', '/live-aac'):
                    self.wfile.write(body * 4)
                    self.wfile.flush()
                if select.select([self.connection], [], [], .01)[0] and not self.connection.recv(1):
                    break
        except OSError:
            pass
        finally:
            with self.server.state_lock:
                self.server.exited += 1


class RadioLabPCMTests(unittest.TestCase):
    success = fixtures.RadioLabHTTPTests.success

    @classmethod
    def setUpClass(cls):
        cls.mp3 = cls.encode('lamemp3enc', 'target=bitrate', 'bitrate=128')
        cls.aac = cls.encode('avenc_aac', '!', 'aacparse', '!',
                             'audio/mpeg,mpegversion=4,stream-format=adts')

    @staticmethod
    def encode(*encoder):
        result = subprocess.run([
            '/usr/bin/gst-launch-1.0', '-q', 'audiotestsrc', 'num-buffers=40',
            'samplesperbuffer=441', 'freq=440', 'volume=0.3', '!',
            'audio/x-raw,rate=44100,channels=2', '!', 'audioconvert', '!',
            *encoder, '!', 'fdsink', 'fd=1',
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True)
        if not result.stdout:
            raise AssertionError('Installed MP3/AAC encoder produced no fixture')
        return result.stdout

    def setUp(self):
        fixtures.RadioLabHTTPTests.setUp(self)
        self.streams = []
        self.processes = []
        self.decoders = []
        self.station = ThreadingHTTPServer(('127.0.0.1', 0), EncodedStation)
        self.station.mp3 = self.mp3
        self.station.aac = self.aac
        self.station.finish = threading.Event()
        self.station.state_lock = threading.Lock()
        self.station.entered = 0
        self.station.exited = 0
        self.station.requests = []
        self.station_thread = threading.Thread(target=self.station.serve_forever,
                                                kwargs={'poll_interval': .01}, daemon=True)
        self.station_thread.start()
        self.original_resolver = RADIO.resolve_public_addresses
        original_popen = subprocess.Popen
        original_start = RADIO.PCMDecoder.start

        def launch(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            self.processes.append(process)
            return process

        def start(decoder):
            self.decoders.append(decoder)
            return original_start(decoder)

        self.patches = [
            patch.object(RADIO, 'resolve_public_addresses', return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, '', self.station.server_address)]),
            patch.object(RADIO, 'STATIONS', tuple(
                {'id': mode, 'url': 'http://radio.fixture.test/' + mode}
                for mode in ('mp3', 'aac', 'chunked', 'live', 'live-aac', 'bad', 'stall', 'headers',
                             'upstream-error', 'redirect', 'truncated', 'badchunk'))),
            patch.object(RADIO.subprocess, 'Popen', side_effect=launch),
            patch.object(RADIO.PCMDecoder, 'start', start),
        ]
        for active_patch in self.patches:
            active_patch.start()

    def tearDown(self):
        try:
            for connection, response in self.streams:
                response.close()
                connection.close()
            self.station.finish.set()
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            self.assert_clean()
        finally:
            self.station.shutdown()
            self.station.server_close()
            self.station_thread.join(2)
            for active_patch in reversed(self.patches):
                active_patch.stop()
            fixtures.RadioLabHTTPTests.tearDown(self)

    def wait_for(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.01)
        self.assertTrue(predicate(), 'condition did not settle')

    def url(self, station='live', generation=1, client='page_client_0001-pcm',
            user='admin', output_format='pcm'):
        query = {'_mygrain_user': user, '_radiolab_client': client,
                 '_radiolab_generation': generation}
        if output_format is not None:
            query['_radiolab_format'] = output_format
        return '/mygrain/radiolab/stream/' + station + '?' + urlencode(query)

    def open_stream(self, station='live', generation=1, client='page_client_0001-pcm',
                    account=None, headers=None, output_format='pcm'):
        account = account or self.admin
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        connection.request('GET', self.url(station, generation, client, account.username, output_format),
                           headers={'Cookie': account.cookie, **(headers or {})})
        response = connection.getresponse()
        self.streams.append((connection, response))
        return connection, response

    def release(self, generation=1, client='page_client_0001-pcm', account=None):
        account = account or self.admin
        query = urlencode({'_radiolab_client': client, '_radiolab_generation': generation,
                           '_mygrain_user': account.username})
        return account.request('POST', '/mygrain/api/radiolab/stream/release?' + query)

    def assert_clean(self):
        self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
        self.wait_for(lambda: self.station.entered == self.station.exited)
        self.assertTrue(all(decoder.closed for decoder in self.decoders))
        self.assertTrue(all(decoder.worker is None or not decoder.worker.is_alive()
                            for decoder in self.decoders))
        for process in self.processes:
            self.assertIsNotNone(process.returncode)
            self.assertTrue(process.stdin.closed)
            self.assertTrue(process.stdout.closed)
            with self.assertRaises(ChildProcessError):
                os.waitpid(process.pid, os.WNOHANG)

    def test_installed_mp3_aac_decode_to_real_stereo_44100_pcm_and_chunked_input(self):
        for generation, station in enumerate(('mp3', 'aac', 'chunked'), 1):
            with self.subTest(station=station):
                _, response = self.open_stream(station, generation)
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader('Content-Type'), 'application/octet-stream')
                self.assertEqual(response.getheader('X-Radiolab-Sample-Rate'), '44100')
                self.assertEqual(response.getheader('X-Radiolab-Channels'), '2')
                self.assertEqual(response.getheader('Transfer-Encoding'), 'chunked')
                self.assertIsNone(response.getheader('Content-Length'))
                self.assertEqual(response.getheader('Accept-Ranges'), 'none')
                self.assertEqual(response.getheader('X-Accel-Buffering'), 'no')
                self.assertIn('no-store', response.getheader('Cache-Control'))
                self.assertEqual(response.getheader('Pragma'), 'no-cache')
                body = response.read()
                self.assertEqual(len(body) % 4, 0)
                self.assertGreater(len(body), .3 * RADIO.PCM_BYTES_PER_SECOND)
                self.assertLess(len(body), .6 * RADIO.PCM_BYTES_PER_SECOND)
                samples = struct.unpack('<' + 'h' * (len(body) // 2), body)
                self.assertGreater(max(samples), 1000)
                self.assertLess(min(samples), -1000)
                channel_error = sum(abs(left - right) for left, right in zip(samples[::2], samples[1::2]))
                self.assertLess(channel_error / (len(samples) // 2), 50)
                signal = samples[::2][4410:13230]
                crossings = sum(before <= 0 < after for before, after in zip(signal, signal[1:]))
                self.assertAlmostEqual(crossings / (len(signal) / RADIO.PCM_SAMPLE_RATE), 440, delta=10)
                self.assert_clean()
        for process in self.processes:
            self.assertEqual(tuple(process.args), RADIO.DECODER_COMMAND)
            self.assertNotIn('radio.fixture.test', ' '.join(process.args))
        for path, headers in self.station.requests:
            self.assertEqual(headers['Host'], 'radio.fixture.test')
            self.assertEqual(headers['Icy-MetaData'], '0')
            self.assertNotIn('Range', headers)

    def test_cached_burst_is_paced_by_sample_count_with_bounded_first_chunk(self):
        started = time.monotonic()
        _, response = self.open_stream()
        first_size = response._read_next_chunk_size()
        self.assertGreater(first_size, 0)
        self.assertLessEqual(first_size, RADIO.PCM_CHUNK_BYTES)
        response.chunk_left = first_size
        received = len(response.read(RADIO.PCM_FRAME_BYTES))
        while time.monotonic() - started < 1.2:
            received += len(response.read(4096))
        elapsed = time.monotonic() - started
        seconds = received / RADIO.PCM_BYTES_PER_SECOND
        self.assertGreater(seconds, .7)
        self.assertLessEqual(seconds, elapsed + .1)
        self.release()
        self.assert_clean()

    def test_byte_and_sample_duration_limits_end_with_valid_chunk_terminator(self):
        for generation, limits, expected in (
            (1, {'MAX_PCM_BYTES': 8192}, 8192),
            (2, {'MAX_PCM_BYTES': 8195}, 8192),
            (3, {'MAX_PCM_SECONDS': .3}, None),
        ):
            with self.subTest(limits=limits), patch.multiple(RADIO, **limits):
                started = time.monotonic()
                _, response = self.open_stream(generation=generation)
                self.assertEqual(response.status, 200)
                body = response.read()
                if expected is not None:
                    self.assertEqual(len(body), expected)
                else:
                    self.assertGreater(len(body), 0)
                    self.assertLessEqual(len(body), int(.3 * RADIO.PCM_SAMPLE_RATE) * 4)
                self.assertEqual(len(body) % 4, 0)
                self.assertLess(time.monotonic() - started, 1)
                self.assert_clean()
        self.assertEqual(RADIO.MAX_PCM_SECONDS, 120)
        self.assertEqual(RADIO.MAX_PCM_BYTES, 32 * 1024 * 1024)
        self.assertEqual((RADIO.MAX_USER_STREAMS, RADIO.MAX_GLOBAL_STREAMS), (4, 8))

    def test_invalid_format_is_explicit_400_without_upstream_or_decoder(self):
        for suffix in ('&_radiolab_format=wav', '&_radiolab_format=',
                       '&_radiolab_format=pcm&_radiolab_format=pcm'):
            status, body, _ = self.admin.request('GET', self.url(output_format=None) + suffix, identity=False)
            self.assertEqual(status, 400)
        self.assertEqual(self.station.entered, 0)
        self.assertFalse(self.processes)

    def test_bad_media_upstream_status_and_redirect_fail_before_pcm_200(self):
        for generation, station in enumerate(('bad', 'upstream-error', 'redirect'), 1):
            _, response = self.open_stream(station, generation)
            self.assertEqual(response.status, 502)
            self.assertIn(b'"ok": false', response.read())
            self.assert_clean()
        self.assertEqual(len(self.processes), 1)
        self.assertNotEqual(self.processes[0].returncode, 0)

    def test_missing_decoder_is_503_and_does_not_leak_slot(self):
        with patch.object(RADIO, 'DECODER_COMMAND', ('/no/such/radiolab-decoder',)):
            _, response = self.open_stream()
            self.assertEqual(response.status, 503)
            response.read()
            self.assert_clean()

    def test_truncated_upstream_and_malformed_chunks_never_end_as_successful_pcm(self):
        for generation, station in enumerate(('truncated', 'badchunk'), 1):
            _, response = self.open_stream(station, generation)
            if response.status == 200:
                with self.assertRaises(http.client.IncompleteRead):
                    response.read()
            else:
                self.assertEqual(response.status, 502)
                response.read()
            self.assert_clean()

    def test_startup_nonzero_and_empty_success_never_manufacture_pcm_success(self):
        for generation, code in enumerate(('raise SystemExit(3)', 'pass'), 1):
            with patch.object(RADIO, 'DECODER_COMMAND', (sys.executable, '-c', code)):
                _, response = self.open_stream(generation=generation)
                self.assertEqual(response.status, 502)
                response.read()
                self.assert_clean()

    def test_decoder_error_after_pcm_headers_aborts_chunked_response(self):
        code = 'import os,time; os.write(1,b"\\x01\\x02\\x03\\x04"*1024); time.sleep(.3); raise SystemExit(4)'
        with patch.object(RADIO, 'DECODER_COMMAND', (sys.executable, '-c', code)):
            _, response = self.open_stream()
            self.assertEqual(response.status, 200)
            self.assertEqual(len(response.read(4096)), 4096)
            with self.assertRaises(http.client.IncompleteRead):
                response.read()
            self.assert_clean()

    def test_read_deadline_and_startup_deadline_reap_decoder_and_close_upstream(self):
        for generation, limits in enumerate(({'READ_TIMEOUT': .2}, {'PCM_START_TIMEOUT': .2}), 1):
            with patch.multiple(RADIO, **limits):
                started = time.monotonic()
                _, response = self.open_stream('headers', generation)
                self.assertEqual(response.status, 502)
                response.read()
                self.assertLess(time.monotonic() - started, 1)
                self.assert_clean()

    def test_stop_release_disconnect_and_replacement_reap_before_capacity_reuse(self):
        with patch.object(RADIO, 'MAX_USER_STREAMS', 1), patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1):
            for generation in range(1, 7):
                connection, response = self.open_stream(generation=generation)
                self.assertEqual(response.status, 200)
                self.assertEqual(len(response.read(1024)), 1024)
                if generation % 2:
                    started = time.monotonic()
                    self.assertEqual(self.release(generation)[:2], (200, {'ok': True, 'released': True}))
                    self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
                    self.assertLess(time.monotonic() - started, .8)
                    self.assert_clean()
                elif generation != 6:
                    started = time.monotonic()
                    response.close()
                    connection.close()
                    self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
                    self.assertLess(time.monotonic() - started, .8)
                    self.assert_clean()
            prior = self.processes[-1]
            _, replacement = self.open_stream(generation=6)
            self.assertEqual(replacement.status, 200)
            self.assertIsNotNone(prior.returncode)
            self.assertFalse(self.decoders[-2].worker.is_alive())
            self.release(6)
            self.assert_clean()

    def test_two_pages_can_each_monitor_and_record_but_fifth_upstream_is_rejected(self):
        _, monitor = self.open_stream(client='page_client_0001', output_format=None,
                                       headers={'Range': 'bytes=0-1'})
        self.assertEqual(monitor.status, 200)
        self.assertEqual(monitor.getheader('Content-Type'), 'audio/mpeg')
        self.assertIsNone(monitor.getheader('Transfer-Encoding'))
        self.assertIsNone(monitor.getheader('X-Radiolab-Sample-Rate'))
        self.assertIsNone(monitor.getheader('Content-Length'))
        self.assertIsNone(monitor.getheader('Content-Range'))
        self.assertEqual(monitor.getheader('Accept-Ranges'), 'none')
        self.assertEqual(monitor.read(3), self.mp3[:3])
        _, recording = self.open_stream()
        self.assertEqual(recording.status, 200)
        _, second_monitor = self.open_stream(client='another_page_0001', output_format=None)
        self.assertEqual(second_monitor.status, 200)
        _, second_recording = self.open_stream(client='another_page_0001-pcm')
        self.assertEqual(second_recording.status, 200)
        self.assertEqual(sum(RADIO.ACTIVE_STREAMS.values()), 4)
        _, blocked = self.open_stream(client='third_page_00001-pcm')
        self.assertEqual(blocked.status, 429)
        blocked.read()
        self.assertEqual(len(self.processes), 2)
        self.assertFalse(self.release(0)[1].get('released', False))
        self.release(client='another_page_0001-pcm')
        self.release(client='another_page_0001')
        self.release()
        self.wait_for(lambda: sum(RADIO.ACTIVE_STREAMS.values()) == 1)
        self.assertEqual(monitor.read(3), self.mp3[3:6])
        self.release(client='page_client_0001')
        self.assert_clean()

    def test_twenty_immediate_record_stop_cycles_with_live_mp3_aac_monitor(self):
        user_id = self.accounts.lookup_user('admin')['id']
        monitor_client = 'page_client_0001'
        capture_client = monitor_client + '-pcm'
        previous_decoder = None
        with ThreadPoolExecutor(max_workers=2) as executor:
            for generation in range(1, 21):
                station = 'live-aac' if generation % 2 else 'live'
                with self.subTest(generation=generation, station=station):
                    monitor_connection, monitor = self.open_stream(
                        station, generation, monitor_client, output_format=None)
                    self.assertEqual(monitor.status, 200)
                    self.assertTrue(monitor.read(3))
                    connection, recording = self.open_stream(station, generation, capture_client)
                    self.assertEqual(recording.status, 200)
                    self.assertEqual(len(recording.read(1024)), 1024)
                    self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 2})
                    if previous_decoder is not None:
                        self.assertTrue(previous_decoder.closed)
                        self.assertIsNotNone(previous_decoder.process.returncode)
                        self.assertFalse(previous_decoder.worker.is_alive())
                    decoder = self.decoders[-1]
                    recording.close()
                    connection.close()
                    capture_release = executor.submit(self.release, generation, capture_client)
                    monitor.close()
                    monitor_connection.close()
                    monitor_release = executor.submit(self.release, generation, monitor_client)
                    self.assertEqual(capture_release.result(timeout=2)[0], 200)
                    self.assertEqual(monitor_release.result(timeout=2)[0], 200)
                    previous_decoder = decoder
        self.assert_clean()
        self.assertEqual((RADIO.MAX_USER_STREAMS, RADIO.MAX_GLOBAL_STREAMS), (4, 8))

    def test_global_limit_rejects_pcm_before_spawning_and_ssrf_validation_still_runs(self):
        user_id = self.accounts.lookup_user('admin')['id']
        with patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1), RADIO.stream_slot(user_id):
            _, response = self.open_stream(account=self.dan)
            self.assertEqual(response.status, 429)
            response.read()
            self.assertFalse(self.processes)
        private = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 80))]
        original_getaddrinfo = socket.getaddrinfo

        def resolve(host, *args, **kwargs):
            return private if host == 'radio.fixture.test' else original_getaddrinfo(host, *args, **kwargs)

        with patch.object(RADIO, 'resolve_public_addresses', self.original_resolver):
            with patch.object(RADIO.socket, 'getaddrinfo', side_effect=resolve):
                _, response = self.open_stream()
                self.assertEqual(response.status, 502)
                response.read()
        self.assertFalse(self.processes)
        self.assertEqual(self.station.entered, 0)

    def test_startup_stop_and_disconnect_interrupt_blocked_upstream_without_decoder_leaks(self):
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(self.open_stream, 'headers')
            self.wait_for(lambda: bool(self.processes))
            started = time.monotonic()
            self.release()
            with self.assertRaises(http.client.RemoteDisconnected):
                pending.result(timeout=1)
            self.assert_clean()
            self.assertLess(time.monotonic() - started, .8)
        connection = socket.create_connection(self.server.server_address, timeout=2)
        request = ('GET ' + self.url('headers', generation=2) + ' HTTP/1.1\r\n'
                   'Host: localhost\r\nCookie: ' + self.admin.cookie + '\r\n\r\n')
        connection.sendall(request.encode())
        self.wait_for(lambda: len(self.processes) == 2)
        started = time.monotonic()
        connection.close()
        self.assert_clean()
        self.assertLess(time.monotonic() - started, .8)
        _, stopped = self.open_stream(generation=1)
        self.assertEqual(stopped.status, 409)
        stopped.read()
        self.assertEqual(len(self.processes), 2)

    def test_old_release_cannot_stop_new_capture_and_tokens_are_account_scoped(self):
        self.assertEqual(self.open_stream(generation=1)[1].status, 200)
        prior = self.processes[-1]
        _, current = self.open_stream(generation=2)
        self.assertEqual(current.status, 200)
        self.assertIsNotNone(prior.returncode)
        self.assertFalse(self.release(1)[1]['released'])
        self.assertFalse(self.release(2, account=self.dan)[1]['released'])
        self.assertEqual(len(current.read(1024)), 1024)
        self.release(2)
        self.assert_clean()
        _, stopped = self.open_stream(generation=2)
        self.assertEqual(stopped.status, 409)
        stopped.read()

    def test_stalled_decoder_input_write_deadline_aborts_and_reaps(self):
        code = ('import os,time\n'
                'while True:\n'
                ' os.write(1,b"\\x01\\x02\\x03\\x04"*1024)\n'
                ' time.sleep(.01)\n')
        with patch.object(RADIO, 'DECODER_COMMAND', (sys.executable, '-c', code)), \
                patch.object(RADIO, 'WRITE_TIMEOUT', .2):
            started = time.monotonic()
            _, response = self.open_stream()
            self.assertEqual(response.status, 200)
            with self.assertRaises(http.client.IncompleteRead):
                response.read()
            self.assert_clean()
            self.assertLess(time.monotonic() - started, 1)

    def test_downstream_backpressure_deadline_closes_upstream_and_reaps(self):
        original_start = RADIO.PCMDecoder.start

        def start(decoder):
            decoder.lease.downstream.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
            return original_start(decoder)

        with patch.object(RADIO.PCMDecoder, 'start', start), patch.object(RADIO, 'WRITE_TIMEOUT', .2):
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=4)
            connection.connect()
            connection.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
            connection.request('GET', self.url(), headers={'Cookie': self.admin.cookie})
            response = connection.getresponse()
            self.streams.append((connection, response))
            self.assertEqual(response.status, 200)
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS, timeout=3)
            self.assert_clean()

    def test_exact_eight_global_slots_bound_processes_and_deny_ninth_capture(self):
        with ExitStack() as reservations:
            for owner in range(7):
                reservations.enter_context(RADIO.stream_slot('reserved-user-' + str(owner)))
            _, response = self.open_stream()
            self.assertEqual(response.status, 200)
            self.assertEqual(sum(RADIO.ACTIVE_STREAMS.values()), 8)
            _, blocked = self.open_stream(account=self.dan)
            self.assertEqual(blocked.status, 429)
            blocked.read()
            self.assertEqual(len(self.processes), 1)
            self.release()
            self.wait_for(lambda: sum(RADIO.ACTIVE_STREAMS.values()) == 7)
            self.assertTrue(self.decoders[0].closed)
        self.assert_clean()


if __name__ == '__main__':
    unittest.main()
