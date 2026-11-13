import importlib.util,json,math,os,pathlib,subprocess,sys,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
STAGE=pathlib.Path(os.environ.get('MYGRAIN_LIQUID_ROOT',ROOT))
sys.path.insert(0,str(ROOT/'tests'))
from test_song_backend import part_zip,rewrite_part

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
old=load('before_liquid',ROOT/'backend/mygrain_songs.py')
new=load('after_liquid',ROOT/'backend/mygrain_songs.py')
exec(compile((STAGE/'backend/mygrain_songs.py').read_text(),new.__file__,'exec'),new.__dict__)
new.ACOUSTIC_FX=load('liquid_fx',STAGE/'backend/mygrain_acoustic_fx.py')

def fixture(settings,key='bubbleChamber'):
 return rewrite_part(part_zip(),lambda m:m['state']['modes'].update({key:settings}))
class BubbleLiquid(unittest.TestCase):
 def test_legacy_hashes_unchanged_including_all_old_excitation_modes(self):
  for mode in ('resonate','droplets','hybrid'):
   body=fixture({'version':1,'enabled':True,'mode':mode,'source':'A','radius':.924,'density':.3})
   self.assertEqual(old.validate_part_zip(body),new.validate_part_zip(body))
  for key in ('wireWorld','sonicCrystal'):
   body=fixture({'enabled':True},key);self.assertEqual(old.validate_part_zip(body),new.validate_part_zip(body))
 def test_version_two_only_versions_audible_local_bubbles(self):
  dry=new.validate_part_zip(part_zip())
  active=new.validate_part_zip(fixture({'version':2,'enabled':True}))
  self.assertEqual(active['acousticFxVersion'],2)
  self.assertNotEqual(active['contentSha256'],dry['contentSha256'])
  for setting in ({'enabled':False},{'enabled':True,'source':'DAW'},{'enabled':True,'level':0}):
   details=new.validate_part_zip(fixture({'version':2,**setting}))
   self.assertNotIn('acousticFxVersion',details)
   self.assertEqual(details,old.validate_part_zip(fixture({'version':1,**setting})))
 def test_all_liquid_presets_validate_and_all_controls_affect_hash(self):
  presets=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./acoustic-fx-presets.js').BANKS.bubbleChamber.map(p=>p.settings())))"],cwd=STAGE))
  self.assertEqual(len(presets),100)
  for p in presets:
   self.assertEqual(new.validate_part_zip(fixture({**p,'enabled':True}))['acousticFxVersion'],2)
  base={'version':2,'enabled':True};before=new.validate_part_zip(fixture(base))['contentSha256']
  for k in new.ACOUSTIC_FX.LIQUID_DEFAULTS:
   val=24 if k=='population' else .99
   self.assertNotEqual(new.validate_part_zip(fixture({**base,k:val}))['contentSha256'],before,k)
 def test_reject_invalid_version_and_each_new_parameter(self):
  for v in (True,3,'2'):
   with self.assertRaises(ValueError):new.validate_part_zip(fixture({'version':v}))
  for k in ('resonance','damping','fizz','flow'):
   for val in (True,-.1,1.1,'0.5',math.inf):
    with self.assertRaises(ValueError):new.validate_part_zip(fixture({'version':2,k:val}))
  for key in ('wireWorld','sonicCrystal'):
   with self.assertRaises(ValueError):new.validate_part_zip(fixture({'version':2},key))
if __name__=='__main__':unittest.main()
