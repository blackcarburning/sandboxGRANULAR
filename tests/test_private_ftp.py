import http.client
import importlib.util
import io
import json
import pathlib
import tempfile
import threading
import unittest
import wave
from http.server import ThreadingHTTPServer
from urllib.parse import urlencode

WORKSPACE=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('private_ftp_test_server',WORKSPACE/'fs7300-documenter/server.py')
S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)

class Client:
    def __init__(self, server): self.address=server.server_address;self.cookie='';self.user=''
    def call(self,method,path,body=None,json_body=None,pin=True,origin=None):
        headers={'Cookie':self.cookie,'Origin':origin or f'http://127.0.0.1:{self.address[1]}'}
        if pin and self.user:headers['X-Mygrain-User']=self.user
        if json_body is not None:body=json.dumps(json_body);headers['Content-Type']='application/json'
        conn=http.client.HTTPConnection(*self.address,timeout=30)
        try:
            conn.request(method,path,body=body,headers=headers);r=conn.getresponse();raw=r.read();h=dict(r.getheaders())
            if 'Set-Cookie' in h:self.cookie=h['Set-Cookie'].split(';')[0]
            return r.status,json.loads(raw) if r.getheader('Content-Type','').startswith('application/json') else raw,h
        finally:conn.close()
    def login(self,user):
        result=self.call('POST','/mygrain/api/auth/login',json_body={'username':user,'password':'fixture-secret'});self.user=user;return result
    def ftp(self,action,path='',**kw):return self.call(kw.pop('method','GET'),'/mygrain/api/ftp/'+action+'?'+urlencode({'path':path}),**kw)

class Quiet(S.DocumenterHandler):
    def log_message(self,*args):pass

class PrivateFTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='mygrain-ftp-test-');cls.root=pathlib.Path(cls.temp.name)
        for user in ('admin','dan'):S._accounts_module.SEED_HASHES[user]=S._accounts_module.hash_password('fixture-secret')
        cls.accounts=S.init_account_store(cls.root)
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Quiet);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.temp.cleanup()
    def setUp(self):
        self.admin=Client(self.server);self.dan=Client(self.server);self.assertEqual(self.admin.login('admin')[0],200);self.assertEqual(self.dan.login('dan')[0],200)
    def wav(self):
        b=io.BytesIO()
        with wave.open(b,'wb') as w:w.setparams((1,2,8000,0,'NONE',''));w.writeframes(b'\x00\x10'*8000)
        return b.getvalue()
    def test_00_trash_created_on_first_listing(self):
        target=self.root/'ftp/admin/.trash'
        self.assertFalse(target.exists())
        self.assertEqual(self.admin.ftp('list')[0],200)
        self.assertTrue(target.is_dir())
        self.assertEqual(target.stat().st_mode & 0o777,0o700)
        self.assertEqual(self.admin.ftp('trash')[1]['entries'],[])

    def test_01_isolation_and_auth(self):
        self.assertEqual(self.admin.ftp('upload','private.wav',method='POST',body=self.wav())[0],201)
        self.assertEqual(self.dan.ftp('file','private.wav')[0],404)
        self.assertEqual(Client(self.server).ftp('list')[0],401)
        self.assertEqual(self.admin.ftp('list',pin=False)[0],401)
        self.assertEqual(self.admin.ftp('mkdir',method='POST',json_body={'path':'bad-origin'},origin='https://evil.example')[0],403)
        original=self.admin.user;self.admin.user='dan';self.assertEqual(self.admin.ftp('list')[0],401);self.admin.user=original
        self.assertEqual(self.admin.ftp('upload','private.wav',method='POST',body=b'do not overwrite')[0],409)
        self.assertEqual(self.admin.ftp('file','private.wav')[1],self.wav())
        for path in ('../dan/private.wav','/dan/private.wav','.trash/x','x\\y'):
            self.assertEqual(self.dan.ftp('file',path)[0],400)
        self.assertEqual(self.admin.ftp('list')[1]['username'],'admin')
    def test_02_folders_moves_recoverable_delete(self):
        self.assertEqual(self.dan.ftp('mkdir',method='POST',json_body={'path':'vocals'})[0],200)
        self.assertEqual(self.dan.ftp('upload','vocals/take.wav',method='POST',body=self.wav())[0],201)
        row=self.dan.ftp('list','vocals')[1]['entries'][0]
        self.assertEqual(self.dan.ftp('move',method='POST',json_body={'path':row['path'],'to':'renamed.wav','version':'stale'})[0],400)
        self.assertEqual(self.dan.ftp('move',method='POST',json_body={'path':row['path'],'to':'renamed.wav','version':row['version']})[0],200)
        entries=self.dan.ftp('list')[1]['entries'];row=next(r for r in entries if r['name']=='renamed.wav')
        self.assertEqual(self.dan.ftp('delete',method='POST',json_body={'path':row['path'],'version':row['version']})[0],200)
        self.assertEqual(self.dan.ftp('file','renamed.wav')[0],404)
        self.assertTrue(list((self.root/'ftp/dan/.trash').glob('*')))
        row=next(r for r in self.dan.ftp('list')[1]['entries'] if r['directory'])
        self.assertEqual(self.dan.ftp('move',method='POST',json_body={'path':row['path'],'to':'newfolder','version':row['version']})[0],200)
    def test_025_trash_restore_private_original_path_and_conflicts(self):
        self.assertEqual(self.admin.ftp('mkdir',method='POST',json_body={'path':'restore-folder'})[0],200)
        self.assertEqual(self.admin.ftp('upload','restore-folder/restore.wav',method='POST',body=self.wav())[0],201)
        row=self.admin.ftp('list','restore-folder')[1]['entries'][0]
        self.assertEqual(self.admin.ftp('delete',method='POST',json_body={'path':row['path'],'version':row['version']})[0],200)
        entry=self.admin.ftp('trash')[1]['entries'][0]
        self.assertEqual(entry['originalPath'],'restore-folder/restore.wav')
        self.assertNotIn(entry['id'],[x['id'] for x in self.dan.ftp('trash')[1]['entries']])
        payload={'id':entry['id'],'version':entry['version']}
        self.assertEqual(self.dan.ftp('restore',method='POST',json_body=payload)[0],404)
        self.assertEqual(self.admin.ftp('restore',method='POST',json_body={**payload,'version':'stale'})[0],400)
        self.assertEqual(self.admin.ftp('upload',row['path'],method='POST',body=b'keep')[0],201)
        self.assertEqual(self.admin.ftp('restore',method='POST',json_body=payload)[0],409)
        self.assertEqual(self.admin.ftp('file',row['path'])[1],b'keep')
        replacement=self.admin.ftp('list','restore-folder')[1]['entries'][0]
        self.admin.ftp('delete',method='POST',json_body={'path':replacement['path'],'version':replacement['version']})
        result=self.admin.ftp('restore',method='POST',json_body=payload)
        self.assertEqual(result[0],200);self.assertEqual(result[1]['path'],row['path'])
        self.assertEqual(self.admin.ftp('file',row['path'])[1],self.wav())
        self.assertNotIn(entry['id'],[x['id'] for x in self.admin.ftp('trash')[1]['entries']])
        for identifier in ('../dan/.trash/x','.trash/x','0'*32+'-../x'):
            self.assertEqual(self.admin.ftp('restore',method='POST',json_body={'id':identifier,'version':'x'})[0],400)
        # Original folder removed: restore into Home, never overwrite.
        self.admin.ftp('delete',method='POST',json_body={'path':row['path'],'version':self.admin.ftp('list','restore-folder')[1]['entries'][0]['version']})
        entry=self.admin.ftp('trash')[1]['entries'][0]
        folder=next(x for x in self.admin.ftp('list')[1]['entries'] if x['name']=='restore-folder')
        self.admin.ftp('delete',method='POST',json_body={'path':folder['path'],'version':folder['version']})
        self.assertEqual(self.admin.ftp('restore',method='POST',json_body={'id':entry['id'],'version':entry['version']})[1]['path'],'restore.wav')
        self.assertEqual(self.admin.ftp('file','restore.wav')[1],self.wav())

    def test_026_legacy_recovery_items_are_restorable(self):
        import secrets
        folder=S._ftp_module.home({'username':'admin'})/'.trash'
        identifier=secrets.token_hex(16)+'-legacy.txt'
        (folder/identifier).write_bytes(b'legacy recovery')
        entry=next(x for x in self.admin.ftp('trash')[1]['entries'] if x['id']==identifier)
        self.assertEqual(entry['originalPath'],'legacy.txt')
        self.assertEqual(self.admin.ftp('restore',method='POST',json_body={'id':identifier,'version':entry['version']})[0],200)
        self.assertEqual(self.admin.ftp('file','legacy.txt')[1],b'legacy recovery')

    def test_03_symlink_confinement(self):
        home=S._ftp_module.home({'username':'dan'});(home/'escape').symlink_to(self.root/'ftp/admin',target_is_directory=True)
        self.assertNotIn('escape',[r['name'] for r in self.dan.ftp('list')[1]['entries']])
        self.assertEqual(self.dan.ftp('file','escape/private.wav')[0],400)
        self.assertEqual(self.dan.ftp('upload','escape/new.wav',method='POST',body=self.wav())[0],400)
        self.assertEqual(self.dan.ftp('audio')[0],200)
    def test_04_generation_uses_only_own_directory(self):
        body=self.wav();self.assertEqual(self.dan.ftp('upload','dan.wav',method='POST',body=body)[0],201)
        paths=self.dan.ftp('audio')[1]['paths'];self.assertIn('dan.wav',paths);self.assertNotIn('private.wav',paths)
        result=self.dan.call('POST','/mygrain-bastardloops/api/bastardloop',json_body={'source':'user_ftp','sourceFiles':['dan.wav'],'divisions':['1/16'],'patternLength':16,'bpm':120,'responseFormat':'audio'})
        self.assertEqual(result[0],201,result[1] if isinstance(result[1],dict) else '')
        self.assertTrue(result[1].startswith(b'RIFF'))
        self.assertEqual(self.dan.call('POST','/mygrain-bastardloops/api/bastardloop',json_body={'source':'user_ftp','sourceFiles':['private.wav'],'responseFormat':'audio'})[0],400)
    def test_05_public_assets_and_download_headers(self):
        for file in ('ftp.html','private-ftp.js','private-ftp.css'):
            self.assertEqual(Client(self.server).call('GET','/mygrain/'+file)[0],200)
        status,body,headers=self.admin.ftp('file','private.wav');self.assertEqual(status,200);self.assertIn('attachment',headers['Content-Disposition']);self.assertIn('no-store',headers['Cache-Control'])

if __name__=='__main__':unittest.main()
