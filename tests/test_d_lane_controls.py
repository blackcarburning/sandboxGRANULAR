import copy, importlib.util, os, unittest, json
import test_d_four_lanes as f
S=f.S
class DControls(unittest.TestCase):
 def test_neutral_legacy_identities(self):
  spec=importlib.util.spec_from_file_location('before_dcontrols',os.environ['MYGRAIN_DCONTROLS_BASELINE']);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
  for d,keys in [({'enabled':False},('bastardD',)),({'enabled':True},('bastardD',)),({'enabled':True,'lanes':f.lanes()},('bastardD','bastardD2','bastardD3','bastardD4'))]:
   body=f.part(d,keys);self.assertEqual(S.validate_part_zip(body),old.validate_part_zip(body))
 def test_selective_new_revision(self):
  for field,value in [('pitch',12),('maximiser',50),('reverse',True),('shift',1),('cut',{'enabled':True,'start':.2,'end':.8}),('cut',{'gapEnabled':True,'gaps':[[.25,.5]]})]:
   lanes=f.lanes();lanes[1][field]=value
   body=f.part({'enabled':True,'lanes':lanes},('bastardD3',));self.assertEqual(S.validate_part_zip(body)['loopDVersion'],4)
   lanes[1]['enabled']=False;self.assertNotEqual(S.validate_part_zip(f.part({'enabled':True,'lanes':lanes},('bastardD3',))).get('loopDVersion'),4)
 def test_reject_invalid(self):
  for field,value in [('pitch',25),('maximiser',101),('reverse',1),('shift',.1),('shift',4097),('cut',[]),('cut',{'gaps':[[0,2]]}),('cut',{'enabled':1}),('cut',{'start':float('nan')})]:
   lanes=f.lanes();lanes[0][field]=value
   with self.subTest(field=field,value=value),self.assertRaises(ValueError):S.validate_part_zip(f.part({'enabled':True,'lanes':lanes},('bastardD2',)))
 def test_v4_admission_stale_get_and_sources(self):
  fixture=f.fixture.SongBackendTests();fixture.setUp()
  try:
   song=fixture.create();lanes=f.lanes();lanes[0]['pitch']=12;source=f.part({'enabled':True,'lanes':lanes},('bastardD2',));reply=fixture.request('POST',f'/api/songs/{song["id"]}/parts?name=DControls&repeats=1',body=source);self.assertEqual(reply.status,201);song=reply.response['song'];p=song['parts'][0];self.assertEqual(p['loopDVersion'],4)
   path=f'/api/songs/{song["id"]}/parts/{p["id"]}/render?sha256={p["sha256"]}&samplecuts=1'
   self.assertEqual(fixture.request('POST',path+'&loopd=3',body=f.fixture.render_wav(p)).status,400)
   saved=fixture.request('POST',path+'&loopd=4',body=f.fixture.render_wav(p));self.assertEqual(saved.status,200)
   folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));stored['parts'][0].pop('loopDVersion');stored['parts'][0]['render']['loopDVersion']=3;(folder/'song.json').write_text(json.dumps(stored))
   self.assertEqual(fixture.request('GET',path).status,404);self.assertEqual(fixture.request('POST',path+'&loopd=3',body=f.fixture.render_wav(p)).status,400)
   self.assertEqual(fixture.request('GET',f'/api/songs/{song["id"]}/parts/{p["id"]}').wfile.getvalue(),source)
  finally:fixture.tearDown()
if __name__=='__main__':unittest.main()
