"""D Mutilator: bounded AI controls and source-scoped Song compatibility."""
import json
import unittest
import zipfile
from io import BytesIO
from unittest.mock import patch
from test_song_backend import SONGS, part_zip, rewrite_part, render_wav, SongBackendTests
from test_ai_patch import ai


def d_part(mutilator):
    def mutate(manifest):
        manifest['state']['modes']['loopD'] = {'enabled': True, 'mutilator': mutilator}
        manifest['assets'][0].update(key='bastardD', path='audio/bastardD.wav')
    body = rewrite_part(part_zip(), mutate)
    output = BytesIO()
    with zipfile.ZipFile(BytesIO(body)) as source, zipfile.ZipFile(output, 'w') as target:
        for name in source.namelist():
            target.writestr(name.replace('bastardL.wav', 'bastardD.wav'), source.read(name))
    return output.getvalue()


class DMutilatorTests(unittest.TestCase):
    def test_d_controls_follow_copy_paste_lane(self):
        for key in ('loopDMutilatorAmount', 'loopDMutilatorTone', 'loopDMutilatorMix', 'loopDMutilatorStrain'):
            self.assertEqual(SONGS.setting_loop_layer(key), 'D')
        self.assertEqual(SONGS.setting_loop_layer('performanceBastardLoopWLevel'), 'W')

    def test_only_active_new_processor_adds_engine_signature(self):
        for mutilator in (None, {'enabled': False}, {'enabled': True, 'strain': 'melt', 'amount': .8, 'mix': .7}, {'enabled': True, 'strain': 'venom', 'amount': .8, 'mix': .7}):
            def mutate(manifest):
                manifest['state']['modes']['loopD'] = {'enabled': True}
                if mutilator is not None:
                    manifest['state']['modes']['loopD']['mutilator'] = mutilator
                manifest['assets'][0].update(key='bastardD', path='audio/bastardD.wav')
            body = rewrite_part(part_zip(), mutate)
            output = BytesIO()
            with zipfile.ZipFile(BytesIO(body)) as source, zipfile.ZipFile(output, 'w') as target:
                for name in source.namelist():
                    target.writestr(name.replace('bastardL.wav', 'bastardD.wav'), source.read(name))
            dumps = json.dumps
            signatures = []
            def capture(value, *args, **kwargs):
                if isinstance(value, dict) and 'audioHashes' in value:
                    signatures.append(value.get('mutilatorEngineRevision'))
                return dumps(value, *args, **kwargs)
            with patch.object(SONGS.json, 'dumps', side_effect=capture):
                details = SONGS.validate_part_zip(output.getvalue())
            self.assertEqual(signatures, [2 if mutilator and mutilator.get('strain') == 'venom' else 1 if mutilator and mutilator.get('enabled') else None])
            self.assertEqual(details['loopDVersion'], 1)
            self.assertEqual(details.get('mutilatorVersion'), None)

    def test_zero_and_legacy_scalar_controls_do_not_require_rhythmic_render(self):
        for key in ('amount', 'mix'):
            for value in (0, None, '', '0'):
                self.assertNotIn('mutilatorVersion', SONGS.validate_part_zip(d_part({'enabled': True, key: value})))
        for value in ({'enabled': True}, {'enabled': True, 'mix': '0.5'}, {'enabled': True, 'mix': 'legacy-invalid'}):
            self.assertEqual(SONGS.validate_part_zip(d_part({**value, 'rhythm': True}))['mutilatorVersion'], 2)

    def test_rhythm_render_marker_required_and_does_not_rewrite_sources(self):
        harness = SongBackendTests()
        harness.setUp()
        try:
            song = harness.create()
            body = d_part({'enabled': True, 'amount': .8, 'mix': .7, 'strain': 'venom', 'rhythm': True})
            reply = harness.request('POST', f'/api/songs/{song["id"]}/parts?name=Mutilator&repeats=1', body=body)
            self.assertEqual(reply.status, 201)
            song = reply.response['song']
            part = song['parts'][0]
            route = f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}'
            self.assertEqual(harness.request('POST', route, body=render_wav(part)).status, 400)
            self.assertEqual(harness.request('POST', route+'&mutilator=3', body=render_wav(part)).status, 400)
            saved = harness.request('POST', route+'&mutilator=2', body=render_wav(part))
            self.assertEqual(saved.status, 200)
            self.assertEqual(saved.response['song']['parts'][0]['render']['mutilatorVersion'], 2)
            self.assertEqual(saved.response['song']['parts'][0]['sha256'], part['sha256'])
            self.assertEqual(saved.response['song']['revision'], song['revision'])
            source = harness.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}')
            self.assertEqual(source.wfile.getvalue(), body)
        finally:
            harness.tearDown()

    def test_ai_controls_are_bounded_and_zero_mix_is_allowed(self):
        recipe = {'title': 'Mutilate D', 'description': 'A fractured loop.', 'loops': {'D': {'enabled': True}},
                  'parameters': {'loopDMutilatorAmount': 73, 'loopDMutilatorTone': 41, 'loopDMutilatorMix': 0}}
        self.assertEqual(ai.validate_recipe(recipe)['parameters'], recipe['parameters'])
        for value in (-1, 101, True, float('nan')):
            with self.assertRaises(ValueError):
                ai.validate_recipe({**recipe, 'parameters': {'loopDMutilatorMix': value}})


if __name__ == '__main__':
    unittest.main()

    def test_switch_default_is_original_and_false_is_signature_neutral(self):
        for enabled in [True,False]:
            for strain in ['gnaw','melt','rupture','scab','venom','hollow','splinter']:
                m={'enabled':enabled,'strain':strain,'amount':.8,'mix':.7,'tone':.4}
                old=SONGS.validate_part_zip(d_part(m));explicit=SONGS.validate_part_zip(d_part({**m,'rhythm':False}))
                self.assertEqual(old['contentSha256'],explicit['contentSha256'])
        for strain in ['diode','cinder','shred','vortex','maw']:
            for rhythm in [True,False]:
                details=SONGS.validate_part_zip(d_part({'enabled':True,'strain':strain,'rhythm':rhythm}))
                self.assertEqual(details['mutilatorVersion'],2)
        with self.assertRaises(ValueError):SONGS.validate_part_zip(d_part({'enabled':True,'rhythm':'yes'}))
