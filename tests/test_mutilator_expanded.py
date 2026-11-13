"""Expanded controls remain additive, validated and explicitly producer-versioned."""
import copy, json, math, os, pathlib, types, unittest
from test_song_backend import SONGS, part_zip, rewrite_part, render_wav, SongBackendTests
from test_d_mutilator import d_part
ROOT=pathlib.Path(__file__).resolve().parents[1]
oldpath=os.environ.get('MYGRAIN_BASELINE_BACKEND')
old=SONGS
if oldpath:
 old=types.ModuleType('old_mutilator_backend');old.__file__=str(ROOT/'backend/mygrain_songs.py')
 exec(compile(pathlib.Path(oldpath).read_text(),old.__file__,'exec'),old.__dict__)
D=SONGS.MUTILATOR.DEFAULTS

def alternate(m,enabled=False):
 return rewrite_part(part_zip(),lambda x:x['state']['modes'].update(loopD={'enabled':enabled,'mutilator':m}))

class ExpandedMutilator(unittest.TestCase):
 def test_all_legacy_signatures_and_neutral_fields_exact(self):
  for strain in ['gnaw','melt','rupture','scab','venom','hollow','splinter','diode','cinder','shred','vortex','maw']:
   for rhythm in [False,True]:
    for power in [False,True]:
     m={'enabled':power,'strain':strain,'rhythm':rhythm,'amount':.7,'tone':.4,'mix':.8}
     for body in [d_part(m),alternate({**m,'input':'A'})]:
      self.assertEqual(old.validate_part_zip(body),SONGS.validate_part_zip(body))
     self.assertEqual(SONGS.validate_part_zip(d_part(m)),SONGS.validate_part_zip(d_part({**m,**D})))
 def test_inactive_extensions_are_hash_neutral(self):
  for values in [{'enabled':False},{'input':'DAW'},{'mix':0},{'mix':None},{'amount':''},{'amount':'0'}]:
   m={'enabled':True,'input':'A',**values}
   self.assertEqual(SONGS.validate_part_zip(alternate(m)),SONGS.validate_part_zip(alternate({**m,'filter':'notch','resonance':.9,'freeDepth':.7,'freeRate':3,'output':-3})))
  m={'enabled':True,'input':'D'}
  self.assertEqual(SONGS.validate_part_zip(alternate(m)),SONGS.validate_part_zip(alternate({**m,'filter':'notch'})))
  m={'enabled':True,'input':'A','rhythm':False}
  self.assertEqual(SONGS.validate_part_zip(alternate(m)),SONGS.validate_part_zip(alternate({**m,'cycleBeats':8,'freeRate':3,'sweep':.4})))
 def test_new_controls_are_strictly_validated(self):
  invalid={'filter':['other',True,None,2,{}], 'resonance':[-.1,1.1,True,None,'0.5',math.nan,math.inf], 'sweep':[-1,2], 'cycleBeats':[0,3,16,True,'4'], 'freeRate':[0,13], 'freeDepth':[-.1,2], 'output':[-19,7]}
  for key,values in invalid.items():
   for value in values:
    with self.subTest(key=key,value=value),self.assertRaises(ValueError):SONGS.validate_part_zip(d_part({'enabled':True,key:value}))
  for key,values in {'filter':['auto','lowpass','highpass','bandpass','notch'],'resonance':[0,.5,1],'sweep':[0,1],'cycleBeats':[.5,1,2,4,8],'freeRate':[.125,12],'freeDepth':[0,1],'output':[-18,0,6]}.items():
   for v in values:SONGS.validate_part_zip(d_part({'enabled':True,key:v}))
 def test_only_active_new_processing_requires_marker(self):
  for recipe in [{'filter':'bandpass'},{'resonance':.9},{'output':-3},{'rhythm':True,'sweep':.3},{'rhythm':True,'cycleBeats':1},{'freeDepth':.7,'freeRate':3}]:
   for body in [d_part({'enabled':True,**recipe}),alternate({'enabled':True,'input':'A',**recipe})]:self.assertEqual(SONGS.validate_part_zip(body)['mutilatorControlsVersion'],1)
 def test_explicit_producer_marker_and_source_integrity(self):
  h=SongBackendTests();h.setUp()
  try:
   song=h.create();bodies=[alternate({'enabled':True,'input':'A','filter':'notch','freeDepth':.4,'freeRate':2}),d_part({'enabled':True,'strain':'venom','rhythm':True,'cycleBeats':1}),d_part({'enabled':True,'strain':'gnaw'})]
   for i,body in enumerate(bodies):
    r=h.request('POST',f'/api/songs/{song["id"]}/parts?name=Fixture{i}&repeats=1',body=body);self.assertEqual(r.status,201,r.response);song=r.response['song']
   revision=song['revision'];hashes=[p['sha256'] for p in song['parts']]
   for i,part in enumerate(song['parts']):
    route=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&characterfx=1&mutilator=2&effectoutput=1'
    r=h.request('POST',route,body=render_wav(part));self.assertEqual(r.status,400 if i<2 else 200,r.response)
    if i==2:self.assertNotIn('mutilatorControlsVersion',r.response['song']['parts'][i]['render'])
    self.assertEqual(h.request('POST',route+'&mutilatorcontrols=9',body=render_wav(part)).status,400)
    r=h.request('POST',route+'&mutilatorcontrols=1',body=render_wav(part));self.assertEqual(r.status,200,r.response);self.assertEqual(r.response['song']['parts'][i]['render']['mutilatorControlsVersion'],1)
    current=r.response['song'];self.assertEqual(current['revision'],revision);self.assertEqual([p['sha256'] for p in current['parts']],hashes)
    self.assertEqual(h.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),bodies[i])
   # Editing back to legacy controls clears only the optional source capability.
   p=current['parts'][0];body=alternate({'enabled':True,'input':'A'})
   r=h.request('POST',f'/api/songs/{song["id"]}/parts/{p["id"]}/save?sha256={p["sha256"]}',body=body)
   self.assertEqual(r.status,200,r.response);self.assertNotIn('mutilatorControlsVersion',r.response['song']['parts'][0])
  finally:h.tearDown()

if __name__=='__main__':unittest.main()
