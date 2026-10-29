"""Standard loop effects are metadata-only, hash-bound and source-safe."""
import copy,json,zipfile,subprocess
from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
import test_song_backend as B
S=B.SONGS

def entries(body):
    with zipfile.ZipFile(BytesIO(body)) as z:return {name:z.read(name) for name in z.namelist()}

def with_fx(body,tag):
    return B.rewrite_part(body,lambda snapshot:snapshot.update(S.convert_fx_snapshot(snapshot)['snapshot'])) if not tag else B.rewrite_part(with_fx(body,0),lambda s:s['state']['modes']['loopFx']['channels']['L'].update(room=tag))

class SongFxConversionTests(TestCase):
    setUp=B.SongBackendTests.setUp
    tearDown=B.SongBackendTests.tearDown
    request=B.SongBackendTests.request
    create=B.SongBackendTests.create
    def upload(self,song,body=None):return self.request('POST',f'/api/songs/{song["id"]}/parts?name=FX',body=body or B.part_zip()).response['song']
    def test_conversion_retains_wavs_history_old_renders_and_is_idempotent(self):
        song=self.upload(self.create());base=f'/api/songs/{song["id"]}';part=song['parts'][0]
        song=self.request('POST',base+f'/parts/{part["id"]}/render?sha256={part["sha256"]}',body=B.render_wav(part)).response['song'];old=copy.deepcopy(song)
        before=entries(self.request('GET',base+f'/parts/{part["id"]}').wfile.getvalue())
        result=self.request('POST',base+'/convert-fx');self.assertEqual(result.status,200,result.response);self.assertEqual(result.response['converted'],1);new=result.response['song'];self.assertEqual(new['revision'],old['revision']+1)
        after=entries(self.request('GET',base+f'/parts/{part["id"]}').wfile.getvalue());self.assertEqual(before['audio/bastardL.wav'],after['audio/bastardL.wav']);snap=json.loads(after['song-part.json']);self.assertEqual(snap['state']['modes']['loopFx']['version'],1);self.assertEqual(new['parts'][0]['render']['sha256'],old['parts'][0]['render']['sha256']);self.assertEqual(new['parts'][0]['loopFxVersion'],1)
        again=self.request('POST',base+'/convert-fx');self.assertEqual(again.response['converted'],0);self.assertEqual(again.response['song'],new)
    def test_new_sources_require_matching_render_version(self):
        song=self.upload(self.create(),with_fx(B.part_zip(),.18));part=song['parts'][0];url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}'
        denied=self.request('POST',url,body=B.render_wav(part));self.assertEqual(denied.status,400);self.assertIn('loop FX-aware',denied.response['error'])
        accepted=self.request('POST',url+'&loopfx=1',body=B.render_wav(part));self.assertEqual(accepted.status,200,accepted.response);self.assertEqual(accepted.response['song']['parts'][0]['render']['loopFxVersion'],1)
    def test_copy_one_loop_moves_only_its_fx_and_no_audio_changes(self):
        source=with_fx(B.part_zip(),.42);target=with_fx(B.part_zip(),.09)
        pasted=S.paste_loop_archive(target,source,['L']);old=json.loads(entries(target)['song-part.json']);new=json.loads(entries(pasted)['song-part.json']);self.assertEqual(new['state']['modes']['loopFx']['channels']['L']['room'],.42)
        for key,channel in old['state']['modes']['loopFx']['channels'].items():
            if key!='L':self.assertEqual(new['state']['modes']['loopFx']['channels'][key],channel)
        self.assertEqual(entries(pasted)['audio/bastardL.wav'],entries(source)['audio/bastardL.wav'])
    def test_invalid_fx_is_rejected_and_conversion_commit_failure_rolls_back(self):
        body=B.rewrite_part(with_fx(B.part_zip(),.18),lambda s:s['state']['modes']['loopFx']['channels']['X'].update(feedback=10))
        with self.assertRaisesRegex(ValueError,'standard loop FX'):S.validate_part_zip(body)
        song=self.upload(self.create());folder=S.SONGS_ROOT/song['id'];before=(folder/'song.json').read_bytes();files={p.name:p.read_bytes() for p in (folder/'parts').iterdir()}
        with patch.object(S,'write_song',side_effect=OSError('fixture disk failure')):result=self.request('POST',f'/api/songs/{song["id"]}/convert-fx')
        self.assertIn(result.status,(400,500));self.assertEqual((folder/'song.json').read_bytes(),before);self.assertEqual({p.name:p.read_bytes() for p in (folder/'parts').iterdir()},files)

    def test_n_space_is_optional_for_legacy_parts_and_validated_for_new_parts(self):
        snapshot=json.loads(entries(with_fx(B.part_zip(),0))['song-part.json'])
        fx=snapshot['state']['modes']['loopFx']
        self.assertIn('N',fx['channels'])
        fx['channels']['N'].update(room=.35,delay=.22)
        S.validate_loop_fx(fx)
        legacy=copy.deepcopy(fx);del legacy['channels']['N'];S.validate_loop_fx(legacy)
        bad=copy.deepcopy(fx);bad['channels']['N']['feedback']=8
        with self.assertRaises(ValueError):S.validate_loop_fx(bad)
        bad=copy.deepcopy(fx);bad['channels']['unknown']=bad['channels']['N']
        with self.assertRaises(ValueError):S.validate_loop_fx(bad)

    def test_pan_is_optional_for_old_parts_and_bounded_for_new_parts(self):
        fx=S.convert_fx_snapshot({'state':{'modes':{}},'assets':[],'extra':{}})['snapshot']['state']['modes']['loopFx']
        fx['channels']['X']['pan']=-.65
        S.validate_loop_fx(fx)
        legacy=copy.deepcopy(fx)
        for channel in legacy['channels'].values():
            channel.pop('pan',None)
        S.validate_loop_fx(legacy)
        for value in (-1.1,1.1,True,'0',float('nan')):
            bad=copy.deepcopy(fx);bad['channels']['X']['pan']=value
            with self.assertRaises(ValueError):S.validate_loop_fx(bad)
