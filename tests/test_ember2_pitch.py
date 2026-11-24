import copy,json,pathlib,subprocess,types,os,unittest
import test_ember as E
ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT="const fs=require('fs'),vm=require('vm'),context=vm.createContext({});for(const file of ['ember-dsp.js','ember2-dsp.js'])vm.runInContext(fs.readFileSync(process.argv[1]+'/'+file,'utf8'),context);console.log(JSON.stringify(context.MygrainEmber.defaults()));"
BASE=json.loads(subprocess.check_output(['node','-e',SCRIPT,str(ROOT)]));BASE['enabled']=True
class GlobalPitch(unittest.TestCase):
 def pitched(self,semitones=12,mode='keep'):
  return dict(copy.deepcopy(BASE),pitch={'semitones':semitones,'mode':mode})
 def test_selective_capability_and_neutral_identity(self):
  previous=types.ModuleType('pre_pitch');previous.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),previous.__file__,'exec'),previous.__dict__)
  for mode in ['keep','speed']:
   for semitones in [-24,-1,1,24]:self.assertEqual(E.s.validate_part_zip(E.body(self.pitched(semitones,mode)))['emberVersion'],30)
   for extras in [{},{'sampleDecay':.6},{'stepLoop':{'enabled':True,'start':3,'end':7}},{'sampleSource':dict(BASE['sampleSource'],voiceSeeds=[None,761,None,None])}]:
    state=dict(copy.deepcopy(BASE),**extras);expected=previous.validate_part_zip(E.body(state));self.assertEqual(E.s.validate_part_zip(E.body(state)),expected);state['pitch']={'semitones':0,'mode':mode};self.assertEqual(E.s.validate_part_zip(E.body(state)),expected)
  self.assertEqual(E.s.validate_part_zip(E.body(dict(self.pitched(),enabled=False))),E.s.validate_part_zip(E.body(dict(BASE,enabled=False))))
 def test_strict_schema(self):
  for pitch in [None,{},[],{'semitones':True,'mode':'keep'},{'semitones':1.5,'mode':'keep'},{'semitones':25,'mode':'keep'},{'semitones':-25,'mode':'keep'},{'semitones':float('nan'),'mode':'keep'},{'semitones':1,'mode':'other'},{'semitones':1,'mode':'keep','extra':0}]:
   with self.subTest(pitch=pitch):
    with self.assertRaises(ValueError):E.s.validate_ember(dict(BASE,pitch=pitch))
 def test_stale_admission_and_immutable_sources(self):
  fixture=E.fixtures.SongBackendTests();fixture.setUp()
  try:
   song=fixture.create();source=E.body(self.pitched());response=fixture.request('POST',f'/api/songs/{song["id"]}/parts?name=Pitch',body=source);self.assertEqual(response.status,201)
   part=response.response['song']['parts'][0];revision=response.response['song']['revision'];self.assertEqual(part['emberVersion'],30)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}';wave=E.fixtures.render_wav(part);query=f'/render?sha256={part["sha256"]}'
   self.assertEqual(fixture.request('POST',url+query+'&ember=29',body=wave).status,400);self.assertEqual(fixture.request('POST',url+query+'&ember=30',body=wave).status,200);self.assertEqual(fixture.request('GET',url).wfile.getvalue(),source)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));self.assertEqual(stored['revision'],revision);stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=29;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(fixture.request('GET',url+'/render').status,404);self.assertEqual(fixture.request('POST',url+query+'&ember=29',body=wave).status,400);self.assertEqual(fixture.request('GET',url).wfile.getvalue(),source)
  finally:fixture.tearDown()
if __name__=='__main__':unittest.main()
