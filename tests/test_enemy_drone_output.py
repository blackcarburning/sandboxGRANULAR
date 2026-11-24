
import copy,json,subprocess,unittest,os,types,pathlib
from test_enemy_drone import source,fixture,ROOT
S=fixture.SONGS
BASE=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require('./enemy-drone-dsp.js').normalize({engineRevision:2,enabled:true})))"],cwd=ROOT,text=True))
VERB={'mix':.7,'size':.8,'decay':8,'tone':.6,'predelay':.03}
class EnemyOutput(unittest.TestCase):
 def test_legacy_neutral_identity_and_selective_revision(self):
  old=types.ModuleType('old');old.__file__=str(ROOT/'backend/mygrain_songs.py');exec(pathlib.Path(os.environ['ENEMY_BASELINE']).read_text(),old.__dict__)
  self.assertEqual(old.validate_part_zip(source(BASE)),S.validate_part_zip(source(BASE)))
  neutral={**BASE,'transpose':0,'finalReverb':{**VERB,'mix':0}}
  self.assertEqual(S.validate_part_zip(source(BASE)),S.validate_part_zip(source(neutral)))
  for change in [{'transpose':12},{'detune':100},{'finalReverb':VERB}]:self.assertEqual(S.validate_part_zip(source({**BASE,**change}))['enemyDroneVersion'],3)
  s=copy.deepcopy(BASE);s['voices'][0]['fine']=-100;self.assertEqual(S.validate_part_zip(source(s))['enemyDroneVersion'],3)
  off={**BASE,'enabled':False,'transpose':24,'finalReverb':VERB};self.assertEqual(S.validate_part_zip(source(off)),S.validate_part_zip(source()))
 def test_strict_optional_inventory_and_bounds(self):
  for change in [{'transpose':25},{'transpose':.5},{'transpose':True},{'detune':100.1},{'finalReverb':{**VERB,'mix':1.1}},{'finalReverb':{**VERB,'decay':12.1}},{'finalReverb':{**VERB,'predelay':.151}},{'finalReverb':{**VERB,'unknown':1}},{'finalReverb':{}},{'finalReverb':None}]:
   with self.subTest(change=change),self.assertRaises(ValueError):S.validate_part_zip(source({**BASE,**change}))
  s=copy.deepcopy(BASE);s['voices'][0]['fine']=101
  with self.assertRaises(ValueError):S.validate_part_zip(source(s))
 def test_original_source_upload_and_stale_get(self):
  f=fixture.SongBackendTests();f.setUp()
  try:
   song=f.create();raw=source({**BASE,'transpose':7,'finalReverb':VERB});r=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Output&repeats=1',body=raw);self.assertEqual(r.status,201);song=r.response['song'];p=song['parts'][0];self.assertEqual(p['enemyDroneVersion'],3)
   url=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}&samplecuts=1'
   for version in ['', '&enemy=1','&enemy=2','&enemy=8']:self.assertEqual(f.request('POST',url+version,body=fixture.render_wav(p)).status,400)
   r=f.request('POST',url+'&enemy=3',body=fixture.render_wav(p));self.assertEqual(r.status,200);self.assertEqual(r.response['song']['revision'],song['revision']);self.assertEqual(r.response['song']['parts'][0]['render']['enemyDroneVersion'],3);self.assertEqual(f.request('GET',url).status,200)
   folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['enemyDroneVersion']=2;stored['parts'][0]['render']['enemyDroneVersion']=2;(folder/'song.json').write_text(json.dumps(stored))
   self.assertEqual(f.request('GET',url).status,404);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),raw)
  finally:f.tearDown()
if __name__=='__main__':unittest.main()
