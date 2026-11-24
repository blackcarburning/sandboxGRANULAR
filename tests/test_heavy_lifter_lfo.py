import copy, json, subprocess, unittest
from test_acoustic_fx import new, old, fixture, ROOT
H = new.ACOUSTIC_FX.HEAVY
class HeavyLifterLfo(unittest.TestCase):
 def settings(self, mode='materialBody', targets=None):
  return H.canonical(dict(enabled=True, mode=mode, lfo=dict(targets=targets if targets is not None else [mode+'.'+next(iter(H.DEFAULTS['recipes'][mode]))])))
 def test_js_python_normalization_and_saved_field_match(self):
  data=json.loads(subprocess.check_output(['node','-e',"const H=require('./heavy-lifter-dsp.js');console.log(JSON.stringify(H.MODES.map(mode=>H.normalize({enabled:true,mode,lfo:{wave:'pulse',pulseWidth:.23,beats:.125,timing:'triplet',depth:.75,targets:['level','width',mode+'.'+Object.keys(H.PARAMS[mode])[0]]}}))))"],cwd=ROOT))
  for s in data:H.validate(s);self.assertEqual(H.canonical(s),s)
 def test_strict_target_types_and_uniqueness(self):
  for invalid in [None,[],{'targets':['level']*2},{'targets':['source']},{'targets':[[]]},{'depth':True},{'depth':-1},{'pulseWidth':0},{'pulseWidth':1},{'wave':'invalid'},{'beats':True},{'beats':.3},{'timing':'swing'},{'foo':1}]:
   with self.subTest(value=invalid),self.assertRaises(ValueError):H.validate({'lfo':invalid})
 def test_all_current_mode_targets_require_eight_and_other_modes_neutral(self):
  for mode in H.SCHEMA['modes']:
   for target in ['level','width']+[mode+'.'+p for p in H.DEFAULTS['recipes'][mode] if p!='seed']:
    s=self.settings(mode,[target]);H.validate(s);self.assertEqual(new.validate_part_zip(fixture({'heavyLifter':s}))['acousticFxVersion'],8)
   base=H.canonical({'mode':mode,'enabled':True})
   for lfo in [{'targets':[]},{'targets':['level'],'depth':0},{'targets':['spectralAlloy.alloy' if mode!='spectralAlloy' else 'materialBody.size']}]:
    s=dict(base,lfo=H.canonical_lfo(lfo));self.assertEqual(new.validate_part_zip(fixture({'heavyLifter':s})),old.validate_part_zip(fixture({'heavyLifter':base})))
 def test_level_modulation_lifts_zero_and_off_external_remain_neutral(self):
  s=self.settings(targets=['level']);s['level']=0
  self.assertEqual(new.validate_part_zip(fixture({'heavyLifter':s}))['acousticFxVersion'],8)
  for extra in [{'enabled':False},{'source':'DAW'}]:
   self.assertNotIn('acousticFxVersion',new.validate_part_zip(fixture({'heavyLifter':dict(s,**extra)})))
 def test_each_lfo_field_changes_active_hash_but_not_original_recipe(self):
  s=self.settings(targets=['level']);before=new.validate_part_zip(fixture({'heavyLifter':s}))['contentSha256']
  for key,value in [('wave','pulse'),('beats',8),('timing','triplet'),('pulseWidth',.23),('depth',.8),('targets',['width'])]:
   v=copy.deepcopy(s);v['lfo'][key]=value;self.assertEqual(v['recipes'],s['recipes']);self.assertNotEqual(new.validate_part_zip(fixture({'heavyLifter':v}))['contentSha256'],before)

 def test_all_38_targets_round_trip_and_server_capability(self):
  for mode in H.SCHEMA['modes']:
   s=self.settings(mode,list(H.LFO_TARGETS));H.validate(s)
   self.assertEqual(len(H.canonical(s)['lfo']['targets']),38)
   self.assertEqual(new.validate_part_zip(fixture({'heavyLifter':s}))['acousticFxVersion'],8)
