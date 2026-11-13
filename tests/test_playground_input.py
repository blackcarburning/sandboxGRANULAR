import pathlib,unittest,copy,json,subprocess
from test_song_backend import SONGS as songs, rewrite_part, part_zip
root=pathlib.Path(__file__).resolve().parents[1]
class InputTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.settings=json.loads(subprocess.check_output(['node','-e',"const w=require('./wasp-dsp.js');console.log(JSON.stringify(w.normalize()))"],cwd=root))
 def details(self,s):return songs.validate_part_zip(rewrite_part(part_zip(),lambda m:m['state']['modes'].update(wasp=s)))
 def test_input_validation_and_targeted_version(self):
  s=copy.deepcopy(self.settings);s['playground']['enabled']=True
  legacy=self.details(s);s['playground']['input']='all';self.assertEqual(self.details(s)['contentSha256'],legacy['contentSha256'])
  for k in ['A','D','K','K5','drums','drumKick','N','DAW']:
   s['playground']['input']=k;new=self.details(s);self.assertEqual(new['playgroundVersion'],3);self.assertNotEqual(new['contentSha256'],legacy['contentSha256'])
  for k in ['off','drawn','unknown',[],None,3]:
   s['playground']['input']=k
   with self.assertRaises(ValueError):songs.validate_wasp(s)
 def test_disabled_input_keeps_legacy_hash(self):
  s=copy.deepcopy(self.settings);s['enabled']=True;legacy=self.details(s)['contentSha256'];s['playground']['input']='A';self.assertEqual(self.details(s)['contentSha256'],legacy)

if __name__ == '__main__': unittest.main()
