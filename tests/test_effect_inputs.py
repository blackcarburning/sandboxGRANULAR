from pathlib import Path
import copy, json, subprocess, unittest
from test_song_backend import SONGS as songs, part_zip, rewrite_part
import test_song_backend
class UnifiedTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.all=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify({tt:require('./turntable-dsp.js').defaults(),w:require('./wasp-dsp.js').normalize(),r:require('./resonator-dsp.js').normalize(),bass:require('./character-fx.js').normalize(),inputs:require('./effect-inputs.js').SOURCES}))"],cwd=Path(__file__).resolve().parents[1]))
 def details(self,m):return songs.validate_part_zip(test_song_backend.rewrite_part(test_song_backend.part_zip(),lambda p:p['state']['modes'].update(m)))
 def test_inventory(self):self.assertEqual(list(songs.CHARACTER_INPUTS),self.all['inputs'])
 def test_all_inputs_validate(self):
  for input in self.all['inputs']:
   tt={**self.all['tt'],'input':input};songs.validate_turntable(tt)
   b={**self.all['bass'],'input':input};songs.validate_character_fx({'bassFace':b})
   w=copy.deepcopy(self.all['w']);w['routes'][0]['source']=input;songs.validate_wasp(w)
   r=copy.deepcopy(self.all['r']);r['slots'][0]['source']=input;songs.validate_resonator(r)
 def test_targeted_capability(self):
  for m in [{'bassFace':{**self.all['bass'],'enabled':True,'input':'all'}},{'loopD':{'enabled':False,'mutilator':{'enabled':True,'input':'all','amount':.5,'mix':.5}}},{'turntable':{**self.all['tt'],'enabled':True,'input':'K'}}]:
   d=self.details(m);self.assertEqual(d['unifiedInputsVersion'],1)
 def test_inactive_new_choices_keep_legacy_content(self):
  for key, settings in [('turntable', self.all['tt']), ('bassFace', self.all['bass'])]:
   legacy=self.details({key:settings})['contentSha256']
   for input in self.all['inputs']:
    self.assertEqual(self.details({key:{**settings,'input':input}})['contentSha256'],legacy)

if __name__ == '__main__': unittest.main()
