import contextlib
import errno
import hashlib
import json
import pathlib
import stat
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
from urllib.parse import quote, urlencode

from test_mygrain_videolab import Handler, SERVER, wav_bytes


RADIO = SERVER._radiolab_module
VIDEO = SERVER._videolab_module
ACCOUNTS = SERVER._accounts_module


class LabHandler(Handler):
    def log_error(self, *args):
        pass


class LabWavEditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='mygrain-lab-wav-edits-')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.store = SERVER.init_account_store(self.root)
        self.admin = self.store.lookup_user('admin')
        self.dan = self.store.lookup_user('dan')
        token = ACCOUNTS.CURRENT_USER.set(self.admin)
        self.addCleanup(ACCOUNTS.CURRENT_USER.reset, token)
        self.labs = (('radiolab', RADIO), ('videolab', VIDEO))

    @contextlib.contextmanager
    def as_user(self, user):
        token = ACCOUNTS.CURRENT_USER.set(user)
        try:
            yield
        finally:
            ACCOUNTS.CURRENT_USER.reset(token)

    def save(self, kind, name='Original', body=None, source=None):
        body = body if body is not None else wav_bytes()
        if kind == 'radiolab':
            query = {'name': [name], 'station': ['bbc-world']}
            if source is not None:
                query['sourceFilename'] = [source]
            return RADIO.save_sample(query, body)
        return VIDEO.save_sample(name, body, source or '')

    def rename_suffix(self, kind, filename):
        return '/rename' if kind == 'radiolab' else '/samples/' + filename + '/rename'

    def rename_payload(self, kind, filename, name):
        return {'filename': filename, 'name': name} if kind == 'radiolab' else {'name': name}

    def request(self, kind, suffix, method='GET', payload=None, body=None, authenticated=False, **kwargs):
        if payload is not None:
            body = json.dumps(payload).encode()
        handler = LabHandler('/mygrain/api/' + kind + suffix, method, body or b'', **kwargs)
        module = RADIO if kind == 'radiolab' else VIDEO
        route = '/api/' + kind + suffix.split('?')[0]
        operation = module.handle_radiolab_request if kind == 'radiolab' else module.handle_videolab_request
        if authenticated:
            SERVER.DocumenterHandler.dispatch_mygrain_request(handler, lambda incoming: operation(incoming, method, route))
        else:
            self.assertTrue(operation(handler, method, route))
        return handler

    def files(self, module):
        return {path.name: path.read_bytes() for path in module.sample_root().iterdir()}

    def test_rename_changes_only_name_preserving_audio_filename_urls_and_provenance(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                path = module.sample_root() / sample['filename']
                metadata_path = path.with_name(path.name + '.json')
                original_audio = path.read_bytes()
                metadata = json.loads(metadata_path.read_bytes())
                metadata['provenance'] = {'url': 'https://example.invalid/original', 'offset': 12, 'nested': ['keep']}
                metadata['url'] = 'https://example.invalid/legacy-source-url'
                metadata['downloadName'] = 'legacy metadata is preserved'
                metadata_path.write_text(json.dumps(metadata))
                response = self.request(kind, self.rename_suffix(kind, sample['filename']), 'POST',
                                        self.rename_payload(kind, sample['filename'], '  Émission 日本.wav  '))
                self.assertEqual(response.reply[0], 200, response.reply)
                renamed = response.reply[1]['sample']
                self.assertEqual(renamed['filename'], sample['filename'])
                self.assertEqual(renamed['url'], ACCOUNTS.bind_media_urls(sample)['url'])
                self.assertEqual(renamed['name'], 'Émission 日本')
                self.assertEqual(renamed['downloadName'], 'Émission 日本.wav')
                expected = {**metadata, 'name': 'Émission 日本'}
                self.assertEqual(json.loads(metadata_path.read_bytes()), expected)
                self.assertEqual(path.read_bytes(), original_audio)
                self.assertEqual(stat.S_IMODE(metadata_path.stat().st_mode), 0o600)
                self.assertEqual(module.list_samples()[0]['name'], 'Émission 日本')

    def test_original_urls_return_identical_audio_and_safe_unicode_download_headers(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                module.rename_sample(sample['filename'], '日本 "mix"/test.wav')
                suffix = '/file?' + urlencode({'name': sample['filename']}) if kind == 'radiolab' else '/samples/' + sample['filename']
                response = self.request(kind, suffix)
                self.assertEqual(response.status, 200)
                self.assertEqual(response.wfile.getvalue(), wav_bytes())
                disposition = response.sent_headers['Content-Disposition']
                disposition.encode('ascii')
                self.assertTrue(disposition.startswith('inline; '))
                self.assertIn("filename*=UTF-8''" + quote('日本 -mix--test.wav', safe=''), disposition)
                self.assertNotIn('\r', disposition)
                self.assertNotIn('\n', disposition)

    def test_repeated_human_names_keep_distinct_files_and_do_not_overwrite(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                first = self.save(kind, 'First')
                second = self.save(kind, 'Second', wav_bytes(frames=1000))
                before = {sample['filename']: (module.sample_root() / sample['filename']).read_bytes() for sample in (first, second)}
                for sample in (first, second):
                    module.rename_sample(sample['filename'], 'Same name')
                self.assertEqual(len(module.list_samples()), 2)
                for filename, audio in before.items():
                    self.assertEqual((module.sample_root() / filename).read_bytes(), audio)
                    self.assertEqual(module.read_sample(filename)['name'], 'Same name')

    def test_invalid_names_and_filenames_leave_every_file_identical(self):
        for kind, module in self.labs:
            sample = self.save(kind)
            before = self.files(module)
            for name in (None, False, 12, [], {}, '', ' ', '.', '..', '.wav', 'a' * 101, 'evil\r\nX-Test: yes', 'bad\x00name', '\ud800'):
                with self.subTest(lab=kind, name=repr(name)):
                    response = self.request(kind, self.rename_suffix(kind, sample['filename']), 'POST',
                                            self.rename_payload(kind, sample['filename'], name))
                    self.assertEqual(response.reply[0], 400, response.reply)
                    self.assertEqual(self.files(module), before)
            for filename in ('../outside.wav', '/tmp/outside.wav', sample['filename'] + '/more', '%2e%2e%2foutside.wav'):
                with self.subTest(lab=kind, filename=filename):
                    response = self.request(kind, self.rename_suffix(kind, filename), 'POST', self.rename_payload(kind, filename, 'New'))
                    self.assertEqual(response.reply[0], 400, response.reply)
                    self.assertEqual(self.files(module), before)

    def test_invalid_json_shapes_and_duplicate_lengths_fail_without_changes(self):
        for kind, module in self.labs:
            sample = self.save(kind)
            before = self.files(module)
            for body in (b'[]', b'null', b'{', b'{}', b'{"name":"New","extra":true}', b'\xff'):
                with self.subTest(lab=kind, body=body):
                    response = self.request(kind, self.rename_suffix(kind, sample['filename']), 'POST', body=body)
                    self.assertEqual(response.reply[0], 400, response.reply)
                    self.assertEqual(self.files(module), before)
            handler = LabHandler('/mygrain/api/' + kind + self.rename_suffix(kind, sample['filename']), 'POST', b'{}')
            handler.headers['Content-Length'] = '2'
            operation = module.handle_radiolab_request if kind == 'radiolab' else module.handle_videolab_request
            operation(handler, 'POST', '/api/' + kind + self.rename_suffix(kind, sample['filename']))
            self.assertEqual(handler.reply[0], 400)
            self.assertEqual(self.files(module), before)

    def test_oversized_chunked_and_incomplete_rename_requests_do_not_change_files(self):
        for kind, module in self.labs:
            sample = self.save(kind)
            before = self.files(module)
            for length, encoding in (('8193', None), ('0', None), ('3', None), ('2', 'chunked'), ('invalid', None)):
                with self.subTest(lab=kind, length=length, encoding=encoding):
                    suffix = self.rename_suffix(kind, sample['filename'])
                    handler = LabHandler('/mygrain/api/' + kind + suffix, 'POST', b'{}')
                    handler.headers.replace_header('Content-Length', length)
                    if encoding:
                        handler.headers['Transfer-Encoding'] = encoding
                    operation = module.handle_radiolab_request if kind == 'radiolab' else module.handle_videolab_request
                    operation(handler, 'POST', '/api/' + kind + suffix)
                    self.assertIn(handler.reply[0], (400, 413), handler.reply)
                    self.assertEqual(self.files(module), before)

    def test_rename_atomic_replace_failure_preserves_original_metadata_and_audio(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                before = self.files(module)
                with patch.object(module.os, 'replace', side_effect=OSError(errno.ENOSPC, 'full')):
                    response = self.request(kind, self.rename_suffix(kind, sample['filename']), 'POST',
                                            self.rename_payload(kind, sample['filename'], 'New'))
                self.assertIn(response.reply[0], (400, 507))
                self.assertEqual(self.files(module), before)

    def test_rename_write_failure_leaves_original_and_no_temp_file(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                before = self.files(module)
                with patch.object(module.os, 'fsync', side_effect=OSError(errno.ENOSPC, 'full')):
                    with self.assertRaises(OSError):
                        module.rename_sample(sample['filename'], 'New')
                self.assertEqual(self.files(module), before)

    def test_temporary_filename_collision_does_not_delete_or_overwrite_existing_file(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                temporary = module.sample_root() / (kind + '-rename-' + 'a' * 32 + '.tmp')
                temporary.write_bytes(b'keep unrelated data')
                before = self.files(module)
                with patch.object(module.secrets, 'token_hex', return_value='a' * 32):
                    with self.assertRaises(FileExistsError):
                        module.rename_sample(sample['filename'], 'New')
                self.assertEqual(self.files(module), before)

    def test_symlink_audio_and_metadata_targets_are_rejected_without_touching_outside(self):
        for kind, module in self.labs:
            for metadata in (False, True):
                with self.subTest(lab=kind, metadata=metadata):
                    sample = self.save(kind)
                    path = module.sample_root() / (sample['filename'] + ('.json' if metadata else ''))
                    outside = self.root / ('outside-' + kind + str(metadata))
                    original = path.read_bytes()
                    outside.write_bytes(original)
                    path.unlink()
                    path.symlink_to(outside)
                    with self.assertRaises(ValueError):
                        module.rename_sample(sample['filename'], 'New')
                    self.assertTrue(path.is_symlink())
                    self.assertEqual(outside.read_bytes(), original)
                    path.unlink()
                    path.write_bytes(original)

    def test_account_isolation_for_rename_and_trim_source(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                before = self.files(module)
                with self.as_user(self.dan):
                    rename = self.request(kind, self.rename_suffix(kind, sample['filename']), 'POST',
                                          self.rename_payload(kind, sample['filename'], 'Other account'))
                    self.assertEqual(rename.reply[0], 404)
                    suffix = '/samples?' + urlencode({'name': 'Stolen trim', 'sourceFilename': sample['filename']})
                    trim = self.request(kind, suffix, 'POST', body=wav_bytes(frames=400))
                    self.assertEqual(trim.reply[0], 404, trim.reply)
                    self.assertFalse(module.sample_root().exists())
                self.assertEqual(self.files(module), before)

    def test_trim_upload_creates_new_copy_and_preserves_full_source_and_provenance(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                metadata_path = module.sample_root() / (sample['filename'] + '.json')
                metadata = json.loads(metadata_path.read_bytes())
                metadata['provenance'] = {'source': 'original', 'nested': {'keep': [1, 2]}}
                metadata_path.write_text(json.dumps(metadata))
                before = self.files(module)
                trimmed = wav_bytes(frames=400)
                response = self.request(kind, '/samples?' + urlencode({'name': 'Trimmed copy', 'sourceFilename': sample['filename']}),
                                        'POST', body=trimmed)
                self.assertIn(response.reply[0], (200, 201), response.reply)
                saved = response.reply[1]['sample']
                self.assertNotEqual(saved['filename'], sample['filename'])
                self.assertNotEqual(saved['url'], sample['url'])
                self.assertEqual(saved['sourceFilename'], sample['filename'])
                self.assertEqual(saved['provenance'], metadata['provenance'])
                self.assertEqual(saved['duration'], .05)
                if kind == 'radiolab':
                    self.assertEqual(saved['station'], 'bbc-world')
                for filename, body in before.items():
                    self.assertEqual((module.sample_root() / filename).read_bytes(), body)
                self.assertEqual((module.sample_root() / saved['filename']).read_bytes(), trimmed)
                self.assertEqual(len(module.list_samples()), 2)

    def test_invalid_trim_body_and_source_do_not_save_or_modify_original(self):
        for kind, module in self.labs:
            sample = self.save(kind)
            before = self.files(module)
            for source in ('', '../outside.wav', 'missing.wav', sample['filename']):
                with self.subTest(lab=kind, source=source):
                    response = self.request(kind, '/samples?' + urlencode({'name': 'Trim', 'sourceFilename': source}),
                                            'POST', body=wav_bytes()[:-1])
                    self.assertIn(response.reply[0], (400, 404))
                    self.assertEqual(self.files(module), before)

    def test_trim_duplicate_source_query_is_rejected(self):
        for kind, module in self.labs:
            sample = self.save(kind)
            before = self.files(module)
            response = self.request(kind, '/samples?name=Trim&sourceFilename=' + sample['filename'] + '&sourceFilename=' + sample['filename'],
                                    'POST', body=wav_bytes(frames=400))
            self.assertEqual(response.reply[0], 400)
            self.assertEqual(self.files(module), before)

    def test_trim_write_failure_rolls_back_new_copy_and_preserves_original(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                before = self.files(module)
                original_write = module.write_private

                def fail_metadata(path, body):
                    if path.name.endswith('.json'):
                        raise OSError(errno.ENOSPC, 'full')
                    return original_write(path, body)

                with patch.object(module, 'write_private', side_effect=fail_metadata):
                    with self.assertRaises(OSError):
                        self.save(kind, 'Trim', wav_bytes(frames=400), sample['filename'])
                self.assertEqual(self.files(module), before)

    def test_source_filename_collision_never_overwrites_original(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                before = self.files(module)
                with patch.object(module.secrets, 'token_hex', return_value=sample['filename'][-20:-4]):
                    with patch.object(module.datetime, 'datetime', wraps=module.datetime.datetime) as clock:
                        clock.now.return_value = module.datetime.datetime.fromisoformat(sample['createdAt'].replace('Z', '+00:00'))
                        with self.assertRaises(FileExistsError):
                            self.save(kind, 'Original', wav_bytes(frames=400), sample['filename'])
                self.assertEqual(self.files(module), before)

    def test_concurrent_renames_are_atomic_and_do_not_change_audio(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                audio_path = module.sample_root() / sample['filename']
                digest = hashlib.sha256(audio_path.read_bytes()).hexdigest()

                def rename(number):
                    with self.as_user(self.admin):
                        return module.rename_sample(sample['filename'], 'Concurrent ' + str(number))

                with ThreadPoolExecutor(max_workers=6) as pool:
                    results = list(pool.map(rename, range(18)))
                self.assertEqual(len(results), 18)
                self.assertIn(module.read_sample(sample['filename'])['name'], {item['name'] for item in results})
                self.assertEqual(hashlib.sha256(audio_path.read_bytes()).hexdigest(), digest)
                self.assertEqual(len(self.files(module)), 2)

    def test_noop_rename_does_not_rewrite_metadata(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                before = self.files(module)
                with patch.object(module.os, 'replace', side_effect=AssertionError('must not write')):
                    self.assertEqual(module.rename_sample(sample['filename'], 'Original')['name'], 'Original')
                self.assertEqual(self.files(module), before)

    def test_rename_and_trim_invalidate_source_listing_only_after_success(self):
        for kind, module in self.labs:
            with self.subTest(lab=kind):
                sample = self.save(kind)
                invalidated = Mock()
                with patch.object(module, 'INVALIDATE_SOURCE_CACHE', invalidated):
                    module.rename_sample(sample['filename'], 'Renamed')
                    invalidated.assert_called_once_with()
                    invalidated.reset_mock()
                    self.save(kind, 'Trim', wav_bytes(frames=400), sample['filename'])
                    invalidated.assert_called_once_with()
                    invalidated.reset_mock()
                    with patch.object(module.os, 'replace', side_effect=OSError(errno.ENOSPC, 'full')):
                        with self.assertRaises(OSError):
                            module.rename_sample(sample['filename'], 'Failed')
                    invalidated.assert_not_called()

    def test_authenticated_routes_reject_anonymous_wrong_account_and_cross_origin(self):
        cookie = ACCOUNTS.COOKIE_NAME + '=' + self.store.new_session(self.admin)
        for kind, module in self.labs:
            sample = self.save(kind)
            before = self.files(module)
            suffix = self.rename_suffix(kind, sample['filename'])
            payload = self.rename_payload(kind, sample['filename'], 'Authenticated')
            for arguments, status in (({'user': None}, 401), ({'cookie': cookie, 'user': 'dan'}, 401),
                                      ({'cookie': cookie, 'origin': 'https://evil.invalid'}, 403)):
                with self.subTest(lab=kind, auth=arguments):
                    response = self.request(kind, suffix, 'POST', payload, authenticated=True, **arguments)
                    self.assertEqual(response.reply[0], status, response.reply)
                    self.assertEqual(self.files(module), before)
            response = self.request(kind, suffix, 'POST', payload, cookie=cookie, authenticated=True)
            self.assertEqual(response.reply[0], 200, response.reply)
            self.assertEqual(response.reply[1]['sample']['name'], 'Authenticated')

    def test_trim_upload_authentication_and_account_pinning_remain_required(self):
        cookie = ACCOUNTS.COOKIE_NAME + '=' + self.store.new_session(self.admin)
        for kind, module in self.labs:
            sample = self.save(kind)
            before = self.files(module)
            suffix = '/samples?' + urlencode({'name': 'Trim', 'sourceFilename': sample['filename']})
            for arguments, status in (({'user': None}, 401), ({'cookie': cookie, 'user': 'dan'}, 401),
                                      ({'cookie': cookie, 'origin': 'https://evil.invalid'}, 403)):
                with self.subTest(lab=kind, auth=arguments):
                    response = self.request(kind, suffix, 'POST', body=wav_bytes(frames=400), authenticated=True, **arguments)
                    self.assertEqual(response.reply[0], status, response.reply)
                    self.assertEqual(self.files(module), before)


if __name__ == '__main__':
    unittest.main()
