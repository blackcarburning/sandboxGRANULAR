"""Integration checks against the explicitly isolated plugin-library fixture."""
import io
import hashlib
import json
import os
import pathlib
import sqlite3
import unittest
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor
import requests

BASE = os.environ.get('MYGRAIN_PLUGIN_TEST_URL', 'http://127.0.0.1:19394/mygrain')


def wav():
    out = io.BytesIO()
    with wave.open(out, 'wb') as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b'\x01\x00' * 1600)
    return out.getvalue()


def archive(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for key, value in entries:
            z.writestr(key, value)
    return out.getvalue()


def bin_bytes():
    snapshot = {'format': 'mygrain-song-part', 'version': 1, 'state': {'modes': {}, 'globalBpm': '120', 'patternLength': 16}, 'extra': {'sequencerSteps': [{'enabled': True, 'pitch': 'C4', 'volume': 80}] * 16}, 'assets': [{'key': 'bastardL', 'path': 'audio/bastardL.wav'}]}
    part = archive([('song-part.json', json.dumps(snapshot)), ('audio/bastardL.wav', wav())])
    ident = 'a' * 32
    manifest = {'format': 'mygrain-parts-bin', 'version': 1, 'parts': [{'id': ident, 'name': 'Test part', 'createdAt': '2026-11-15T16:00:00Z', 'bpm': 120, 'bars': 1, 'patch': 'parts-bin/' + ident + '.zip', 'render': 'parts-bin/' + ident + '.wav'}]}
    return archive([('parts-bin.json', json.dumps(manifest)), ('parts-bin/' + ident + '.zip', part), ('parts-bin/' + ident + '.wav', wav())])


class PluginLibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert requests.get(BASE + '/').headers.get('X-Mygrain-Isolated-Test') == 'plugin-library', 'Never run against live storage'
        cls.admin, cls.other = requests.Session(), requests.Session()
        for session, user, password in [(cls.admin, 'admin', 'isolated-vst3-test'), (cls.other, 'dan', 'charged')]:
            response = session.post(BASE + '/api/auth/login', json={'username': user, 'password': password})
            assert response.ok, response.text
            session.headers['X-Mygrain-User'] = user
        cls.path = BASE + '/api/plugin-library/bins'
        cls.body = bin_bytes()

    def setUp(self):
        for session in [self.admin, self.other]:
            for entry in session.get(self.path).json()['bins']:
                session.delete(self.path + '/' + entry['id'])

    def publish(self, name='Universal test'):
        return self.admin.post(self.path, params={'name': name}, data=self.body, headers={'Content-Type': 'application/zip'})

    def test_crud_exact_bytes_account_isolation_and_cleanup(self):
        r = self.publish()
        self.assertEqual(r.status_code, 201, r.text)
        ident = r.json()['id']
        r = self.admin.get(self.path + '/' + ident)
        self.assertEqual(r.content, self.body)
        self.assertIn('no-store', r.headers['Cache-Control'])
        self.assertEqual(self.publish().status_code, 409)
        self.assertEqual(self.other.get(self.path).json()['bins'], [])
        self.assertEqual(self.other.get(self.path + '/' + ident).status_code, 404)
        self.assertEqual(self.other.delete(self.path + '/' + ident).status_code, 404)
        self.assertEqual(self.admin.post(self.path + '/' + ident + '/rename', json={'name': 'Renamed <bin>'}).status_code, 200)
        self.assertEqual(self.admin.get(self.path).json()['bins'][0]['name'], 'Renamed <bin>')
        self.assertEqual(self.admin.get(self.path + '/' + ident).content, self.body)
        self.assertEqual(self.admin.delete(self.path + '/' + ident).status_code, 200)
        self.assertEqual(self.admin.get(self.path + '/' + ident).status_code, 404)
        self.assertEqual(self.admin.get(self.path).json()['bins'], [])

    def test_auth_origin_identity_and_invalid_archives(self):
        self.assertEqual(requests.get(self.path).status_code, 401)
        self.assertEqual(self.admin.get(self.path, headers={'X-Mygrain-User': 'dan'}).status_code, 401)
        self.assertEqual(self.admin.post(self.path, params={'name': 'x'}, data=self.body, headers={'Content-Type': 'application/zip', 'Origin': 'https://not-mygrain.invalid'}).status_code, 403)
        for body in [b'not a zip', archive([('../escape', 'no')]), archive([('parts-bin.json', '{"format":"bad"}')])]:
            r = self.admin.post(self.path, params={'name': 'x'}, data=body, headers={'Content-Type': 'application/zip'})
            self.assertEqual(r.status_code, 400, r.text)
        z = zipfile.ZipFile(io.BytesIO(self.body))
        entries = [(p.filename, z.read(p.filename)) for p in z.infolist()]
        for kind in ['nested', 'wav', 'path', 'duplicate', 'compressed']:
            bad = list(entries)
            if kind == 'nested':
                bad[1] = (bad[1][0], self.body)
            elif kind == 'wav':
                bad[2] = (bad[2][0], b'RIFF' + b'\x00' * 40)
            elif kind == 'path':
                bad.append(('../escape', b'x'))
            elif kind == 'duplicate':
                bad.append(bad[1])
            else:
                out = io.BytesIO()
                with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as comp:
                    for key, value in bad:
                        comp.writestr(key, value)
                body = out.getvalue()
            if kind != 'compressed':
                body = archive(bad)
            self.assertEqual(self.admin.post(self.path, params={'name': 'bad'}, data=body, headers={'Content-Type': 'application/zip'}).status_code, 400, kind)
        self.assertEqual(self.admin.get(self.path).json()['bins'], [])

    def test_update_conflicts_append_and_empty_bins(self):
        first = self.publish('Open bin').json()
        rev = first['revision']
        self.assertEqual(rev, hashlib.sha256(self.body).hexdigest())
        path = self.path + '/' + first['id']
        self.assertEqual(self.admin.post(path + '/replace', data=self.body, headers={'Content-Type': 'application/zip'}).status_code, 428)
        changed = self.body.replace(b'Test part', b'Best part')  # Repack below so CRC remains valid.
        with zipfile.ZipFile(io.BytesIO(self.body)) as z:
            entries = [(p.filename, z.read(p.filename)) for p in z.infolist()]
        entries[0] = (entries[0][0], entries[0][1].replace(b'Test part', b'Best part'))
        changed = archive(entries)
        r = self.admin.post(path + '/replace', data=changed, headers={'Content-Type': 'application/zip', 'If-Match': '"' + rev + '"'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotEqual(r.json()['revision'], rev)
        self.assertEqual(self.admin.get(path).content, changed)
        r = self.admin.post(path + '/replace', data=self.body, headers={'Content-Type': 'application/zip', 'If-Match': rev})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.admin.get(path).content, changed)
        self.assertEqual(self.other.post(path + '/replace', data=self.body, headers={'Content-Type': 'application/zip', 'If-Match': rev}).status_code, 404)
        r = self.admin.post(path + '/append', data=self.body, headers={'Content-Type': 'application/zip'})
        self.assertEqual(r.status_code, 200, r.text)
        with zipfile.ZipFile(io.BytesIO(self.admin.get(path).content)) as z:
            parts = json.loads(z.read('parts-bin.json'))['parts']
            self.assertEqual(len(parts), 2)
            self.assertEqual(len({p['id'] for p in parts}), 2)
            with zipfile.ZipFile(io.BytesIO(self.body)) as original:
                for part in parts:
                    self.assertEqual(z.read(part['patch']), original.read('parts-bin/' + 'a' * 32 + '.zip'))
                    self.assertEqual(z.read(part['render']), original.read('parts-bin/' + 'a' * 32 + '.wav'))
        empty = archive([('parts-bin.json', json.dumps({'format': 'mygrain-parts-bin', 'version': 1, 'parts': []}))])
        r = self.admin.post(self.path, params={'name': 'Empty bin'}, data=empty, headers={'Content-Type': 'application/zip'})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.admin.get(self.path + '/' + r.json()['id']).content, empty)

    def test_move_transaction_and_exact_bytes(self):
        source, target = self.publish('Source').json(), self.publish('Destination').json()
        source_path, target_path = self.path + '/' + source['id'], self.path + '/' + target['id']
        params = dict(moveFrom=source['id'], revision=source['revision'], part='a' * 32)
        headers = {'Content-Type': 'application/zip'}
        # Conflicting name and invalid/missing destination cannot remove the source.
        r = self.admin.post(self.path, params=dict(params, name='Destination'), data=self.body, headers=headers)
        self.assertEqual(r.status_code, 409, r.text)
        self.assertEqual(self.admin.get(source_path).content, self.body)
        self.assertEqual(self.admin.post(self.path + '/' + '0' * 32 + '/append', params=params, data=self.body, headers=headers).status_code, 404)
        self.assertEqual(self.admin.get(source_path).content, self.body)
        self.assertEqual(self.other.post(target_path + '/append', params=params, data=self.body, headers=headers).status_code, 404)
        bad = dict(params, revision='0' * 64)
        self.assertEqual(self.admin.post(target_path + '/append', params=bad, data=self.body, headers=headers).status_code, 409)
        self.assertEqual(self.admin.get(source_path).content, self.body)
        self.assertEqual(self.admin.get(target_path).content, self.body)
        # Full destination rejects atomically, keeping both sides intact.
        for _ in range(31):
            self.assertEqual(self.admin.post(target_path + '/append', data=self.body, headers=headers).status_code, 200)
        full = self.admin.get(target_path).content
        r = self.admin.post(target_path + '/append', params=params, data=self.body, headers=headers)
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(self.admin.get(source_path).content, self.body)
        self.assertEqual(self.admin.get(target_path).content, full)
        # Move the last source part to a newly created bin in one transaction.
        r = self.admin.post(self.path, params=dict(params, name='Moved'), data=self.body, headers=headers)
        self.assertEqual(r.status_code, 201, r.text)
        moved = r.json()
        self.assertEqual(self.admin.get(self.path + '/' + moved['id']).content, self.body)
        with zipfile.ZipFile(io.BytesIO(self.admin.get(source_path).content)) as z:
            self.assertEqual(json.loads(z.read('parts-bin.json'))['parts'], [])
        self.assertEqual(hashlib.sha256(self.admin.get(source_path).content).hexdigest(), moved['sourceRevision'])

    def test_concurrent_appends_and_optimistic_replace(self):
        first = self.publish('Concurrent').json()
        path = self.path + '/' + first['id']
        def post(action, body, revision=None):
            return requests.post(path + action, data=body, headers={'Content-Type': 'application/zip', 'X-Mygrain-User': 'admin', **({'If-Match': revision} if revision else {})}, cookies=self.admin.cookies).status_code
        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(lambda _: post('/append', self.body), range(6)))
        self.assertEqual(statuses, [200] * 6)
        with zipfile.ZipFile(io.BytesIO(self.admin.get(path).content)) as z:
            parts = json.loads(z.read('parts-bin.json'))['parts']
            self.assertEqual(len(parts), 7)
            self.assertEqual(len({p['id'] for p in parts}), 7)
        rev = hashlib.sha256(self.admin.get(path).content).hexdigest()
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: post('/replace', self.body, rev), range(2)))
        self.assertEqual(sorted(statuses), [200, 409])

    def test_telemetry_strict_numeric_write_only_and_idempotence(self):
        path = BASE + '/api/audio-telemetry'
        payload = dict(sessionId='b' * 32, sequence=0, startedAt='2026-11-15T16:00:00Z', build='vtest.1', samples=[dict(elapsedMs=0, plugin='fx', contextState='running', armed=True, missingBlocks=3, clockRatio=1.001)])
        for _ in range(2):
            r = self.admin.post(path, json=payload)
            self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.admin.get(path).status_code, 405)
        self.assertEqual(requests.post(path, json=payload).status_code, 401)
        for key, value in [('audio', 'PCM'), ('password', 'no'), ('elapsedMs', 'bad'), ('armed', 1), ('plugin', 'anything'), ('contextState', 'secret')]:
            bad = dict(payload, sequence=1, samples=[dict(payload['samples'][0], **{key: value})])
            self.assertEqual(self.admin.post(path, json=bad).status_code, 400, key)

    def test_concurrent_quota_and_physical_cleanup(self):
        def publish(index):
            # A dedicated connection per request; share only this synthetic auth.
            return requests.post(self.path, params={'name': 'Quota ' + str(index)}, data=self.body, headers={'Content-Type': 'application/zip', 'X-Mygrain-User': 'admin'}, cookies=self.admin.cookies).status_code
        with ThreadPoolExecutor(max_workers=6) as executor:
            results = list(executor.map(publish, range(18)))
        self.assertEqual(results.count(201), 16, results)
        self.assertEqual(results.count(507), 2, results)
        entries = self.admin.get(self.path).json()['bins']
        self.assertEqual(len(entries), 16)
        # The guarded fixture owns this local directory; never inspect live stores.
        store = pathlib.Path(os.environ.get('MYGRAIN_PLUGIN_TEST_STORE', pathlib.Path(__file__).resolve().parents[2] / 'isolated-store'))
        paths = list((store / 'users').glob('*/plugin-library/bins.sqlite3'))
        sizes_before = {p: p.stat().st_size for p in paths}
        for entry in entries:
            self.assertEqual(self.admin.delete(self.path + '/' + entry['id']).status_code, 200)
        self.assertTrue(any(p.stat().st_size < size for p, size in sizes_before.items()))
        for path in paths:
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('PRAGMA auto_vacuum').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
