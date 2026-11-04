import copy
import json
import inspect
import subprocess
import unittest
from pathlib import Path
from test_song_backend import SONGS, part_zip, rewrite_part

ROOT = Path(__file__).resolve().parents[1]

class TurntableTests(unittest.TestCase):
    def settings(self):
        return json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./turntable-dsp.js').defaults()))"], cwd=ROOT))

    def test_defaults_and_legacy(self):
        SONGS.validate_turntable(None)
        SONGS.validate_turntable(self.settings())

    def test_invalid_settings(self):
        for key, value in [('enabled', 1), ('year', 1900), ('year', 9999), ('needle', 'broken'), ('route', 'vocals'), ('hum', float('nan')), ('wow', 2), ('output', -99)]:
            settings = self.settings()
            settings[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                SONGS.validate_turntable(settings)

    def test_bypass_reuses_legacy_hash_and_active_edits_invalidate(self):
        body = part_zip()
        settings = self.settings()
        def digest(value):
            return SONGS.validate_part_zip(rewrite_part(body, lambda p: p['state']['modes'].update(turntable=value)))['contentSha256']
        legacy = SONGS.validate_part_zip(body)['contentSha256']
        self.assertEqual(digest(settings), legacy)
        settings['year'] = 1920
        self.assertEqual(digest(settings), legacy)
        settings['enabled'] = True
        active = digest(settings)
        self.assertNotEqual(active, legacy)
        settings['year'] = 1990
        self.assertNotEqual(active, digest(settings))

    def test_route_hash_compatibility(self):
        value = self.settings()
        value['enabled'] = True
        def digest(v):
            return SONGS.validate_part_zip(rewrite_part(part_zip(), lambda p: p['state']['modes'].update(turntable=v)))['contentSha256']
        legacy = dict(value)
        legacy.pop('route')
        self.assertEqual(digest(value), digest(legacy))
        value['route'] = 'drums'
        self.assertNotEqual(digest(value), digest(legacy))
        value['enabled'] = legacy['enabled'] = False
        self.assertEqual(digest(value), digest(legacy))

    def test_pitch_revision_refreshes_only_pitch_modulated_parts(self):
        namespace = dict(SONGS.__dict__)
        original = inspect.getsource(SONGS.validate_part_zip).replace(
            "2 if any(state['modes']['turntable'].get(key, 0) > 0 for key in ('wow', 'flutter')) else 1", "1")
        exec(original, namespace)
        value = self.settings()
        value['enabled'] = True
        body = rewrite_part(part_zip(), lambda p: p['state']['modes'].update(turntable=value))
        self.assertNotEqual(SONGS.validate_part_zip(body)['contentSha256'], namespace['validate_part_zip'](body)['contentSha256'])
        value['wow'] = value['flutter'] = 0
        body = rewrite_part(part_zip(), lambda p: p['state']['modes'].update(turntable=value))
        self.assertEqual(SONGS.validate_part_zip(body)['contentSha256'], namespace['validate_part_zip'](body)['contentSha256'])

if __name__ == '__main__':
    unittest.main()
