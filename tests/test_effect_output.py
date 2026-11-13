"""Independent returns are saved, versioned and selectively refreshed."""
import importlib.util, pathlib, sys, unittest, os, json, subprocess
ROOT=pathlib.Path(os.environ.get('MYGRAIN_TEST_ROOT',pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(ROOT/'tests'))
from test_song_backend import part_zip,rewrite_part
spec=importlib.util.spec_from_file_location('effect_output_songs',ROOT/'backend/mygrain_songs.py');songs=importlib.util.module_from_spec(spec);spec.loader.exec_module(songs)
if os.environ.get('MYGRAIN_EFFECT_OUTPUT_SOURCE'):
 exec(compile(pathlib.Path(os.environ['MYGRAIN_EFFECT_OUTPUT_SOURCE']).read_text(),songs.__file__,'exec'),songs.__dict__)
spec=importlib.util.spec_from_file_location('before_effect_output_songs',pathlib.Path(os.environ['MYGRAIN_BASELINE_BACKEND']) if os.environ.get('MYGRAIN_BASELINE_BACKEND') else ROOT/'backend/mygrain_songs.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
class EffectOutputs(unittest.TestCase):
 def test_legacy_and_disabled_hashes_unchanged(self):
  body=part_zip();self.assertEqual(songs.validate_part_zip(body),old.validate_part_zip(body))
  body=rewrite_part(body,lambda m:m['state']['modes'].update(effectOutput={'version':1,'throughMain':{'wasp':True}}))
  self.assertEqual(songs.validate_part_zip(body),old.validate_part_zip(part_zip()))
 def test_active_mode_requires_new_renderer(self):
  mode=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify({...require('./turntable-dsp.js').normalize(),enabled:true}))"],cwd=ROOT))
  independent=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(turntable=mode))
  following=rewrite_part(independent,lambda m:m['state']['modes'].update(effectOutput={'version':1,'throughMain':{'turntable':True}}))
  a,b=songs.validate_part_zip(independent),songs.validate_part_zip(following)
  self.assertEqual(a['effectOutputVersion'],1);self.assertNotEqual(a['contentSha256'],b['contentSha256']);
  if os.environ.get('MYGRAIN_BASELINE_BACKEND'):self.assertNotEqual(a['contentSha256'],old.validate_part_zip(independent)['contentSha256'])
 def test_main_mute_requires_capability_three_without_any_active_effect(self):
  dry=part_zip();muted=rewrite_part(dry,lambda m:m['state']['modes'].update(effectOutput={'version':1,'throughMain':{},'mainMuted':True}))
  a,b=songs.validate_part_zip(dry),songs.validate_part_zip(muted)
  self.assertEqual(b['effectOutputVersion'],3);self.assertNotEqual(a['contentSha256'],b['contentSha256'])
 def test_false_or_missing_mute_keeps_legacy_identity(self):
  for value in [None,False]:
   mode={'version':1,'throughMain':{}}
   if value is not None:mode['mainMuted']=value
   body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(effectOutput=mode))
   self.assertEqual(songs.validate_part_zip(body),old.validate_part_zip(part_zip()))
 def test_muted_source_solo_still_requires_three(self):
  body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(loopLayerSolo='bastarda',effectOutput={'version':1,'throughMain':{},'mainMuted':True}))
  self.assertEqual(songs.validate_part_zip(body)['effectOutputVersion'],3)
 def test_mute_boolean_validation(self):
  for value in [1,'true',[],None]:
   body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(effectOutput={'version':1,'throughMain':{},'mainMuted':value}))
   with self.assertRaises(ValueError):songs.validate_part_zip(body)
 def test_route_validation(self):
  for value in [{'version':2,'throughMain':{}},{'version':1,'throughMain':{'unknown':True}},{'version':1,'throughMain':{'wasp':1}}]:
   body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(effectOutput=value))
   with self.assertRaises(ValueError):songs.validate_part_zip(body)
if __name__=='__main__':unittest.main()
