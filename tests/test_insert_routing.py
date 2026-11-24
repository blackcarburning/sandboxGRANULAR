"""Source-owned inserts: selective capabilities, canonical mixes and original ZIPs."""
import copy,importlib.util,json,os,pathlib,subprocess,unittest
from test_song_backend import part_zip,rewrite_part,SongBackendTests,render_wav
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
songs=load('insert_songs',ROOT/'backend/mygrain_songs.py');old=load('insert_before',os.environ['MYGRAIN_BASELINE_BACKEND'])
KEYS=list(songs.COOKING_POT_KEYS)
def body(modes):return rewrite_part(part_zip(),lambda m:m['state']['modes'].update(copy.deepcopy(modes)))
def pot(**extra):return dict(version=1,enabled=False,order=KEYS,**extra)
class InsertIdentity(unittest.TestCase):
 def test_off_legacy_identity(self):
  for modes in [{},{'cookingPot':pot(mixes={'wireWorld':.3})},{'bassFace':{'enabled':False,'input':'A','amount':.7,'mix':.8}}]:
   value=body(modes);self.assertEqual(songs.validate_part_zip(value),old.validate_part_zip(value))
 def test_power_owns_even_zero_level_with_legacy_pot_off(self):
  for enabled in [False,True]:
   for level in [0,.7]:
    modes={'wireWorld':{'version':1,'enabled':True,'source':'A','level':level},'cookingPot':{**pot(),'enabled':enabled}}
    self.assertEqual(songs.validate_part_zip(body(modes))['cookingPotVersion'],4)
    js=int(subprocess.check_output(['node','-e',"console.log(require('./cooking-pot-model.js').renderVersion(JSON.parse(process.argv[1])))",json.dumps(modes)],cwd=ROOT));self.assertEqual(js,4)
 def test_daw_only_omitted(self):
  self.assertEqual(songs.cooking_pot_render_version({'modes':{'bassFace':{'enabled':True,'input':'DAW'}}}),0)
 def test_active_balance_is_hashed_and_inactive_is_not(self):
  modes={'wireWorld':{'version':1,'enabled':True,'source':'A','level':.6},'cookingPot':pot(mixes={'wireWorld':.2})};value=body(modes);before=bytes(value);a=songs.validate_part_zip(value);self.assertEqual(value,before)
  modes['cookingPot']['mixes']['wireWorld']=.8;b=songs.validate_part_zip(body(modes));self.assertNotEqual(a['contentSha256'],b['contentSha256'])
  modes['cookingPot']['mixes']['turntable']=.2;self.assertEqual(b,songs.validate_part_zip(body(modes)))
 def test_strict_balances(self):
  for v in [[],{'unknown':.5},{'wireWorld':True},{'wireWorld':-1},{'wireWorld':1.1},{'wireWorld':'1'},{'bassFace':.5}]:
   with self.subTest(v=v),self.assertRaises(ValueError):songs.validate_part_zip(body({'cookingPot':pot(mixes=v)}))
class InsertAdmission(SongBackendTests):
 def test_insert_v4_admission(self):
  song=self.create();value=body({'bassFace':{'enabled':True,'input':'A','amount':.4,'mix':.5}})
  response=self.request('POST',f'/api/songs/{song["id"]}/parts?name=Insert&repeats=1',body=value);self.assertEqual(response.status,201);song=response.response['song'];part=song['parts'][0];self.assertEqual(part['cookingPotVersion'],4)
  path=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&unifiedinputs=3&characterfx=1&effectoutput=5&acousticfx=9&loopfx=1&channeleq=3&samplecuts=1'
  for cap in ['', '&cookingpot=1','&cookingpot=2','&cookingpot=3']:
   self.assertEqual(self.request('POST',path+cap,body=render_wav(part)).status,400)
  response=self.request('POST',path+'&cookingpot=4',body=render_wav(part));self.assertEqual(response.status,200);self.assertEqual(response.response['song']['revision'],song['revision']);self.assertEqual(response.response['song']['parts'][0]['sha256'],part['sha256'])
if __name__=='__main__':unittest.main()
