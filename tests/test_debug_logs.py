import concurrent.futures
import http.client
import importlib.util
import json
import pathlib
import stat
import tempfile
import threading
import unittest
from email.message import Message
from http.server import ThreadingHTTPServer
from io import BytesIO
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location('debug_logs_tests', pathlib.Path(__file__).resolve().parents[1] / 'backend' / 'mygrain_debug_logs.py')
logs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logs)


class Handler:
    def __init__(self, body, headers=None):
        self.headers = Message()
        for name, value in {
            'Content-Type': 'application/json', 'Content-Length': str(len(body)),
            'Origin': logs.PUBLIC_ORIGIN, 'X-Mygrain-Debug': '1', 'Host': 'openclaw.blackcarburning.com',
            **(headers or {}),
        }.items():
            if value is not None:
                self.headers[name] = value
        self.rfile = BytesIO(body)
        self.connection = Mock()
        self.connection.gettimeout.return_value = None
        self.client_address = ('127.0.0.1', 12345)

    def send_json(self, payload, status=200, extra_headers=None):
        self.response = payload
        self.status = status
        self.response_headers = extra_headers


class DebugLogTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='mygrain-debug-tests-')
        self.addCleanup(folder.cleanup)
        self.root = pathlib.Path(folder.name) / 'logs'
        override = patch.object(logs, 'LOGS_ROOT', self.root)
        override.start()
        self.addCleanup(override.stop)
        logs.UPLOAD_TIMES.clear()
        self.report = {
            'schemaVersion': 1, 'application': 'MYGRAIN', 'build': 'v2026.10.15.LOG.1',
            'captureTime': '2026-10-15T16:00:00.000Z', 'currentState': None,
            'recentLogs': [], 'debugConsoleEvents': [], 'debugConsoleText': 'Synthetic test — not a phone report.',
            'userAgent': 'Test iPhone', 'platform': 'iPhone',
            'phoneDiagnostics': {'schemaVersion': 1, 'incidents': [{'type': 'user-marked-crackle'}]},
        }

    def request(self, report=None, headers=None, raw=None, method='POST', route='/api/debug-logs'):
        handler = Handler(raw if raw is not None else json.dumps(self.report if report is None else report).encode(), headers)
        self.assertTrue(logs.handle_debug_log_request(handler, method, route))
        return handler

    def test_report_is_saved_with_receipt_private_modes_and_no_extra_client_metadata(self):
        result = self.request()
        self.assertEqual(result.status, 201)
        self.assertRegex(result.response['logId'], r'^audio-\d{8}T\d{6}Z-[a-f0-9]{16}$')
        stored = self.root / (result.response['logId'] + '.json')
        capture = json.loads(stored.read_text())
        self.assertEqual(capture['report'], self.report)
        self.assertEqual(capture['receivedAt'], result.response['receivedAt'])
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(stored.stat().st_mode), 0o600)
        self.assertEqual(set(result.response), {'ok', 'logId', 'receivedAt'})
        self.assertEqual(result.response_headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', result.response_headers)
        self.assertEqual(list(self.root.glob('.upload-*')), [])

    def test_get_and_nested_paths_cannot_list_read_or_upload_logs(self):
        for method, route in [('GET', '/api/debug-logs'), ('GET', '/api/debug-logs/secret.json'), ('POST', '/api/debug-logs/../escape')]:
            self.assertEqual(self.request(method=method, route=route).status, 405)
        self.assertFalse(self.root.exists())

    def test_optional_runtime_and_recovery_diagnostics_are_saved_without_changing_the_original_capture(self):
        report = {**self.report, 'runtimeDiagnostics': {'schemaVersion': 1, 'sessionId': 'source-run', 'events': []},
                  'recoveryDiagnostics': {'schemaVersion': 1, 'sourceSessionId': 'source-run', 'currentRuntime': {'events': [{'type': 'boot'}]}}}
        result = self.request(report=report)
        self.assertEqual(result.status, 201)
        saved = json.loads((self.root / (result.response['logId'] + '.json')).read_text())['report']
        self.assertEqual(saved, report)
        self.assertEqual(saved['captureTime'], self.report['captureTime'])

    def test_invalid_runtime_and_recovery_extensions_are_rejected(self):
        for field in ('runtimeDiagnostics', 'recoveryDiagnostics'):
            for value in (None, [], {'schemaVersion': True}, {'schemaVersion': 2}, {}):
                with self.subTest(field=field, value=value):
                    self.assertEqual(self.request(report={**self.report, field: value}).status, 400)

    def test_unrelated_routes_are_not_intercepted(self):
        self.assertFalse(logs.handle_debug_log_request(Handler(b''), 'GET', '/api/songs'))

    def test_origin_header_and_fetch_site_are_required(self):
        for headers in [{'Origin': None}, {'Origin': 'null'}, {'Origin': 'https://evil.example'},
                        {'Origin': logs.PUBLIC_ORIGIN + '.evil.example'}, {'X-Mygrain-Debug': None},
                        {'Sec-Fetch-Site': 'cross-site'}, {'Sec-Fetch-Site': 'same-site'}]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request(headers=headers).status, 403)
        self.assertFalse(self.root.exists())

    def test_loopback_test_server_is_allowed_only_with_matching_local_host(self):
        headers = {'Host': '127.0.0.1:18765', 'Origin': 'http://127.0.0.1:18765'}
        self.assertEqual(self.request(headers=headers).status, 201)
        self.assertEqual(self.request(headers={**headers, 'Host': 'evil.example'}).status, 403)
        handler = Handler(json.dumps(self.report).encode(), headers)
        handler.client_address = ('192.0.2.10', 12345)
        self.assertFalse(logs.trusted_request(handler))

    def test_non_json_encoded_chunked_and_invalid_lengths_are_rejected(self):
        for headers, expected in [({'Content-Type': 'text/plain'}, 415), ({'Content-Encoding': 'gzip'}, 400),
                                  ({'Transfer-Encoding': 'chunked'}, 400), ({'Content-Length': None}, 411),
                                  ({'Content-Length': '-1'}, 411), ({'Content-Length': 'x'}, 411),
                                  ({'Content-Length': '0'}, 413), ({'Content-Length': str(logs.MAX_LOG_BYTES + 1)}, 413)]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request(headers=headers).status, expected)
        self.assertFalse(self.root.exists())

    def test_duplicate_content_lengths_are_rejected_before_reading(self):
        handler = Handler(json.dumps(self.report).encode())
        handler.headers['Content-Length'] = '1'
        logs.handle_debug_log_request(handler, 'POST', '/api/debug-logs')
        self.assertEqual(handler.status, 411)
        self.assertEqual(handler.rfile.tell(), 0)

    def test_invalid_incomplete_nonfinite_and_deep_json_are_rejected(self):
        for raw in [b'{', b'\xff', b'[]', b'null', b'{"schemaVersion": NaN}', b'[' * 2000 + b']' * 2000]:
            self.assertEqual(self.request(raw=raw).status, 400)
        self.assertEqual(self.request(raw=b'{}', headers={'Content-Length': '100'}).status, 400)
        self.assertFalse(self.root.exists())

    def test_invalid_schema_unknown_paths_and_missing_diagnostics_are_rejected(self):
        for changes in [{'schemaVersion': True}, {'schemaVersion': 2}, {'application': 'other'},
                        {'filename': '../../escape.json'}, {'captureTime': 'yesterday'}, {'build': ''},
                        {'phoneDiagnostics': None}, {'currentState': []}, {'recentLogs': [{}] * 21},
                        {'debugConsoleEvents': [{}] * 81}, {'debugConsoleText': ''}]:
            with self.subTest(changes=changes):
                self.assertEqual(self.request(report={**self.report, **changes}).status, 400)
        self.assertFalse(self.root.exists())

    def test_rate_limit_has_retry_after_and_expires(self):
        with patch.object(logs, 'MAX_UPLOADS_PER_MINUTE', 2), patch.object(logs.time, 'monotonic', return_value=100):
            self.assertEqual(self.request().status, 201)
            self.assertEqual(self.request().status, 201)
            limited = self.request()
            self.assertEqual(limited.status, 429)
            self.assertEqual(limited.response_headers['Retry-After'], '60')
        with patch.object(logs.time, 'monotonic', return_value=161):
            self.assertEqual(self.request().status, 201)

    def test_storage_quota_rejects_without_deleting_or_replacing_existing_logs(self):
        first = self.request()
        stored = self.root / (first.response['logId'] + '.json')
        original = stored.read_bytes()
        with patch.object(logs, 'MAX_STORED_LOGS', 1):
            self.assertEqual(self.request().status, 507)
        with patch.object(logs, 'MAX_STORED_BYTES', len(original)):
            self.assertEqual(self.request().status, 507)
        with patch.object(logs.shutil, 'disk_usage', return_value=Mock(free=1)):
            self.assertEqual(self.request().status, 507)
        self.assertEqual(stored.read_bytes(), original)
        self.assertEqual(len(list(self.root.glob('*.json'))), 1)

    def test_io_failure_is_reported_without_leaking_path_and_temporary_files_are_removed(self):
        with patch.object(logs.os, 'replace', side_effect=OSError('/private/sensitive/path')):
            result = self.request()
        self.assertEqual(result.status, 503)
        self.assertNotIn('/private', result.response['error'])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_symlink_storage_is_rejected(self):
        self.root.symlink_to(self.root.parent, target_is_directory=True)
        self.assertEqual(self.request().status, 503)

    def test_parallel_submissions_are_unique_complete_and_do_not_overwrite(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            results = list(executor.map(lambda unused: self.request(), range(12)))
        self.assertTrue(all(result.status == 201 for result in results))
        self.assertEqual(len({result.response['logId'] for result in results}), 12)
        self.assertEqual(len(list(self.root.glob('*.json'))), 12)
        for stored in self.root.glob('*.json'):
            self.assertEqual(json.loads(stored.read_text())['report'], self.report)


class DebugLogHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server_spec = importlib.util.spec_from_file_location('debug_log_http_tests', pathlib.Path(__file__).resolve().parents[2] / 'fs7300-documenter' / 'server.py')
        cls.server_module = importlib.util.module_from_spec(server_spec)
        server_spec.loader.exec_module(cls.server_module)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), cls.server_module.DocumenterHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='mygrain-debug-http-')
        self.addCleanup(folder.cleanup)
        accounts = self.server_module.init_account_store(pathlib.Path(folder.name))
        self.root = accounts.path_for('debug_logs', accounts.lookup_user('admin'))
        self.cookie = None
        self.server_module._debug_logs_module.UPLOAD_TIMES.clear()
        status, headers, unused = self.request('POST', '/mygrain/api/auth/login', report={'username': 'admin', 'password': 'snowpeas'})
        self.assertEqual(status, 200)
        self.cookie = headers['Set-Cookie'].split(';')[0]

    def request(self, method, route='/mygrain/api/debug-logs', report=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        origin = f'http://127.0.0.1:{self.server.server_port}'
        body = json.dumps(report) if report is not None else None
        outgoing = {'Origin': origin, 'Content-Type': 'application/json',
                    'X-Mygrain-Debug': '1', 'X-Mygrain-User': 'admin', **(headers or {})}
        if self.cookie:
            outgoing['Cookie'] = self.cookie
        connection.request(method, route, body, outgoing)
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        connection.close()
        return result

    def test_live_handler_wiring_stores_capture_and_never_serves_report(self):
        report = {
            'schemaVersion': 1, 'application': 'MYGRAIN', 'build': 'integration-test',
            'captureTime': '2026-10-15T16:00:00Z', 'currentState': None, 'recentLogs': [],
            'debugConsoleEvents': [], 'debugConsoleText': 'Synthetic HTTP fixture.',
            'userAgent': 'Test', 'platform': 'Test', 'phoneDiagnostics': {'schemaVersion': 1},
        }
        status, headers, raw = self.request('POST', report=report)
        self.assertEqual(status, 201)
        receipt = json.loads(raw)
        stored = self.root / (receipt['logId'] + '.json')
        self.assertEqual(json.loads(stored.read_text())['report'], report)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        for route, expected in [('/mygrain/api/debug-logs', 405),
                                ('/mygrain/api/debug-logs/' + stored.name, 405),
                                ('/mygrain/logs/' + stored.name, 403),
                                ('/mygrain/../../../../..' + str(stored), 403)]:
            self.assertEqual(self.request('GET', route)[0], expected)

    def test_http_rejects_cross_origin_and_oversized_body_before_reading(self):
        self.assertEqual(self.request('POST', report={}, headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('POST', report={}, headers={'Content-Length': str(logs.MAX_LOG_BYTES + 1)})[0], 413)
        self.assertFalse(self.root.exists())

    def test_http_cors_preflight_never_grants_cross_origin_upload_access(self):
        status, headers, unused = self.request('OPTIONS', headers={'Origin': 'https://evil.example',
                                                                 'Access-Control-Request-Method': 'POST',
                                                                 'Access-Control-Request-Headers': 'X-Mygrain-Debug'})
        self.assertEqual(status, 403)
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        status, headers, unused = self.request('OPTIONS')
        self.assertEqual(status, 204)
        self.assertNotIn('Access-Control-Allow-Origin', headers)


if __name__ == '__main__':
    unittest.main()
