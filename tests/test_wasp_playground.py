import copy
import json
import pathlib
import subprocess
import unittest
from unittest.mock import patch
from test_song_backend import SONGS, part_zip, rewrite_part

ROOT=pathlib.Path(__file__).resolve().parents[1]
class PlaygroundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.settings=json.loads(subprocess.check_output(['node','-e',"const w=require('./wasp-dsp.js');console.log(JSON.stringify({...w.normalize(),enabled:true}))"],cwd=ROOT))
    def digest(self,settings):
        return SONGS.validate_part_zip(rewrite_part(part_zip(),lambda manifest:manifest['state']['modes'].update(wasp=settings)))['contentSha256']
    def test_old_and_disabled_playground_have_identical_audio_content_hash(self):
        s=copy.deepcopy(self.settings)
        old=copy.deepcopy(s);old.pop('playground')
        self.assertEqual(self.digest(old),self.digest(s))
        s['playground']['cutoff']=20
        s['playground']['modulation']['q']['curve']=[1]*64
        self.assertEqual(self.digest(old),self.digest(s))
        s['playground']['enabled']=True
        self.assertNotEqual(self.digest(old),self.digest(s))
    def test_active_values_sources_and_curves_change_render_hash_without_mutating_source(self):
        s=copy.deepcopy(self.settings);s['playground']['enabled']=True
        original=copy.deepcopy(s);before=self.digest(s)
        self.assertEqual(s,original)
        for mutate in [lambda p:p.update(cutoff=700),lambda p:p.update(resonant=800),lambda p:p.update(q=6),lambda p:p['modulation']['q'].update(source='D'),lambda p:p['modulation']['q'].update(curve=[1]*64)]:
            new=copy.deepcopy(s);mutate(new['playground']);self.assertNotEqual(before,self.digest(new))
    def test_playground_independent_render_key_and_bypassed_wasp_edits(self):
        s=copy.deepcopy(self.settings);s['enabled']=False
        dry=self.digest(s);s['playground']['enabled']=True
        active=self.digest(s);self.assertNotEqual(dry,active)
        s['blend']=0;s['melt']=0;s['output']=-24
        self.assertEqual(self.digest(s),active)
        s['playground']['cutoff']=400
        self.assertNotEqual(self.digest(s),active)

    def test_modes_slopes_and_all_track_sources_validate(self):
        for mode in ['lowpass','highpass','bandpass','notch','comb','combNegative','allpass','peak','lowshelf','highshelf']:
            for slope in [12,24,36,48,60,72,84,96]:
                s=copy.deepcopy(self.settings);s['playground'].update(enabled=True,mode=mode,slope=slope)
                SONGS.validate_wasp(s)
        for source in ['D','A','K5','drumRoll','N','sample','generated','all','off','drawn']:
            s=copy.deepcopy(self.settings);s['playground']['modulation']['resonant']['source']=source;SONGS.validate_wasp(s)
    def test_unbounded_or_invalid_playground_data_is_rejected(self):
        for key,value in [('enabled',1),('q',25),('cutoff',float('nan')),('resonant',20001),('slope',108),('mode','unknown')]:
            s=copy.deepcopy(self.settings);s['playground'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):SONGS.validate_wasp(s)
        for key,value in [('source','arbitrary-path'),('amount',2),('curve',[0]*63),('curve',[False]*64),('curve',[float('inf')]*64)]:
            s=copy.deepcopy(self.settings);s['playground']['modulation']['cutoff'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):SONGS.validate_wasp(s)

    def test_curve_clocks_grid_and_kick_route_validate_and_round_trip(self):
        s=copy.deepcopy(self.settings)
        s['playground']['enabled']=True
        s['playground']['routeKick']=True
        lane=s['playground']['modulation']['cutoff']
        lane.update(clock='sync',beats=4,multiplier=2,timing='triplet',snap=.125,snapTiming='dotted')
        SONGS.validate_wasp(s)
        self.assertTrue(self.digest(s))
        for key,value in [('clock','invalid'),('beats',3),('snap',.3),('multiplier',16),('bpm',0),('hz',float('nan')),('snapTiming','swing')]:
            bad=copy.deepcopy(s);bad['playground']['modulation']['cutoff'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):
                SONGS.validate_wasp(bad)
        bad=copy.deepcopy(s);bad['playground']['routeKick']='true'
        with self.assertRaises(ValueError):SONGS.validate_wasp(bad)

    def test_resonance_render_revision_is_scoped_to_changed_active_modes(self):
        original_sha=SONGS.hashlib.sha256
        for mode in ['lowpass','highpass','bandpass','notch','allpass','peak','lowshelf','highshelf','comb','combNegative','off','wasp-only','wasp-filter']:
            s=copy.deepcopy(self.settings);s['enabled']=mode in ['wasp-only','wasp-filter']
            s['filter']['enabled']=mode=='wasp-filter'
            s['playground'].update(enabled=mode not in ['off','wasp-only','wasp-filter'],mode=mode if mode not in ['off','wasp-only','wasp-filter'] else 'lowpass')
            observed=[]
            def capture(value=b''):
                try:
                    content=json.loads(value)
                    if isinstance(content,dict) and 'state' in content: observed.append(content)
                except (ValueError,UnicodeDecodeError): pass
                return original_sha(value)
            with patch.object(SONGS.hashlib,'sha256',side_effect=capture): self.digest(s)
            self.assertTrue(observed,mode)
            expected=None if mode=='off' else 3 if mode=='wasp-only' else 4 if mode=='wasp-filter' else 7 if mode in ['comb','combNegative'] else 8
            self.assertEqual(observed[-1].get('waspEngineRevision'),expected,mode)
            details=SONGS.validate_part_zip(rewrite_part(part_zip(),lambda manifest:manifest['state']['modes'].update(wasp=s)))
            self.assertEqual(details.get('playgroundVersion'),1 if expected==8 else None,mode)

    def test_additive_instrument_controls_are_bounded_and_legacy_is_unmodified(self):
        s=copy.deepcopy(self.settings)
        original=copy.deepcopy(s);SONGS.validate_wasp(s);self.assertEqual(s,original)
        pg=s['playground'];pg.update(enabled=True,glide=.35,motion=1,mix=.7)
        pg['modulation']['cutoff'].update(source='drawn',hz=997,phaseOffset=.25,interpolation='hold')
        pg['rateMod']={'enabled':True,'target':'cutoff','clock':'hz','hz':97,'depth':2,'beats':4,'multiplier':1,'timing':'straight','curve':[0]*64}
        SONGS.validate_wasp(s)
        before=copy.deepcopy(s);self.assertTrue(self.digest(s));self.assertEqual(s,before)
        for key,value in [('hz',1001),('depth',float('nan')),('target','unknown'),('clock','bpm'),('curve',[0]*63),('curve',[True]*64),('curve',[float('inf')]*64),('enabled',1)]:
            bad=copy.deepcopy(s);bad['playground']['rateMod'][key]=value
            with self.subTest(rate_field=key),self.assertRaises(ValueError):SONGS.validate_wasp(bad)
        for key,value in [('glide',0),('glide',None),('glide',41),('mix',-1),('motion',2)]:
            bad=copy.deepcopy(s);bad['playground'][key]=value
            with self.subTest(field=key),self.assertRaises(ValueError):SONGS.validate_wasp(bad)

    def test_all_174_factory_recipes_pass_real_zip_validation(self):
        code="const fs=require('fs'),vm=require('vm'),s={MygrainWasp:require('./wasp-dsp')};let u=fs.readFileSync('wasp-ui.js','utf8');vm.runInNewContext(u.slice(0,u.indexOf(\"\\n(function(root){\\n'use strict';if(root.__mygrainSongRenderDeck)\")),s);console.log(JSON.stringify(s.MygrainPlaygroundPresets.list.map(p=>({...s.MygrainWasp.normalize(),playground:{...p.settings(),enabled:true}}))))"
        settings=json.loads(subprocess.check_output(['node','-e',code],cwd=ROOT))
        self.assertEqual(len(settings),174)
        for s in settings:
            body=rewrite_part(part_zip(),lambda manifest:manifest['state']['modes'].update(wasp=s))
            details=SONGS.validate_part_zip(body);self.assertEqual(details['playgroundVersion'],2)
