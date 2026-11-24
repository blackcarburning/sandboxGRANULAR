"""Only implicit-wet Playground audio invalidates old Cooking Pot renders."""
import copy, importlib.util, json, os, pathlib, subprocess, unittest
from test_song_backend import SONGS as songs, part_zip, rewrite_part
ROOT=pathlib.Path(__file__).resolve().parents[1]
class PlaygroundActivation(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.wasp=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./wasp-dsp.js').normalize()))"],cwd=ROOT))
  spec=importlib.util.spec_from_file_location('activation_before',os.environ['MYGRAIN_BASELINE_BACKEND']);cls.before=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.before)
 def test_selective_capability_and_immutable_archives(self):
  changed=0
  for enabled in [False,True]:
   for source in ['all','A','DAW']:
    for mix in [None,0,.5,1]:
     wasp=copy.deepcopy(self.wasp);wasp['playground'].update(enabled=enabled,input=source)
     if mix is None:wasp['playground'].pop('mix',None)
     else:wasp['playground']['mix']=mix
     body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(wasp=wasp));original=bytes(body)
     new=songs.validate_part_zip(body);old=self.before.validate_part_zip(body)
     affected=enabled and source!='DAW' and mix is None
     self.assertEqual(new.get('cookingPotVersion',0),0 if not enabled or source=='DAW' else 5 if mix is None else 4)
     self.assertEqual(new['contentSha256']!=old['contentSha256'],affected)
     self.assertEqual(body,original);changed+=affected
  self.assertEqual(changed,2)

import test_song_backend as _base
from test_song_backend import render_wav
class PlaygroundRenderAdmission(unittest.TestCase):
 setUp= _base.SongBackendTests.setUp
 tearDown= _base.SongBackendTests.tearDown
 request= _base.SongBackendTests.request
 create= _base.SongBackendTests.create
 def test_legacy_part_metadata_cannot_admit_stale_implicit_wet_render(self):
  wasp=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./wasp-dsp.js').normalize()))"],cwd=ROOT));wasp['playground']['enabled']=True;wasp['playground'].pop('mix',None)
  body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(wasp=wasp));song=self.create();base='/api/songs/'+song['id']
  song=self.request('POST',base+'/parts?name=Implicit&repeats=1',body=body).response['song'];part=song['parts'][0];folder,stored=songs.read_song(song['id'],songs.owner_hash({'X-Mygrain-Song-Key':'a'*64}))
  stored['parts'][0]['cookingPotVersion']=4;songs.write_song(folder,stored,advance_revision=False)
  endpoint=base+'/parts/'+part['id'];query='?sha256='+part['sha256']+'&playground=3&waspsource=1&unifiedinputs=3&effectoutput=8&samplecuts=1'
  rejected=self.request('POST',endpoint+'/render'+query+'&cookingpot=4',body=render_wav(part));self.assertEqual(rejected.status,400);self.assertIn('cooking pot',str(rejected.response).lower())
  accepted=self.request('POST',endpoint+'/render'+query+'&cookingpot=5',body=render_wav(part));self.assertEqual(accepted.status,200,str(accepted.response));self.assertEqual(accepted.response['song']['parts'][0]['render']['cookingPotVersion'],5)
  folder,stored=songs.read_song(song['id'],songs.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['render']['cookingPotVersion']=4;songs.write_song(folder,stored,advance_revision=False)
  self.assertEqual(self.request('GET',endpoint+'/render').status,404)
  refreshed=self.request('POST',endpoint+'/render'+query+'&cookingpot=5',body=render_wav(part));self.assertEqual(refreshed.status,200);self.assertEqual(self.request('GET',endpoint+'/render').wfile.getvalue(),render_wav(part));self.assertEqual(self.request('GET',endpoint).wfile.getvalue(),body)
  self.assertEqual(refreshed.response['song']['revision'],song['revision'])

if __name__=='__main__':unittest.main()
