import importlib.util
import io
import json
import pathlib
import tempfile
import threading
import types
import unittest
from unittest.mock import patch
from test_song_backend import SONGS
import test_wasp

ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'backend'/f'{name}.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
W=load('mygrain_wasp_patches');A=load('mygrain_accounts')
class WaspLibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
        self.accounts=types.SimpleNamespace(users_root=self.root,user_lock=lambda user:threading.RLock())
        self.user={'id':'a'*32};self.other={'id':'b'*32};self.settings=test_wasp.WaspTests().settings()
    def request(self,method='GET',payload=None,user=None):
        body=json.dumps(payload).encode() if payload is not None else b''
        class Handler:
            def send_json(h,payload,status=200,extra_headers=None):h.result=(status,payload)
        h=Handler();h.headers={'Content-Length':str(len(body)),'Content-Type':'application/json'};h.rfile=io.BytesIO(body)
        W.handle_request(h,method,self.accounts,user or self.user,A.checked_path,SONGS.validate_wasp);return h.result
    def save(self,name='Sting',revision=0):
        return self.request('POST',{'action':'save','revision':revision,'name':name,'settings':self.settings})
    def test_roundtrip_and_isolation(self):
        status,data=self.save();self.assertEqual(status,200);self.assertFalse(data['patches'][0]['settings']['enabled']);self.assertEqual(data['patches'][0]['settings']['filter'],self.settings['filter'])
        self.assertEqual(self.request()[1]['patches'],data['patches']);self.assertEqual(self.request(user=self.other)[1]['patches'],[])
        self.assertEqual(self.request('POST',{'action':'delete','id':data['selectedId'],'revision':0},self.other)[0],404)
        p=W.location(self.accounts,self.user,A.checked_path);self.assertEqual(p.stat().st_mode&0o777,0o600)
    def test_revision_conflict_duplicate_rename_replace_delete(self):
        _,d=self.save();pid=d['selectedId'];self.assertEqual(self.save('Other',0)[0],409);self.assertEqual(self.save('sting',1)[0],400)
        status,d=self.request('POST',{'action':'rename','id':pid,'revision':1,'name':'Needle'});self.assertEqual(status,200);self.assertEqual(d['patches'][0]['name'],'Needle')
        self.settings['filter']['enabled']=True
        status,d=self.request('POST',{'action':'replace','id':pid,'revision':2,'settings':self.settings});self.assertEqual(status,200);self.assertTrue(d['patches'][0]['settings']['filter']['enabled'])
        self.assertEqual(self.request('POST',{'action':'delete','id':pid,'revision':3})[1]['patches'],[])
    def test_invalid_filter_rejected_without_save(self):
        for key,value in [('enabled',1),('slope',13),('rate',float('nan')),('mode','bad'),('resonance',100),('wave','bad')]:
            self.settings=test_wasp.WaspTests().settings();self.settings['filter'][key]=value
            self.assertEqual(self.save()[0],400,key)
        self.assertEqual(self.request()[1]['revision'],0)
    def test_symlinks_corruption_and_atomic_failure_preserve_data(self):
        self.save();p=W.location(self.accounts,self.user,A.checked_path);original=p.read_bytes()
        with patch.object(W.os,'replace',side_effect=OSError('disk error')):
            self.assertEqual(self.save('Second',1)[0],500)
        self.assertEqual(p.read_bytes(),original)
        p.write_text('broken');self.assertEqual(self.save('Second',1)[0],500);self.assertEqual(p.read_text(),'broken')
        p.unlink();p.symlink_to(self.root/'elsewhere');self.assertRaises(ValueError,W.location,self.accounts,self.user,A.checked_path)
    def test_name_and_size_and_capacity_bounds(self):
        for name in ['', 'x'*81,'bad\nname']:
            self.assertEqual(self.save(name)[0],400)
        self.assertEqual(self.request('POST',{'action':'save','name':'x'*18000})[0],400)
        self.assertEqual(self.request('DELETE')[0],405)
        library={'version':1,'revision':0,'patches':[{'id':str(i),'name':str(i)} for i in range(256)]}
        with self.assertRaises(ValueError):W.mutate(library,{'action':'save','revision':0,'name':'new','settings':self.settings},SONGS.validate_wasp)
if __name__=='__main__':unittest.main()
