import copy,unittest,json
import test_ember as e
class EmberPulses(unittest.TestCase):
 def test_v1_identity_and_v2_selective_capability(self):
  legacy=e.s.validate_part_zip(e.fixtures.part_zip());v1=dict(e.recipe,enabled=True)
  mixed=dict(v1,pulseFrequencies=[.01,.023,2.31,11.9,2560,None]);before=copy.deepcopy(mixed)
  e.s.validate_ember(mixed);self.assertEqual(before,mixed)
  self.assertEqual(e.s.validate_part_zip(e.body(v1))['emberVersion'],8)
  self.assertEqual(e.s.validate_part_zip(e.body(v1)),e.s.validate_part_zip(e.body(dict(v1,pulseFrequencies=[None]*6))))
  current=e.s.validate_part_zip(e.body(mixed));self.assertEqual(current['emberVersion'],8)
  self.assertNotEqual(current['contentSha256'],e.s.validate_part_zip(e.body(v1))['contentSha256'])
  for changes in [dict(enabled=False),dict(level=0),dict(cables=[])]:self.assertEqual(legacy,e.s.validate_part_zip(e.body(dict(mixed,**changes))))
 def test_new_fields_strictly_validated(self):
  for pulses in [None,[],[1]*5,[1]*7,[True]*6,['1']*6,[0]*6,[2561]*6,[float('nan')]*6,[float('inf')]*6]:
   with self.assertRaises(ValueError):e.s.validate_ember(dict(e.recipe,pulseFrequencies=pulses))
  for pulses in [[None]*6,[.01,2560,None,None,None,None]]:e.s.validate_ember(dict(e.recipe,pulseFrequencies=pulses))

 def test_current_render_admission_stale_get_and_immutable_sources(self):
  f=e.fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();source=e.body(dict(e.recipe,enabled=True,pulseFrequencies=[.01,.1,.37,1.3,17.3,61.7]))
   reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Independent&repeats=1',body=source);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0];self.assertEqual(p['emberVersion'],8)
   path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}'
   for declaration in ['', '&ember=1', '&ember=2', '&ember=3', '&ember=4', '&ember=5', '&ember=6', '&ember=7', '&ember=11']:self.assertEqual(f.request('POST',path+declaration,body=e.fixtures.render_wav(p)).status,400)
   saved=f.request('POST',path+'&ember=8',body=e.fixtures.render_wav(p));self.assertEqual(saved.status,200)
   folder,stored=e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=1;(folder/'song.json').write_text(json.dumps(stored))
   self.assertEqual(f.request('GET',path).status,404);self.assertEqual(f.request('POST',path+'&ember=1',body=e.fixtures.render_wav(p)).status,400)
   self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),source)
   self.assertEqual(e.s.read_song(song['id'],e.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}))[1]['revision'],revision)
  finally:f.tearDown()

 def test_five_voice_subhz_range_is_selectively_versioned(self):
  voice=dict(e.recipe,enabled=True,frequencies=[.01,.1,.25,1.37,7.31]);e.s.validate_ember(voice)
  self.assertEqual(e.s.validate_part_zip(e.body(voice))['emberVersion'],8)
  legacy=e.s.validate_part_zip(e.fixtures.part_zip())
  self.assertEqual(e.s.validate_part_zip(e.body(dict(voice,enabled=False))),legacy)
  for invalid in [[0]*5,[8001]*5,[float('nan')]*5]:
   with self.assertRaises(ValueError):e.s.validate_ember(dict(voice,frequencies=invalid))
