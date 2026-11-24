import copy,unittest,json,subprocess,types,os
from pathlib import Path
import test_ember as e
class EmberStrong(unittest.TestCase):
 def test_only_active_cross_mod_changes_identity(self):
  oldpath=Path(os.environ['TASK'])/'before/backend/mygrain_songs.py';old=types.ModuleType('old_strong_backend');old.__file__=str(Path(e.s.__file__));exec(compile(oldpath.read_text(),old.__file__,'exec'),old.__dict__)
  dry=dict(e.recipe,enabled=True);cross=dict(dry,crossMod=[False,False,False,False,True],crossModDepth=.7)
  for state,changed in [(dry,False),(cross,True),(dict(cross,crossModDepth=0),False),(dict(cross,enabled=False),False),(dict(cross,level=0),False),(dict(cross,cables=[]),False),(dict(dry,pulseCrossMod=[False,False,True,False,False,False],crossModDepth=.7),True),(dict(cross,crossModDepth=0,lfo=dict(enabled=True,wave='sine',rate=.5,depth=1,inverse=False,targets=[dict(key='crossModDepth',inverse=False)])),True)]:
   original=copy.deepcopy(state);a=old.validate_part_zip(e.body(state));b=e.s.validate_part_zip(e.body(state));self.assertEqual(state,original)
   if changed:self.assertEqual(a['emberVersion'],8);self.assertEqual(b['emberVersion'],9);self.assertNotEqual(a['contentSha256'],b['contentSha256'])
   else:self.assertEqual(a,b)
