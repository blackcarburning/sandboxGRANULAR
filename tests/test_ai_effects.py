import importlib.util,pathlib,unittest,json,copy,os
from unittest.mock import patch,MagicMock
p=pathlib.Path(os.environ.get('MYGRAIN_STAGE',pathlib.Path(__file__).parents[1]))
spec=importlib.util.spec_from_file_location('ai',p/'backend/mygrain_ai_patch.py');ai=importlib.util.module_from_spec(spec);spec.loader.exec_module(ai)
class Effects(unittest.TestCase):
 def recipe(self):return {'title':'Effect only','description':'Controlled bass colour','parameters':{},'loops':{},'effects':{'bassFace':{'enabled':True,'input':'X','amount':.3,'mix':.4}},'cardEffects':{'X':{'filterEnabled':True,'cutoff':1800,'lfoBeats':1,'lfoDepth':.2}}}
 def test_valid_effect_only(self):self.assertEqual(ai.validate_recipe(self.recipe()),self.recipe())
 def test_invalid_contract(self):
  for group,key,field,value in [('effects','bubbleChamber','enabled',True),('effects','bassFace','mix',2),('effects','bassFace','mix',True),('effects','bassFace','input','DAW'),('effects','wasp','destination','D'),('cardEffects','generated','room',.2),('cardEffects','D','filterSlope',25),('effects','wireWorld','feedback',float('nan'))]:
   r=self.recipe();r[group]={key:{field:value}}
   with self.subTest(group=group,key=key,field=field),self.assertRaises(ValueError):ai.validate_recipe(r)
 def test_effects_reach_all_modes(self):
  for mode in ['generate','regenerate','refine','section']:
   process=MagicMock(returncode=0);process.__enter__.return_value=process;process.communicate.return_value=(json.dumps({'outputs':[{'text':json.dumps(self.recipe())}]}),'')
   with patch.object(ai.subprocess,'Popen',return_value=process):
    ai.run_model('dark bass',{}, {},direction={'mode':mode,'effectState':{'effects':{'bassFace':{'enabled':False}}}})
    text=process.communicate.call_args.kwargs['input'];self.assertIn('effectCapabilities',text);self.assertIn('currentEffects',text);self.assertIn(ai.GENRE_MEMORY,text)
 def test_effect_only_generate_not_noop(self):
  current={k:s['min'] for k,s in ai.CONTROLS.items()};current.update(lpfCutoff=12000,hpfCutoff=20);loops={k:{'enabled':False,'loaded':False,'samples':[]} for k in ai.LOOPS}
  ctx={'status':'fallback','reason':'fixture','catalogueCount':0,'eligibleCount':0,'candidates':{},'entries':{}}
  with patch.object(ai.catalogue,'retrieve',return_value=ctx),patch.object(ai.catalogue,'with_x_repository',return_value=ctx),patch.object(ai.catalogue,'attach_selections'),patch.object(ai,'run_model',return_value=self.recipe()):self.assertEqual(ai.generate('dark bass',current,loops),self.recipe())
 def test_every_genre_has_effects(self):
  for key in ai.GENRES:
   text=ai.GENRE_MEMORY.split('## '+key+' — ',1)[1].split('\n## ',1)[0];self.assertIn('**Useful effects:**',text)
if __name__=='__main__':unittest.main()
