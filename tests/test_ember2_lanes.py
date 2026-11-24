import copy,json,pathlib,subprocess,types,os,unittest
import test_ember as E
R=pathlib.Path(__file__).resolve().parents[1]
js="const fs=require('fs'),vm=require('vm'),c=vm.createContext({});for(const f of ['ember-dsp.js','ember2-dsp.js'])vm.runInContext(fs.readFileSync(process.argv[1]+'/'+f,'utf8'),c);console.log(JSON.stringify(c.MygrainEmber.defaults()));"
base=json.loads(subprocess.check_output(['node','-e',js,str(R)]));base['enabled']=True
class Lanes(unittest.TestCase):
 def lane(self):
  s=copy.deepcopy(base);s['sampleSource']['voiceSeeds']=[None,761,None,None];return s
 def test_legacy_neutral_identity(self):
  old=types.ModuleType('old_lanes');old.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),old.__file__,'exec'),old.__dict__)
  for decay in [None,.6]:
   s=copy.deepcopy(base)
   if decay:s['sampleDecay']=decay
   expected=old.validate_part_zip(E.body(s));self.assertEqual(E.s.validate_part_zip(E.body(s)),expected)
   s['sampleSource']['voiceSeeds']=[None]*4;self.assertEqual(E.s.validate_part_zip(E.body(s)),expected)
 def test_capability_and_disabled_identity(self):
  s=self.lane();self.assertEqual(E.s.validate_part_zip(E.body(s))['emberVersion'],28)
  s['sampleDecay']=.6;self.assertEqual(E.s.validate_part_zip(E.body(s))['emberVersion'],28)
  s['enabled']=False;self.assertEqual(E.s.validate_part_zip(E.body(s)),E.s.validate_part_zip(E.body(dict(base,enabled=False))))
 def test_strict_validation(self):
  for seeds in [None,{},[],[1],[1]*5,[True,None,None,None],[0,None,None,None],[-1,None,None,None],[16777216,None,None,None],[1.5,None,None,None],['1',None,None,None]]:
   s=self.lane();s['sampleSource']['voiceSeeds']=seeds
   with self.assertRaises(ValueError):E.s.validate_ember(s)
  for key,value in [('version',1),('engineRevision',2)]:
   s=self.lane()
   if key=='version':s['sampleSource'][key]=value
   else:s[key]=value
   with self.assertRaises(ValueError):E.s.validate_ember(s)
  s=self.lane();s['sampleSource']['unexpected']=1
  with self.assertRaises(ValueError):E.s.validate_ember(s)
 def test_stale_admission_original_source_and_revision(self):
  f=E.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=E.body(self.lane());r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Lane',body=source);self.assertEqual(r.status,201);part=r.response['song']['parts'][0];revision=r.response['song']['revision'];self.assertEqual(part['emberVersion'],28)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}';wav=E.fixtures.render_wav(part);query=f'/render?sha256={part["sha256"]}'
   self.assertEqual(f.request('POST',url+query+'&ember=27',body=wav).status,400);self.assertEqual(f.request('POST',url+query+'&ember=28',body=wav).status,200);self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));self.assertEqual(stored['revision'],revision);stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=27;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(f.request('GET',url+'/render').status,404);self.assertEqual(f.request('POST',url+query+'&ember=27',body=wav).status,400);self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
