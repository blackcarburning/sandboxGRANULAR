import copy,os,pathlib,types,unittest
import test_ember as E
class EmberNoMod(unittest.TestCase):
 def test_raw_legacy_and_trial_selective_identity(self):
  old=types.ModuleType('old_no_mod');old.__file__=E.s.__file__;exec(compile((pathlib.Path(os.environ['TASK'])/'baseline/sandboxGRANULAR/backend/mygrain_songs.py').read_text(),old.__file__,'exec'),old.__dict__)
  for v in [E.recipe,dict(E.recipe,enabled=True),dict(E.recipe,enabled=True,oscDivider=4,pulseDivider=6),dict(E.recipe,enabled=True,cableStrengthBypass=True)]:self.assertEqual(old.validate_part_zip(E.body(v)),E.s.validate_part_zip(E.body(v)))
  for extra in [dict(cables=E.recipe['cables']+[dict(from_='osc5',to='mod1',amount=.8)]),dict(rhythm=dict(version=1,density=0,decay=.14,swing=.12,spread=.85,seed=173))]:
   extra=copy.deepcopy(extra)
   for c in extra.get('cables',[]):
    if 'from_' in c:c['from']=c.pop('from_')
   v=dict(E.recipe,enabled=True,**extra);E.s.validate_ember(v);self.assertEqual(E.s.validate_part_zip(E.body(v))['emberVersion'],13)
 def test_raw_freshness_and_immutable_source(self):
  f=E.fixtures.SongBackendTests();f.setUp()
  try:
   for extra in [dict(cables=E.recipe['cables']+[{'from':'osc5','to':'mod1','amount':.8}]),dict(rhythm=dict(version=1,density=0,decay=.14,swing=.12,spread=.85,seed=173))]:
    song=f.create();source=E.body(dict(E.recipe,enabled=True,**extra));base=f'/api/songs/{song["id"]}';reply=f.request('POST',base+'/parts?name=Rollback',body=source);self.assertEqual(reply.status,201);part=reply.response['song']['parts'][0];self.assertEqual(part['emberVersion'],13);url=base+f'/parts/{part["id"]}';query=f'/render?sha256={part["sha256"]}';wav=E.fixtures.render_wav(part)
    for version in ['', '8','9','10','11','12','14']:self.assertEqual(f.request('POST',url+query+'&ember='+version,body=wav).status,400)
    self.assertEqual(f.request('POST',url+query+'&ember=13',body=wav).status,200)
    folder,stored=E.s.read_song(song['id'],E.s.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('emberVersion');stored['parts'][0]['render']['emberVersion']=12;E.s.write_song(folder,stored,advance_revision=False)
    self.assertEqual(f.request('GET',url+'/render').status,404);self.assertEqual(f.request('POST',url+query+'&ember=12',body=wav).status,400);self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
    refreshed=f.request('POST',url+query+'&ember=13',body=wav);self.assertEqual(refreshed.status,200);self.assertEqual(refreshed.response['song']['revision'],revision)
  finally:f.tearDown()
