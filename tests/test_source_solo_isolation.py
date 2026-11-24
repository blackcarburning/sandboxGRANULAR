"""Source-Solo capability parity, legacy identities, immutable ZIPs and stale admission."""
import copy,importlib.util,json,os,pathlib,subprocess,unittest
import test_song_backend as fixtures
ROOT=pathlib.Path(__file__).resolve().parents[1];songs=fixtures.SONGS

def body(modes,extra=None):
 def change(m):
  m['state']['modes'].update(copy.deepcopy(modes))
  if extra:m['extra'].update(copy.deepcopy(extra))
 return fixtures.rewrite_part(fixtures.part_zip(),change)

def bass(source='all',enabled=True):return {'version':1,'enabled':enabled,'input':source,'amount':.6,'mix':0}

class SoloIdentity(unittest.TestCase):
 def test_js_python_capabilities(self):
  masks=[{}, {'loopLayerSolo':['bastarda']},{'loopLayerSolo':['bastardb']},{'loopLayerSolo':['bastardk']},{'drumMachineLaneSolos':['kick']},{'grainLayerSolo':['A']},{'generatedSampleSolo':True}]
  for mask in masks:
   for source in ['A','B','all','K','drums','DAW']:
    for enabled in [False,True]:
     m={**mask,'bassFace':bass(source,enabled)}
     js=int(subprocess.check_output(['node','-e',"console.log(require('./effect-inputs.js').soloInsertVersion(JSON.parse(process.argv[1]),JSON.parse(process.argv[2])))",json.dumps(m),'[]'],cwd=ROOT))
     self.assertEqual(songs.effect_output_render_version({'modes':m})==7,js==7,(m,js))
  for extra in [{'performanceSourceLayerSolo':['osc']},{'performanceSourceLayerSolo':['granular']},{'performanceSourceLayerSolo':['loop']}]:
   m={'bassFace':bass()};self.assertEqual(songs.validate_part_zip(body(m,extra))['effectOutputVersion'],7)
 def test_zero_return_and_legacy_group_metadata_still_own_source(self):
  for group_enabled in [False,True]:
   for level in [0,.7]:
    m={'loopLayerSolo':['bastarda'],'wireWorld':{'version':1,'enabled':True,'source':'A','level':level},'cookingPot':{'version':1,'enabled':group_enabled,'order':list(songs.COOKING_POT_KEYS)}}
    value=body(m);original=bytes(value);self.assertEqual(songs.validate_part_zip(value)['effectOutputVersion'],7);self.assertEqual(original,value)
 def test_unaffected_snapshots_keep_exact_baseline_identity(self):
  spec=importlib.util.spec_from_file_location('solo_baseline',os.environ['MYGRAIN_BASELINE_BACKEND']);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
  for m in [{},{'bassFace':bass()},{'loopLayerSolo':['bastarda']},{'loopLayerSolo':['bastarda'],'bassFace':bass('B')},{'loopLayerSolo':['bastarda'],'bassFace':bass('DAW')},{'loopLayerSolo':['bastarda'],'bassFace':bass(enabled=False)}]:
   value=body(m);self.assertEqual(songs.validate_part_zip(value),old.validate_part_zip(value),m)
 def test_only_affected_render_content_identity_is_versioned(self):
  spec=importlib.util.spec_from_file_location('solo_baseline_hash',os.environ['MYGRAIN_BASELINE_BACKEND']);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
  value=body({'loopLayerSolo':['bastarda'],'bassFace':bass()});before=old.validate_part_zip(value);after=songs.validate_part_zip(value);self.assertNotEqual(before['contentSha256'],after['contentSha256']);self.assertEqual(after['effectOutputVersion'],7)

class SoloAdmission(unittest.TestCase):
 def setUp(self):self.fixture=fixtures.SongBackendTests();self.fixture.setUp()
 def tearDown(self):self.fixture.tearDown()
 def test_stale_v6_get_post_rejected_without_modifying_sources(self):
  f=self.fixture;song=f.create();value=body({'loopLayerSolo':['bastarda'],'bassFace':bass()});reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Solo&repeats=1',body=value);self.assertEqual(reply.status,201);song=reply.response['song'];part=song['parts'][0]
  self.assertEqual(part['effectOutputVersion'],7)
  base=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}'
  flags='&samplecuts=1&acousticfx=9&cookingpot=4&unifiedinputs=3&loopd=2&characterfx=1'
  self.assertEqual(f.request('POST',base+flags+'&effectoutput=6',body=fixtures.render_wav(part)).status,400)
  saved=f.request('POST',base+flags+'&effectoutput=7',body=fixtures.render_wav(part));self.assertEqual(saved.status,200)
  folder,stored=songs.read_song(song['id'],songs.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0]['effectOutputVersion']=5;stored['parts'][0]['render']['effectOutputVersion']=6;(folder/'song.json').write_text(json.dumps(stored))
  self.assertEqual(f.request('GET',base).status,404)
  self.assertEqual(f.request('POST',base+flags+'&effectoutput=6',body=fixtures.render_wav(part)).status,400)
  self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),value)
  self.assertEqual(saved.response['song']['revision'],song['revision']);self.assertEqual(saved.response['song']['parts'][0]['sha256'],part['sha256'])

if __name__=='__main__':unittest.main()
