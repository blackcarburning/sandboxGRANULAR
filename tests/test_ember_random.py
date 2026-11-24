import unittest,subprocess,json,copy
from pathlib import Path
import test_ember as e
class EmberRandom(unittest.TestCase):
 def test_both_generated_modes_validate_and_retain_selective_capabilities(self):
  script="const M=require('./ember-dsp.js');console.log(JSON.stringify(['hz','bpm'].flatMap(mode=>Array.from({length:150},(_,i)=>({mode,value:M.randomPatch({...M.defaults(),enabled:true},Math.imul(i+1,0x9e3779b9)>>>0,mode)})))))"
  recipes=json.loads(subprocess.check_output(['node','-e',script],cwd=Path(__file__).resolve().parents[1]));self.assertEqual(len(recipes),300)
  for i,row in enumerate(recipes):
   v=row['value'];before=copy.deepcopy(v);e.s.validate_ember(v);state={'modes':{'ember':v}};self.assertEqual(e.s.ember_render_version(state),9);self.assertEqual(v,before)
   if i%15==0:self.assertEqual(e.s.validate_part_zip(e.body(v))['emberVersion'],9)
