import copy,sys,pathlib,unittest,json,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tests'));import test_song_backend as fixtures
s=fixtures.SONGS
recipe=json.loads(subprocess.check_output(['node','-e',f"console.log(JSON.stringify(require({json.dumps(str(ROOT/'ember-dsp.js'))}).defaults()))"]))
def body(value):
 return fixtures.rewrite_part(fixtures.part_zip(),lambda m:m['state']['modes'].update(ember=copy.deepcopy(value)))
class EmberBackend(unittest.TestCase):
 def test_off_preserves_legacy_identity_and_active_is_versioned(self):
  old=s.validate_part_zip(fixtures.part_zip());off=s.validate_part_zip(body(recipe));self.assertEqual(old,off)
  active=dict(recipe,enabled=True);details=s.validate_part_zip(body(active));self.assertEqual(details['emberVersion'],8);self.assertNotEqual(old['contentSha256'],details['contentSha256']);self.assertEqual(old,s.validate_part_zip(body(dict(active,level=0))))
 def test_invalid_controls_cables_and_nonfinite_rejected(self):
  for values in [dict(recipe,feedback=1),dict(recipe,tempo=99999),dict(recipe,level=float('nan')),dict(recipe,frequencies=[110]),dict(recipe,cables=[{'from':'not-a-pad','to':'lowL','amount':1}]),dict(recipe,cables=[recipe['cables'][0]]*2)]:
   with self.assertRaises(ValueError):s.validate_ember(values)
 def test_source_membership_parity(self):
  self.assertIn('E',s.solo_effect_sources({'modes':{'loopLayerSolo':['bastarde']}}));state={'modes':{'loopLayerSolo':['bastarde'],'bassFace':{'version':1,'enabled':True,'input':'all','mix':0,'amount':.6}}};self.assertEqual(s.effect_output_render_version(state),7)
 def test_off_amendment_drops_active_capability(self):
  f=fixtures.SongBackendTests();f.setUp()
  try:
   song=f.create();v=body(dict(recipe,enabled=True));reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Ember&repeats=1',body=v);self.assertEqual(reply.status,201);part=reply.response['song']['parts'][0];self.assertEqual(part['emberVersion'],8)
   path=f'/api/songs/{song["id"]}/parts/{part["id"]}'
   saved=f.request('POST',path+f'/save?sha256={part["sha256"]}&name=Off&repeats=1',body=body(recipe));self.assertEqual(saved.status,200);self.assertNotIn('emberVersion',saved.response['song']['parts'][0])
   legacy=f.request('POST',f'/api/songs/{song["id"]}/parts?name=Legacy&repeats=1',body=fixtures.part_zip()).response['song']['parts'][-1]
   path=f'/api/songs/{song["id"]}/parts/{legacy["id"]}';wav=fixtures.render_wav(legacy);render=f.request('POST',path+f'/render?sha256={legacy["sha256"]}&keyboard=1&grain=1',body=wav);self.assertEqual(render.status,200)
   unchanged=f.request('POST',path+f'/save?sha256={legacy["sha256"]}&name=StillOff&repeats=1',body=body(recipe));self.assertEqual(unchanged.status,200);updated=unchanged.response['song']['parts'][-1];self.assertEqual(updated['contentSha256'],legacy['contentSha256']);self.assertEqual(updated['render']['sha256'],render.response['song']['parts'][-1]['render']['sha256']);self.assertEqual(f.request('GET',path+'/render').wfile.getvalue(),wav)

  finally:f.tearDown()
if __name__=='__main__':unittest.main()
