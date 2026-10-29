import copy
import json
from unittest.mock import MagicMock, patch
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('genre_ai',pathlib.Path(__file__).parents[1]/'backend/mygrain_ai_patch.py')
ai=importlib.util.module_from_spec(spec);spec.loader.exec_module(ai)
class Genres(unittest.TestCase):
 def recipe(self,genre='experimental',tempo=120):
  r={'title':'Texture','description':'Modular and Terra pulse','parameters':{'globalBpmSlider':tempo},'loops':{k:{'enabled':False} for k in ai.LOOPS}}
  if genre=='experimental':
   r['loops']['W']={'enabled':True,'reload':True,'divisions':['1/8']}
   r['loops']['L']={'enabled':True,'reload':True,'repository':'samples_terra','notes':[48,None,55,None]}
  return r
 def test_experimental_contract(self):
  r=self.recipe();ai.validate_recipe(r);ai.validate_genre_recipe(r,{'genre':'experimental','genreBpm':None})
  for key in ['P','O','Q']:
   bad=copy.deepcopy(r);bad['loops'][key]['enabled']=True
   with self.assertRaises(ValueError):ai.validate_genre_recipe(bad,{'genre':'experimental'})
  bad=copy.deepcopy(r);bad['loops']['L']['repository']='samples_leads'
  with self.assertRaises(ValueError):ai.validate_genre_recipe(bad,{'genre':'experimental'})
 def test_dnb_exclusions_and_tempo(self):
  r=self.recipe('dnb',174);ai.validate_genre_recipe(r,{'genre':'dnb'})
  for key in ['P','O','Q']:
   bad=copy.deepcopy(r);bad['loops'][key]['enabled']=True
   with self.assertRaises(ValueError):ai.validate_genre_recipe(bad,{'genre':'dnb'})
  with self.assertRaises(ValueError):ai.validate_genre_recipe(self.recipe('dnb',120),{'genre':'dnb'})
  ai.validate_genre_recipe(self.recipe('dnb',120),{'genre':'dnb','genreBpm':120})
 def test_full_genre_memory_is_mandatory_for_every_model_call(self):
  for genre in [None, *ai.GENRES]:
   process=MagicMock(returncode=0)
   process.__enter__.return_value=process
   process.communicate.return_value=(json.dumps({'outputs':[{'text':json.dumps(self.recipe())}]}),'')
   direction={'mode':'generate',**({'genre':genre,'genreBpm':None} if genre else {})}
   with self.subTest(genre=genre),patch.object(ai.subprocess,'Popen',return_value=process):
    ai.run_model('new musical patch',{}, {},direction=direction)
    instruction=process.communicate.call_args.kwargs['input']
    self.assertIn(ai.GENRE_MEMORY,instruction)
    for key in ai.GENRES:self.assertIn(f'## {key} — ',instruction)
    if genre:self.assertIn('Never inherit the current BPM or a half-time sample BPM',instruction)
 def test_genre_memory_reaches_refinement_and_song_sections(self):
  for mode in ('regenerate','refine','section'):
   process=MagicMock(returncode=0)
   process.__enter__.return_value=process
   process.communicate.return_value=(json.dumps({'outputs':[{'text':json.dumps(self.recipe())}]}),'')
   with self.subTest(mode=mode),patch.object(ai.subprocess,'Popen',return_value=process):
    ai.run_model('keep the musical identity',{}, {},direction={'mode':mode})
    self.assertIn(ai.GENRE_MEMORY,process.communicate.call_args.kwargs['input'])
 def test_automatic_tempo_boundaries_for_every_genre(self):
  for genre,profile in ai.GENRES.items():
   for bpm in [profile['bpm'][0],profile['bpm'][1]]:
    r=self.recipe(tempo=bpm)
    with self.subTest(genre=genre,bpm=bpm):ai.validate_genre_recipe(r,{'genre':genre})
   for bpm in [profile['bpm'][0]-1,profile['bpm'][1]+1]:
    with self.subTest(genre=genre,bpm=bpm),self.assertRaises(ValueError):
     ai.validate_genre_recipe(self.recipe(tempo=bpm),{'genre':genre})
 def test_dnb_half_time_and_previous_tempo_rejected_before_apply(self):
  for bpm in [85,87,90,120,160,169]:
   with self.subTest(bpm=bpm),self.assertRaises(ValueError):
    ai.validate_genre_recipe(self.recipe('dnb',bpm),{'genre':'dnb','genreBpm':None})
  ai.validate_genre_recipe(self.recipe('dnb',90),{'genre':'dnb','genreBpm':90})
 def test_no_partial_genre_result(self):
  r=self.recipe();del r['loops']['O']
  with self.assertRaises(ValueError):ai.validate_genre_recipe(r,{'genre':'experimental'})
 def test_genre_request_bounds(self):
  for values in [{'genre':'unknown'},{'genre':'house','genreBpm':True},{'genre':'house','genreBpm':181},{'genreBpm':120},{'genre':'house','mode':'refine','refinement':'more hats'}]:
   with self.assertRaises(ValueError):ai.validate_direction({'prompt':'a new groove',**values})
  self.assertEqual(ai.validate_direction({'prompt':'groove','genre':'house','genreBpm':123})['genreBpm'],123)
 def test_unsupported_operations_stay_rejected(self):
  for mutation in [{'source':'secret'},{'repository':'unknown'},{'effect':'made up'}]:
   r=self.recipe();r['loops']['L'].update(mutation)
   with self.assertRaises(ValueError):ai.validate_recipe(r)
if __name__=='__main__':unittest.main()
