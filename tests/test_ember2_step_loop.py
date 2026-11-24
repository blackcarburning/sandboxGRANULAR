import copy,json,pathlib,subprocess,types,os,unittest
import test_ember as E
ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT="const fs=require('fs'),vm=require('vm'),context=vm.createContext({});for(const file of ['ember-dsp.js','ember2-dsp.js'])vm.runInContext(fs.readFileSync(process.argv[1]+'/'+file,'utf8'),context);console.log(JSON.stringify(context.MygrainEmber.defaults()));"
BASE=json.loads(subprocess.check_output(['node','-e',SCRIPT,str(ROOT)]));BASE['enabled']=True
class StepLoop(unittest.TestCase):
 def loop(self):
  state=copy.deepcopy(BASE);state['stepLoop']={'enabled':True,'start':1,'end':7};return state
 def test_selective_capability(self):
  self.assertEqual(E.s.validate_part_zip(E.body(self.loop()))['emberVersion'],29)
  state=copy.deepcopy(BASE);state['sampleSource']['voiceSeeds']=[None,761,None,None]
  self.assertEqual(E.s.validate_part_zip(E.body(state))['emberVersion'],28)
  state['stepLoop']=self.loop()['stepLoop'];self.assertEqual(E.s.validate_part_zip(E.body(state))['emberVersion'],29)
 def test_legacy_and_neutral_identity(self):
  previous=types.ModuleType('pre_step_loop');previous.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),previous.__file__,'exec'),previous.__dict__)
  for decay in [None,.6]:
   state=copy.deepcopy(BASE)
   if decay:state['sampleDecay']=decay
   expected=previous.validate_part_zip(E.body(state));self.assertEqual(E.s.validate_part_zip(E.body(state)),expected)
   for loop in [{'enabled':False,'start':5,'end':9},{'enabled':True,'start':1,'end':16}]:
    state['stepLoop']=loop;self.assertEqual(E.s.validate_part_zip(E.body(state)),expected)
  state=self.loop();state['enabled']=False;self.assertEqual(E.s.validate_part_zip(E.body(state)),E.s.validate_part_zip(E.body(dict(BASE,enabled=False))))
 def test_only_in_range_hits_are_audible(self):
  state=self.loop();state['stepLoop']={'enabled':True,'start':2,'end':2}
  for voice in state['voices']:voice['pattern']=[1]+[0]*15
  self.assertEqual(E.s.ember_render_version({'modes':{'ember':state}}),0)
 def test_legacy_engine_neutral_loop(self):
  state=copy.deepcopy(BASE);state.pop('engineRevision');state.pop('clockDivider');state.pop('sampleSource');state['swing']=.15
  expected=E.s.validate_part_zip(E.body(state))
  for loop in [{'enabled':False,'start':5,'end':9},{'enabled':True,'start':1,'end':16}]:
   state['stepLoop']=loop;self.assertEqual(E.s.validate_part_zip(E.body(state)),expected)
  state['stepLoop']={'enabled':True,'start':5,'end':9}
  with self.assertRaises(ValueError):E.s.validate_ember(state)
 def test_strict_loop_schema(self):
  cases=[None,{},[],{'enabled':1,'start':1,'end':8},{'enabled':True,'start':True,'end':8},{'enabled':True,'start':0,'end':8},{'enabled':True,'start':1.5,'end':8},{'enabled':True,'start':9,'end':8},{'enabled':True,'start':1,'end':17},{'enabled':True,'start':1,'end':8,'extra':0}]
  for loop in cases:
   with self.subTest(loop=loop):
    state=self.loop();state['stepLoop']=loop
    with self.assertRaises(ValueError):E.s.validate_ember(state)
 def test_stale_admission_and_immutable_sources(self):
  fixture=E.fixtures.SongBackendTests();fixture.setUp()
  try:
   song=fixture.create();source=E.body(self.loop());response=fixture.request('POST',f'/api/songs/{song["id"]}/parts?name=Loop',body=source);self.assertEqual(response.status,201)
   part=response.response['song']['parts'][0];revision=response.response['song']['revision'];self.assertEqual(part['emberVersion'],29)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}';wave=E.fixtures.render_wav(part);query=f'/render?sha256={part["sha256"]}'
   self.assertEqual(fixture.request('POST',url+query+'&ember=28',body=wave).status,400);self.assertEqual(fixture.request('POST',url+query+'&ember=29',body=wave).status,200)
   self.assertEqual(fixture.request('GET',url).wfile.getvalue(),source)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));self.assertEqual(stored['revision'],revision);stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=28;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(fixture.request('GET',url+'/render').status,404);self.assertEqual(fixture.request('POST',url+query+'&ember=28',body=wave).status,400);self.assertEqual(fixture.request('GET',url).wfile.getvalue(),source)
  finally:fixture.tearDown()
if __name__=='__main__':unittest.main()
