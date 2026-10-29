"""Wasp archive validation: bounded settings, no changes to source audio."""
import copy
import json
import pathlib
import subprocess
import unittest
from test_song_backend import SONGS

ROOT = pathlib.Path(__file__).resolve().parents[1]
class WaspTests(unittest.TestCase):
    def settings(self):
        return json.loads(subprocess.check_output(['node', '-e', "const w=require('./wasp-dsp.js');console.log(JSON.stringify({...w.preset('Melt'),enabled:true}))"], cwd=ROOT))
    def test_phone_filter_slopes_validate(self):
        for slope in [12,24,36,48,60,72,84,96]:
            value = self.settings()
            value['filter']['slope'] = slope
            SONGS.validate_wasp(value)
        for slope in [0,6,13,108]:
            value['filter']['slope'] = slope
            with self.assertRaises(ValueError):
                SONGS.validate_wasp(value)
    def test_legacy_without_wasp_remains_valid(self):
        SONGS.validate_wasp(None)
    def test_all_presets_validate(self):
        values=json.loads(subprocess.check_output(['node','-e',"const w=require('./wasp-dsp.js');console.log(JSON.stringify(Object.keys(w.presets).map(n=>w.preset(n))))"],cwd=ROOT))
        for value in values:
            SONGS.validate_wasp(value)
    def test_invalid_settings_rejected(self):
        for field, value in [('depth',float('nan')),('level',99),('source','secret'),('method','unknown'),('enabled',1),('mode','unknown')]:
            settings=self.settings();settings['routes'][0][field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                SONGS.validate_wasp(settings)
    def test_more_than_six_channels_rejected(self):
        settings=self.settings();settings['routes'].append(copy.deepcopy(settings['routes'][0]))
        with self.assertRaises(ValueError):
            SONGS.validate_wasp(settings)
if __name__ == '__main__':
    unittest.main()

class FilterArchiveTests(unittest.TestCase):
    settings = WaspTests.settings
    def test_disabled_filter_preserves_legacy_render_cache_hash(self):
        from test_song_backend import part_zip,rewrite_part
        s=self.settings();s.pop('filter',None)
        body=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(wasp=s))
        legacy=SONGS.validate_part_zip(body)['contentSha256']
        s['filter']=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./wasp-dsp.js').endFilter()))"],cwd=ROOT))
        off=SONGS.validate_part_zip(rewrite_part(part_zip(),lambda m:m['state']['modes'].update(wasp=s)))['contentSha256']
        self.assertEqual(legacy,off)
        s['filter']['enabled']=True
        on=SONGS.validate_part_zip(rewrite_part(part_zip(),lambda m:m['state']['modes'].update(wasp=s)))['contentSha256']
        self.assertNotEqual(on,off)
