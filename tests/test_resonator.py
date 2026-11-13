import copy
import json
import pathlib
import subprocess
import unittest
from test_song_backend import SONGS, part_zip, rewrite_part

ROOT = pathlib.Path(__file__).resolve().parents[1]
class ResonatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.settings = json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./resonator-dsp.js').normalize()))"], cwd=ROOT))
    def digest(self, value=None):
        return SONGS.validate_part_zip(rewrite_part(part_zip(), lambda manifest: manifest['state']['modes'].update({} if value is None else {'resonatorR':value})))['contentSha256']
    def test_old_and_disabled_settings_reuse_legacy_hash(self):
        s=copy.deepcopy(self.settings)
        self.assertEqual(self.digest(),self.digest(s))
        s['slots'][0]['gap']=20;s['slots'][1]['radius']=.5
        self.assertEqual(self.digest(),self.digest(s))
        s['enabled']=True;s['slots'][0]['enabled']=False
        self.assertEqual(self.digest(),self.digest(s))
    def test_active_audio_changes_key_without_mutating_settings(self):
        s=copy.deepcopy(self.settings);s['enabled']=True;original=copy.deepcopy(s)
        active=self.digest(s);self.assertEqual(s,original);self.assertNotEqual(active,self.digest())
        for k,v in [('source','all'),('material','metal'),('gap',12),('depth',.6),('pan',.8)]:
            new=copy.deepcopy(s);new['slots'][0][k]=v;self.assertNotEqual(active,self.digest(new))
        s['slots'][1]['radius']=.4
        self.assertEqual(active,self.digest(s))
    def test_invalid_and_unbounded_settings_rejected(self):
        for k,v in [('gap',float('nan')),('depth',float('inf')),('radius',0),('enabled',1),('source','../../private'),('material','paper'),('drive',37)]:
            s=copy.deepcopy(self.settings);s['slots'][0][k]=v
            with self.subTest(k=k),self.assertRaises(ValueError):SONGS.validate_resonator(s)
        for v in [{}, {'version':1,'enabled':True,'slots':[]}, {'version':True,'enabled':True,'slots':self.settings['slots']}]:
            with self.assertRaises(ValueError):SONGS.validate_resonator(v)
    def test_all_object_defaults_validate(self):
        for object in ['door','wall','pipe','cone']:
            s=json.loads(subprocess.check_output(['node','-e',f"const R=require('./resonator-dsp.js');console.log(JSON.stringify(R.normalize({{enabled:true,slots:[{{object:'{object}'}}]}})))"],cwd=ROOT))
            SONGS.validate_resonator(s)
    def test_drawn_curve_bounds_and_content_hash(self):
        legacy=copy.deepcopy(self.settings);legacy['enabled']=True
        s=copy.deepcopy(legacy);s['slots'][0]['excitationCurve']=[-12]*16
        SONGS.validate_resonator(s)
        self.assertNotEqual(self.digest(legacy),self.digest(s))
        changed=copy.deepcopy(s);changed['slots'][0]['excitationCurve'][7]=-24
        self.assertNotEqual(self.digest(s),self.digest(changed))
        for curve in [None, [], [0]*15, [0]*17, [True]*16, ['0']*16, [float('nan')]*16, [float('inf')]*16, [-37]*16, [1]*16]:
            bad=copy.deepcopy(s);bad['slots'][0]['excitationCurve']=curve
            with self.subTest(curve=curve),self.assertRaises(ValueError):SONGS.validate_resonator(bad)
        s['enabled']=False
        self.assertEqual(self.digest(),self.digest(s))
        s['enabled']=True;s['slots'][0].pop('excitationCurve');s['slots'][1]['excitationCurve']=[-12]*16
        self.assertEqual(self.digest(legacy),self.digest(s))
    def test_output_volume_validation_and_legacy_cache_compatibility(self):
        s=copy.deepcopy(self.settings);s['enabled']=True
        original=self.digest(s)
        s['outputLevel']=1
        self.assertEqual(original,self.digest(s))
        s['outputLevel']=.5
        self.assertNotEqual(original,self.digest(s))
        s['outputLevel']=0
        self.assertEqual(self.digest(),self.digest(s))
        for value in [None,True,'0.5',float('nan'),float('inf'),-.1,1.1]:
            s['outputLevel']=value
            with self.subTest(value=value),self.assertRaises(ValueError):SONGS.validate_resonator(s)
    def test_delay_validation_hash_and_zero_delay_legacy(self):
        s=copy.deepcopy(self.settings);s['enabled']=True;legacy=self.digest(s)
        s['delay']={'mode':'ms','ms':0,'division':16}
        self.assertEqual(legacy,self.digest(s))
        s['delay']['ms']=125
        self.assertNotEqual(legacy,self.digest(s))
        s['delay']['mode']='sync'
        self.assertNotEqual(legacy,self.digest(s))
        for delay in [None,{}, {'mode':'ms','ms':2001,'division':16}, {'mode':'ms','ms':True,'division':16}, {'mode':'sync','ms':0,'division':128}, {'mode':'sync','ms':float('nan'),'division':16}]:
            s['delay']=delay
            with self.subTest(delay=delay),self.assertRaises(ValueError):SONGS.validate_resonator(s)
