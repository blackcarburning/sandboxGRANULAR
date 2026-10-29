"""Real authenticated HTTP lifecycle checks, using disposable account stores."""
import hashlib
import json
import pathlib
import socket
import threading
import time
import unittest
import zipfile
from io import BytesIO
from urllib.parse import quote
from unittest.mock import patch
from types import SimpleNamespace

import test_mygrain_accounts as account_tests
from test_mygrain_accounts import SERVER, wav_bytes, part_bytes

PATTERNS = SERVER._wav_patterns_module
PATTERN_BYTES = part_bytes()


def bundle(pattern=None, wav=None):
    output = BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('render.wav', wav if wav is not None else wav_bytes())
        archive.writestr('pattern.zip', pattern if pattern is not None else PATTERN_BYTES)
    return output.getvalue()


class WavPatternTests(unittest.TestCase):
    setUp = account_tests.AccountHTTPTests.setUp
    tearDown = account_tests.AccountHTTPTests.tearDown
    success = account_tests.AccountHTTPTests.success
    upload = account_tests.AccountHTTPTests.upload

    def save(self, client=None, name='paired.wav', body=None):
        return self.success(client or self.admin, 'POST', '/mygrain-wavs/api/render-with-pattern?filename=' + quote(name),
                            body=body if body is not None else bundle(), headers={'Content-Type': 'application/zip'})

    def listing(self, client=None):
        return self.success(client or self.admin, 'GET', '/mygrain-wavs/api/list')['files']

    def account_root(self, client=None):
        user = self.accounts.lookup_user((client or self.admin).username)
        token = SERVER._accounts_module.CURRENT_USER.set(user)
        try:
            return pathlib.Path(SERVER.ensure_mygrain_repository_root(SERVER.MYGRAIN_WAVS_ROUTE))
        finally:
            SERVER._accounts_module.CURRENT_USER.reset(token)

    def test_exact_source_round_trip_and_unchanged_legacy_listing(self):
        self.upload(self.admin, 'legacy.wav')
        saved = self.save()
        rows = {entry['name']: entry for entry in self.listing()}
        self.assertNotIn('patternExport', rows['legacy.wav'])
        details = rows['paired.wav']['patternExport']
        self.assertEqual(details['sha256'], hashlib.sha256(PATTERN_BYTES).hexdigest())
        self.assertEqual(self.success(self.admin, 'GET', details['url']), PATTERN_BYTES)
        self.assertEqual(self.success(self.admin, 'GET', saved['url']), wav_bytes())
        status, body, headers = self.admin.request('HEAD', details['url'])
        self.assertEqual((status, body, headers['Content-Length']), (200, b'', str(len(PATTERN_BYTES))))
        self.assertEqual(self.admin.request('GET', '/mygrain-wavs/api/pattern?filename=legacy.wav')[0], 404)
        self.assertEqual(details['filename'], 'paired.zip')
        self.assertEqual(headers['Content-Disposition'], "attachment; filename*=UTF-8''paired.zip")

    def test_download_releases_storage_lock_before_network_io(self):
        saved = self.save()
        acquired = threading.Event()
        original = PATTERNS.send_pattern
        user = self.accounts.lookup_user('admin')
        def send(handler, method, filename, body):
            def contender():
                with self.accounts.user_lock(user):
                    acquired.set()
            worker = threading.Thread(target=contender, daemon=True)
            worker.start()
            try:
                self.assertTrue(acquired.wait(1), 'Download still holds the account lock')
            finally:
                original(handler, method, filename, body)
            worker.join(1)
        with patch.object(PATTERNS, 'send_pattern', side_effect=send):
            self.assertEqual(self.success(self.admin, 'GET', saved['patternExport']['url']), PATTERN_BYTES)
        self.assertTrue(acquired.is_set())

    def test_new_pair_never_rewrites_old_wavs_comments_hearts_or_order(self):
        for name in ('first.wav', 'second.wav'):
            self.upload(self.admin, name)
            self.success(self.admin, 'POST', '/mygrain-wavs/api/file-feedback', data={'filename': name, 'comment': 'Keep my note ♥ ' + name, 'reaction': 'love'})
        before = self.listing()
        bodies = {row['name']: self.success(self.admin, 'GET', row['url']) for row in before}
        self.save()
        self.assertEqual([row for row in self.listing() if row['name'] != 'paired.wav'], before)
        for name, body in bodies.items():
            self.assertEqual(self.success(self.admin, 'GET', '/mygrain-wavs/' + quote(name)), body)

    def test_song_render_archive_keeps_distinct_patches_and_arrangement(self):
        manifest = {'format': 'mygrain-render-patches', 'version': 1,
                    'patches': [{'id': 'verse', 'name': 'Verse', 'path': 'patches/1.zip'}, {'id': 'chorus', 'name': 'Chorus', 'path': 'patches/2.zip'}],
                    'arrangement': [{'patch': 'verse', 'repeats': 1}, {'patch': 'chorus', 'repeats': 2}, {'patch': 'verse', 'repeats': 3}]}
        output = BytesIO()
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
            archive.writestr('render-patches.json', json.dumps(manifest))
            archive.writestr('patches/1.zip', PATTERN_BYTES)
            archive.writestr('patches/2.zip', PATTERN_BYTES)
        saved = self.save(name='song.wav', body=bundle(pattern=output.getvalue()))
        self.assertEqual(self.success(self.admin, 'GET', saved['patternExport']['url']), output.getvalue())
        self.assertEqual(saved['patternExport']['filename'], 'song.zip')

    def test_invalid_nested_song_patch_cannot_save_a_render(self):
        for path, data in [('patches/1.zip', b'invalid patch'), ('../outside.zip', PATTERN_BYTES)]:
            output = BytesIO()
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
                archive.writestr('render-patches.json', json.dumps({'format': 'mygrain-render-patches', 'version': 1, 'patches': [{'id': 'a', 'name': 'A', 'path': path}], 'arrangement': [{'patch': 'a'}]}))
                archive.writestr(path, data)
            self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/render-with-pattern?filename=bad.wav', body=bundle(pattern=output.getvalue()))[0], 400)
        self.assertEqual(self.listing(), [])

    def test_same_filename_account_isolation_auth_pin_and_origin(self):
        own = self.save()
        self.assertEqual(self.dan.request('GET', own['patternExport']['url'])[0], 401)
        self.assertEqual(self.dan.request('GET', '/mygrain-wavs/api/pattern?filename=paired.wav')[0], 404)
        self.assertEqual(self.anonymous.request('GET', own['patternExport']['url'])[0], 401)
        self.assertEqual(self.admin.request('GET', own['patternExport']['url'], headers={'X-Mygrain-User': 'dan'})[0], 401)
        self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/render-with-pattern?filename=bad.wav', body=bundle(), headers={'Origin': 'https://other.invalid'})[0], 403)
        other = self.save(self.dan, body=bundle(wav=wav_bytes(value=7)))
        self.assertEqual(other['savedName'], own['savedName'])
        self.assertNotEqual(self.success(self.admin, 'GET', own['url']), self.success(self.dan, 'GET', other['url']))
        self.assertEqual(len(self.listing(self.admin)), 1)
        self.assertEqual(len(self.listing(self.dan)), 1)

    def test_invalid_pair_cannot_leave_an_orphan_wav(self):
        for body in (bundle(pattern=b'not a patch'), bundle(wav=b'not audio'), b'broken upload'):
            with self.subTest(body_size=len(body)):
                self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/render-with-pattern?filename=bad.wav', body=body)[0], 400)
                self.assertEqual(self.listing(), [])
                self.assertEqual(list(self.account_root().glob('*.wav')), [])

    def test_uniquely_named_pairs_do_not_replace_each_other(self):
        first = self.save()
        second = self.save(body=bundle(wav=wav_bytes(value=8)))
        self.assertNotEqual(first['savedName'], second['savedName'])
        self.assertEqual(len(self.listing()), 2)
        for row in self.listing():
            self.assertEqual(self.success(self.admin, 'GET', row['patternExport']['url']), PATTERN_BYTES)

    def test_rename_and_delete_follow_the_associated_wav_only(self):
        saved = self.save(name='before.wav')
        self.upload(self.admin, 'legacy.wav')
        renamed = self.success(self.admin, 'POST', '/mygrain-wavs/api/rename', data={'from': 'before.wav', 'to': 'after.wav'})
        self.assertEqual(renamed['savedName'], 'after.wav')
        rows = {row['name']: row for row in self.listing()}
        self.assertEqual(self.success(self.admin, 'GET', rows['after.wav']['patternExport']['url']), PATTERN_BYTES)
        self.assertEqual(self.admin.request('GET', saved['patternExport']['url'])[0], 404)
        self.success(self.admin, 'DELETE', '/mygrain-wavs/api/delete?filename=after.wav')
        self.assertEqual([row['name'] for row in self.listing()], ['legacy.wav'])
        self.assertEqual(list((self.account_root() / '.pattern-exports').iterdir()), [])

    def test_missing_changed_or_corrupt_export_hides_import(self):
        self.save()
        root = self.account_root()
        wav, archive, metadata = PATTERNS.paths(root, 'paired.wav')
        archive.unlink()
        self.assertNotIn('patternExport', self.listing()[0])
        self.assertEqual(self.admin.request('GET', '/mygrain-wavs/api/pattern?filename=paired.wav')[0], 404)
        self.save(name='changed.wav')
        wav, archive, metadata = PATTERNS.paths(root, 'changed.wav')
        wav.write_bytes(wav_bytes(value=9))
        row = next(row for row in self.listing() if row['name'] == 'changed.wav')
        self.assertNotIn('patternExport', row)
        self.save(name='corrupt.wav')
        wav, archive, metadata = PATTERNS.paths(root, 'corrupt.wav')
        metadata.write_text('not json')
        row = next(row for row in self.listing() if row['name'] == 'corrupt.wav')
        self.assertNotIn('patternExport', row)

    def test_storage_cannot_be_downloaded_directly_or_traversed(self):
        self.save()
        _, archive, _ = PATTERNS.paths(self.account_root(), 'paired.wav')
        self.assertEqual(self.admin.request('GET', '/mygrain-wavs/.pattern-exports/' + archive.name)[0], 403)
        for filename in ('../escape.wav', '.hidden.wav', 'file.zip', 'sub/clip.wav'):
            self.assertIsNone(PATTERNS.info(self.account_root(), filename))
        self.assertEqual(self.admin.request('GET', '/mygrain-wavs/api/pattern?filename=../escape.wav')[0], 404)

    def test_sharing_wav_does_not_implicitly_share_source_pattern(self):
        saved = self.save()
        self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': saved['savedName'], 'username': 'dan'})
        self.assertTrue(self.listing(self.dan))
        for row in self.listing(self.dan):
            self.assertNotIn('patternExport', row)

    def test_failed_provenance_write_rolls_back_only_new_pair(self):
        root = self.account_root()
        self.upload(self.admin, 'legacy.wav')
        with self.assertRaisesRegex(OSError, 'fixture'), patch.object(self.accounts, 'wav_created', side_effect=OSError('fixture')):
            PATTERNS.save_bundle(root, 'failed.wav', bundle(), lambda name: name, SERVER._song_module.validate_part_zip, self.accounts.wav_created)
        self.assertEqual([row['name'] for row in self.listing()], ['legacy.wav'])
        self.assertEqual(list((root / '.pattern-exports').iterdir()), [])


class PatternTransferTests(unittest.TestCase):
    def handler(self, writer):
        statuses = []
        handler = SimpleNamespace(wfile=writer, close_connection=False,
            send_response=statuses.append, send_header=lambda *args: None,
            end_headers=lambda: None)
        return handler, statuses

    def test_slow_transfer_outlives_single_write_deadline(self):
        # Real socket backpressure: the total transfer exceeds the socket's
        # sendall timeout, while each bounded chunk continues making progress.
        sender, receiver = socket.socketpair()
        sender.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 32768)
        sender.settimeout(.25)
        body = bytes(range(256)) * 8192
        received = bytearray()
        writer = SimpleNamespace(write=sender.sendall)
        handler, statuses = self.handler(writer)
        def read_slowly():
            while True:
                chunk = receiver.recv(16384)
                if not chunk:
                    return
                received.extend(chunk)
                time.sleep(.005)
        worker = threading.Thread(target=read_slowly, daemon=True)
        started = time.monotonic()
        worker.start()
        try:
            PATTERNS.send_pattern(handler, 'GET', 'large.wav', body)
            sender.shutdown(socket.SHUT_WR)
            worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertGreater(time.monotonic() - started, .25)
            self.assertEqual(received, body)
            self.assertFalse(handler.close_connection)
            self.assertEqual(statuses, [200])
        finally:
            sender.close()
            receiver.close()

    def test_failed_stream_closes_without_appending_an_error_response(self):
        writer = SimpleNamespace(write=lambda data: (_ for _ in ()).throw(TimeoutError('stalled')))
        handler, statuses = self.handler(writer)
        PATTERNS.send_pattern(handler, 'GET', 'large.wav', b'zip')
        self.assertTrue(handler.close_connection)
        self.assertEqual(statuses, [200])

    def test_head_does_not_write_a_zip_body(self):
        writer = SimpleNamespace(write=lambda data: self.fail('HEAD wrote body'))
        handler, statuses = self.handler(writer)
        PATTERNS.send_pattern(handler, 'HEAD', 'large.wav', b'zip')
        self.assertEqual(statuses, [200])


if __name__ == '__main__':
    unittest.main()
