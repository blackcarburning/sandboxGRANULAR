import copy,json,unittest
import test_ember as e
class EmberLfoSync(unittest.TestCase):
 def recipe(self):return dict(e.recipe,enabled=True,lfo=dict(enabled=True,wave='square',rate=.37,depth=.7,inverse=False,targets=[dict(key='level',inverse=False)]))
 def test_selective_v4_validation_and_legacy_hashes(self):
  v=self.recipe();old=e.s.validate_part_zip(e.body(v));self.assertEqual(old['emberVersion'],8)
  for divide in [1,2,3,4,6,8,12,16,24,32,48,64]:
   for multiply in [1,2,3,4,6,8,12,16,24,32,48,64]:
    a=copy.deepcopy(v);a['lfo']['sync']=dict(enabled=True,divide=divide,multiply=multiply);before=copy.deepcopy(a);e.s.validate_ember(a);self.assertEqual(e.s.validate_part_zip(e.body(a))['emberVersion'],8);self.assertEqual(a,before);a['lfo']['sync']['enabled']=False;self.assertEqual(e.s.validate_part_zip(e.body(a)),old)
  for sync in [None,{},dict(enabled=1,divide=1,multiply=1),dict(enabled=True,divide=True,multiply=1),dict(enabled=True,divide=0,multiply=1),dict(enabled=True,divide=1,multiply=7),dict(enabled=True,divide=1,multiply=float('inf'))]:
   a=copy.deepcopy(v);a['lfo']['sync']=sync
   with self.assertRaises(ValueError):e.s.validate_ember(a)
  a=copy.deepcopy(v);a['lfo']['sync']=dict(enabled=True,divide=8,multiply=3)
  for key,value in [('enabled',False),('depth',0),('targets',[])]:
   b=copy.deepcopy(a);b['lfo'][key]=value;c=copy.deepcopy(b);c['lfo'].pop('sync');self.assertEqual(e.s.validate_part_zip(e.body(b)),e.s.validate_part_zip(e.body(c)))
 def test_current_admission_original_snapshot_stale_get_and_source_immutable(self):
  f=e.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();a=self.recipe();a['lfo']['sync']=dict(enabled=True,divide=8,multiply=3);source=e.body(a);reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Synced&repeats=1',body=source);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0];self.assertEqual(p['emberVersion'],8)
   path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}'
   for decl in ['', '&ember=1', '&ember=2', '&ember=3', '&ember=4', '&ember=5', '&ember=6', '&ember=7', '&ember=11']:self.assertEqual(f.request('POST',path+decl,body=e.fixtures.render_wav(p)).status,400)
   self.assertEqual(f.request('POST',path+'&ember=8',body=e.fixtures.render_wav(p)).status,200)
   folder,stored=e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=3;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',path).status,404);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),source);self.assertEqual(e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}))[1]['revision'],revision)
  finally:f.tearDown()
