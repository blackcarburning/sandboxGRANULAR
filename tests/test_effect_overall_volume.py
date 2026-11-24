import importlib.util,pathlib,sys,unittest,os,json,subprocess,copy
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tests'))
from test_song_backend import part_zip,rewrite_part
spec=importlib.util.spec_from_file_location('overall_songs',ROOT/'backend/mygrain_songs.py');songs=importlib.util.module_from_spec(spec);spec.loader.exec_module(songs)
spec=importlib.util.spec_from_file_location('overall_before',pathlib.Path(os.environ['MYGRAIN_BASELINE_BACKEND']));old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
def body(modes):return rewrite_part(part_zip(),lambda m:m['state']['modes'].update(copy.deepcopy(modes)))
def bass(source='A'):return json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./character-fx.js').normalize({enabled:true,input:process.argv[1],amount:.8,mix:1})))",source],cwd=ROOT))
class OverallVolume(unittest.TestCase):
 def test_legacy_unity_off_external_keep_identity(self):
  for modes in [{},{'bassFace':bass()},{'bassFace':bass('DAW')},{'bassFace':{**bass(),'enabled':False}}]:
   baseline=old.validate_part_zip(body(modes))
   for volumes in [{},{'bassFace':1}]+([{'bassFace':0}] if not modes.get('bassFace',{}).get('enabled') or modes['bassFace']['input']=='DAW' else []):
    self.assertEqual(songs.validate_part_zip(body({**modes,'effectOutput':{'version':1,'throughMain':{},'volumes':volumes}})),baseline)
 def test_active_nonunity_and_zero_need_six(self):
  modes={'bassFace':bass()};base=songs.validate_part_zip(body(modes))
  for gain in [0,.17,.5,.99]:
   actual=songs.validate_part_zip(body({**modes,'effectOutput':{'version':1,'throughMain':{},'volumes':{'bassFace':gain}}}));self.assertEqual(actual['effectOutputVersion'],6);self.assertNotEqual(actual['contentSha256'],base['contentSha256'])
 def test_terminal_chain_and_js_python_agree(self):
  seed={'bassFace':bass('all'),'wireWorld':{'version':1,'enabled':True,'source':'A','level':.6},'effectOutput':{'version':1,'throughMain':{},'volumes':{'bassFace':.2,'wireWorld':.7}},'cookingPot':{'version':1,'enabled':False,'order':list(songs.COOKING_POT_KEYS)}}
  for source in ['A','all','drums','K','DAW']:
   for order in [list(songs.COOKING_POT_KEYS),list(songs.COOKING_POT_KEYS)[::-1]]:
    m=copy.deepcopy(seed);m['wireWorld']['source']=source;m['cookingPot']['order']=order
    js=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./cooking-pot-model.js').outputVolumes(JSON.parse(process.argv[1]))))",json.dumps(m)],cwd=ROOT));self.assertEqual(js,songs.active_effect_output_volumes({'modes':m}))
 def test_nonterminal_gains_do_not_change_hash(self):
  m={'bassFace':bass(),'wireWorld':{'version':1,'enabled':True,'source':'A','level':.6}}
  self.assertEqual(songs.validate_part_zip(body(m)),songs.validate_part_zip(body({**m,'effectOutput':{'version':1,'throughMain':{},'volumes':{'bassFace':0}}})))
 def test_strict_gain_validation(self):
  for value in [None,[],{'unknown':.5},{'bassFace':True},{'bassFace':'0.5'},{'bassFace':-.1},{'bassFace':1.1}]:
   with self.subTest(value=value),self.assertRaises(ValueError):songs.validate_part_zip(body({'effectOutput':{'version':1,'throughMain':{},'volumes':value}}))
if __name__=='__main__':unittest.main()
