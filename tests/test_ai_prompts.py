import copy
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import stat
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('ai_prompts_tests', Path(__file__).parents[1] / 'backend/mygrain_ai_patch.py')
ai = importlib.util.module_from_spec(spec); spec.loader.exec_module(ai)
store = ai.prompts
OWNER = 'a' * 32
OTHER = 'b' * 32
CURRENT = {k: v['min'] for k, v in ai.CONTROLS.items()}; CURRENT.update(hpfCutoff=20, lpfCutoff=12000)
LOOPS = {k: {'enabled': True, 'loaded': True, 'samples': ['fixture.wav']} for k in ai.LOOPS}
STATE = {'X': [36, None] * 8, 'L': [60, None] * 8, 'Q': {'instrument': 'strings', 'sequence': [{'notes': [60, 63, 67], 'rest': False, 'gate': 7.2, 'velocity': 82}] + [None] * 15}, 'drumsEnabled': True, 'drums': {k: [1, 0] * 8 for k in ['kick', 'snare', 'hat']}}
RECIPE = {'title': 'Darker', 'description': 'Lower bass cutoff; keep harmony and sources.', 'parameters': {'performanceBastardLoopXFilterCutoff': 1200}, 'loops': {}}


class Handler:
    def __init__(self, body=None, user=True):
        raw = json.dumps(body).encode() if body is not None else b''
        self.rfile = io.BytesIO(raw); self.headers = {'Content-Type': 'application/json', 'Content-Length': str(len(raw))}; self.mygrain_user = {'id': OWNER} if user else None
    def send_json(self, payload, status=200, extra_headers=None): self.result = (status, payload, extra_headers)


class PromptLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.db = Path(self.temp.name) / 'ai-prompts.sqlite3'
    def save(self, name='Warm chords', prompt='Warm Q strings and bass', owner=OWNER): return store.library(self.db, owner, {'action': 'save', 'name': name, 'prompt': prompt})

    def test_saved_recalled_reopened_and_private(self):
        self.assertEqual(store.library(self.db, OWNER)['prompts'], [])
        saved = self.save(); recalled = store.library(self.db, OWNER)
        self.assertEqual(saved['prompts'], recalled['prompts']); self.assertEqual(saved['savedId'], recalled['prompts'][0]['id'])
        self.assertEqual(store.library(self.db, OTHER)['prompts'], [])
        self.assertEqual(stat.S_IMODE(self.db.stat().st_mode), 0o600)
        self.assertEqual(self.save(owner=OTHER)['prompts'][0]['name'], 'Warm chords')

    def test_names_idempotence_and_no_silent_overwrite(self):
        first = self.save(); self.assertEqual(self.save(name='WARM CHORDS')['savedId'], first['savedId'])
        with self.assertRaises(ValueError): self.save(prompt='Different direction')
        self.assertEqual(store.library(self.db, OWNER)['prompts'][0]['prompt'], 'Warm Q strings and bass')

    def test_soft_remove_owner_scope_and_original_text_retained(self):
        identifier = self.save()['savedId']
        with self.assertRaises(ValueError): store.library(self.db, OTHER, {'action': 'remove', 'id': identifier})
        self.assertEqual(store.library(self.db, OWNER, {'action': 'remove', 'id': identifier})['prompts'], [])
        with sqlite3.connect(self.db) as db:
            row = db.execute('SELECT prompt,removed_at FROM prompts').fetchone(); self.assertEqual(row[0], 'Warm Q strings and bass'); self.assertTrue(row[1])
        self.assertNotEqual(self.save()['savedId'], identifier)

    def test_validation_limits_and_symlink(self):
        for body in [None, [], {'action': 'save', 'name': 'A', 'prompt': 'ok'}, {'action': 'save', 'name': 'A'*81, 'prompt': 'Valid prompt'}, {'action': 'save', 'name': 'A', 'prompt': 'x'*1501}, {'action': 'save', 'name': 'A\nB', 'prompt': 'valid'}, {'action': 'save', 'name': 'A', 'prompt': 'valid', 'owner': OTHER}, {'action': 'remove', 'id': '../escape'}]:
            if body is None: continue
            with self.subTest(body=body), self.assertRaises(ValueError): store.library(self.db, OWNER, body)
        with patch.object(store, 'MAX_PROMPTS', 1):
            self.save()
            with self.assertRaises(ValueError): self.save(name='Second')
        target = Path(self.temp.name) / 'link.sqlite'; target.symlink_to(self.db)
        with self.assertRaises(OSError): store.library(target, OWNER)

    def test_concurrent_duplicate_save_no_overwrite(self):
        store.library(self.db, OWNER)
        with ThreadPoolExecutor(max_workers=4) as pool: results = list(pool.map(lambda _: self.save(), range(4)))
        self.assertEqual(len({r['savedId'] for r in results}), 1); self.assertEqual(len(store.library(self.db, OWNER)['prompts']), 1)

    def test_http_auth_validation_and_safe_storage_errors(self):
        h = Handler(user=False); store.handle_request(h, 'GET', self.db); self.assertEqual(h.result[0], 401)
        h = Handler({'action': 'save', 'name': 'Mine', 'prompt': 'Warm piano'}); store.handle_request(h, 'POST', self.db); self.assertEqual(h.result[0], 200); self.assertEqual(h.result[2]['Cache-Control'], 'no-store')
        h = Handler(); store.handle_request(h, 'GET', None); self.assertEqual(h.result[0], 503)
        for method in ['DELETE', 'PUT']:
            h = Handler(); store.handle_request(h, method, self.db); self.assertEqual(h.result[0], 400)
        h = Handler({}); h.headers['Content-Type'] = 'text/plain'; store.handle_request(h, 'POST', self.db); self.assertEqual(h.result[0], 400)
        h = Handler({}); h.headers['Content-Length'] = '90000'; store.handle_request(h, 'POST', self.db); self.assertEqual(h.result[0], 400)


class RefineTests(unittest.TestCase):
    def direction(self, **updates):
        body = {'prompt': 'Warm C minor chords', 'current': CURRENT, 'loops': LOOPS, 'mode': 'refine', 'refinement': 'Darker bass; keep notes and drums.', 'musicalState': copy.deepcopy(STATE)}; body.update(updates); return body

    def test_legacy_and_new_request_contracts(self):
        body = {'prompt': 'warm', 'current': CURRENT, 'loops': LOOPS}; self.assertEqual(ai.validate_direction(body)['mode'], 'generate')
        body = self.direction(); ai.validate_request(body); result = ai.validate_direction(body); self.assertEqual(result['musicalState'], STATE)
        self.assertEqual(ai.validate_direction({**body, 'mode': 'regenerate', 'refinement': ''})['mode'], 'regenerate')

    def test_invalid_context_mode_and_combined_length(self):
        for update in [{'mode': []}, {'mode': 'shell'}, {'refinement': ''}, {'refinement': 'x'*501}, {'musicalState': None}, {'prompt': 'x'*1490}, {'mode': 'regenerate'}]:
            with self.subTest(update=update), self.assertRaises(ValueError): ai.validate_direction(self.direction(**update))
        for mutate in [lambda s: s.update(X=[True]), lambda s: s.update(L=[128]), lambda s: s['Q'].update(instrument='other'), lambda s: s['Q']['sequence'][0].update(gate=float('nan')), lambda s: s['drums'].update(kick=[2]), lambda s: s['Q']['sequence'][0].update(notes=[60]*9)]:
            body = self.direction(); mutate(body['musicalState'])
            with self.assertRaises(ValueError): ai.validate_direction(body)

    def test_refine_rejects_library_reloads(self):
        for recipe in [{**RECIPE, 'loops': {'X': {'reload': True}}}, {**RECIPE, 'drums': {'tracks': {'kick': {'reload': True}}}}]:
            with patch.object(ai, 'run_model', return_value=recipe), self.assertRaises(ValueError): ai.generate('warm', CURRENT, LOOPS, direction=ai.validate_direction(self.direction()))

    def test_refine_partial_recipe_keeps_sources_and_supports_one_change(self):
        with patch.object(ai, 'run_model', return_value=copy.deepcopy(RECIPE)):
            result = ai.generate('warm', CURRENT, LOOPS, direction=ai.validate_direction(self.direction()))
        self.assertEqual(result, RECIPE)

    def test_model_gets_actual_notes_and_explicit_override(self):
        process = MagicMock(returncode=0); process.__enter__.return_value = process; process.communicate.return_value = (json.dumps({'outputs': [{'text': json.dumps(RECIPE)}]}), '')
        with patch.object(ai.subprocess, 'Popen', return_value=process) as run:
            ai.run_model('warm', CURRENT, LOOPS, direction=ai.validate_direction(self.direction()))
        prompt = run.call_args.args[0][-1]
        self.assertIn('REFINE MODE OVERRIDES', prompt); self.assertIn('NO library reloads', prompt); self.assertIn('"X":[36,null', prompt); self.assertIn('"notes":[60,63,67]', prompt)


if __name__ == '__main__': unittest.main()
