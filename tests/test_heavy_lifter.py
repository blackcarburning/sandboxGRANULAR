"""Strict settings, all recipes, additive identity and legacy archive checks."""
import copy, json, math, os, subprocess, unittest
from test_acoustic_fx import new, old, fixture, ROOT
H = new.ACOUSTIC_FX.HEAVY
class HeavyLifter(unittest.TestCase):
 def test_600_presets_match_js_canonical(self):
  data=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./heavy-lifter-presets.js').ALL.map(p=>p.settings())))"],cwd=ROOT))
  self.assertEqual(len(data),600)
  for s in data:
   H.validate(s); self.assertEqual(H.canonical(s),s)
   s['enabled']=True
   self.assertEqual(new.validate_part_zip(fixture({'heavyLifter':s}))['acousticFxVersion'],6 if s['mode'] in ('mechanicalMotion','spectralImprint') else 5)
 def test_legacy_hashes_retained_with_off_zero_and_external_heavy(self):
  for serial in (False,True):
   keys=[k for k in old.COOKING_POT_KEYS if k!='heavyLifter']
   for extra in ({},{'wireWorld':{'enabled':True}},{'henrysHose':{'version':2,'enabled':True}}):
    modes={'cookingPot':{'version':1,'enabled':serial,'order':keys},**extra}
    expected=old.validate_part_zip(fixture(modes))
    for value in ({'enabled':False},{'enabled':True,'level':0},{'enabled':True,'source':'DAW'}):
     m=copy.deepcopy(modes);m['heavyLifter']=value;m['cookingPot']['order'].insert(2,'heavyLifter');m['effectOutput']={'version':1,'throughMain':{'heavyLifter':True}}
     self.assertEqual(new.validate_part_zip(fixture(m)),expected)
 def test_every_optional_inventory_subset_and_power_memory(self):
  keys=list(new.COOKING_POT_KEYS)
  for optional in ([],['henrysHose'],['heavyLifter'],['henrysHose','heavyLifter']):
   order=[k for k in keys if k not in ('henrysHose','heavyLifter') or k in optional]
   v={'version':1,'enabled':True,'order':order,'power':{'enabled':False,'remembered':dict.fromkeys(order+['masterBaker'],False)}}
   new.validate_cooking_pot(v)
 def test_strict_parameters_and_recording_bounds(self):
  for bad in ({'version':True},{'mode':'eval'},{'recipes':[]},{'recipes':{'materialBody':None}},{'samples':{'materialBody':[None]}},{'level':True},{'width':math.inf},{'recipes':{'materialBody':{'seed':0}}},{'recipes':{'materialBody':{'seed':True}}},{'recipes':{'materialBody':{'size':2}}}):
   with self.subTest(bad=bad),self.assertRaises(ValueError):new.ACOUSTIC_FX.validate({'heavyLifter':bad})
  row=next(iter(H.CATALOG.values()));cut={'id':row['id'],'chunk':0,'start':0,'duration':min(1,row['chunks'][0]['frames']/24000),'bars':1,'bpm':120}
  s=H.canonical({'enabled':True,'samples':{'materialBody':[cut]}});H.validate(s)
  for field,value in [('id','bad'),('chunk',9999),('start',16),('duration',math.inf),('bars',.5),('bpm',0)]:
   bad=copy.deepcopy(s);bad['samples']['materialBody'][0][field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):H.validate(bad)
 def test_every_recipe_parameter_and_seed_changes_active_identity(self):
  for mode in H.SCHEMA['modes']:
   s=H.canonical({'enabled':True,'mode':mode});before=new.validate_part_zip(fixture({'heavyLifter':s}))['contentSha256']
   for key in s['recipes'][mode]:
    v=copy.deepcopy(s);v['recipes'][mode][key]=239 if key=='seed' else 0 if s['recipes'][mode][key]>.5 else 1
    self.assertNotEqual(before,new.validate_part_zip(fixture({'heavyLifter':v}))['contentSha256'])
if __name__=='__main__':unittest.main()

class WetRenderRevisionTests(unittest.TestCase):
 def test_only_corrected_audible_modes_require_revision_six(self):
  for mode in ('materialBody','mechanicalMotion','spectralImprint','livingConvolution','spectralAlloy','stressedMetal'):
   s={'version':1,'enabled':True,'mode':mode}
   self.assertEqual(new.validate_part_zip(fixture({'heavyLifter':s}))['acousticFxVersion'],6 if mode in ('mechanicalMotion','spectralImprint') else 5)
   before=old.validate_part_zip(fixture({'heavyLifter':s}));after=new.validate_part_zip(fixture({'heavyLifter':s}))
   if after.get('acousticFxVersion') != before.get('acousticFxVersion'):self.assertNotEqual(after['contentSha256'],before['contentSha256'])
   else:self.assertEqual(after,before)
   for extra in ({'enabled':False},{'level':0},{'source':'DAW'}):
    self.assertNotIn('acousticFxVersion',new.validate_part_zip(fixture({'heavyLifter':dict(s,**extra)})))
