import importlib.util
import io
import json
import pathlib
import subprocess
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('mygrain_ai_patch', pathlib.Path(__file__).parents[1] / 'backend/mygrain_ai_patch.py')
ai = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai)
CURRENT = {key: spec['min'] for key, spec in ai.CONTROLS.items()}
CURRENT.update(lpfCutoff=12000, hpfCutoff=20)
LOOPS = {key: {'enabled': False, 'loaded': False, 'samples': []} for key in ai.LOOPS}
RECIPE = {'title': 'Soft edges', 'description': 'Soft grains over existing sounds.', 'parameters': {'grainSize': 300, 'lpfCutoff': 2400, 'hpfCutoff': 80}, 'loops': {}}


class Handler:
    def __init__(self, data=None, user=True):
        body = json.dumps(data if data is not None else {'prompt': 'Warm hazy pad', 'current': CURRENT, 'loops': LOOPS}).encode()
        self.headers = {'Content-Length': str(len(body))}
        self.rfile = io.BytesIO(body)
        self.mygrain_user = {'id': 'test-user'} if user else None
        self.result = None

    def send_json(self, payload, status=200, extra_headers=None):
        self.result = (status, payload, extra_headers)


class AiPatchTests(unittest.TestCase):
    def setUp(self):
        ai.REQUESTS.clear()

    def test_controls_match_real_sliders(self):
        import re
        html = (pathlib.Path(__file__).parents[1] / 'index.html').read_text()
        self.assertEqual(len(ai.CONTROLS), 77)
        for key, spec in ai.CONTROLS.items():
            tag = re.search(r'<input[^>]+id="' + key + r'"[^>]*>', html).group()
            attrs = dict(re.findall(r'(\w+)="([^"]*)"', tag))
            self.assertGreaterEqual(spec['min'], int(attrs['min']))
            self.assertLessEqual(spec['max'], int(attrs['max']))
            self.assertEqual(spec['step'], int(attrs['step']))

    def test_drums_and_q_styles(self):
        recipe = {**RECIPE, 'loops': {'Q': {'chords': [[48, 52, 55]], 'style': 'warm', 'chordSteps': 8}, 'X': {'notes': [36, None] * 32}}, 'drums': {'enabled': True, 'tracks': {'kick': {'reload': True, 'steps': [1, 0, 0, 0]}, 'hat': {'steps': [0, 0, 1, 0]}}}}
        self.assertEqual(ai.validate_recipe(recipe), recipe)
        for drums in [None, [], {'enabled': 1}, {'tracks': []}, {'tracks': {'tom': {'steps': [1]}}}, {'tracks': {'kick': {'url': 'https://invalid'}}}, {'tracks': {'hat': {'steps': [True]}}}, {'tracks': {'snare': {'steps': [2]}}}, {'tracks': {'kick': {'steps': [1]*65}}}, {'tracks': {'kick': {'reload': 'yes'}}}]:
            with self.subTest(drums=drums), self.assertRaises(ValueError): ai.validate_recipe({**RECIPE, 'drums': drums})
        for q in [{'style': 'extreme'}, {'chordSteps': True}, {'chordSteps': 3}]:
            with self.assertRaises(ValueError): ai.validate_recipe({**RECIPE, 'loops': {'Q': q}})

    def test_current_outside_generation_bounds_is_valid(self):
        self.assertEqual(ai.validate_request({'prompt': 'dark and warm', 'current': {**CURRENT, 'hpfCutoff': 5000}, 'loops': LOOPS})[1]['hpfCutoff'], 5000)

    def test_reject_input_injection_and_bad_numbers(self):
        for current in ({**CURRENT, 'volume': 100}, {**CURRENT, 'grainSize': True}, {**CURRENT, 'grainSize': float('nan')}, {**CURRENT, 'grainSize': 42.5}):
            with self.assertRaises(ValueError): ai.validate_request({'prompt': 'A good sound', 'current': current, 'loops': LOOPS})
        with self.assertRaises(ValueError): ai.validate_request({'prompt': 'x'*1501, 'current': CURRENT, 'loops': LOOPS})
        with self.assertRaises(ValueError): ai.validate_request({'prompt': 'warm', 'current': CURRENT, 'loops': LOOPS, 'model': 'other'})

    def test_recipe_is_strict(self):
        for params in ({'volume': 150}, {'__proto__': 1}, {'hpfCutoff': 999}, {'grainSize': '30'}, {'grainSize': 40.5}, {'grainSize': False}, {}):
            with self.assertRaises(ValueError): ai.validate_recipe({**RECIPE, 'parameters': params})
        with self.assertRaises(ValueError): ai.validate_recipe({**RECIPE, 'code': 'anything'})

    def test_all_loop_controls_and_bounded_sources(self):
        lanes = {key: {'enabled': False} for key in ai.LOOPS}
        lanes.update(A={'enabled': True, 'reload': True, 'divisions': ['1/8', '1/4']},
                     L={'enabled': True, 'reload': True, 'notes': [60, None, 67]},
                     Q={'enabled': True, 'instrument': 'strings', 'chords': [[48, 52, 55]]})
        recipe = {**RECIPE, 'parameters': {'globalBpmSlider': 104}, 'loops': lanes}
        self.assertEqual(ai.validate_recipe(recipe), recipe)

    def test_forbidden_loop_operations_and_invalid_sequences(self):
        for lanes in ({'unknown': {'enabled': True}}, {'M': {'reload': True}},
                      {'K': {'url': 'https://example.invalid/audio.wav'}},
                      {'A': {'enabled': 1}}, {'A': {'divisions': ['1/7']}},
                      {'A': {'divisions': ['1/8', '1/8']}}, {'L': {'notes': [True]}},
                      {'L': {'notes': [None]}}, {'X': {'notes': [100]}},
                      {'Q': {'instrument': 'other'}}, {'Q': {'chords': [[False]]}},
                      {'Q': {'chords': [[10, 30]]}},
                      {key: {'reload': True} for key in ['A', 'B', 'C', 'V']}):
            with self.subTest(lanes=lanes), self.assertRaises(ValueError):
                ai.validate_recipe({**RECIPE, 'loops': lanes})

    def test_cannot_enable_empty_recording_or_silent_sequence(self):
        for key, lane in [('M', {'enabled': True}), ('K', {'enabled': True}),
                          ('A', {'enabled': True}), ('X', {'enabled': True, 'reload': True}),
                          ('Q', {'enabled': True})]:
            with self.subTest(loop=key), patch.object(ai, 'run_model', return_value={**RECIPE, 'loops': {key: lane}}):
                with self.assertRaises(ValueError): ai.generate('new patch', CURRENT, LOOPS)

    def test_filters_cannot_cancel_each_other(self):
        with patch.object(ai, 'run_model', return_value={**RECIPE, 'parameters': {'lpfCutoff': 500, 'hpfCutoff': 800}}):
            with self.assertRaises(ValueError): ai.generate('thin', CURRENT, LOOPS)

    def test_fixed_model_and_no_tools(self):
        process = MagicMock(returncode=0)
        process.__enter__.return_value = process
        process.communicate.return_value = (json.dumps({'outputs': [{'text': json.dumps(RECIPE)}]}), '')
        with patch.object(ai.subprocess, 'Popen', return_value=process) as run:
            self.assertEqual(ai.run_model('warm', CURRENT, LOOPS), RECIPE)
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], '/usr/bin/node')
        self.assertEqual(pathlib.Path(args[0][1]).name, 'mygrain_model_run.mjs')
        self.assertTrue(kwargs['start_new_session'])
        self.assertEqual(process.communicate.call_args.kwargs['timeout'], 75)
        self.assertIn('DEFAULT FOCUS', process.communicate.call_args.kwargs['input'])
        runner = pathlib.Path(args[0][1]).read_text()
        for contract in ("model: 'gpt-6.1-sol'", "provider: 'openai'", "modelRun: true", "promptMode: 'none'", "meta.usage"):
            self.assertIn(contract, runner)
        self.assertNotIn('agent', args[0])
        self.assertNotIn('--file', args[0])

    def test_invalid_provider_response(self):
        for output in ('not json', json.dumps({'outputs': []}), json.dumps({'outputs': [{'text': '```json {} ```'}]})):
            process = MagicMock(returncode=0)
            process.__enter__.return_value = process
            process.communicate.return_value = (output, '')
            with patch.object(ai.subprocess, 'Popen', return_value=process):
                with self.assertRaises(ValueError): ai.run_model('warm', CURRENT, LOOPS)

    def test_reported_usage_includes_cache_without_double_counting(self):
        raw = {'input': 1000, 'output': 200, 'cacheRead': 8000, 'cacheWrite': 0, 'total': 9200, 'reasoningTokens': 80}
        usage = ai.reported_usage(raw)
        self.assertEqual(usage, {'available': True, 'inputTokens': 9000, 'outputTokens': 200, 'totalTokens': 9200, 'cachedInputTokens': 8000, 'cacheWriteTokens': 0, 'reasoningTokens': 80})
        self.assertEqual(ai.reported_usage({k: v for k, v in raw.items() if k != 'total'})['totalTokens'], 9200)
        for invalid in (None, [], {}, {**raw, 'input': True}, {**raw, 'output': -1}, {**raw, 'input': '1000'}, {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0}):
            with self.subTest(invalid=invalid): self.assertEqual(ai.reported_usage(invalid), {'available': False})

    def test_usage_survives_invalid_recipe_and_http_validation_failure(self):
        raw = {'input': 100, 'output': 20, 'cacheRead': 0, 'cacheWrite': 0, 'total': 120}
        process = MagicMock(returncode=0); process.__enter__.return_value = process
        process.communicate.return_value = (json.dumps({'outputs': [{'text': '{}'}], 'usage': raw}), '')
        usage = {}
        with patch.object(ai.subprocess, 'Popen', return_value=process), self.assertRaises(ValueError): ai.run_model('warm', CURRENT, LOOPS, usage_report=usage)
        self.assertEqual(usage['totalTokens'], 120)
        def invalid(*args, **kwargs):
            kwargs['usage_report'].update(usage)
            raise ValueError('Invalid recipe')
        with patch.object(ai, 'generate', side_effect=invalid):
            h = Handler(); ai.handle_ai_patch_request(h, 'POST', '/api/ai-patch-direction')
        self.assertEqual(h.result[0], 400); self.assertEqual(h.result[1]['usage']['totalTokens'], 120)

    def test_timeout_reaps_cli_process_group(self):
        process = MagicMock(pid=12345)
        process.__enter__.return_value = process
        process.communicate.side_effect = [subprocess.TimeoutExpired('model', 75), ('', '')]
        with patch.object(ai.subprocess, 'Popen', return_value=process), patch.object(ai.os, 'killpg') as kill:
            with self.assertRaises(subprocess.TimeoutExpired): ai.run_model('warm', CURRENT, LOOPS)
        kill.assert_called_once_with(12345, ai.signal.SIGKILL)
        self.assertEqual(process.communicate.call_count, 2)

    def test_unauthenticated(self):
        h = Handler(user=False)
        ai.handle_ai_patch_request(h, 'POST', '/api/ai-patch-direction')
        self.assertEqual(h.result[0], 401)

    def test_authenticated_success_no_store_and_rate_limit(self):
        with patch.object(ai, 'generate', return_value=RECIPE):
            h = Handler(); ai.handle_ai_patch_request(h, 'POST', '/api/ai-patch-direction')
            self.assertEqual(h.result[0], 200)
            self.assertEqual(h.result[1]['model'], ai.MODEL)
            self.assertEqual(h.result[2]['Cache-Control'], 'no-store')
            h2 = Handler(); ai.handle_ai_patch_request(h2, 'POST', '/api/ai-patch-direction')
            self.assertEqual(h2.result[0], 429)
        self.assertFalse(ai.INFLIGHT.locked())

    def test_global_concurrency(self):
        ai.INFLIGHT.acquire()
        try:
            h = Handler(); ai.handle_ai_patch_request(h, 'POST', '/api/ai-patch-direction')
            self.assertEqual(h.result[0], 429)
        finally: ai.INFLIGHT.release()

    def test_errors_do_not_sign_out_or_hold_worker(self):
        for error, status in [(ValueError('Invalid proposal'), 400), (RuntimeError('credential detail'), 503), (subprocess.TimeoutExpired('model', 75), 504)]:
            ai.REQUESTS.clear()
            with patch.object(ai, 'generate', side_effect=error):
                h = Handler(); ai.handle_ai_patch_request(h, 'POST', '/api/ai-patch-direction')
                self.assertEqual(h.result[0], status)
                self.assertNotIn('credential', h.result[1]['error'])
                self.assertFalse(ai.INFLIGHT.locked())

    def test_bad_method_and_oversized_input(self):
        h = Handler(); ai.handle_ai_patch_request(h, 'GET', '/api/ai-patch-direction')
        self.assertEqual(h.result[0], 400)
        h = Handler(); h.headers['Content-Length'] = '100000'; ai.handle_ai_patch_request(h, 'POST', '/api/ai-patch-direction')
        self.assertEqual(h.result[0], 400)


if __name__ == '__main__': unittest.main()
