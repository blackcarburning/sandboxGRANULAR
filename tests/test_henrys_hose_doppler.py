"""Versioned Doppler state and unchanged legacy render identities."""
import copy,json,subprocess,unittest,math
from test_acoustic_fx import new,old,fixture,ROOT
class Doppler(unittest.TestCase):
 def test_js_python_new_defaults_and_every_factory_preset_agree(self):
  data=json.loads(subprocess.check_output(['node','-e',"const D=require('./acoustic-fx-dsp.js'),P=require('./acoustic-fx-presets.js');console.log(JSON.stringify([D.normalize('henrysHose'),...P.BANKS.henrysHose.map(p=>p.settings())]));"],cwd=ROOT))
  for s in data:
   new.ACOUSTIC_FX.validate({'henrysHose':s});self.assertEqual(new.ACOUSTIC_FX.canonical('henrysHose',s),s)
   s['enabled']=True;details=new.validate_part_zip(fixture({'henrysHose':s}));self.assertEqual(details['acousticFxVersion'],4)
 def test_version_one_active_and_inactive_hashes_are_unchanged(self):
  for serial in (False,True):
   for s in ({'enabled':True},{'enabled':True,'source':'A','micLType':'ribbon','orbit':.91},{'enabled':True,'level':0},{'enabled':False},{'enabled':True,'source':'DAW'}):
    modes={'henrysHose':s,'cookingPot':{'version':1,'enabled':serial,'order':list(new.COOKING_POT_KEYS)}}
    self.assertEqual(new.validate_part_zip(fixture(modes)),old.validate_part_zip(fixture({**modes,'cookingPot':{**modes['cookingPot'],'order':[k for k in modes['cookingPot']['order'] if k in old.COOKING_POT_KEYS]}})))
 def test_doppler_changes_active_identity_only(self):
  a={'version':2,'enabled':True,'source':'A','doppler':.25};b={**a,'doppler':.75}
  self.assertNotEqual(new.validate_part_zip(fixture({'henrysHose':a}))['contentSha256'],new.validate_part_zip(fixture({'henrysHose':b}))['contentSha256'])
  dry=new.validate_part_zip(fixture({}))
  for edits in ({'enabled':False},{'level':0},{'source':'DAW'}):
   self.assertEqual(new.validate_part_zip(fixture({'henrysHose':{**b,**edits}})),dry)
 def test_reject_invalid_depth_and_version(self):
  for v in (-.01,1.01,math.inf,True,'loud'):
   with self.assertRaises(ValueError):new.validate_part_zip(fixture({'henrysHose':{'version':2,'doppler':v}}))
  with self.assertRaises(ValueError):new.validate_part_zip(fixture({'henrysHose':{'version':3}}))
