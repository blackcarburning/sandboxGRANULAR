"""Eight-lane schemas, selective render capability and archived render identity."""
import copy,json,pathlib,subprocess,sys,types,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
import mygrain_songs as songs
JS="""const fs=require('fs'),vm=require('vm');global.window=global;global.addEventListener=()=>{};for(const f of ['ember-dsp.js','ember2-dsp.js','restructure-dsp.js'])vm.runInThisContext(fs.readFileSync(process.argv[1]+'/'+f,'utf8'));console.log(JSON.stringify({defaults:MygrainRestructure.defaults(),recipes:MygrainRestructure.PRESETS.map(x=>x.settings),ember:MygrainEmber.defaults()}));"""
DATA=json.loads(subprocess.check_output(['node','-e',JS,str(ROOT)]))
class RestructureEight(unittest.TestCase):
 def test_current_recipes(self):
  for model in [DATA['defaults']]+DATA['recipes']:
   songs.validate_restructure(model)
   self.assertEqual(len(model['voices']),8)
   self.assertEqual(model['sampleSource']['source'],'samples_public')
   self.assertTrue(all(v['reverb']['mix']==0 for v in model['voices']))
 def test_selective_capability(self):
  active=copy.deepcopy(DATA['defaults']);active['enabled']=True
  self.assertEqual(songs.ember_render_version({'modes':{'restructure':active}}),31)
  self.assertEqual(songs.ember_only_render_version({'modes':{'restructure':active}}),0)
  active['enabled']=False
  self.assertEqual(songs.ember_render_version({'modes':{'restructure':active}}),0)
  old=copy.deepcopy(DATA['ember']);old['enabled']=True
  self.assertEqual(songs.ember_render_version({'modes':{'ember':old}}),26)
 def test_bad_sources_dimensions_and_individual_rooms(self):
  for mutate in [lambda m:m['sampleSource'].update(source='SAMPLES_INDUSTRY'),lambda m:m['sampleSource'].update(url='https://example.com/audio'),lambda m:m['voices'].pop(),lambda m:m['matrix'][7].pop(),lambda m:m['spring'].update(decay=1.2),lambda m:m['voices'][7]['reverb'].update(mix=.2)]:
   model=copy.deepcopy(DATA['defaults']);mutate(model)
   with self.assertRaises(ValueError):songs.validate_restructure(model)
 def test_frozen_corpus_integrity(self):
  import hashlib
  catalogue=json.loads((ROOT/'restructure-catalog.json').read_text())
  self.assertEqual(catalogue['source'],'samples_public');self.assertGreaterEqual(len(catalogue['records']),8)
  ids=set()
  for row in catalogue['records']:
   self.assertNotIn(row['id'],ids);ids.add(row['id'])
   path=(ROOT.parent/'samples_public'/row['file']).resolve();path.relative_to((ROOT.parent/'samples_public').resolve())
   self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),row['originalSha256'])
   for i,chunk in enumerate(row['chunks']):
    body=(ROOT/'restructure-corpus-v1'/row['id']/(str(i)+'.pcm')).read_bytes()
    self.assertEqual(len(body),chunk['frames']*2);self.assertEqual(hashlib.sha256(body).hexdigest(),chunk['sha256'])
if __name__=='__main__':unittest.main()
