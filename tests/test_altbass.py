import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('altbass_ai',ROOT/'backend/mygrain_ai_patch.py')
ai=importlib.util.module_from_spec(spec);spec.loader.exec_module(ai)
server_spec=importlib.util.spec_from_file_location('altbass_server',ROOT.parent/'fs7300-documenter/server.py')
server=importlib.util.module_from_spec(server_spec);server_spec.loader.exec_module(server)

class AltBassTests(unittest.TestCase):
    def context(self,repository='samples_bass'):
        return ai.catalogue.with_x_repository({'status':'fallback','reason':'fixture','candidates':{},'entries':{},'sourceRoot':pathlib.Path('/tmp/no-private-library'),'eligibleCount':0,'catalogueCount':0},repository)
    def test_package_is_unmodified_original_aiff_and_fully_indexed(self):
        import aifc, sqlite3
        folder=ROOT/'SAMPLES_ALTBASS';manifest=json.loads((folder/'manifest.json').read_text())
        self.assertEqual(len(manifest['samples']),63)
        self.assertEqual({x['patch'] for x in manifest['samples']},{'Pulse Bass','Saw Bass split'})
        self.assertEqual(len(list(folder.rglob('*.aif'))),63)
        self.assertEqual(list(folder.rglob('*.wav')),[])
        for sample in manifest['samples']:
            data=(folder/sample['name']).read_bytes();self.assertEqual(hashlib.sha256(data).hexdigest(),sample['sourceSha256'])
            self.assertEqual(sample['sha256'],sample['sourceSha256'])
            self.assertEqual(sample['midi'],sample['sourceMidi'])
            self.assertNotIn('tuningCorrectionCents',sample)
            with aifc.open(str(folder/sample['name'])) as audio:
                self.assertEqual(audio.getsampwidth(),3)
                self.assertEqual(audio.getnframes(),sample['frames'])
                self.assertEqual(audio.getframerate(),sample['sampleRate'])
        with sqlite3.connect(ai.catalogue.ALTBASS_DB_PATH.as_uri()+'?mode=ro',uri=True) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM files WHERE status='complete' AND present_in_latest_inventory=1").fetchone()[0],63)
            self.assertEqual(db.execute('SELECT count(*) FROM audio_analysis').fetchone()[0],63)
            self.assertEqual(db.execute('SELECT count(*) FROM source_mappings').fetchone()[0],63)
            self.assertEqual(db.execute('SELECT count(*) FROM filename_metadata WHERE declared_bpm IS NOT NULL').fetchone()[0],0)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
    def test_shared_package_uses_existing_api_not_private_mirror_or_remote(self):
        with patch.object(server,'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT',pathlib.Path('/tmp/unrelated-account')),patch.object(server.subprocess,'run',side_effect=AssertionError('Must not use remote')):
            self.assertEqual(server.get_bastardloop_local_source_root('samples_altbass'),ROOT/'SAMPLES_ALTBASS')
            files=server.list_bastardloop_source_files('samples_altbass',force_refresh=True)
            self.assertEqual(len(files),63)
            sample=server.resolve_bastardloop_source_sample('samples_altbass',relative_path=files[0])
            self.assertTrue(sample['bytes'].startswith(b'FORM'))
            headers=server.bastardloop_sample_response_headers(sample)
            self.assertEqual(headers['Content-Type'],'audio/aiff')
            self.assertRegex(headers['X-Mygrain-Source-Root'],r'^[A-G]#?[234]$')
            with self.assertRaises(ValueError):server.fetch_bastardloop_sample_bytes('samples_altbass','../index.html')
    def test_catalogue_bound_and_repository_must_be_explicit_when_switching(self):
        context=self.context();candidates=context['candidates']['X'];self.assertEqual(len(candidates),ai.catalogue.LIMIT)
        self.assertEqual(context['eligibleCount'],63)
        self.assertTrue(all(c['measured']['rmsDbfs'] is not None for c in candidates))
        self.assertTrue(all(c['measured']['brightnessHz'] > 0 for c in candidates))
        candidate=candidates[0];recipe={'loops':{'X':{'reload':True,'sampleId':candidate['sampleId']}}}
        with self.assertRaises(ValueError):ai.catalogue.attach_selections(recipe,context)
        recipe['loops']['X']['repository']='samples_altbass';ai.catalogue.attach_selections(recipe,context)
        self.assertEqual(recipe['loops']['X']['selection']['source'],'samples_altbass')
        context=self.context('samples_altbass');recipe={'loops':{'X':{'reload':True,'sampleId':candidate['sampleId']}}};ai.catalogue.attach_selections(recipe,context)
        self.assertEqual(recipe['loops']['X']['selection']['playbackRoot']['note'],candidate['playbackRoot']['note'])
    def test_explicit_repository_and_input_validation(self):
        current={key:value['min'] for key,value in ai.CONTROLS.items()};loops={key:{'enabled':False,'loaded':False,'samples':[]} for key in ai.LOOPS};loops['X']['repository']='samples_altbass'
        ai.validate_request({'prompt':'Clean bass','current':current,'loops':loops})
        recipe={'title':'Juno','description':'Switch to clean bass','parameters':{},'loops':{'X':{'repository':'samples_altbass','reload':True}}}
        ai.validate_recipe(recipe)
        for settings in [{'repository':'../anything','reload':True},{'repository':'samples_altbass'},{'repository':'samples_altbass','reload':False}]:
            with self.assertRaises(ValueError):ai.validate_recipe({**recipe,'loops':{'X':settings}})
        with self.assertRaises(ValueError):ai.validate_recipe({**recipe,'loops':{'L':{'repository':'samples_altbass','reload':True}}})
    def test_mismatched_hash_does_not_enter_shortlist(self):
        with patch.object(ai.catalogue,'current_file',return_value=False):
            self.assertEqual(self.context()['candidates']['X'],[])

if __name__=='__main__':unittest.main()

class OriginalCatalogueSafetyTests(unittest.TestCase):
    def test_unavailable_full_index_is_not_replaced_by_manifest_guess(self):
        with patch.object(ai.catalogue,'ALTBASS_DB_PATH',pathlib.Path('/tmp/nonexistent-altbass-catalogue.sqlite')):
            context=AltBassTests().context()
            self.assertEqual(context['candidates'].get('X',[]),[])
    def test_original_root_and_acoustic_estimate_stay_separate(self):
        context=AltBassTests().context('samples_altbass')
        self.assertTrue(any(c['playbackRoot']['note'] != c['audioTentative']['note'] for c in context['candidates']['X']))
        self.assertTrue(all('SFZ' in c['playbackRoot']['source'] for c in context['candidates']['X']))
