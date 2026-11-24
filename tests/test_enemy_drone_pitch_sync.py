import copy, unittest, json
from test_enemy_drone import source, fixture
from test_enemy_drone_living import BASE
from test_enemy_drone_pitch_lfo import LFO
S=fixture.SONGS
class EnemyPitchSync(unittest.TestCase):
 def test_compatibility_and_ratios(self):
  prior=S.validate_part_zip(source(dict(copy.deepcopy(BASE),pitchLfo=LFO)))
  for ratio in (1/16,1/8,1/4,1/2,1,2,4,8,16):
   lfo=dict(LFO,sync=True,ratio=ratio)
   self.assertEqual(S.validate_part_zip(source(dict(copy.deepcopy(BASE),pitchLfo=lfo)))['enemyDroneVersion'],7)
   self.assertEqual(S.validate_part_zip(source(dict(copy.deepcopy(BASE),pitchLfo=dict(lfo,sync=False)))),prior)
  for key, values in {'sync':[0,1,'yes',None],'ratio':[0,-1,3,32,True,'1',None,float('nan')]}.items():
   for value in values:
    with self.subTest(key=key,value=value),self.assertRaises(ValueError):S.validate_part_zip(source(dict(copy.deepcopy(BASE),pitchLfo=dict(LFO,sync=True,ratio=1,**{})|{key:value})))
 def test_server_capability_and_stamp(self):
  f=fixture.SongBackendTests();f.setUp()
  try:
   song=f.create();raw=source(dict(copy.deepcopy(BASE),pitchLfo=dict(LFO,sync=True,ratio=2)));r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=PitchSync&repeats=1',body=raw);self.assertEqual(r.status,201);song=r.response['song'];part=song['parts'][0];self.assertEqual(part['enemyDroneVersion'],7)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1'
   for version in ('','&enemy=6','&enemy=8'):self.assertEqual(f.request('POST',url+version,body=fixture.render_wav(part)).status,400)
   self.assertEqual(f.request('POST',url+'&enemy=7',body=fixture.render_wav(part)).status,200);self.assertEqual(f.request('GET',url).status,200)
   self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}').response['song']['parts'][0]['render']['enemyDroneVersion'],7)
  finally:f.tearDown()
