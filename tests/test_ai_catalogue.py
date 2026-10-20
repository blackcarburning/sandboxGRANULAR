"""Real catalogue integration contracts; no model calls or production mutations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ai_catalogue_tests', Path(__file__).parents[1] / 'backend/mygrain_ai_patch.py')
ai = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai)
cat = ai.catalogue
CURRENT = {key: value['min'] for key, value in ai.CONTROLS.items()}
CURRENT.update(lpfCutoff=12000, hpfCutoff=20, globalBpmSlider=104)
LOOPS = {key: {'enabled': False, 'loaded': False, 'samples': []} for key in ai.LOOPS}


class CatalogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = hashlib.sha256(cat.DB_PATH.read_bytes()).hexdigest()
        cls.context = cat.retrieve('Warm C minor 104 BPM piano and sub bass', CURRENT, cat.SOURCE_BASE)

    def test_01_complete_real_catalogue_bounded_shortlist(self):
        c = self.context
        self.assertEqual(c['status'], 'ready')
        self.assertEqual(c['catalogueCount'], 941)
        self.assertEqual(set(c['candidates']), set(cat.LANES))
        self.assertLessEqual(len(json.dumps(cat.model_context(c))), 40000)
        self.assertNotIn('/srv/', json.dumps(cat.model_context(c)))
        self.assertNotIn('absolute_path', json.dumps(cat.model_context(c)))
        for lane, candidates in c['candidates'].items():
            self.assertEqual(len(candidates), cat.LIMIT)
            for candidate in candidates:
                entry = c['entries'][candidate['sampleId']]
                self.assertEqual(entry['source'], cat.LANES[lane])
                self.assertTrue(cat.current_file(entry['row'], c['sourceRoot'], entry['source'], verify_hash=True))
                self.assertLessEqual(candidate['measured']['decodedMiBAt96k'], 32)
                self.assertNotIn('filename_percussion_in_tonal_collection', candidate['warnings'])
                if lane in ('X', 'L'):
                    self.assertIsNotNone(candidate['playbackRoot'])
                    self.assertFalse(candidate['filename']['loopClaim'])

    def test_02_unknown_modes_not_major_and_candidates_not_promoted(self):
        c = self.context
        unknowns = [v for v in c['entries'].values() if v['row']['filename_mode'] is None]
        self.assertTrue(unknowns)
        for entry in unknowns:
            self.assertEqual(entry['candidate']['filename']['mode'], 'unknown')
        row = {'estimated_note': None, 'filename_pitch_class': 0}
        self.assertIsNone(cat.root_info(row, {'root_note_candidates': []}))
        self.assertIsNone(cat.root_info({**row, 'estimated_note': 'D2'}, {}))
        self.assertEqual(cat.root_info({**row, 'estimated_note': 'C2'}, {})['note'], 'C2')
        self.assertEqual(cat.root_info(row, {'root_note_candidates': [{'midi_note': 12}]})['note'], 'C0')

    def test_03_selected_identity_and_trusted_root_returned(self):
        c = self.context
        candidate = c['candidates']['X'][0]
        recipe = {'title': 'Tonal', 'description': 'Tonal patch', 'parameters': {}, 'loops': {'X': {'reload': True, 'enabled': True, 'sampleId': candidate['sampleId'], 'notes': [36, None]}}}
        ai.validate_recipe(recipe)
        with patch.object(cat, 'retrieve', return_value=c), patch.object(ai, 'run_model', return_value=recipe):
            report = {}; result = ai.generate('C minor bass', CURRENT, LOOPS, catalogue_report=report)
        selection = result['loops']['X']['selection']
        self.assertEqual(selection['relativePath'], c['entries'][candidate['sampleId']]['row']['relative_path'])
        self.assertEqual(selection['playbackRoot'], candidate['playbackRoot'])
        self.assertEqual(report['status'], 'ready')
        self.assertEqual(report['fallbackLanes'], [])

    def test_04_wrong_lane_unknown_id_omission_rejected(self):
        for selected in [None, 'f' * 64, self.context['candidates']['P'][0]['sampleId']]:
            recipe = {'loops': {'X': {'reload': True, **({'sampleId': selected} if selected else {})}}}
            with self.assertRaises(ValueError): cat.attach_selections(recipe, self.context)
        for lane in [{'reload': False, 'sampleId': 'f' * 64}, {'reload': True, 'sampleId': '../escape'}, {'reload': True, 'selection': {'relativePath': 'invented.wav'}}]:
            with self.assertRaises(ValueError): ai.validate_recipe({'title': 'T', 'description': 'D', 'parameters': {}, 'loops': {'X': lane}})

    def test_05_missing_corrupt_and_account_without_files_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for db in [root / 'missing.sqlite', root / 'corrupt.sqlite']:
                if db.name.startswith('corrupt'): db.write_text('not SQLite')
                with patch.object(cat, 'DB_PATH', db):
                    c = cat.retrieve('warm bass', CURRENT, cat.SOURCE_BASE)
                self.assertEqual(c['status'], 'fallback')
                self.assertEqual(c['entries'], {})
            c = cat.retrieve('warm bass', CURRENT, root)
            self.assertEqual(c['status'], 'fallback')
            self.assertEqual(c['entries'], {})
            cat.attach_selections({'loops': {'X': {'reload': True}}}, c)

    def test_06_account_copy_hash_and_stale_content_checks(self):
        entry = self.context['entries'][self.context['candidates']['X'][0]['sampleId']]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = cat.safe_path(root, entry['source'], entry['row']['relative_path'])
            target.parent.mkdir(parents=True)
            target.write_bytes(Path(entry['row']['absolute_path']).read_bytes())
            self.assertTrue(cat.current_file(entry['row'], root, entry['source']))
            with target.open('r+b') as stream:
                stream.seek(-1, 2); b = stream.read(1); stream.seek(-1, 2); stream.write(bytes([b[0] ^ 255]))
            self.assertFalse(cat.current_file(entry['row'], root, entry['source']))
            c = {**self.context, 'sourceRoot': root}
            with self.assertRaises(ValueError): cat.attach_selections({'loops': {'X': {'reload': True, 'sampleId': entry['candidate']['sampleId']}}}, c)

    def test_07_path_escape_and_collection_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as other:
            root = Path(folder)
            for name in ['../escape.wav', '/absolute.wav', 'a/../b.wav', 'a\\b.wav', 'a//b.wav']:
                with self.assertRaises(ValueError): cat.safe_path(root, 'samples_bass', name)
            (root / 'SAMPLES_BASS').symlink_to(other, target_is_directory=True)
            with self.assertRaises(ValueError): cat.safe_path(root, 'samples_bass', 'test.wav')

    def test_08_unbound_account_never_uses_shared_catalogue(self):
        c = cat.retrieve('warm bass', CURRENT)
        self.assertEqual(c['status'], 'fallback')
        self.assertEqual(c['entries'], {})
        self.assertIn('not bound', c['reason'])

    def test_09_uncut_supported_but_not_mixed_with_slicing(self):
        recipe = {'title': 'T', 'description': 'D', 'parameters': {}, 'loops': {'P': {'reload': True, 'divisions': ['uncut']}}}
        self.assertEqual(ai.validate_recipe(recipe), recipe)
        recipe['loops']['P']['divisions'] = ['uncut', '1/4']
        with self.assertRaises(ValueError): ai.validate_recipe(recipe)

    def test_10_database_unchanged(self):
        self.assertEqual(hashlib.sha256(cat.DB_PATH.read_bytes()).hexdigest(), self.before)


if __name__ == '__main__': unittest.main()
