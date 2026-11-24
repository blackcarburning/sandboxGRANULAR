"""Ember private patch persistence and selective EQ Song compatibility."""
import copy,importlib.util,io,json,pathlib,tempfile,threading,types,unittest
from unittest.mock import patch
import test_ember as E
import test_channel_eq as C
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/'backend'/f'{name}.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
LIB=load('mygrain_ember_patches');ACCOUNTS=load('mygrain_accounts')
class EmberPatchLibrary(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
  self.accounts=types.SimpleNamespace(users_root=self.root,user_lock=lambda user:threading.RLock());self.user={'id':'a'*32};self.other={'id':'b'*32}
  eq=C.EQ.channel();point=copy.deepcopy(eq);point['enabled']=True;point['bands'][1].update(gain=-18,frequency=220)
  eq['automation']={'version':1,'read':True,'steps':32,'points':[{'phase':0,**point},{'phase':1,**point}]}
  self.settings={'version':1,'ember':dict(E.recipe,enabled=True,level=.37,tempo=91,pulseWidths=[.00005]*6,crossMod=[True]*5,crossModDepth=.89),'eq':eq}
 def request(self,method='GET',payload=None,user=None):
  body=json.dumps(payload).encode() if payload is not None else b''
  class H:
   def send_json(h,value,status=200,extra_headers=None):h.result=(status,value,extra_headers)
  h=H();h.headers={'Content-Length':str(len(body)),'Content-Type':'application/json'};h.rfile=io.BytesIO(body)
  LIB.handle_request(h,method,self.accounts,user or self.user,ACCOUNTS.checked_path,E.s.validate_ember,C.EQ.channel);return h.result
 def save(self,name='Copper tide',revision=0):return self.request('POST',{'action':'save','name':name,'revision':revision,'settings':self.settings})
 def test_full_recipe_eq_completed_curve_roundtrip_and_account_isolation(self):
  status,d,headers=self.save();self.assertEqual(status,200);self.assertEqual(headers['Cache-Control'],'private, no-store');expected=copy.deepcopy(self.settings);expected['ember']['enabled']=False
  self.assertEqual(d['patches'][0]['settings'],expected);self.assertEqual(self.request()[1]['patches'],d['patches']);self.assertEqual(self.request(user=self.other)[1]['patches'],[])
  self.assertEqual(self.request('POST',{'action':'delete','id':d['selectedId'],'revision':0},self.other)[0],404)
  p=LIB.location(self.accounts,self.user,ACCOUNTS.checked_path);self.assertEqual(p.stat().st_mode&0o777,0o600);self.assertIn('ember-patches',str(p))
 def test_revision_duplicate_rename_replace_and_delete(self):
  _,d,_=self.save();pid=d['selectedId'];self.assertEqual(self.save('Other',0)[0],409);self.assertEqual(self.save('COPPER TIDE',1)[0],400)
  _,d,_=self.request('POST',{'action':'rename','id':pid,'name':'Inverse coal','revision':1});self.assertEqual(d['patches'][0]['name'],'Inverse coal')
  self.settings['eq']['manualBypass']=True;self.settings['ember']['tone']=.8
  status,d,_=self.request('POST',{'action':'replace','id':pid,'settings':self.settings,'revision':2});self.assertEqual(status,200);self.assertEqual(d['patches'][0]['settings']['ember']['tone'],.8);self.assertTrue(d['patches'][0]['settings']['eq']['manualBypass'])
  self.assertEqual(self.request('POST',{'action':'delete','id':pid,'revision':3})[1]['patches'],[])
 def test_malformed_ember_eq_automation_and_names_do_not_create_library(self):
  base=copy.deepcopy(self.settings)
  bad=[]
  for field,value in [('level',float('nan')),('pulseWidths',[1]),('crossMod',[True])]:
   p=copy.deepcopy(base);p['ember'][field]=value;bad.append(p)
  for field,value in [('bands',[]),('automation',{'version':1,'read':True,'points':[{'phase':.5}]})]:
   p=copy.deepcopy(base);p['eq'][field]=value;bad.append(p)
  for value in bad:self.settings=value;self.assertEqual(self.save()[0],400)
  self.settings=base
  for name in ['', 'x'*81, 'bad\nname', 'bad'+chr(127)]:self.assertEqual(self.save(name)[0],400)
  self.assertEqual(self.request()[1]['revision'],0)
 def test_atomic_failure_and_corruption_preserve_original_bytes(self):
  self.save();p=LIB.location(self.accounts,self.user,ACCOUNTS.checked_path);before=p.read_bytes()
  with patch.object(LIB.os,'replace',side_effect=OSError('disk full')):self.assertEqual(self.save('Second',1)[0],500)
  self.assertEqual(p.read_bytes(),before);p.write_text('broken');self.assertEqual(self.save('Second',1)[0],500);self.assertEqual(p.read_text(),'broken')
  p.unlink();p.symlink_to(self.root/'elsewhere');self.assertRaises(ValueError,LIB.location,self.accounts,self.user,ACCOUNTS.checked_path)
class EmberEqVersion(unittest.TestCase):
 def archive(self,eq,ember=None):return C.replace_eq(E.body(dict(E.recipe,enabled=True) if ember is None else ember),{'version':1,'channels':{'E':eq}})
 def test_static_read_bypass_and_inaudible_source_capabilities(self):
  eq=C.EQ.channel();point=copy.deepcopy(eq);point['enabled']=True;point['bands'][0]['gain']=-18
  dry=E.s.validate_part_zip(self.archive(eq));self.assertNotIn('eqVersion',dry)
  self.assertEqual(E.s.validate_part_zip(self.archive(point))['eqVersion'],4)
  eq['automation']={'version':1,'read':True,'steps':16,'points':[{'phase':0,**point},{'phase':1,**point}]}
  read=E.s.validate_part_zip(self.archive(eq));self.assertEqual(read['eqVersion'],4);self.assertNotEqual(read['contentSha256'],dry['contentSha256'])
  off=copy.deepcopy(eq);off['manualBypass']=True;self.assertEqual(E.s.validate_part_zip(self.archive(off)),dry)
  for settings in [dict(E.recipe,enabled=False),dict(E.recipe,enabled=True,level=0),dict(E.recipe,enabled=True,cables=[])]:
   self.assertEqual(E.s.validate_part_zip(self.archive(eq,settings)),E.s.validate_part_zip(self.archive(C.EQ.channel(),settings)))
 def test_new_upload_version_admission_and_old_raw_snapshot_get_guard(self):
  f=C.backend.SongBackendTests();f.setUp()
  try:
   eq=C.EQ.channel();eq['enabled']=True;eq['bands'][0]['gain']=-18
   song=f.create();base=f'/api/songs/{song["id"]}';song=f.request('POST',base+'/parts?name=Eeq',body=self.archive(eq)).response['song'];part=song['parts'][0];url=base+f'/parts/{part["id"]}/render?sha256={part["sha256"]}&ember=8'
   for version in ('','1','2','3'):self.assertEqual(f.request('POST',url+'&channeleq='+version,body=C.backend.render_wav(part)).status,400)
   reply=f.request('POST',url+'&channeleq=4',body=C.backend.render_wav(part));self.assertEqual(reply.status,200);self.assertEqual(reply.response['song']['parts'][0]['render']['channelEqVersion'],4)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('eqVersion',None);stored['parts'][0]['render']['channelEqVersion']=3;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(f.request('GET',url.split('?')[0]).status,404);self.assertEqual(f.request('POST',url+'&channeleq=3',body=C.backend.render_wav(part)).status,400)
   refreshed=f.request('POST',url+'&channeleq=4',body=C.backend.render_wav(part));self.assertEqual(refreshed.status,200);self.assertEqual(refreshed.response['song']['revision'],revision)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
