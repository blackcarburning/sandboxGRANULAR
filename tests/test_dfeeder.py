import hashlib
import json
import math
import pathlib
import struct
import sys
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from test_mygrain_accounts import AccountHTTPTests, SERVER
for route in SERVER.PROTECTED_ROUTES:
    if route['base']=='/mygrain':route['root']=pathlib.Path(__file__).resolve().parents[1]
D=SERVER._dfeeder_module
L=SERVER._loopstore_module

class DfeederTests(AccountHTTPTests):
    # Reuse the established real HTTP account fixture, not its unrelated test methods.
    def candidate(self,owner='admin',index=0,ident='a'*32,bpm=178):
        root=D.safe_dir(D.ROOT);user=self.accounts.lookup_user(owner)
        job=dict(id=ident,ownerId=user['id'],username=owner,count=index+1,bpms=[bpm]*(index+1))
        folder=D.safe_dir(root/'.pending'/ident);frames=round(60/bpm*16*8000)
        pcm=b''.join(int(round((8388607 if i==0 else math.sin(i*.2)*1000000))).to_bytes(3,'little',signed=True)*2 for i in range(frames))
        data=b'RIFF'+struct.pack('<I',36+len(pcm))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,2,8000,48000,6,24)+b'data'+struct.pack('<I',len(pcm))+pcm
        (folder/f'{index:04d}.wav').write_bytes(data)
        item=dict(index=index,bpm=bpm,steps=64,quality='full',layers=['bastarda','bastardd'],drums=True,peak=1,rms=.1)
        name=D.publish(root,job,item,L);return name,data
    def test_review_bytes_auth_and_recovery(self):
        name,raw=self.candidate('dan');url='/mygrain/api/dfeeder/audio/'+name
        self.assertEqual(self.anonymous.request('GET','/mygrain/api/dfeeder/list')[0],401)
        for who in [self.admin,self.dan]:
            status,body,headers=who.request('GET','/mygrain/api/dfeeder/list');self.assertEqual(status,200);self.assertEqual(body['files'][0]['name'],name);self.assertIn('no-store',headers['Cache-Control'])
        self.assertEqual(self.dan.request('GET',url+'?mygrainUser=admin',identity=False)[0],401)
        status,data,headers=self.dan.request('GET',url+'?mygrainUser=dan',headers={'Range':'bytes=44-65'},identity=False)
        self.assertEqual((status,data),(206,raw[44:66]));self.assertEqual(headers['Accept-Ranges'],'bytes')
        status,data,_=self.dan.request('HEAD',url+'?mygrainUser=dan',identity=False)
        self.assertEqual((status,data),(200,b''))
        status,result,_=self.dan.request('POST','/mygrain/api/dfeeder/approve',data={'filename':name});self.assertEqual(status,200,result)
        self.assertFalse((D.ROOT/name).exists());self.assertEqual((L.ROOT/result['savedName']).read_bytes(),raw)
        self.assertEqual(L.read_metadata(L.ROOT,result['savedName'])['ownerId'],self.accounts.lookup_user('dan')['id'])
        self.assertEqual(self.dan.request('POST','/mygrain/api/dfeeder/approve',data={'filename':name})[0],404)
        name,raw=self.candidate('admin',ident='b'*32)
        self.assertEqual(self.dan.request('POST','/mygrain/api/dfeeder/reject',data={'filename':name})[0],403)
        self.assertEqual(self.admin.request('POST','/mygrain/api/dfeeder/reject',data={'filename':name})[0],200)
        self.assertFalse((D.ROOT/name).exists());self.assertEqual(next((D.ROOT/'.trash').rglob('*.wav')).read_bytes(),raw)
        self.assertEqual(self.admin.request('GET','/mygrain/api/dfeeder/list')[1]['files'],[])
    def test_validation_and_source_quality_guards(self):
        for body in [{'count':0},{'count':True},{'count':101},{'bpm':67},{'bpm':179},{'bpm':100.2},{'ownerId':'x'},{'directory':'../'}]:
            with self.subTest(body=body):self.assertEqual(self.admin.request('POST','/mygrain/api/dfeeder/generate',data=body)[0],400)
        self.assertEqual(D.options({'count':3,'bpm':68}),(3,68));self.assertEqual(D.options({}),(10,None))
        for name in ['../x.wav','/x.wav','.jobs/x.json','a/b.wav']:
            self.assertIn(self.admin.request('POST','/mygrain/api/dfeeder/approve',data={'filename':name})[0],(400,404))
        name,raw=self.candidate();meta=L.read_metadata(D.ROOT,name)
        (D.ROOT/name).write_bytes(raw[:-1]+b'x')
        self.assertEqual(self.admin.request('POST','/mygrain/api/dfeeder/approve',data={'filename':name})[0],400)
        self.assertTrue((D.ROOT/name).exists())
        for changes in [{'layers':['osc']},{'quality':'low'},{'steps':16},{'drums':False}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                D.publish(D.ROOT,{'id':'c'*32,'count':1,'bpms':[68]},dict(index=0,bpm=68,steps=64,quality='full',layers=['bastarda'],drums=True,**{k:v for k,v in changes.items() if k not in ('steps','quality','layers','drums')})|changes,L)
    def test_mode_and_key_guards(self):
        for body in [{'mode':'unknown'},{'mode':[]},{'mode':'loop','key':'C'},{'mode':'drone','key':'H'}]:
            with self.subTest(body=body),self.assertRaises(ValueError):D.options(body)
        self.assertEqual(D.options({'mode':'drone','key':'C#','bpm':120}),(10,120))
        base=dict(index=0,bpm=68,steps=64,quality='full',layers=['bastarde'],drums=False,peak=1,rms=.1,mode='ember',recipes={'ember':{'level':.4}})
        for mode,changes in [('loop',{'drums':True,'layers':['bastarde','enemy']}),('loop',{'drums':True,'drumLevels':{'cymbals':.4}}),('ember',{'drums':True}),('ember',{'recipes':{'ember':{'level':1}}}),('drone',{'layers':['enemy'],'mode':'drone','key':'C#','recipes':{'enemy':{'transpose':0,'voices':[{'note':49}]*8*7+[{'note':62}]}}}),('drone',{'layers':['enemy'],'mode':'drone','key':'C#','recipes':{'enemy':{'transpose':7,'voices':[{'note':49}]*8}}}),('drone',{'layers':['enemy'],'mode':'drone','key':'C#','recipes':{'enemy':{'transpose':0,'voices':[{'note':49,'fine':1}]*8}}})]:
            with self.subTest(mode=mode,changes=changes),self.assertRaises(ValueError):
                D.publish(D.ROOT,dict(id='e'*32,count=1,bpms=[68],mode=mode,key='C#' if mode=='drone' else 'random'),base|changes,L)
    def test_drone_chord_options_and_degree_guard(self):
        for chord in D.DRONE_CHORDS:
            for octaves in (1,2,3,4):
                self.assertEqual(D.options(dict(mode='drone',key='F#',chord=chord,octaves=octaves)),(10,None))
        for body in [dict(chord='unknown'),dict(chord=[]),dict(octaves=True),dict(octaves=0),dict(octaves=5),dict(octaves='2')]:
            with self.subTest(body=body),self.assertRaises(ValueError):D.options(dict(mode='drone',**body))
        with self.assertRaises(ValueError):D.options(dict(mode='loop',chord='major'))
        job=dict(id='7'*32,count=1,bpms=[178],mode='drone',key='C',chord='major',octaves=2)
        voices=[dict(note=36,fine=0,on=True,level=.5)]*8
        item=dict(index=0,bpm=178,steps=64,quality='full',layers=['enemy'],drums=False,mode='drone',key='C',chord='major',octaves=2,peak=1,rms=.1,recipes=dict(enemy=dict(transpose=0,voices=voices)))
        with self.assertRaisesRegex(ValueError,'cover the chosen'):
            D.publish(D.ROOT,job,item,L)
        voices=[dict(note=36+[0,4,7][i%3]+12*(i%2),fine=0,on=True,level=.5) for i in range(8)]
        item['recipes']['enemy']['voices']=voices
        with self.assertRaisesRegex(ValueError,'Rendered sample missing'):
            D.publish(D.ROOT,job,item,L)
        voices[0]['note']=60
        with self.assertRaisesRegex(ValueError,'cover the chosen'):
            D.publish(D.ROOT,job,item,L)

    def test_restructure_post_effect_publication_guard(self):
        name,raw=self.candidate(ident='9'*32)
        root=D.ROOT;ident='8'*32;job=dict(id=ident,count=1,bpms=[178],mode='native',ownerId=self.accounts.lookup_user('admin')['id'],username='admin')
        pending=D.safe_dir(root/'.pending'/ident);(pending/'0000.wav').write_bytes(raw)
        metric=lambda lufs,peak:dict(lufs=lufs,peak=peak,rms=.03,frames=48000)
        drums=metric(-20,.4);source=metric(-24,.3)
        rb=dict(status='balanced',sourceTap='post-fx',referenceTap='post-fx',targetLu=0,gain=.5,startLevel=.7,effectiveLevel=.35,drums=drums,restructure=source,verified=dict(drums=drums,restructure=source))
        item=dict(index=0,bpm=178,steps=64,quality='full',layers=['dropbox'],drums=True,peak=1,rms=.1,sampleRate=48000,balance=dict(restructure=rb))
        import copy
        for change in [dict(sourceTap='pre-fx'),dict(gain=1.1),dict(startLevel=.88),dict(effectiveLevel=.5),dict(verified=dict(drums=drums,restructure=metric(-18,.3))),dict(verified=dict(drums=drums,restructure=metric(-24,.6)))]:
            broken=copy.deepcopy(item);broken['balance']['restructure'].update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):D.publish(root,job,broken,L)
        self.assertTrue((pending/'0000.wav').exists())
        saved=D.publish(root,job,item,L);self.assertEqual((root/saved).read_bytes(),raw)
    def test_job_restart_and_concurrency(self):
        root=D.safe_dir(D.ROOT);ident='d'*32
        row=dict(id=ident,state='running',count=10,completed=3,createdAt=time.time(),message='Working')
        D.atomic_json(D.job_path(root,ident),row)
        self.assertEqual(D.read_jobs(root)[0]['state'],'interrupted')
        row['state']='running';D.RUNNING[ident]=None;D.atomic_json(D.job_path(root,ident),row)
        try:
            self.assertEqual(self.admin.request('POST','/mygrain/api/dfeeder/generate',data={'count':10})[0],409)
        finally:D.RUNNING.pop(ident)
    def test_concurrent_approve_and_static_boundary(self):
        name,raw=self.candidate()
        user=self.accounts.lookup_user('admin')
        def approve():
            try:return D.review(D.ROOT,name,user,True,L,SERVER._accounts_module.checked_path)
            except FileNotFoundError:return None
        with ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(lambda _:approve(),range(2)))
        self.assertEqual(sum(r is not None for r in result),1);self.assertEqual(len(list(L.ROOT.glob('*.wav'))),1)
        for path in ['/mygrain/backend/mygrain_dfeeder.py','/mygrain/scripts/dfeeder-worker.cjs','/mygrain/SAMPLES_DFEEDER/.jobs/x.json']:
            self.assertNotEqual(self.anonymous.request('GET',path)[0],200)
        for path in ['/mygrain/dfeeder.js','/mygrain/dfeeder.css']:
            self.assertEqual(self.anonymous.request('GET',path)[0],200)

# Do not accidentally inherit the entire account suite in this focused class.
for name in list(AccountHTTPTests.__dict__):
    if name.startswith('test_') and name not in DfeederTests.__dict__:setattr(DfeederTests,name,None)
def load_tests(loader, tests, pattern):return loader.loadTestsFromTestCase(DfeederTests)
if __name__=='__main__':unittest.main()
