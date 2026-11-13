import copy
import json
import pathlib
import subprocess
import unittest
import test_channel_eq as base


class AutomationTests(unittest.TestCase):
    def test_patch_zip_validation_and_backend_normalization_preserve_points(self):
        eq = base.EQ.normalize()
        channel = eq['channels']['X']
        channel['enabled'] = True
        first = copy.deepcopy(channel)
        second = copy.deepcopy(channel)
        second['bands'][1]['frequency'] = 3600
        second['bands'][1]['gain'] = 9
        channel['automation'] = {'version': 1, 'read': True, 'steps': 16,
                                 'points': [{'phase': 0, **first}, {'phase': 1, **second}]}
        self.assertEqual(base.EQ.normalize(eq), eq)
        result = base.SONGS.validate_part_zip(base.replace_eq(base.backend.part_zip(), eq))
        # Server validation must keep the complete automation in the archive metadata.
        self.assertEqual(result['eqVersion'], 1)
        changed = copy.deepcopy(eq)
        changed['channels']['X']['automation']['points'][1]['bands'][1]['gain'] = -6
        other = base.SONGS.validate_part_zip(base.replace_eq(base.backend.part_zip(), changed))
        self.assertNotEqual(result['contentSha256'], other['contentSha256'])
        self.assertEqual(base.unpack(base.replace_eq(base.backend.part_zip(), eq))[0]['state']['modes']['channelEq']['channels']['X']['automation'], channel['automation'])

    def test_browser_and_backend_codecs_agree_and_reject_invalid_positions(self):
        eq = base.EQ.normalize()
        initial = copy.deepcopy(eq['channels']['L'])
        eq['channels']['L']['automation'] = {'version': 1, 'read': True, 'steps': 32,
                                          'points': [{'phase': 0, **initial}, {'phase': 1, **initial}]}
        js = "const E=require('./channel-eq.js');process.stdout.write(JSON.stringify(E.normalize(JSON.parse(process.argv[1]))))"
        result = subprocess.run(['node', '-e', js, json.dumps(eq)], cwd=pathlib.Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), base.EQ.normalize(eq))
        eq['channels']['L']['automation']['points'][1]['phase'] = 0
        with self.assertRaises(ValueError):
            base.EQ.normalize(eq)

    def test_all_channels_preserve_automation_and_extended_reads_require_new_render(self):
        for key in base.EQ.KEYS:
            eq = base.EQ.normalize()
            initial = copy.deepcopy(eq['channels'][key])
            initial['enabled'] = True
            eq['channels'][key]['automation'] = {'version': 1, 'read': True, 'steps': 16,
                'points': [{'phase': 0, **initial}, {'phase': 1, **initial}]}
            result = base.SONGS.validate_part_zip(base.replace_eq(base.backend.part_zip(), eq))
            self.assertEqual(result['eqVersion'], 1 if key in ('X', 'L') else 3, key)
            eq['channels'][key]['automation']['read'] = False
            result = base.SONGS.validate_part_zip(base.replace_eq(base.backend.part_zip(), eq))
            self.assertNotIn('eqVersion', result, key)

    def test_explicit_manual_bypass_survives_codec_but_is_not_audible(self):
        for key in base.EQ.KEYS:
            eq = base.EQ.normalize()
            point = copy.deepcopy(eq['channels'][key]); point['enabled'] = True
            eq['channels'][key].update(manualBypass=True, automation={'version': 1, 'read': True, 'steps': 16,
                'points': [{'phase': 0, **point}, {'phase': 1, **point}]})
            self.assertEqual(base.EQ.normalize(eq), eq)
            self.assertFalse(base.EQ.audible(eq['channels'][key]))
            result = base.SONGS.validate_part_zip(base.replace_eq(base.backend.part_zip(), eq))
            self.assertNotIn('eqVersion', result)
            js = "const E=require('./channel-eq.js');process.stdout.write(JSON.stringify(E.normalize(JSON.parse(process.argv[1]))))"
            browser = subprocess.run(['node', '-e', js, json.dumps(eq)], cwd=pathlib.Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(browser.stdout), eq)
