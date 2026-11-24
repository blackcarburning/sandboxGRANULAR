import copy,json,subprocess,unittest
from test_acoustic_fx import new,old,fixture,ROOT
L=new.ACOUSTIC_FX.LFO
class EffectLfo(unittest.TestCase):
 def modes(self,key,s):return {'loopD':{'enabled':True,'mutilator':s}} if key=='mutilator' else {key:s}
 def settings(self,key):
  return json.loads(subprocess.check_output(['node','-e',"const D=require('./effect-lfo.js');const k=process.argv[1];const api=k==='bassFace'?require('./character-fx.js'):k==='mutilator'?require('./mutilator-dsp.js'):require('./acoustic-fx-dsp.js');const v={enabled:true,input:'A',source:'A',version:k==='bubbleChamber'?2:1,freeDepth:.4};const s=k==='bassFace'||k==='mutilator'?api.normalize(v):api.normalize(k,v);s.lfo=D.normalize(k,{wave:'pulse',beats:.125,timing:'triplet',pulseWidth:.23,depth:1,targets:D.targets(k)});console.log(JSON.stringify(s))",key],cwd=ROOT))
 def test_all_40_strict_targets_and_js_python_round_trip(self):
  count=0
  for key in L.SPECS:
   s=self.settings(key);L.validate(key,s['lfo']);self.assertEqual(s['lfo'],L.canonical(key,s['lfo']))
   for target in L.SPECS[key]:
    v=copy.deepcopy(s);v['lfo']['targets']=[target]
    if target=='cycleBeats':v['rhythm']=True
    info=new.validate_part_zip(fixture(self.modes(key,v)));self.assertEqual(info['acousticFxVersion'],9,key+'.'+target);count+=1
  self.assertEqual(count,40)
 def test_reject_invalid_and_duplicate_assignments_without_manual_limit(self):
  for key in L.SPECS:
   for bad in [None,[],{'targets':['mix']*2},{'targets':['input']},{'targets':[[]]},{'depth':True},{'depth':-1},{'depth':1.01},{'beats':.3},{'beats':True},{'wave':'oops'},{'timing':'swing'},{'pulseWidth':0},{'extra':1}]:
    with self.subTest(key=key,bad=bad),self.assertRaises(ValueError):L.validate(key,bad)
   L.validate(key,dict(targets=list(L.SPECS[key])))
 def test_inactive_lfos_preserve_legacy_cache_and_zero_can_lift(self):
  for key in L.SPECS:
   s=self.settings(key);plain={k:v for k,v in s.items() if k!='lfo'}
   for lfo in [dict(s['lfo'],targets=[]),dict(s['lfo'],depth=0)]:
    self.assertEqual(new.validate_part_zip(fixture(self.modes(key,dict(plain,lfo=lfo)))),old.validate_part_zip(fixture(self.modes(key,plain))),key)
   field='mix' if key in ('bassFace','mutilator') else 'level';v=dict(s,**{field:0});v['lfo']=dict(s['lfo'],targets=[field]);self.assertEqual(new.validate_part_zip(fixture(self.modes(key,v)))['acousticFxVersion'],9)
   for extra in [dict(enabled=False),dict(input='DAW') if key in ('bassFace','mutilator') else dict(source='DAW')]:
    self.assertLess(new.validate_part_zip(fixture(self.modes(key,dict(v,**extra)))).get('acousticFxVersion',0),9)
 def test_active_lfo_settings_change_identity_without_changing_base(self):
  for key in L.SPECS:
   s=self.settings(key);baseline=new.validate_part_zip(fixture(self.modes(key,s)))['contentSha256']
   for field,value in [('wave','sine'),('beats',8),('timing','dotted'),('pulseWidth',.67),('depth',.5),('targets',[next(iter(L.SPECS[key]))])]:
    v=copy.deepcopy(s);v['lfo'][field]=value;self.assertNotEqual(new.validate_part_zip(fixture(self.modes(key,v)))['contentSha256'],baseline,key+'.'+field)
 def test_source_solo_and_pot_capability_include_zero_base_modulation(self):
  for key in L.SPECS:
   s=self.settings(key);field='mix' if key in ('bassFace','mutilator') else 'level';s[field]=0;s['lfo']['targets']=[field]
   modes=self.modes(key,s);modes['cookingPot']={'version':1,'enabled':True,'order':list(new.COOKING_POT_KEYS)};modes['loopSolo']=['A']
   info=new.validate_part_zip(fixture(modes));self.assertEqual(info['acousticFxVersion'],9)
