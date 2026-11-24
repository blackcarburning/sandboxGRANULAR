import copy,unittest,json,subprocess
from pathlib import Path
import test_ember as e
class EmberLfo(unittest.TestCase):
 def lfo(self,**kw):return dict(enabled=True,wave='sine',rate=.2,depth=.7,inverse=False,targets=[dict(key='freq0',inverse=False)],**kw)
 def test_identity_validation_and_selective_capability(self):
  active=dict(e.recipe,enabled=True);legacy=e.s.validate_part_zip(e.body(active));lfo=self.lfo()
  for ext in [dict(balance=.5),dict(lfo={**lfo,'enabled':False}),dict(lfo={**lfo,'depth':0}),dict(lfo={**lfo,'targets':[]})]:self.assertEqual(e.s.validate_part_zip(e.body(dict(active,**ext))),legacy)
  for ext in [dict(lfo=lfo),dict(balance=0),dict(balance=1),dict(lfo={**lfo,'targets':[dict(key='level',inverse=True)]},level=0)]:
   v=dict(active,**ext);before=copy.deepcopy(v);e.s.validate_ember(v);self.assertEqual(e.s.validate_part_zip(e.body(v))['emberVersion'],8);self.assertEqual(v,before)
   v['enabled']=False;self.assertEqual(e.s.validate_part_zip(e.body(v)),e.s.validate_part_zip(e.fixtures.part_zip()))
  for invalid in [dict(balance=True),dict(balance=-1),dict(lfo={}),dict(lfo={**lfo,'rate':0}),dict(lfo={**lfo,'depth':2}),dict(lfo={**lfo,'inverse':1}),dict(lfo={**lfo,'targets':[dict(key='volume',inverse=False)]}),dict(lfo={**lfo,'targets':lfo['targets']*2})]:
   with self.assertRaises(ValueError):e.s.validate_ember(dict(active,**invalid))
  script="const M=require('./ember-dsp.js');console.log(JSON.stringify(Array.from({length:300},(_,i)=>M.randomPatch(M.defaults(),i+1))))"
  recipes=json.loads(subprocess.check_output(['node','-e',script],cwd=Path(__file__).resolve().parents[1]));self.assertEqual(len(recipes),300)
  for v in recipes:e.s.validate_ember(v)
  keys=[*(f'freq{i}' for i in range(5)),*(f'pulse{i}' for i in range(6)),'level','pitch','tone','modDepth','delayTime','feedback','bizarre','balance','tempo','pulseRate']
  all_targets={**lfo,'targets':[dict(key=k,inverse=True) for k in keys]};e.s.validate_ember(dict(active,lfo=all_targets));self.assertEqual(e.s.validate_part_zip(e.body(dict(active,lfo=all_targets)))['emberVersion'],8)
 def test_current_admission_and_stale_get_use_immutable_original(self):
  f=e.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=e.body(dict(e.recipe,enabled=True,lfo=self.lfo()));reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=LFO&repeats=1',body=source);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0];self.assertEqual(p['emberVersion'],8)
   path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}'
   for declaration in ['', '&ember=1', '&ember=2', '&ember=3', '&ember=4', '&ember=5', '&ember=6', '&ember=7', '&ember=11']:self.assertEqual(f.request('POST',path+declaration,body=e.fixtures.render_wav(p)).status,400)
   self.assertEqual(f.request('POST',path+'&ember=8',body=e.fixtures.render_wav(p)).status,200)
   folder,stored=e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=2;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',path).status,404)
   self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),source);self.assertEqual(e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}))[1]['revision'],revision)
  finally:f.tearDown()
