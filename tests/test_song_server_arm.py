import hashlib
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, patch
from test_song_backend import SONGS, Handler

SPEC = importlib.util.spec_from_file_location('server_arm_test_service', pathlib.Path(__file__).resolve().parents[1] / 'backend/mygrain_server_arm.py')
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class LoaderTests(unittest.TestCase):
    def test_simultaneous_account_requests_share_one_queue_instance(self):
        module = SimpleNamespace()
        loader = SimpleNamespace(exec_module=Mock(side_effect=lambda _: time.sleep(0.02)))
        with patch.object(SONGS, 'SERVER_ARM_MODULE', None), \
             patch.object(importlib.util, 'spec_from_file_location', return_value=SimpleNamespace(loader=loader)), \
             patch.object(importlib.util, 'module_from_spec', return_value=module), \
             ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: SONGS.server_arm_module(), range(8)))
        self.assertTrue(all(result is module for result in results))
        loader.exec_module.assert_called_once()


class QueueTests(unittest.TestCase):
    def setUp(self):
        SERVICE.JOBS.clear()
        self.part = {'id': 'a'*32, 'sha256': 'b'*64, 'patternSteps': 64, 'bpm': 120}
        self.executor = Mock()
        self.available = patch.object(SERVICE, 'available', return_value=True)
        self.execution = patch.object(SERVICE, 'EXECUTOR', self.executor)
        self.available.start()
        self.execution.start()

    def tearDown(self):
        self.execution.stop()
        self.available.stop()

    def start(self, scope='owner', part=None, occurrence=None):
        return SERVICE.start(scope, 'Song-12345678', part or self.part, 'http://127.0.0.1:18921/mygrain/', 'private-session-fixture', occurrence)

    def test_same_owner_source_deduplicates_and_status_never_contains_credentials(self):
        self.assertEqual(self.start()['state'], 'queued')
        self.start()
        self.assertEqual(self.executor.submit.call_count, 1)
        self.assertNotIn('private-session', json.dumps(list(SERVICE.JOBS.values())))
        self.assertEqual(set(SERVICE.status('owner', 'Song-12345678', self.part['id'], self.part['sha256'])), {'state','message','createdAt','updatedAt'})

    def test_accounts_are_isolated_and_queue_has_a_hard_bound(self):
        for n in range(4):
            self.start(scope=str(n))
        with self.assertRaisesRegex(ValueError, 'queue is full'):
            self.start(scope='fifth')
        self.assertEqual(SERVICE.status('other', 'Song-12345678', self.part['id'], self.part['sha256'])['state'], 'missing')

    def test_reused_hidden_source_targets_the_visible_occurrence(self):
        self.start(occurrence='c'*32)
        payload = self.executor.submit.call_args.args[2]
        self.assertEqual(payload['partId'], 'c'*32)
        self.assertEqual(payload['sourceSha256'], self.part['sha256'])

    def test_completed_job_can_be_requested_again_if_client_still_needs_a_render(self):
        self.start()
        key = self.executor.submit.call_args.args[1]
        SERVICE.JOBS[key]['state'] = 'done'
        self.start()
        self.assertEqual(self.executor.submit.call_count, 2)
        self.assertEqual(SERVICE.JOBS[key]['state'], 'queued')

    def test_success_releases_private_payload_and_publishes_only_status(self):
        self.start()
        _, key, payload, timeout = self.executor.submit.call_args.args
        worker = Mock(returncode=0)
        worker.communicate.return_value = (json.dumps({'result': {'partId': payload['partId'], 'sourceSha256': payload['sourceSha256']}}), '')
        with patch.object(SERVICE.subprocess, 'Popen', return_value=worker):
            SERVICE._run(key, payload, timeout)
        self.assertEqual(payload, {})
        self.assertEqual(SERVICE.JOBS[key]['state'], 'done')

    def test_worker_source_mismatch_fails_and_can_retry(self):
        self.start()
        _, key, payload, timeout = self.executor.submit.call_args.args
        worker = Mock(returncode=0)
        worker.communicate.return_value = (json.dumps({'result': {'partId': payload['partId'], 'sourceSha256': 'd'*64}}), '')
        with patch.object(SERVICE.subprocess, 'Popen', return_value=worker):
            SERVICE._run(key, payload, timeout)
        self.assertEqual(SERVICE.JOBS[key]['state'], 'failed')
        self.start()
        self.assertEqual(self.executor.submit.call_count, 2)

    def test_timeout_kills_worker_group_and_leaves_sources_unchanged(self):
        self.start()
        _, key, payload, timeout = self.executor.submit.call_args.args
        worker = Mock(pid=12345)
        worker.communicate.side_effect = [subprocess.TimeoutExpired('node', timeout), ('', '')]
        with patch.object(SERVICE.subprocess, 'Popen', return_value=worker), patch.object(SERVICE.os, 'killpg') as kill:
            SERVICE._run(key, payload, timeout)
        kill.assert_called_once()
        self.assertEqual(payload, {})
        self.assertIn('timed out', SERVICE.JOBS[key]['message'])


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.user = {'id':'fixture-user', 'is_admin':False}
        self.part = {'id':'a'*32, 'sha256':'b'*64, 'patternSteps':64, 'bpm':120, 'repeats':1}
        self.song = {'id':'Song-12345678', 'name':'Test copy', 'revision':4, 'ownerHash':hashlib.sha256(b'mygrain-account:fixture-user').hexdigest(), 'parts':[self.part]}
        self.folder = self.root / self.song['id']
        self.folder.mkdir()
        (self.folder/'song.json').write_text(json.dumps(self.song))
        self.service = SimpleNamespace(start=Mock(return_value={'state':'queued'}),status=Mock(return_value={'state':'running'}))
        self.patches = [patch.object(SONGS,'SONGS_ROOT',self.root),patch.object(SONGS,'ACCOUNT_IDENTITY',lambda:self.user),patch.object(SONGS,'SERVER_ARM_MODULE',self.service)]
        for p in self.patches:p.start()

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()

    def request(self, method='POST', digest=None):
        path=f'/api/songs/{self.song["id"]}/parts/{self.part["id"]}/server-arm'
        handler=Handler(path='/mygrain'+path+'?sha256='+(digest or self.part['sha256']))
        handler.server=SimpleNamespace(server_address=('127.0.0.1',18921))
        handler.headers['Cookie']='private-session-fixture'
        SONGS.handle_song_request(handler,method,path)
        return handler

    def test_start_needs_no_edit_lease_and_does_not_rewrite_sources_or_arrangement(self):
        before=(self.folder/'song.json').read_bytes()
        response=self.request()
        self.assertEqual(response.status,200)
        self.assertEqual(response.response['job']['state'],'queued')
        self.assertEqual((self.folder/'song.json').read_bytes(),before)
        self.assertEqual(self.service.start.call_args.args[-1],self.part['id'])
        self.assertNotIn('private-session',json.dumps(response.response))

    def test_get_polls_same_account_source_scoped_job(self):
        self.assertEqual(self.request('GET').status,200)
        self.service.status.assert_called_once_with(str(self.root),self.song['id'],self.part['id'],self.part['sha256'])

    def test_changed_part_hash_rejects_before_queueing(self):
        self.assertEqual(self.request(digest='c'*64).status,409)
        self.service.start.assert_not_called()

    def test_other_account_cannot_start_or_poll_job(self):
        self.user['id']='other'
        self.assertEqual(self.request().status,404)
        self.assertEqual(self.request('GET').status,404)
        self.service.start.assert_not_called()
