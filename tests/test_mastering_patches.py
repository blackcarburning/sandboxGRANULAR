"""Private mastering memories: real authenticated HTTP, disposable account roots."""
import json
import stat
import unittest
import test_mygrain_accounts as fixture

API = '/mygrain-wavs/api/mastering/presets'
SETTINGS = dict(subcut=25, drive=9, bass=35, compression=30, ceiling=-1.5,
                lowEQ=3, midEQ=-2, highEQ=2, lowComp=30, midComp=20,
                highComp=10, exciter=15, outputDrive=6, maximiser=1, targetLufs=-6)


class PrivateMasteringPatches(unittest.TestCase):
    setUp = fixture.AccountHTTPTests.setUp
    tearDown = fixture.AccountHTTPTests.tearDown
    success = fixture.AccountHTTPTests.success

    def save(self, client, **changes):
        payload = dict(action='save', revision=0, name='My private sound', engine='live-master-3',
                       preset='punch', loop=True, settings=SETTINGS)
        payload.update(changes)
        return self.success(client, 'POST', API, data=payload)

    def test_private_crud_persistence_and_foreign_ids(self):
        a = self.save(self.admin)
        b = self.save(self.dan, settings={**SETTINGS, 'drive': 2})
        for owner, other, saved in [(self.admin, self.dan, a), (self.dan, self.admin, b)]:
            identifier = saved['savedId']
            result = self.success(owner, 'GET', API + '/' + identifier)
            self.assertEqual(result['patch']['settings'], saved['patches'][0]['settings'])
            self.assertEqual(other.request('GET', API + '/' + identifier)[0], 404)
            for action in ['save', 'delete']:
                self.assertEqual(other.request('POST', API, data={'action': action, 'revision': 1, 'id': identifier})[0], 404)
            self.assertEqual(len(self.success(owner, 'GET', API)['patches']), 1)
        updated = self.save(self.admin, revision=1, id=a['savedId'], name='Updated', loop=False)
        self.assertFalse(updated['patches'][0]['loop'])
        self.assertEqual(self.admin.request('POST', API, data={'action':'delete', 'revision':1, 'id':a['savedId']})[0], 409)
        deleted = self.success(self.admin, 'POST', API, data={'action':'delete', 'revision':2, 'id':a['savedId']})
        self.assertEqual(deleted['patches'], [])
        files = list(self.root.rglob('.mastering-presets.json'))
        self.assertEqual(len(files), 2)
        for path in files:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(json.loads(path.read_text())['version'], 1)
        # A fresh authenticated client reads the persisted, account-scoped store.
        fresh = fixture.Client(self.server.server_address)
        self.assertEqual(fresh.login('dan', 'charged')[0], 200)
        self.assertEqual(self.success(fresh, 'GET', API)['patches'], b['patches'])

    def test_auth_validation_and_hidden_file_denial(self):
        self.save(self.admin)
        self.assertEqual(self.anonymous.request('GET', API)[0], 401)
        self.assertEqual(self.dan.request('GET', API, headers={'X-Mygrain-User':'admin'})[0], 401)
        for changes in [dict(owner='admin'), dict(name=''), dict(settings={**SETTINGS,'drive':37}), dict(settings={**SETTINGS,'maximiser':True})]:
            payload = dict(action='save', revision=0, name='test', engine='live-master-3', preset='clean', loop=True, settings=SETTINGS)
            payload.update(changes)
            self.assertEqual(self.dan.request('POST', API, data=payload)[0], 400)
        for path in ['/mygrain-wavs/.mastering-presets.json', '/mygrain/.mastering-presets.json', '/mygrain-wavs/%2emastering-presets.json', '/mygrain-wavs/../admin/wavs/.mastering-presets.json']:
            status, body, _ = self.admin.request('GET', path)
            self.assertIn(status, (400,403,404))
            self.assertNotIn(b'My private sound', body if isinstance(body, bytes) else json.dumps(body).encode())
        _, _, headers = self.admin.request('GET', API)
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_explicit_wav_share_does_not_share_patch_library(self):
        saved = self.save(self.admin)
        self.success(self.admin, 'POST', '/mygrain-wavs/api/upload?filename=private-test.wav', body=fixture.wav_bytes(), headers={'Content-Type':'audio/wav'})
        self.assertEqual(self.dan.request('GET','/mygrain-wavs/private-test.wav?mygrainUser=dan')[0],404)
        self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename':'private-test.wav','username':'dan'})
        self.assertTrue(self.success(self.dan, 'GET', '/mygrain-wavs/api/list')['files'])
        self.assertEqual(self.success(self.dan, 'GET', API)['patches'], [])
        self.assertEqual(self.dan.request('GET',API+'/'+saved['savedId'])[0],404)


if __name__ == '__main__':
    unittest.main()
