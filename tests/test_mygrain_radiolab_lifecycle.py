import http.client
import select
import socket
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock, patch
from urllib.parse import urlencode

import test_mygrain_radiolab as fixtures


RADIO = fixtures.RADIO
ACCOUNTS = fixtures.ACCOUNTS


class DelayedStation(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def do_GET(self):
        with self.server.state_lock:
            self.server.entered += 1
        try:
            if self.path != '/headers':
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(b'fixture audio')
                self.wfile.flush()
            while not self.server.finish.is_set():
                if self.path == '/flood':
                    self.wfile.write(b'a' * 32768)
                    self.wfile.flush()
                    with self.server.state_lock:
                        self.server.written += 32768
                elif select.select([self.connection], [], [], .02)[0]:
                    if not self.connection.recv(1):
                        break
        except OSError:
            pass
        finally:
            with self.server.state_lock:
                self.server.exited += 1


class RadioLabLifecycleTests(unittest.TestCase):
    success = fixtures.RadioLabHTTPTests.success

    def setUp(self):
        fixtures.RadioLabHTTPTests.setUp(self)
        self.streams = []
        self.station = None
        self.patches = []

    def tearDown(self):
        for connection, response in self.streams:
            response.close()
            connection.close()
        if self.station is not None:
            self.station.finish.set()
            self.station.shutdown()
            self.station.server_close()
            self.station_thread.join(2)
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
        for active_patch in reversed(self.patches):
            active_patch.stop()
        fixtures.RadioLabHTTPTests.tearDown(self)

    def start_station(self):
        station = ThreadingHTTPServer(('127.0.0.1', 0), DelayedStation)
        station.finish = threading.Event()
        station.state_lock = threading.Lock()
        station.entered = 0
        station.exited = 0
        station.written = 0
        thread = threading.Thread(target=station.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        thread.start()
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', station.server_address)]
        resolver = patch.object(RADIO, 'resolve_public_addresses', return_value=addresses)
        catalogue = patch.object(RADIO, 'STATIONS', tuple(
            {'id': mode, 'url': 'http://radio.fixture.test/' + mode}
            for mode in ('body', 'headers', 'flood')))
        resolver.start()
        catalogue.start()
        self.patches.extend((resolver, catalogue))
        self.station = station
        self.station_thread = thread
        return station

    def wait_for(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.01)
        self.assertTrue(predicate(), 'condition did not settle')

    def stream_url(self, generation=None, client='page_client_0001', station='body', user='admin'):
        query = {'_mygrain_user': user}
        if generation is not None:
            query.update(_radiolab_client=client, _radiolab_generation=generation)
        return '/mygrain/radiolab/stream/' + station + '?' + urlencode(query)

    def open_stream(self, generation=None, client='page_client_0001', station='body', account=None, headers=None):
        account = account or self.admin
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=4)
        connection.request('GET', self.stream_url(generation, client, station, account.username), headers={'Cookie': account.cookie, **(headers or {})})
        response = connection.getresponse()
        self.streams.append((connection, response))
        return connection, response

    def release(self, generation, client='page_client_0001', account=None, **kwargs):
        account = account or self.admin
        query = urlencode({'_radiolab_client': client, '_radiolab_generation': generation,
                           '_mygrain_user': account.username})
        return account.request('POST', '/mygrain/api/radiolab/stream/release?' + query, **kwargs)

    def test_iphone_range_probe_then_plain_get_same_tune_replaces_connection(self):
        # Actual iPhone access logs: bytes=0-1 -> 200, ordinary GET -> 409.
        # A live stream has no byte-range representation; Safari retries without
        # Range. That retry is another HTTP request, not a stale user action.
        station = self.start_station()
        user_id = self.accounts.lookup_user('admin')['id']
        with patch.object(RADIO, 'MAX_USER_STREAMS', 1), patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1):
            _, probe = self.open_stream(1, headers={'Range': 'bytes=0-1'})
            self.assertEqual(probe.status, 200)
            self.assertEqual(probe.getheader('Accept-Ranges'), 'none')
            self.assertIsNone(probe.getheader('Content-Range'))
            self.assertEqual(probe.read(2), b'fi')
            _, playback = self.open_stream(1)
            self.assertEqual(playback.status, 200)
            self.assertEqual(playback.read(len(b'fixture audio')), b'fixture audio')
            self.wait_for(lambda: station.exited == 1)
            self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 1})
            self.release(1)
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            self.assertEqual(self.admin.request('GET', self.stream_url(1), identity=False)[0], 409)

    def test_current_generation_reconnects_after_transport_ends_but_not_after_stop(self):
        station = self.start_station()
        with patch.object(RADIO, 'READ_TIMEOUT', .15):
            connection, response = self.open_stream(1)
            self.assertEqual(response.status, 200)
            response.close()
            connection.close()
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            self.assertEqual(self.open_stream(1)[1].status, 200)
            self.release(1)
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            self.assertEqual(self.admin.request('GET', self.stream_url(1), identity=False)[0], 409)
            self.assertEqual(self.open_stream(2)[1].status, 200)
            self.release(2)

    def test_same_generation_cannot_change_station_or_revive_superseded_tune(self):
        self.start_station()
        self.assertEqual(self.open_stream(1)[1].status, 200)
        self.assertEqual(self.admin.request('GET', self.stream_url(1, station='flood'), identity=False)[0], 409)
        self.assertEqual(self.station.entered, 1)
        self.assertEqual(self.open_stream(2)[1].status, 200)
        self.assertEqual(self.admin.request('GET', self.stream_url(1), identity=False)[0], 409)
        self.assertEqual(self.open_stream(2)[1].status, 200)
        self.assertFalse(self.release(1)[1]['released'])
        self.assertTrue(RADIO.ACTIVE_STREAMS)
        self.release(2)

    def test_twenty_same_tune_http_retries_close_prior_sockets_under_single_slot_limit(self):
        station = self.start_station()
        user_id = self.accounts.lookup_user('admin')['id']
        with patch.object(RADIO, 'MAX_USER_STREAMS', 1), patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1):
            for attempt in range(20):
                _, response = self.open_stream(1, headers={'Range': 'bytes=0-1'} if attempt % 2 == 0 else {})
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(2), b'fi')
                self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 1})
                self.wait_for(lambda: station.exited == attempt)
            self.release(1)
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            self.wait_for(lambda: station.exited == 20)

    def test_repeated_scoped_switch_closes_delayed_body_before_reusing_single_slot(self):
        station = self.start_station()
        user_id = self.accounts.lookup_user('admin')['id']
        with patch.object(RADIO, 'MAX_USER_STREAMS', 1), patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1):
            for generation in range(1, 21):
                started = time.monotonic()
                connection, response = self.open_stream(generation)
                self.assertEqual(response.status, 200)
                self.assertLess(time.monotonic() - started, 1)
                self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 1})
                self.wait_for(lambda: station.exited == generation - 1)
                if generation > 1:
                    self.assertEqual(self.admin.request('GET', self.stream_url(generation - 1), identity=False)[0], 409)
            self.assertEqual(self.release(20)[:2], (200, {'ok': True, 'released': True}))
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            self.wait_for(lambda: station.exited == 20)

    def test_stop_is_cheap_authenticated_origin_checked_and_old_stop_cannot_cancel_new_tune(self):
        self.start_station()
        connection, response = self.open_stream(1)
        self.assertEqual(response.status, 200)
        with patch.object(RADIO, 'REPLACE_TIMEOUT', 2):
            for account, kwargs, expected in (
                (self.anonymous, {}, 401),
                (self.admin, {'identity': False}, 401),
                (self.admin, {'headers': {'Origin': 'https://attacker.example'}}, 403),
                (self.admin, {'headers': {'X-Mygrain-User': 'dan'}}, 401),
            ):
                self.assertEqual(self.release(1, account=account, **kwargs)[0], expected)
            self.assertTrue(RADIO.ACTIVE_STREAMS)
            started = time.monotonic()
            self.assertEqual(self.release(1)[:2], (200, {'ok': True, 'released': True}))
            self.assertLess(time.monotonic() - started, .5)
            self.assertEqual(self.release(1)[:2], (200, {'ok': True, 'released': False}))
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            connection, response = self.open_stream(2)
            self.assertEqual(response.status, 200)
            self.assertEqual(self.release(1)[:2], (200, {'ok': True, 'released': False}))
            self.assertEqual(self.admin.request('GET', self.stream_url(1), identity=False)[0], 409)
            self.assertEqual(self.open_stream(2)[1].status, 200)
            self.assertTrue(RADIO.ACTIVE_STREAMS)
            self.release(2)

    def test_stop_before_delayed_get_records_watermark_and_validates_both_fields(self):
        self.start_station()
        self.assertEqual(self.release(9)[:2], (200, {'ok': True, 'released': False}))
        for generation in (8, 9):
            self.assertEqual(self.admin.request('GET', self.stream_url(generation), identity=False)[0], 409)
        self.assertEqual(self.station.entered, 0)
        for query in (
            '_radiolab_client=page_client_0001', '_radiolab_generation=1',
            '_radiolab_client=&_radiolab_generation=',
            '_radiolab_client=short&_radiolab_generation=1',
            '_radiolab_client=page_client_0001&_radiolab_generation=01',
            '_radiolab_client=page_client_0001&_radiolab_generation=-1',
            '_radiolab_client=page_client_0001&_radiolab_generation=9007199254740992',
            '_radiolab_client=page_client_0001&_radiolab_generation=1&_radiolab_generation=2',
            '_radiolab_client=page_client_0001&_radiolab_client=page_client_0001&_radiolab_generation=1',
        ):
            with self.subTest(query=query):
                self.assertEqual(self.admin.request('GET', self.stream_url() + '&' + query, identity=False)[0], 400)
                self.assertEqual(self.admin.request('POST', '/mygrain/api/radiolab/stream/release?' + query)[0], 400)
        connection, response = self.open_stream(10)
        self.assertEqual(response.status, 200)
        self.release(10)

    def test_page_and_account_isolation_and_actual_limits_are_preserved(self):
        self.start_station()
        user_id = self.accounts.lookup_user('admin')['id']
        dan_id = self.accounts.lookup_user('dan')['id']
        with patch.object(RADIO, 'MAX_USER_STREAMS', 1), patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 2):
            self.assertEqual(self.open_stream(1)[1].status, 200)
            self.assertEqual(self.open_stream(1, account=self.dan)[1].status, 200)
            self.assertEqual(self.admin.request('GET', self.stream_url(1, 'other_page_00001'), identity=False)[0], 429)
            self.assertEqual(self.release(1, client='other_page_00001')[1]['released'], False)
            self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 1, dan_id: 1})
            self.assertEqual(self.open_stream(2)[1].status, 200)
            self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 1, dan_id: 1})
            self.release(2)
            self.wait_for(lambda: RADIO.ACTIVE_STREAMS == {dan_id: 1})
            self.release(1, account=self.dan)

    def test_new_tune_interrupts_upstream_that_has_not_sent_headers(self):
        station = self.start_station()

        def pending():
            try:
                return self.admin.request('GET', self.stream_url(1, station='headers'), identity=False)[0]
            except (OSError, http.client.HTTPException):
                return 'aborted'

        with ThreadPoolExecutor(max_workers=1) as executor:
            original = executor.submit(pending)
            self.wait_for(lambda: station.entered == 1)
            started = time.monotonic()
            self.assertEqual(self.open_stream(2)[1].status, 200)
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(original.result(timeout=1), 'aborted')
            self.wait_for(lambda: station.exited == 1)
            self.release(2)

    def test_stop_one_page_leaves_another_page_of_same_account_connected(self):
        station = self.start_station()
        user_id = self.accounts.lookup_user('admin')['id']
        self.assertEqual(self.open_stream(1)[1].status, 200)
        self.assertEqual(self.open_stream(1, client='other_page_00001')[1].status, 200)
        self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 2})
        self.release(1)
        self.wait_for(lambda: RADIO.ACTIVE_STREAMS == {user_id: 1})
        self.wait_for(lambda: station.exited == 1)
        self.assertEqual(self.open_stream(2)[1].status, 200)
        self.assertEqual(RADIO.ACTIVE_STREAMS, {user_id: 2})
        self.release(2)
        self.release(1, client='other_page_00001')

    def test_cancel_interrupts_non_reading_downstream_without_waiting_write_timeout(self):
        station = self.start_station()
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=4)
        connection.connect()
        connection.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
        connection.request('GET', self.stream_url(1, station='flood'), headers={'Cookie': self.admin.cookie})
        response = connection.getresponse()
        self.streams.append((connection, response))
        self.assertEqual(response.status, 200)
        user_id = self.accounts.lookup_user('admin')['id']
        with RADIO.STREAM_LOCK:
            lease = next(iter(RADIO.STREAM_SCOPES[(user_id, 'page_client_0001')]['leases']))
        lease.downstream.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
        self.wait_for(lambda: station.written >= 1024 * 1024)
        previous = None
        for attempt in range(30):
            written = station.written
            if written == previous:
                break
            previous = written
            time.sleep(.05)
        else:
            self.fail('upstream did not backpressure while downstream was non-reading')
        started = time.monotonic()
        self.assertEqual(self.open_stream(2)[1].status, 200)
        self.assertLess(time.monotonic() - started, 1)
        self.wait_for(lambda: station.exited == 1)
        self.release(2)

    def test_disconnected_downstream_without_release_still_has_bounded_read_cleanup(self):
        station = self.start_station()
        with patch.object(RADIO, 'READ_TIMEOUT', .15):
            connection, response = self.open_stream(1)
            self.assertEqual(response.status, 200)
            response.close()
            connection.close()
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS, timeout=1)
            self.wait_for(lambda: station.exited == 1)

    def test_release_also_interrupts_pending_headers_without_waiting_for_stream_cleanup(self):
        station = self.start_station()

        def pending():
            try:
                return self.admin.request('GET', self.stream_url(1, station='headers'), identity=False)[0]
            except (OSError, http.client.HTTPException):
                return 'aborted'

        with ThreadPoolExecutor(max_workers=1) as executor:
            original = executor.submit(pending)
            self.wait_for(lambda: station.entered == 1)
            self.assertEqual(self.release(1)[1], {'ok': True, 'released': True})
            self.assertEqual(original.result(timeout=1), 'aborted')
            self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)
            self.wait_for(lambda: station.exited == 1)


    def test_legacy_paused_clients_reproduce_slot_exhaustion_with_real_delayed_body(self):
        station = self.start_station()
        streams = [self.open_stream() for attempt in range(RADIO.MAX_USER_STREAMS)]
        self.assertTrue(all(response.status == 200 for connection, response in streams))
        self.wait_for(lambda: station.entered == RADIO.MAX_USER_STREAMS)
        user_id = self.accounts.lookup_user('admin')['id']
        self.assertEqual(RADIO.ACTIVE_STREAMS[user_id], RADIO.MAX_USER_STREAMS)
        self.assertEqual(self.admin.request('GET', self.stream_url(station='flood'), identity=False)[0], 429)
        first, first_response = streams[0]
        first_response.close()
        first.close()
        time.sleep(.05)
        self.assertEqual(RADIO.ACTIVE_STREAMS[user_id], RADIO.MAX_USER_STREAMS)
        self.assertEqual(self.admin.request('GET', self.stream_url(station='flood'), identity=False)[0], 429)
        for connection, response in streams[1:]:
            response.close()
            connection.close()
        station.finish.set()
        self.wait_for(lambda: not RADIO.ACTIVE_STREAMS)


class RadioLabLeaseTests(unittest.TestCase):
    def setUp(self):
        self.scopes = patch.object(RADIO, 'STREAM_SCOPES', {})
        self.counts = patch.object(RADIO, 'ACTIVE_STREAMS', {})
        self.scopes.start()
        self.counts.start()
        self.addCleanup(self.scopes.stop)
        self.addCleanup(self.counts.stop)

    def test_immediate_other_scope_waits_for_cancelled_transport_without_freeing_early(self):
        entered = threading.Event()
        finish = threading.Event()
        leases = []

        def hold():
            with RADIO.stream_slot('user', 'page_client_0001', 1) as lease:
                leases.append(lease)
                entered.set()
                finish.wait(2)

        with patch.object(RADIO, 'MAX_USER_STREAMS', 1), patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1):
            with ThreadPoolExecutor(max_workers=1) as executor:
                original = executor.submit(hold)
                self.assertTrue(entered.wait(1))
                timer = threading.Timer(.1, finish.set)
                try:
                    self.assertTrue(RADIO.release_stream('user', 'page_client_0001', 1))
                    self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})
                    self.assertFalse(leases[0].done.is_set())
                    timer.start()
                    with RADIO.stream_slot('user', 'page_client_0001-pcm', 2):
                        self.assertTrue(leases[0].done.is_set())
                        self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})
                finally:
                    finish.set()
                    timer.cancel()
                    if timer.ident is not None:
                        timer.join(1)
                    original.result(timeout=1)
        self.assertFalse(RADIO.ACTIVE_STREAMS)

    def test_cleanup_error_still_removes_completed_lease_and_signals_waiters(self):
        with RADIO.stream_slot('user', 'page_client_0001', 1):
            with self.assertRaisesRegex(OSError, 'cleanup failure'):
                with RADIO.stream_slot('user', 'page_client_0001-pcm', 2) as recording:
                    recording.close = Mock(side_effect=OSError('cleanup failure'))
            self.assertTrue(recording.done.is_set())
            self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})
            self.assertFalse(RADIO.STREAM_SCOPES[('user', 'page_client_0001-pcm')]['leases'])
        self.assertFalse(RADIO.ACTIVE_STREAMS)

    def test_uninterruptible_previous_lease_cannot_release_capacity_early(self):
        entered = threading.Event()
        finish = threading.Event()

        def hold():
            with RADIO.stream_slot('user', 'page_client_0001', 1) as lease:
                entered.set()
                finish.wait(2)
                return lease

        with ThreadPoolExecutor(max_workers=1) as executor:
            original = executor.submit(hold)
            self.assertTrue(entered.wait(1))
            try:
                with patch.object(RADIO, 'REPLACE_TIMEOUT', .03):
                    started = time.monotonic()
                    with self.assertRaises(RADIO.RelayError) as failure:
                        with RADIO.stream_slot('user', 'page_client_0001', 2):
                            self.fail('admitted before prior actual connection closed')
                    self.assertEqual(failure.exception.status, 429)
                    self.assertLess(time.monotonic() - started, .5)
                    self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})
                    self.assertFalse(RADIO.release_stream('user', 'page_client_0001', 1))
                    with self.assertRaises(RADIO.RelayError) as failure:
                        with RADIO.stream_slot('user', 'page_client_0001', 3):
                            self.fail('an earlier timed-out replacement hid a draining connection')
                    self.assertEqual(failure.exception.status, 429)
                    self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})
            finally:
                finish.set()
            lease = original.result(timeout=1)
        self.assertTrue(lease.cancelled.is_set())
        self.assertTrue(lease.done.is_set())
        self.assertFalse(RADIO.ACTIVE_STREAMS)
        with self.assertRaises(RADIO.RelayError) as failure:
            with RADIO.stream_slot('user', 'page_client_0001', 2):
                self.fail('failed attempt generation was reused')
        self.assertEqual(failure.exception.status, 409)
        with RADIO.stream_slot('user', 'page_client_0001', 4):
            self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})

    def test_resources_close_before_counter_is_decremented(self):
        closing = threading.Event()
        finish = threading.Event()
        handler = Mock(command='GET', path='/mygrain/radiolab/stream/vesti-fm')
        response = Mock()
        response.read1.return_value = b''
        response.close.side_effect = lambda: (closing.set(), finish.wait(2))
        connection = Mock()
        connection.close.side_effect = lambda: self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})

        def stream():
            token = ACCOUNTS.CURRENT_USER.set({'id': 'user', 'username': 'test'})
            try:
                RADIO.handle_stream_request(handler, '/radiolab/stream/vesti-fm')
            finally:
                ACCOUNTS.CURRENT_USER.reset(token)

        with patch.object(RADIO, 'open_station_stream', return_value=(connection, response, 'audio/mpeg')), patch.object(RADIO, 'MAX_GLOBAL_STREAMS', 1):
            with ThreadPoolExecutor(max_workers=1) as executor:
                original = executor.submit(stream)
                self.assertTrue(closing.wait(1))
                try:
                    with self.assertRaises(RADIO.RelayError) as failure:
                        with RADIO.stream_slot('another-user'):
                            self.fail('cleanup was still holding the upstream connection')
                    self.assertEqual(failure.exception.status, 429)
                finally:
                    finish.set()
                original.result(timeout=1)
        self.assertFalse(RADIO.ACTIVE_STREAMS)

    def test_newest_generation_wins_while_two_older_requests_are_draining(self):
        entered = threading.Event()
        finish = threading.Event()
        leases = []

        def hold():
            with RADIO.stream_slot('user', 'page_client_0001', 1) as lease:
                leases.append(lease)
                entered.set()
                finish.wait(2)

        def replace():
            try:
                with RADIO.stream_slot('user', 'page_client_0001', 2):
                    return 'incorrectly admitted'
            except RADIO.RelayError as error:
                return error.status

        with ThreadPoolExecutor(max_workers=2) as executor:
            original = executor.submit(hold)
            self.assertTrue(entered.wait(1))
            intermediate = executor.submit(replace)
            self.assertTrue(leases[0].cancelled.wait(1))
            timer = threading.Timer(.05, finish.set)
            timer.start()
            try:
                with RADIO.stream_slot('user', 'page_client_0001', 3):
                    self.assertEqual(RADIO.ACTIVE_STREAMS, {'user': 1})
                    self.assertEqual(intermediate.result(timeout=1), 409)
                original.result(timeout=1)
            finally:
                finish.set()
                timer.cancel()
                timer.join(1)
        self.assertFalse(RADIO.ACTIVE_STREAMS)

    def test_scope_registry_is_bounded_and_never_evicts_live_lease(self):
        with patch.object(RADIO, 'MAX_USER_STREAM_SCOPES', 1), patch.object(RADIO, 'MAX_STREAM_SCOPES', 2):
            with RADIO.stream_slot('user', 'page_client_0001', 1):
                with self.assertRaises(RADIO.RelayError) as failure:
                    RADIO.release_stream('user', 'other_page_00001', 1)
                self.assertEqual(failure.exception.status, 429)
                self.assertFalse(RADIO.release_stream('other', 'page_client_0001', 1))
                with self.assertRaises(RADIO.RelayError) as failure:
                    RADIO.release_stream('third', 'page_client_0001', 1)
                self.assertEqual(failure.exception.status, 429)
                with patch.object(RADIO, 'STREAM_SCOPE_SECONDS', 0):
                    self.assertFalse(RADIO.release_stream('other', 'other_page_00001', 1))
                    self.assertIn(('user', 'page_client_0001'), RADIO.STREAM_SCOPES)
            with patch.object(RADIO, 'STREAM_SCOPE_SECONDS', 0):
                self.assertFalse(RADIO.release_stream('user', 'other_page_00001', 1))
                self.assertNotIn(('user', 'page_client_0001'), RADIO.STREAM_SCOPES)

    def test_cancel_during_dns_wait_does_not_free_unbounded_resolvers(self):
        entered = threading.Event()
        finish = threading.Event()
        slots = threading.BoundedSemaphore(1)
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('1.1.1.1', 80))]

        def delayed_dns(*args, **kwargs):
            entered.set()
            finish.wait(2)
            return public

        def resolve():
            try:
                with RADIO.stream_slot('user', 'page_client_0001', 1):
                    RADIO.resolve_public_addresses('example.org', 80)
            except RADIO.RelayError as error:
                return error.status

        with patch.object(RADIO, 'DNS_SLOTS', slots), patch.object(RADIO.socket, 'getaddrinfo', side_effect=delayed_dns):
            with ThreadPoolExecutor(max_workers=1) as executor:
                original = executor.submit(resolve)
                self.assertTrue(entered.wait(1))
                try:
                    self.assertTrue(RADIO.release_stream('user', 'page_client_0001', 1))
                    self.assertEqual(original.result(timeout=.5), 409)
                    self.assertFalse(RADIO.ACTIVE_STREAMS)
                    self.assertFalse(slots.acquire(blocking=False))
                finally:
                    finish.set()
            self.assertTrue(slots.acquire(timeout=1))
            slots.release()

if __name__ == '__main__':
    unittest.main()
