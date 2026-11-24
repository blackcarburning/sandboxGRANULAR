import copy,json,pathlib,subprocess,sys,types,os,unittest
import test_ember as E
R=pathlib.Path(__file__).resolve().parents[1]
js="const fs=require('fs'),vm=require('vm'),c=vm.createContext({});for(const f of ['ember-dsp.js','ember2-dsp.js'])vm.runInContext(fs.readFileSync(process.argv[1]+'/'+f,'utf8'),c);console.log(JSON.stringify(c.MygrainEmber.defaults()));"
recipe=json.loads(subprocess.check_output(['node','-e',js,str(R)]));recipe['enabled']=True
class Decay(unittest.TestCase):
 def test_zero_legacy_content_exact(self):
  old=types.ModuleType('old_decay');old.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'before/backend/mygrain_songs.py').read_text(),old.__file__,'exec'),old.__dict__)
  self.assertEqual(E.s.validate_part_zip(E.body(recipe)),old.validate_part_zip(E.body(recipe)))
  self.assertEqual(E.s.validate_part_zip(E.body(dict(recipe,sampleDecay=0))),old.validate_part_zip(E.body(recipe)))
 def test_positive_and_invalid(self):
  a=E.s.validate_part_zip(E.body(dict(recipe,sampleDecay=.6)));self.assertEqual(a['emberVersion'],27)
  self.assertEqual(E.s.validate_part_zip(E.body(dict(recipe,sampleDecay=.6,enabled=False))),E.s.validate_part_zip(E.body(dict(recipe,enabled=False))))
  for v in [True,-.1,2.01,float('nan'),'1']:
   with self.assertRaises(ValueError):E.s.validate_ember(dict(recipe,sampleDecay=v))
 def test_render_admission_and_source_immutable(self):
  f=E.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=E.body(dict(recipe,sampleDecay=.6));r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Decay',body=source);self.assertEqual(r.status,201);part=r.response['song']['parts'][0];self.assertEqual(part['emberVersion'],27)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}';wav=E.fixtures.render_wav(part);query=f'/render?sha256={part["sha256"]}'
   self.assertEqual(f.request('POST',url+query+'&ember=26',body=wav).status,400)
   self.assertEqual(f.request('POST',url+query+'&ember=27',body=wav).status,200)
   self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
   folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=26;E.s.write_song(folder,stored,advance_revision=False)
   self.assertEqual(f.request('GET',url+'/render').status,404)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
