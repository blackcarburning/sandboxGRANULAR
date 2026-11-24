"""Additive Hose identity: inactive, EQ, legacy Pot and native protocol boundaries."""
import copy,unittest
from test_acoustic_fx import new,old,fixture
class HenryHose(unittest.TestCase):
 def test_inactive_hose_preserves_real_legacy_identity_with_eq_and_pot(self):
  eq=new.CHANNEL_EQ.normalize();eq['channels']['A']['enabled']=True;eq['channels']['A']['bands'][1].update(gain=12,frequency=2300,q=2)
  legacy=list([k for k in new.COOKING_POT_KEYS if k not in ('henrysHose','heavyLifter')])
  for serial in (False,True):
   modes={'channelEq':eq,'cookingPot':{'version':1,'enabled':serial,'order':legacy,'power':{'enabled':True,'remembered':{k:False for k in (*legacy,'masterBaker')}}},'effectOutput':{'version':1,'mainMuted':False,'throughMain':{}}}
   expected=old.validate_part_zip(fixture(modes))
   for hose in ({'enabled':False},{'enabled':True,'level':0},{'enabled':True,'source':'DAW'}):
    updated=copy.deepcopy(modes);updated['henrysHose']=hose;updated['cookingPot']['order'].insert(3,'henrysHose');updated['cookingPot']['power']['remembered']['henrysHose']=True;updated['effectOutput']['throughMain']['henrysHose']=True
    self.assertEqual(new.validate_part_zip(fixture(updated)),expected)
 def test_sparse_active_hose_is_canonical_inside_legacy_or_new_pot(self):
  sparse={'enabled':True};full=new.ACOUSTIC_FX.canonical('henrysHose',sparse)
  for order in (list(new.COOKING_POT_KEYS),list([k for k in new.COOKING_POT_KEYS if k not in ('henrysHose','heavyLifter')])):
   base={'cookingPot':{'version':1,'enabled':True,'order':order},'henrysHose':sparse}
   details=new.validate_part_zip(fixture(base));self.assertEqual(details['acousticFxVersion'],3)
   self.assertEqual(details,new.validate_part_zip(fixture({**base,'henrysHose':full})))
if __name__=='__main__':unittest.main()
