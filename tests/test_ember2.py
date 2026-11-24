import copy,json,pathlib,subprocess,sys,types,unittest,os
import test_ember as E
ROOT=pathlib.Path(__file__).resolve().parents[1]
js="const fs=require('fs'),vm=require('vm'),c=vm.createContext({});for(const f of ['ember-dsp.js','ember2-dsp.js'])vm.runInContext(fs.readFileSync(process.argv[1]+'/'+f,'utf8'),c);console.log(JSON.stringify({recipe:c.MygrainEmber.defaults(),bank:c.MygrainEmber.PRESETS,random:Array.from({length:32},(_,i)=>c.MygrainEmber.randomPatch(c.MygrainEmber.defaults(),i*3191+1))}));"
DATA=json.loads(subprocess.check_output(['node','-e',js,str(ROOT)]));recipe=DATA['recipe']
class Ember2Backend(unittest.TestCase):
 def test_canonical_bank_random_and_selective_off_identity(self):
  blank=E.s.validate_part_zip(E.fixtures.part_zip())
  self.assertEqual(E.s.validate_part_zip(E.body(recipe)),blank)
  for v in [p['settings'] for p in DATA['bank']]+DATA['random']:
   E.s.validate_ember(v);active=dict(v,enabled=True);details=E.s.validate_part_zip(E.body(active));self.assertEqual(details['emberVersion'],26)
   self.assertNotEqual(details['contentSha256'],blank['contentSha256'])
  self.assertEqual(E.s.validate_part_zip(E.body(dict(recipe,enabled=True,level=0))),blank)
  empty=copy.deepcopy(recipe);empty['enabled']=True
  for voice in empty['voices']:voice['pattern']=[0]*16
  self.assertEqual(E.s.validate_part_zip(E.body(empty)),blank)
 def test_old_pulse_v2_identity_exact(self):
  old=types.ModuleType('ember_sample_before');old.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),old.__file__,'exec'),old.__dict__)
  for patch in DATA['bank'][:24]:
   v=dict(patch['settings'],enabled=True);v.pop('sampleSource');v.pop('engineRevision');v.pop('clockDivider');self.assertEqual(E.s.validate_part_zip(E.body(v)),old.validate_part_zip(E.body(v)))
 def test_previous_sample_snapshots_identity_exact(self):
  old=types.ModuleType('ember_previous_sample');old.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),old.__file__,'exec'),old.__dict__)
  for recipe in json.loads((pathlib.Path(os.environ['TASK'])/'evidence/before-recipes.json').read_text()):
   v=dict(recipe,enabled=True);a=E.s.validate_part_zip(E.body(v));self.assertEqual(a,old.validate_part_zip(E.body(v)));self.assertEqual(a['emberVersion'],25)
   older=copy.deepcopy(v);older['engineRevision']=2;self.assertEqual(E.s.validate_part_zip(E.body(older)),old.validate_part_zip(E.body(older)));self.assertEqual(E.s.validate_part_zip(E.body(older))['emberVersion'],24)
   v.pop('engineRevision');v.pop('clockDivider');v['sampleSource'].pop('frames',None);self.assertEqual(E.s.validate_part_zip(E.body(v)),old.validate_part_zip(E.body(v)))
 def test_sample_seed_is_canonical_audible_content(self):
  a=copy.deepcopy(recipe);a['enabled']=True;b=copy.deepcopy(a);b['sampleSource']['seed']+=1
  self.assertNotEqual(E.s.validate_part_zip(E.body(a))['contentSha256'],E.s.validate_part_zip(E.body(b))['contentSha256'])
 def test_malformed_rejected_without_legacy_conversion(self):
  cases=[]
  for path,value in [('seed',float('nan')),('seed',1.5),('version',2.0),('enabled',1),('tempo',999),('matrix',[[0]*4]*3),('voices',[]),('engineRevision',1),('engineRevision',True),('clockDivider',0),('clockDivider',5),('clockDivider',True),('swing',.1)]:
   v=copy.deepcopy(recipe);v[path]=value;cases.append(v)
  for group,key,value in [('lfo','beats',.7),('lfo','shape','freeHz'),('filter','cutoff',float('inf')),('reverb','decay',1),('filter','resonance',True)]:
   v=copy.deepcopy(recipe);v['voices'][0][group][key]=value;cases.append(v)
  v=copy.deepcopy(recipe);v['matrix'][0][0]=.5;cases.append(v)
  v=copy.deepcopy(recipe);v['voices'][0]['pattern'][0]=1.1;cases.append(v)
  for source in [None,{}, {'version':3,'seed':1},{'version':1,'seed':0},{'version':1,'seed':1.5},{'version':1,'seed':True},{'version':1,'seed':1,'extra':0}, {'version':1,'seed':1,'frames':15}, {'version':1,'seed':1,'frames':True}, {'version':1,'seed':1,'frames':384001}, {'version':1,'seed':1,'frames':17.5}]:
   v=copy.deepcopy(recipe);v['sampleSource']=source;cases.append(v)
  for v in cases:
   with self.subTest(value=v):
    with self.assertRaises(ValueError):E.s.validate_ember(v)
 def test_legacy_snapshot_identities_remain_exact(self):
  before=pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py'
  old=types.ModuleType('ember2_before');old.__file__=E.s.__file__;exec(compile(before.read_text(),old.__file__,'exec'),old.__dict__)
  for v in [E.recipe,dict(E.recipe,enabled=True),dict(E.recipe,enabled=True,crossMod=[True]*5,crossModDepth=.7),dict(E.recipe,enabled=True,oscDivider=6,pulseDivider=14)]:
   self.assertEqual(E.s.validate_part_zip(E.body(v)),old.validate_part_zip(E.body(v)))
 def test_server_admission_source_immutable_and_warm_reuse(self):
  f=E.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=E.body(dict(recipe,enabled=True));url=f'/api/songs/{song["id"]}'
   added=f.request('POST',url+'/parts?name=Ember2',body=source);self.assertEqual(added.status,201);part=added.response['song']['parts'][0];self.assertEqual(part['emberVersion'],26)
   url+=f'/parts/{part["id"]}';query=f'/render?sha256={part["sha256"]}';wav=E.fixtures.render_wav(part)
   for revision in ['', '1','8','13','19','20','21','22','23','24','25']:
    self.assertEqual(f.request('POST',url+query+'&ember='+revision,body=wav).status,400)
   done=f.request('POST',url+query+'&ember=26',body=wav);self.assertEqual(done.status,200);revision=done.response['song']['revision']
   self.assertEqual(f.request('GET',url+'/render').wfile.getvalue(),wav)
   self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=21;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(f.request('GET',url+'/render').status,404)
   again=f.request('POST',url+query+'&ember=26',body=wav);self.assertEqual(again.status,200);self.assertEqual(again.response['song']['revision'],revision)
   self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
