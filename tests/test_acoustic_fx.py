"""Legacy optional-mode compatibility and all new source/parameter boundaries."""
import importlib.util,pathlib,sys,unittest,math,json,os,subprocess
from io import BytesIO
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from test_song_backend import part_zip,rewrite_part

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
new=load('acoustic_songs',ROOT/'backend/mygrain_songs.py')
old=load('legacy_acoustic_songs',pathlib.Path(os.environ['MYGRAIN_BASELINE_BACKEND'])) if os.environ.get('MYGRAIN_BASELINE_BACKEND') else new
fx=new.ACOUSTIC_FX

def fixture(modes):return rewrite_part(part_zip(),lambda m:m['state']['modes'].update(modes))
class AcousticFX(unittest.TestCase):
 def test_exact_legacy_and_disabled_cache_identity(self):
  resonator=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./resonator-dsp.js').normalize({enabled:true,slots:[{object:'pipe',enabled:true,source:'A',level:.4},{enabled:false}]})))"],cwd=ROOT))
  for modes in [{},{'resonatorR':resonator},{'bassFace':{'enabled':True,'input':'X','strain':'tape-hug','amount':.6,'mix':.5}}]:
   body=fixture(modes);expected=old.validate_part_zip(body);self.assertEqual(expected,new.validate_part_zip(body))
   for key in fx.KEYS:
    for value in [{'enabled':False},{'enabled':True,'level':0},{'enabled':True,'source':'DAW'}]:
     self.assertEqual(expected,new.validate_part_zip(fixture({**modes,key:value})))
 def test_sources_and_active_defaults(self):
  for key in fx.KEYS:
   for source in fx.SOURCES:
    details=new.validate_part_zip(fixture({key:{'enabled':True,'source':source}}))
    self.assertEqual(details.get('acousticFxVersion'),None if source=='DAW' else 1)
   sparse={'enabled':True};full=fx.canonical(key,sparse)
   self.assertEqual(new.validate_part_zip(fixture({key:sparse})),new.validate_part_zip(fixture({key:full})))
 def test_reject_bad_versions_sources_and_parameters(self):
  for key in fx.KEYS:
   bad_values=[{'version':True},{'version':3 if key=='bubbleChamber' else 2},{'enabled':'yes'},{'source':'eval()'},{'level':math.inf},{'width':-1},{'level':True}]
   for field,default in fx.DEFAULTS[key].items():
    bad_values.append({field:99 if field in fx.ENUMS else 'not-a-number'})
   for bad in bad_values:
    with self.subTest(key=key,bad=bad),self.assertRaises(ValueError):new.validate_part_zip(fixture({key:bad}))
 def test_every_preset_matches_backend_and_no_factory_ids(self):
  data=json.loads(subprocess.check_output(['node','-e',"const d=require('./acoustic-fx-dsp.js'),b=require('./acoustic-fx-presets.js');console.log(JSON.stringify(Object.fromEntries(d.KEYS.map(k=>[k,b.BANKS[k].map(p=>p.settings())]))))"],cwd=ROOT))
  for key,bank in data.items():
   self.assertEqual(len(bank),100)
   for p in bank:
    self.assertNotIn('id',p);fx.validate({key:p});p['enabled']=True;self.assertEqual(new.validate_part_zip(fixture({key:p}))['acousticFxVersion'],2 if key=='bubbleChamber' else 1)
 def test_each_parameter_changes_active_content_and_off_is_canonical(self):
  for key,defaults in fx.DEFAULTS.items():
   before=new.validate_part_zip(fixture({key:{'enabled':True}}))['contentSha256']
   for field,d in defaults.items():
    value=fx.ENUMS[field][0] if field in fx.ENUMS else (0 if d>.5 else 1)
    if value==d:value=fx.ENUMS[field][-1]
    self.assertNotEqual(before,new.validate_part_zip(fixture({key:{'enabled':True,field:value}}))['contentSha256'],key+'.'+field)
if __name__=='__main__':unittest.main()
