"""EQ-only Song copy is server-owned, metadata-only and revision guarded."""
import copy
import json
import unittest
import zipfile
from io import BytesIO
from unittest.mock import patch
import test_song_backend as backend
from test_song_k_copy import k_part
from test_song_loop_copy import unpack
from test_channel_eq import replace_eq
S=backend.SONGS


def settings(tag):
    value=S.CHANNEL_EQ.normalize()
    for i,c in enumerate(value['channels'].values()):
        c['enabled']=tag == 1
        c['bands'][1].update(frequency=500+i*100, gain=tag*3, q=tag+i*.1)
    return value


class EqOnlyArchiveTests(unittest.TestCase):
    def test_all_26_individual_eqs_copy_without_any_other_snapshot_or_wav_change(self):
        source=replace_eq(k_part(1),settings(1));target=replace_eq(k_part(2),settings(2))
        original,wavs=unpack(target)
        for channel in S.CHANNEL_EQ.KEYS:
            with self.subTest(channel=channel),patch.object(S,'convert_k_snapshot',side_effect=AssertionError('EQ-only must not convert K')):
                body=S.paste_loop_archive(target,source,['eq:'+channel]);result,audio=unpack(body)
                expected=copy.deepcopy(original);expected['state']['modes']['channelEq']['channels'][channel]=settings(1)['channels'][channel]
                result.pop('createdAt',None);expected.pop('createdAt',None)
                self.assertEqual(result,expected);self.assertEqual(audio,wavs);S.validate_part_zip(body)

    def test_one_eq_can_target_many_channels_with_bypassed_and_legacy_sources(self):
        target=replace_eq(backend.part_zip(),settings(1))
        for source,expected in [(replace_eq(backend.part_zip(),settings(2)),settings(2)['channels']['A']), (backend.part_zip(),S.CHANNEL_EQ.channel())]:
            with self.subTest(source=bool(source)):
                result,audio=unpack(S.paste_loop_archive(target,source,['eq:A'],{key:'A' for key in S.CHANNEL_EQ.KEYS}))
                self.assertTrue(all(c==expected for c in result['state']['modes']['channelEq']['channels'].values()))
                self.assertEqual(audio,unpack(target)[1])

    def test_legacy_destination_does_not_gain_unrelated_defaults_and_audio_stays_identical(self):
        target=backend.part_zip();before,audio=unpack(target)
        result,after=unpack(S.paste_loop_archive(target,replace_eq(backend.part_zip(),settings(1)),['eq:K5'],{'drumRoll':'K5'}))
        expected=copy.deepcopy(before);expected['state']['modes']['channelEq']=S.CHANNEL_EQ.normalize();expected['state']['modes']['channelEq']['channels']['drumRoll']=settings(1)['channels']['K5']
        result.pop('createdAt',None);expected.pop('createdAt',None)
        self.assertEqual(result,expected);self.assertEqual(after,audio)

    def test_multiple_eq_sources_and_mixed_sound_targets_remain_independent(self):
        source=replace_eq(k_part(1),settings(1));target=replace_eq(k_part(2),settings(2))
        result,audio=unpack(S.paste_loop_archive(target,source,['K2','drumKick','eq:A','eq:K5'],{'K4':'A','drumHat':'K5'}))
        sm,sa=unpack(source);tm,ta=unpack(target)
        self.assertEqual(result['state']['modes']['kMultitrack']['tracks'][1],sm['state']['modes']['kMultitrack']['tracks'][1])
        self.assertEqual(result['state']['modes']['kMultitrack']['tracks'][3],tm['state']['modes']['kMultitrack']['tracks'][3])
        for target_key,source_key in [('K2','K2'),('drumKick','drumKick'),('K4','A'),('drumHat','K5')]:self.assertEqual(result['state']['modes']['channelEq']['channels'][target_key],settings(1)['channels'][source_key])
        for key,body in audio.items():self.assertEqual(body,sa[key] if key in ('bastardKTrack2','drumKick') else ta[key])

    def test_invalid_targets_uncopied_sources_and_empty_eq_destinations_fail(self):
        body=backend.part_zip()
        for layers,mapping in [(['eq:A'],{'bad':'A'}),(['eq:A'],{'B':'Q'}),(['eq:A'],{}),(['eq:A'],[]),(['A'],{'B':'A'}),(['eq:bad'],None)]:
            with self.subTest(layers=layers,mapping=mapping),self.assertRaises(ValueError):S.paste_loop_archive(body,body,layers,mapping)


class EqCopyApiTests(unittest.TestCase):
    setUp=backend.SongBackendTests.setUp
    tearDown=backend.SongBackendTests.tearDown
    request=backend.SongBackendTests.request
    create=backend.SongBackendTests.create

    def test_eq_paste_api_keeps_source_and_history_rejects_bad_map_and_marks_render_compatibility(self):
        song=self.create();base=f'/api/songs/{song["id"]}'
        song=self.request('POST',base+'/parts?name=Source',body=replace_eq(backend.part_zip(),settings(1))).response['song']
        song=self.request('POST',base+'/parts?name=Target',body=backend.part_zip()).response['song'];source,target=song['parts']
        payload={'sourceSongId':song['id'],'sourcePartId':source['id'],'sourceSha256':source['sha256'],'layer':'eq:A','eqMap':{'K2':'A','drumRoll':'A'}}
        route=base+f'/parts/{target["id"]}/paste-loop?sha256={target["sha256"]}'
        bad=self.request('POST',route,payload={**payload,'eqMap':{'K2':'X'}});self.assertEqual(bad.status,400)
        self.assertEqual(self.request('GET',base).response['song']['revision'],song['revision'])
        saved=self.request('POST',route,payload=payload);self.assertEqual(saved.status,200)
        updated=saved.response['song'];self.assertEqual(updated['parts'][0]['sha256'],source['sha256']);self.assertEqual(updated['parts'][1]['eqVersion'],1)
        body=self.request('GET',base+f'/parts/{target["id"]}').wfile.getvalue()
        actual,audio=unpack(body);self.assertEqual(actual['state']['modes']['channelEq']['channels']['K2'],settings(1)['channels']['A']);self.assertEqual(audio,unpack(backend.part_zip())[1])
