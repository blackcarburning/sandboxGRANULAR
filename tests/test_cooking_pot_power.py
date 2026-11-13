"""Power-switch memory is portable editor metadata, never an audio override."""
import copy
import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from test_song_backend import SONGS, part_zip, rewrite_part

KEYS = (*SONGS.COOKING_POT_KEYS, 'masterBaker')

def archive(modes):
    return rewrite_part(part_zip(), lambda m: m['state']['modes'].update(copy.deepcopy(modes)))

class CookingPotPower(unittest.TestCase):
    def test_memory_is_not_part_of_audio_identity(self):
        bass = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify({...require('./character-fx.js').normalize(),enabled:true,input:'DAW'}))"], cwd=ROOT))
        for serial in [False, True]:
            modes = {'bassFace': bass, 'cookingPot': {'version': 1, 'enabled': serial, 'order': list(SONGS.COOKING_POT_KEYS)}}
            original = SONGS.validate_part_zip(archive(modes))
            for enabled in [False, True]:
                modes['cookingPot']['power'] = {'enabled': enabled, 'remembered': {key: True for key in KEYS}}
                self.assertEqual(SONGS.validate_part_zip(archive(modes)), original)

    def test_strict_memory_validation(self):
        valid = {'enabled': False, 'remembered': {key: False for key in KEYS}}
        invalid = [False, {}, {**valid, 'enabled': 0}, {**valid, 'remembered': {}}, {**valid, 'remembered': {**valid['remembered'], 'masterBaker': 1}}, {**valid, 'remembered': {**valid['remembered'], 'unknown': True}}]
        for power in invalid:
            with self.subTest(power=power), self.assertRaisesRegex(ValueError, 'remembered effect power'):
                SONGS.validate_part_zip(archive({'cookingPot': {'version': 1, 'enabled': True, 'order': list(SONGS.COOKING_POT_KEYS), 'power': power}}))

if __name__ == '__main__':
    unittest.main()
