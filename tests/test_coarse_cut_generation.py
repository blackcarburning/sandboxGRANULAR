import ast
import pathlib
import random
import unittest

class CoarseCuts(unittest.TestCase):
    def test_ai_schema_rejects_every_other_cut_resolution(self):
        import test_ai_patch as fixture
        self.assertEqual(fixture.ai.SCHEMA['divisions'], ['2', '1'])
        for value in ['4','1/2','1/4','1/8','1/16','1/32','uncut']:
            with self.assertRaises(ValueError):
                fixture.ai.validate_recipe({**fixture.RECIPE, 'loops': {'A': {'divisions': [value]}}})

    def test_real_server_schedule_never_selects_fine_divisions(self):
        path=pathlib.Path(__file__).resolve().parents[2]/'fs7300-documenter/server.py'
        tree=ast.parse(path.read_text())
        functions={'normalize_random_cut_divisions','build_bastardloop_schedule','clamp_bastardloop_pattern_steps'}
        nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in functions or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id.startswith('MYGRAIN_BASTARDLOOP_') for t in n.targets)]
        # Include literal constants only; source-library config has external dependencies.
        literals=[]
        for n in nodes:
            if isinstance(n,ast.FunctionDef):literals.append(n);continue
            try:ast.literal_eval(n.value)
            except (ValueError,TypeError):continue
            literals.append(n)
        scope={};exec(compile(ast.Module(body=literals,type_ignores=[]),str(path),'exec'),scope)
        for steps in [8,9,16,17,24,32,48,64]:
            for values in [None,[],['1/32'],['uncut'],['4'],['2'],['1'],['2','1'],['1/8','1']]:
                for seed in range(20):
                    schedule=scope['build_bastardloop_schedule'](random.Random(seed),values,steps)
                    self.assertEqual(sum(x['slots'] for x in schedule),steps*2)
                    self.assertTrue(all(x['label'] in ('2','1') for x in schedule))
                    self.assertTrue(all(x['slots']>=32 for x in schedule[:-1]))

if __name__=='__main__':unittest.main()
