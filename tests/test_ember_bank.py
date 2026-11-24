"""Every factory recipe goes through the production strict Song validator."""
import copy,json,pathlib,subprocess,sys,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import test_ember as e
PRESETS=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require(process.argv[1]).PRESETS))",str(ROOT/'ember-dsp.js')]))
class EmberBank(unittest.TestCase):
 def test_all_recipes_accepted_and_legacy_off_identity_retained(self):
  old=e.s.validate_part_zip(e.fixtures.part_zip())
  for p in PRESETS:
   settings=copy.deepcopy(p['settings']);original=copy.deepcopy(settings)
   e.s.validate_ember(settings);self.assertEqual(settings,original)
   self.assertEqual(old,e.s.validate_part_zip(e.body(settings)),p['id'])
   settings['enabled']=True;value=e.s.validate_part_zip(e.body(settings));self.assertEqual(value['emberVersion'],9,p['id'])
if __name__=='__main__':unittest.main()
