import copy
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
