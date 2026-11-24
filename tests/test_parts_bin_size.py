"""Real >96 MiB bins over isolated authenticated HTTP, never production stores."""
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse
import wave
import zipfile
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_plugin_library import archive, bin_bytes
BASE = os.environ.get('MYGRAIN_PLUGIN_TEST_URL', 'http://127.0.0.1:19357/mygrain')
OUT = Path(os.environ['MYGRAIN_TEST_OUTPUT'])


def fixtures():
    folder = OUT / 'fixtures'
    folder.mkdir(parents=True, exist_ok=True)
    small = bin_bytes()
    (folder / 'small.zip').write_bytes(small)
    with zipfile.ZipFile(io.BytesIO(small)) as z:
        values = [(p.filename, z.read(p.filename)) for p in z.infolist()]
    source=Path(os.environ.get('MYGRAIN_SIZE_SOURCE', folder / 'patch.zip'))
    if source.exists():
        values[1] = (values[1][0], source.read_bytes())
    else:
        # Make the legacy test source valid for both strict browser and server readers.
        with zipfile.ZipFile(io.BytesIO(values[1][1])) as z:
            snapshot = json.loads(z.read('song-part.json'))
            snapshot['assets'][0].update(channels=2, frames=800, sampleRate=8000)
            values[1] = (values[1][0], archive([('song-part.json', json.dumps(snapshot)), ('audio/bastardL.wav', z.read('audio/bastardL.wav'))]))
        (folder / 'patch.zip').write_bytes(values[1][1])
    for size in (100, 140):
        target = folder / f'{size}.zip'
        data = io.BytesIO()
        with wave.open(data, 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(3)
            w.setframerate(48000)
            w.writeframes(b'\x01\x00\x00' * (size * 1048576 // 3))
        target.write_bytes(archive(values[:2] + [(values[2][0], data.getvalue())]))
    return folder


class PartsBinSizeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert requests.get(BASE + '/').headers.get('X-Mygrain-Isolated-Test') == 'plugin-library', 'Never run against live storage'
        cls.folder = fixtures()
        cls.admin, cls.other = requests.Session(), requests.Session()
        for client, user, password in [(cls.admin, 'admin', 'isolated-vst3-test'), (cls.other, 'dan', 'charged')]:
            r = client.post(BASE + '/api/auth/login', json={'username': user, 'password': password})
            assert r.ok, r.text
            client.headers['X-Mygrain-User'] = user
        cls.url = BASE + '/api/plugin-library/bins'
        for b in cls.admin.get(cls.url).json()['bins']:
            assert cls.admin.delete(cls.url + '/' + b['id']).ok

    def test_large_universal_create_replace_conflict_and_archive_admission(self):
        first = None
        result = []
        for size in (100, 140):
            body = (self.folder / f'{size}.zip').read_bytes()
            r = self.admin.post(self.url, params={'name': f'{size} MiB size test'}, data=body, headers={'Content-Type': 'application/zip'}, timeout=120)
            self.assertEqual(r.status_code, 201, r.text)
            saved = r.json()
            path = self.url + '/' + saved['id']
            recalled = self.admin.get(path, timeout=120)
            self.assertEqual(hashlib.sha256(recalled.content).hexdigest(), hashlib.sha256(body).hexdigest())
            self.assertEqual(self.other.get(path).status_code, 404)
            result.append({'size': size, 'id': saved['id'], 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
            if size == 100:
                first = saved
            else:
                target = self.url + '/' + first['id']
                replaced = self.admin.post(target + '/replace', data=body, headers={'Content-Type': 'application/zip', 'If-Match': first['revision']}, timeout=120)
                self.assertEqual(replaced.status_code, 200, replaced.text)
                stale = self.admin.post(target + '/replace', data=(self.folder / 'small.zip').read_bytes(), headers={'Content-Type': 'application/zip', 'If-Match': first['revision']})
                self.assertEqual(stale.status_code, 409)
                self.assertEqual(hashlib.sha256(self.admin.get(target).content).hexdigest(), saved['revision'])
        # Body admission rejects an impossible request before reading/allocating it.
        u = urlparse(self.url)
        connection = http.client.HTTPConnection(u.hostname, u.port, timeout=20)
        cookie = '; '.join(f'{k}={v}' for k, v in self.admin.cookies.items())
        connection.request('POST', u.path + '?name=Impossible', body=None, headers={'Cookie': cookie, 'X-Mygrain-User': 'admin', 'Content-Type': 'application/zip', 'Content-Length': str(512 * 1048576 + 1)})
        self.assertEqual(connection.getresponse().status, 413)
        connection.close()
        self.assertEqual(len(self.admin.get(self.url).json()['bins']), 2)
        # Keep a genuine 100 MiB fixture for subsequent browser/native-codec checks.
        body = (self.folder / '100.zip').read_bytes()
        r = self.admin.post(self.url + '/' + first['id'] + '/replace', data=body, headers={'Content-Type': 'application/zip', 'If-Match': result[1]['sha256']}, timeout=120)
        self.assertEqual(r.status_code, 200, r.text)
        (OUT / 'http-results.json').write_text(json.dumps({'largeBins': result, 'byteExact': True, 'accountIsolation': True, 'staleSaveRetained': True, 'quotaAdmissionRetained': True}, indent=2))


if __name__ == '__main__':
    unittest.main()
