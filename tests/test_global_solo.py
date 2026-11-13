import importlib.util, pathlib, sys, unittest, os, json, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from test_song_backend import part_zip,rewrite_part

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
new=load('global_solo_songs',ROOT/'backend/mygrain_songs.py')
old=load('baseline_solo_songs',pathlib.Path(os.environ['MYGRAIN_BASELINE_BACKEND']))
class GlobalSolo(unittest.TestCase):
 def test_version_only_for_saved_solo_selections(self):
  for key,value in [('loopLayerSolo',['bastardd']),('grainLayerSolo',['A']),('sourceWaveformSolo',['generated']),('generatedSampleSolo',True),('drumMachineLaneSolos',['kick'])]:
   self.assertEqual(new.effect_output_render_version({'modes':{key:value}}),2)
  self.assertEqual(new.effect_output_render_version({'modes':{}},{'performanceSourceLayerSolo':['osc']}),2)
  for modes in [{},{'loopLayerSolo':'none'},{'grainLayerSolo':[]},{'generatedSampleSolo':False}]:
   self.assertEqual(new.effect_output_render_version({'modes':modes}),0)
 def test_unchanged_legacy_and_manual_effect_identities(self):
  turntable=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./turntable-dsp.js').normalize()))"],cwd=ROOT))
  acoustic=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./acoustic-fx-dsp.js').normalize('bubbleChamber',{enabled:true,source:'A',level:.11})))"],cwd=ROOT))
  for modes in [{},{'bubbleChamber':acoustic},{'turntable':turntable},{'loopLayerSolo':[],'grainLayerSolo':[],'generatedSampleSolo':False}]:
   body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(modes));self.assertEqual(old.validate_part_zip(body),new.validate_part_zip(body))
 def test_saved_source_solo_adds_only_targeted_render_revision(self):
  for key,value in [('loopLayerSolo',['bastardd']),('grainLayerSolo',['A']),('generatedSampleSolo',True),('drumMachineLaneSolos',['kick'])]:
   body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update({key:value}));a=old.validate_part_zip(body);b=new.validate_part_zip(body)
   self.assertEqual(b['effectOutputVersion'],2);self.assertNotEqual(a['contentSha256'],b['contentSha256']);self.assertEqual(a['audioAssets'],b['audioAssets'])
if __name__=='__main__':unittest.main()
