"""Optional serial routing: strict state, neutral legacy identity and audible order."""
import importlib.util,json,os,pathlib,sys,unittest,subprocess,copy
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from test_song_backend import part_zip,rewrite_part
spec=importlib.util.spec_from_file_location('pot_songs',ROOT/'backend/mygrain_songs.py');songs=importlib.util.module_from_spec(spec);spec.loader.exec_module(songs)
spec=importlib.util.spec_from_file_location('pot_before_songs',pathlib.Path(os.environ['MYGRAIN_BASELINE_BACKEND']));old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
KEYS=list(songs.COOKING_POT_KEYS)
def pot(enabled=True,order=None):return {'version':1,'enabled':enabled,'order':order or KEYS}
def with_modes(modes):return rewrite_part(part_zip(),lambda m:m['state']['modes'].update(copy.deepcopy(modes)))
class CookingPot(unittest.TestCase):
 def test_old_and_bypassed_identity(self):
  baseline=old.validate_part_zip(part_zip())
  for value in [None,pot(False),pot(False,KEYS[::-1]),pot(True)]:
   result=songs.validate_part_zip(with_modes({'cookingPot':value}))
   self.assertEqual(result,baseline)
 def test_active_order_is_hashed(self):
  bass=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify({...require('./character-fx.js').normalize(),enabled:true,input:'DAW'}))"],cwd=ROOT))
  a=songs.validate_part_zip(with_modes({'bassFace':bass,'cookingPot':pot()}));b=songs.validate_part_zip(with_modes({'bassFace':bass,'cookingPot':pot(True,KEYS[::-1])}))
  self.assertEqual(a['cookingPotVersion'],2);self.assertNotEqual(a['contentSha256'],b['contentSha256'])
 def test_d_off_and_daw_mutilator_controls_not_pruned(self):
  for selected in ['D','DAW']:
   m={'enabled':True,'strain':'gnaw','amount':.7,'tone':.5,'mix':.5,'input':selected,'freeDepth':.8,'freeRate':.7}
   modes={'cookingPot':pot(),'loopD':{'version':1,'enabled':False,'level':.8,'mutilator':m}}
   a=songs.validate_part_zip(with_modes(modes));m['freeRate']=2
   b=songs.validate_part_zip(with_modes(modes));self.assertNotEqual(a['contentSha256'],b['contentSha256']);self.assertEqual(a['cookingPotVersion'],2)
 def test_input_routes_are_part_of_pot_render_identity(self):
  bass=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify({...require('./character-fx.js').normalize(),enabled:true,input:'A'}))"],cwd=ROOT))
  first=songs.validate_part_zip(with_modes({'bassFace':bass,'cookingPot':pot()}));bass['input']='B'
  second=songs.validate_part_zip(with_modes({'bassFace':bass,'cookingPot':pot()}))
  self.assertNotEqual(first['contentSha256'],second['contentSha256'])
  self.assertEqual(first['cookingPotVersion'],2)
 def test_source_conflicts_are_selectively_versioned_and_js_agrees(self):
  base={'cookingPot':pot(),'loopD':{'mutilator':{'enabled':True,'input':'A','amount':.8,'mix':.7}},'bassFace':{'enabled':True,'input':'A','amount':.8,'mix':.7}}
  for source,expected in [('A',2),('all',2),('B',3),('K',3),('drums',3)]:
   with self.subTest(source=source):
    modes=copy.deepcopy(base);modes['bassFace']['input']=source
    body=with_modes(modes);state={'modes':modes}
    result=songs.validate_part_zip(body)
    self.assertEqual(result['cookingPotVersion'],expected)
    js=int(subprocess.check_output(['node','-e',"console.log(require('./cooking-pot-model.js').renderVersion(JSON.parse(process.argv[1])))",json.dumps(modes)],cwd=ROOT))
    self.assertEqual(js,expected)
    prior=old.validate_part_zip(body)
    self.assertEqual(result['contentSha256']==prior['contentSha256'],expected==2)
  modes=copy.deepcopy(base);modes['cookingPot']['enabled']=False;modes['bassFace']['input']='B'
  self.assertEqual(songs.validate_part_zip(with_modes(modes)),old.validate_part_zip(with_modes(modes)))
 def test_strict_validation(self):
  for value in [[],{},pot()|{'version':2},pot()|{'enabled':1},pot()|{'order':KEYS[:-1]},pot()|{'order':['unknown']+KEYS[1:]},pot()|{'order':[KEYS[0]]*9},pot()|{'order':[{}]*9}]:
   with self.subTest(value=value),self.assertRaises(ValueError):songs.validate_part_zip(with_modes({'cookingPot':value}))
 def test_inspection_does_not_mutate_source(self):
  tt=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify({...require('./turntable-dsp.js').normalize(),enabled:true,route:'drums'}))"],cwd=ROOT))
  body=with_modes({'cookingPot':pot(),'turntable':tt})
  before=bytes(body);songs.validate_part_zip(body);self.assertEqual(body,before)
if __name__=='__main__':unittest.main()
