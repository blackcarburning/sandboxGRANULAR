import copy,json,subprocess,unittest,os,types,pathlib
from test_enemy_drone import source,fixture,ROOT
S=fixture.SONGS
BASE=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require('./enemy-drone-dsp.js').normalize({engineRevision:2,enabled:true})))"],cwd=ROOT,text=True))
DRIFT={'enabled':True,'amount':30,'speed':.12,'breath':.1,'pan':.2}
class EnemyLiving(unittest.TestCase):
 def test_legacy_neutral_and_selective_revision(self):
  old=types.ModuleType('old');old.__file__=str(ROOT/'backend/mygrain_songs.py');exec(pathlib.Path(os.environ['ENEMY_BASELINE']).read_text(),old.__dict__)
  self.assertEqual(old.validate_part_zip(source(BASE)),S.validate_part_zip(source(BASE)))
  neutral=copy.deepcopy(BASE);neutral['drift']={**DRIFT,'enabled':False}
  for v in neutral['voices']:v.update(waveform='original',width=.3)
  self.assertEqual(S.validate_part_zip(source(BASE)),S.validate_part_zip(source(neutral)))
  for shape in ['sine','triangle','saw','square','pulse']:
   v=copy.deepcopy(BASE);v['voices'][0].update(waveform=shape,width=.2);self.assertEqual(S.validate_part_zip(source(v))['enemyDroneVersion'],4)
  self.assertEqual(S.validate_part_zip(source({**BASE,'drift':DRIFT}))['enemyDroneVersion'],4)
  self.assertEqual(S.validate_part_zip(source({**neutral,'enabled':False})),S.validate_part_zip(source()))
  self.assertEqual(S.validate_part_zip(source({**BASE,'transpose':12}))['enemyDroneVersion'],3)
 def test_strict_no_noise_inventory_and_bounds(self):
  for change in [None,{}, {**DRIFT,'enabled':1},{**DRIFT,'amount':50.1},{**DRIFT,'speed':.009},{**DRIFT,'speed':.501},{**DRIFT,'breath':.31},{**DRIFT,'pan':.51},{**DRIFT,'amount':float('nan')},{**DRIFT,'unknown':0}]:
   with self.subTest(drift=change),self.assertRaises(ValueError):S.validate_part_zip(source({**BASE,'drift':change}))
  for change in [{'waveform':'noise'},{'waveform':None},{'waveform':'random'},{'width':.09},{'width':.91},{'width':True},{'width':float('inf')},{'unknown':0}]:
   v=copy.deepcopy(BASE);v['voices'][0].update(change)
   with self.subTest(voice=change),self.assertRaises(ValueError):S.validate_part_zip(source(v))
 def test_original_source_producer4_and_stale_get(self):
  f=fixture.SongBackendTests();f.setUp()
  try:
   song=f.create();v=copy.deepcopy(BASE);v['drift']=DRIFT;v['voices'][0].update(waveform='pulse',width=.21);raw=source(v);r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Living&repeats=1',body=raw);self.assertEqual(r.status,201);song=r.response['song'];part=song['parts'][0];self.assertEqual(part['enemyDroneVersion'],4)
   url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1'
   for version in ['', '&enemy=1','&enemy=2','&enemy=3','&enemy=8']:self.assertEqual(f.request('POST',url+version,body=fixture.render_wav(part)).status,400)
   r=f.request('POST',url+'&enemy=4',body=fixture.render_wav(part));self.assertEqual(r.status,200);self.assertEqual(r.response['song']['revision'],song['revision']);self.assertEqual(r.response['song']['parts'][0]['render']['enemyDroneVersion'],4);self.assertEqual(f.request('GET',url).status,200)
   folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['enemyDroneVersion']=3;stored['parts'][0]['render']['enemyDroneVersion']=3;(folder/'song.json').write_text(json.dumps(stored));self.assertEqual(f.request('GET',url).status,404);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
