"""Optional character inserts keep unchanged legacy audio cache keys reusable."""
import importlib.util, pathlib, sys, unittest, math, os, types, zipfile, json
from io import BytesIO
ROOT=pathlib.Path(__file__).resolve().parents[1]
LIVE=pathlib.Path(os.environ.get('MYGRAIN_REPO_ROOT',str(ROOT)))
sys.path.insert(0,str(LIVE/'tests'))
from test_song_backend import part_zip, rewrite_part
def load(name,source):
 module=types.ModuleType(name);module.__file__=str(LIVE/'backend/mygrain_songs.py');sys.modules[name]=module;exec(compile(source,module.__file__,'exec'),module.__dict__);return module
new=load('character_songs',(ROOT/'backend/mygrain_songs.py').read_text())
baseline=os.environ.get('MYGRAIN_BASELINE_BACKEND')
old=load('legacy_songs',pathlib.Path(baseline).read_text()) if baseline else new
def fixture(modes):return rewrite_part(part_zip(),lambda m:m['state']['modes'].update(modes))
class CharacterFX(unittest.TestCase):
 def test_legacy_hash_exact(self):
  for modes in [{},{'loopD':{'enabled':False,'mutilator':{'enabled':False}}},{'loopD':{'enabled':True,'mutilator':{'enabled':True,'strain':'venom','mix':.5,'amount':.5,'rhythm':False}}}]:
   body=fixture(modes);before=old.validate_part_zip(body);self.assertEqual(before,new.validate_part_zip(body));body=fixture({**modes,'bassFace':{'version':1,'enabled':False,'input':'X','strain':'velvet-valve','amount':.5,'mix':.5}});self.assertEqual(before,new.validate_part_zip(body))
 def test_character_admission(self):
  for input in new.CHARACTER_INPUTS:
   b={'enabled':True,'input':input,'amount':.6,'mix':.6,'strain':'full-bass-face'};d=new.validate_part_zip(fixture({'bassFace':b}));self.assertEqual(d.get('characterFxVersion'),None if input=='DAW' else 1)
   d=new.validate_part_zip(fixture({'loopD':{'enabled':False,'mutilator':{'enabled':True,'input':input,'amount':.6,'mix':.6}}}));self.assertEqual(d.get('characterFxVersion'),None if input in ('DAW','D') else 1)
 def test_all_strains_validate(self):
  self.assertEqual(len(new.BASS_FACE_STRAINS),30)
  for strain in new.BASS_FACE_STRAINS:new.validate_part_zip(fixture({'bassFace':{'enabled':True,'strain':strain}}))
 def test_reject_bad_controls(self):
  for bad in [{'input':'X;eval'},{'strain':'unknown'},{'enabled':'yes'},{'mix':math.inf},{'amount':-1},{'body':2},{'tone':True}]:
   with self.assertRaises(ValueError):new.validate_part_zip(fixture({'bassFace':bad}))
 def test_copy_X_includes_character_but_legacy_clears_it(self):
  bass={'enabled':True,'input':'A','strain':'tape-hug'}
  source=fixture({'bassFace':bass});destination=fixture({})
  body=new.paste_loop_archive(destination,source,'X')
  with zipfile.ZipFile(BytesIO(body)) as z:self.assertEqual(json.loads(z.read('song-part.json'))['state']['modes']['bassFace'],bass)
  body=new.paste_loop_archive(source,destination,'X')
  with zipfile.ZipFile(BytesIO(body)) as z:self.assertNotIn('bassFace',json.loads(z.read('song-part.json'))['state']['modes'])
 def test_default_D_explicit_hash(self):
  a={'loopD':{'enabled':False,'mutilator':{'enabled':False,'strain':'gnaw'}}};body=fixture(a);before=new.validate_part_zip(body);a['loopD']['mutilator']['input']='D';self.assertEqual(before,new.validate_part_zip(fixture(a)))
if __name__=='__main__':unittest.main()
