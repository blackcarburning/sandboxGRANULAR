"""Real HTTP checks; only runs against an explicitly isolated loopback account store."""
import hashlib
import io
import json
import os
import unittest
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests
from test_song_backend import part_zip

BASE = os.environ.get('MYGRAIN_SCRATCH_TEST_URL', 'http://127.0.0.1:19053/mygrain')
ROOT = Path(os.environ.get('MYGRAIN_TEST_ROOT', '/tmp/mygrain-scratchpad-test'))
API = BASE + '/api/plugin-library/scratchpad'

def bundle(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as archive:
        for key, data in entries:
            archive.writestr(key, data)
    return out.getvalue()

def wav():
    out = io.BytesIO()
    with wave.open(out, 'wb') as audio:
        audio.setnchannels(2);audio.setsampwidth(3);audio.setframerate(44100)
        audio.writeframes((b'\x00\x00\x20' + b'\x00\x00\xe0') * 4410)
    return out.getvalue()

class ScratchpadHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert BASE.startswith('http://127.0.0.1:') and ROOT.is_relative_to('/tmp') and ROOT.name.startswith('mygrain-scratchpad-')
        assert ROOT.exists(), 'Start the isolated fixture first.'
        cls.sessions = []
        for username, password in [('admin', 'isolated-vst3-test'), ('dan', 'isolated-dan-test')]:
            session = requests.Session()
            r = session.post(BASE + '/api/auth/login', json={'username': username, 'password': password})
            assert r.ok, r.text
            session.headers['X-Mygrain-User'] = username
            cls.sessions.append(session)
        cls.a, cls.b = cls.sessions
        cls.audio, cls.patch = wav(), part_zip()
        cls.pair = bundle([('render.wav', cls.audio), ('pattern.zip', cls.patch)])

    def setUp(self):
        for session in self.sessions:
            while True:
                rows = session.get(API).json()['items']
                if not rows:break
                for row in rows:
                    self.assertEqual(session.delete(API + '/items/' + row['id'], headers={'If-Match': str(row['revision'])}).status_code, 200)

    def save(self, title='First idea', data=None, session=None, **query):
        return (session or self.a).post(API + '/items', params={'name': title, **query}, data=self.pair if data is None else data, headers={'Content-Type': 'application/zip'})

    def test_pair_integrity_folders_cas_and_recoverable_delete(self):
        r = self.save();self.assertEqual(r.status_code, 201, r.text)
        item = r.json()['item'];url = API + '/items/' + item['id']
        for kind, original in [('audio', self.audio), ('patch', self.patch)]:
            r = self.a.get(url + '/' + kind);self.assertEqual(r.content, original)
            self.assertEqual(item[kind + 'Sha256'], hashlib.sha256(original).hexdigest())
            self.assertEqual(item[kind + 'Bytes'], len(original))
            self.assertIn('no-store', r.headers['Cache-Control'])
            self.assertEqual(self.a.head(url + '/' + kind).headers['Content-Length'], str(len(original)))
        f = self.a.post(API + '/folders', json={'name':'Tests ' + item['id']}).json()['id']
        r = self.a.post(url, json={'revision':1,'name':'Renamed <idea>','folder':f});self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.a.get(API, params={'folder':f}).json()['items'][0]['name'],'Renamed <idea>')
        self.assertEqual(self.a.get(API, params={'folder':''}).json()['total'],0)
        self.assertEqual(self.a.post(url,json={'revision':1,'name':'stale'}).status_code,409)
        self.assertEqual(self.a.delete(url,headers={'If-Match':'1'}).status_code,409)
        r=self.a.post(url,json={'revision':2,'folder':None});self.assertEqual(r.status_code,200)
        self.assertEqual(self.a.get(url+'/patch').content,self.patch)
        self.assertEqual(self.a.get(API,params={'q':'<idea>'}).json()['total'],1)
        self.assertEqual(self.a.delete(url,headers={'If-Match':'3'}).status_code,200)
        self.assertEqual(self.a.get(url+'/audio').status_code,404)
        self.assertEqual(self.a.get(API).json()['total'],0)
        # Soft-deletion is recoverable, without making it accessible through the API.
        import sqlite3
        databases=list(ROOT.rglob('scratchpad/ideas.sqlite3'));self.assertTrue(databases)
        found=False
        for dbfile in databases:
            self.assertEqual(dbfile.stat().st_mode & 0o777,0o600)
            with sqlite3.connect(dbfile) as db:
                row=db.execute('SELECT audio,patch,deleted FROM ideas WHERE id=?',(item['id'],)).fetchone()
                if row:found=True;self.assertEqual(row[:2],(self.audio,self.patch));self.assertIsNotNone(row[2])
        self.assertTrue(found)

    def test_auth_identity_csrf_foreign_ids_and_no_repository_leak(self):
        item=self.save().json()['item'];url=API+'/items/'+item['id']
        self.assertEqual(requests.get(API).status_code,401)
        self.assertEqual(self.a.get(API,headers={'X-Mygrain-User':'dan'}).status_code,401)
        self.assertEqual(self.a.post(API+'/items',params={'name':'x'},data=self.pair,headers={'Content-Type':'application/zip','Origin':'https://evil.invalid'}).status_code,403)
        self.assertEqual(self.b.get(API).json()['total'],0)
        for endpoint in ['/audio','/patch']:
            self.assertEqual(self.b.get(url+endpoint).status_code,404)
        self.assertEqual(self.b.post(url,json={'revision':1,'name':'stolen'}).status_code,404)
        self.assertEqual(self.b.delete(url,headers={'If-Match':'1'}).status_code,404)
        self.assertEqual(self.a.get(API,params={'user':'dan'}).status_code,400)
        for path in ['/scratchpad/ideas.sqlite3','/backend/mygrain_scratchpad.py','/api/plugin-library/scratchpad/items/../../../ideas.sqlite3']:
            self.assertNotEqual(self.a.get(BASE+path).status_code,200)
        self.assertEqual(self.a.get(BASE+'/api/plugin-library/bins').json()['bins'],[])

    def test_invalid_upload_is_atomic_and_requires_patch(self):
        for body in [b'no zip',bundle([('render.wav',self.audio)]),bundle([('render.wav',b'RIFFno'),('pattern.zip',self.patch)]),bundle([('render.wav',self.audio),('pattern.zip',b'bad')]),bundle([('render.wav',self.audio),('pattern.zip',self.patch),('../x',b'x')]),bundle([('render.wav',self.audio[:-1]),('pattern.zip',self.patch)])]:
            r=self.save(data=body);self.assertEqual(r.status_code,400,r.text)
        malformed = bytearray(self.audio)
        malformed[40:44] = (len(self.audio) - 44 + 6).to_bytes(4, 'little')
        self.assertEqual(self.save(data=bundle([('render.wav', malformed), ('pattern.zip', self.patch)])).status_code,400)
        self.assertEqual(self.a.get(API).json()['total'],0)
        self.assertEqual(self.save(title='  ').status_code,400)
        self.assertEqual(self.save(folder='a'*32).status_code,404)

    def test_unlimited_count_paging_and_literal_search(self):
        for i in range(63):
            self.assertEqual(self.save('Count %_ '+str(i)).status_code,201)
        page=self.a.get(API,params={'q':'%_','limit':50}).json()
        self.assertEqual(page['total'],63);self.assertEqual(len(page['items']),50);self.assertIsNone(page['capacityLimit'])
        self.assertEqual(len(self.a.get(API,params={'offset':50}).json()['items']),13)
        for i in range(17):
            self.assertEqual(self.a.post(API+'/folders',json={'name':'Unbounded '+os.urandom(8).hex()}).status_code,201)

    def test_concurrent_updates_only_one_wins(self):
        item=self.save().json()['item'];url=API+'/items/'+item['id']
        def rename(number):
            return self.a.post(url,json={'revision':1,'name':f'Winner {number}'}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(rename,[1,2])),[200,409])
        self.assertEqual(self.a.get(url+'/audio').content,self.audio)

if __name__=='__main__':unittest.main()
