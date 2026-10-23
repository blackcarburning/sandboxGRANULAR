import copy
import hashlib
import json
import subprocess
import zipfile
from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
from test_song_backend import SONGS, Handler, SongBackendTests, part_zip, rewrite_part, render_wav


class ServerKConversionTests(TestCase):
    setUp = SongBackendTests.setUp
    tearDown = SongBackendTests.tearDown
    request = SongBackendTests.request
    create = SongBackendTests.create
    upload = SongBackendTests.upload
    reuse = SongBackendTests.reuse

    def convert(self, song):
        return self.request('POST', f'/api/songs/{song["id"]}/convert-k')

    def contents(self, song):
        folder = SONGS.SONGS_ROOT / song['id']
        return {p.name:p.read_bytes() for p in (folder/'parts').iterdir()}

    def test_atomic_unique_and_hidden_source_conversion_keeps_all_wavs_renders_order_and_history(self):
        for hidden in (False, True):
            song = self.upload(self.upload(self.create()))
            base = f'/api/songs/{song["id"]}'
            source = song['parts'][0]
            song = self.request('POST',base+f'/parts/{source["id"]}/render?sha256={source["sha256"]}&portable=1',body=render_wav(source)).response['song']
            song = self.reuse(song)
            if hidden:song=self.request('POST',base+f'/parts/{source["id"]}/delete?sha256={source["sha256"]}').response['song']
            before = copy.deepcopy(song)
            old_files = self.contents(song)
            result=self.convert(song)
            self.assertEqual(result.status,200,result.response)
            self.assertEqual(result.response['converted'],2)
            saved=result.response['song']
            self.assertEqual(saved['revision'],before['revision']+1)
            self.assertEqual([(p['id'],p['name'],p['repeats'],p.get('sourcePartId')) for p in before['parts']],[(p['id'],p['name'],p['repeats'],p.get('sourcePartId')) for p in saved['parts']])
            for old,new in zip(before['parts'],saved['parts']):
                self.assertNotEqual(old['sha256'],new['sha256'])
                self.assertEqual(old.get('render',{}).get('sha256'),new.get('render',{}).get('sha256'))
                raw=self.request('GET',base+f'/parts/{new["id"]}').wfile.getvalue()
                with zipfile.ZipFile(BytesIO(raw)) as archive:
                    snapshot=json.loads(archive.read('song-part.json'))
                    self.assertEqual(snapshot['state']['modes']['kMultitrack']['version'],2)
                    self.assertEqual(archive.read('audio/bastardL.wav'),zipfile.ZipFile(BytesIO(part_zip())).read('audio/bastardL.wav'))
            after_files=self.contents(saved)
            self.assertTrue(all(after_files[n]==v for n,v in old_files.items()))
            stored=json.loads((SONGS.SONGS_ROOT/song['id']/'song.json').read_text())
            self.assertEqual(len(stored['history']),2)
            again=self.convert(saved)
            self.assertEqual(again.status,200)
            self.assertEqual(again.response['converted'],0)
            self.assertEqual(again.response['song'],saved)
            self.assertEqual(self.contents(saved),after_files)

    def test_failure_in_later_part_rolls_back_entire_song_and_staged_assets(self):
        song=self.upload(self.upload(self.create()));folder=SONGS.SONGS_ROOT/song['id'];before=(folder/'song.json').read_bytes();files=self.contents(song)
        run=SONGS.subprocess.run;calls=[]
        def fail_second(*args,**kwargs):
            calls.append(1)
            if len(calls)==2:return subprocess.CompletedProcess(args[0],1,'','Invalid K settings')
            return run(*args,**kwargs)
        with patch.object(SONGS.subprocess,'run',side_effect=fail_second):result=self.convert(song)
        self.assertEqual(result.status,400)
        self.assertEqual((folder/'song.json').read_bytes(),before)
        self.assertEqual(self.contents(song),files)

    def test_disk_failure_at_commit_leaves_originals_and_no_published_files(self):
        song=self.upload(self.create());folder=SONGS.SONGS_ROOT/song['id'];before=(folder/'song.json').read_bytes();files=self.contents(song)
        write=SONGS.write_song
        with patch.object(SONGS,'write_song',side_effect=OSError('disk failure')):result=self.convert(song)
        self.assertEqual(result.status,500)
        self.assertEqual((folder/'song.json').read_bytes(),before)
        self.assertEqual(self.contents(song),files)

    def test_conversion_requires_editor_lease_and_exact_revision(self):
        song=self.upload(self.create());path=f'/api/songs/{song["id"]}/convert-k'
        for headers,expected in [({},423),({'X-Mygrain-Song-Device':'1'*32,'X-Mygrain-Song-Session':'2'*32,'X-Mygrain-Song-Lock':self.edit_tokens[song['id']],'If-Match':'"0"'},409)]:
            h=Handler(path='/mygrain'+path);h.headers.update(headers);SONGS.handle_song_request(h,'POST',path);self.assertEqual(h.status,expected,h.response)

    def test_corrupt_source_is_rejected_before_any_conversion_commit(self):
        song=self.upload(self.create());folder=SONGS.SONGS_ROOT/song['id'];archive=folder/'parts'/(song['parts'][0]['id']+'.zip');archive.write_bytes(archive.read_bytes()+b'corruption');before=(folder/'song.json').read_bytes();files=self.contents(song)
        result=self.convert(song);self.assertEqual(result.status,400);self.assertEqual((folder/'song.json').read_bytes(),before);self.assertEqual(self.contents(song),files)

    def test_version_one_multitrack_keeps_five_takes_levels_pan_and_shared_processing(self):
        with zipfile.ZipFile(BytesIO(part_zip())) as source:
            snapshot=json.loads(source.read('song-part.json'));wav=source.read('audio/bastardL.wav')
        tracks=[{'steps':i+3,'level':(i+1)/5,'pan':(i-2)/2,'mute':i==2,'sourceBpm':123} for i in range(5)]
        snapshot['state']['modes']['kMultitrack']={'version':1,'selected':3,'tracks':tracks}
        snapshot['state']['sliders']={'performanceBastardLoopKSemitone':'7','performanceBastardLoopKFilterCutoff':'900'}
        keys=['bastardK',*[f'bastardKTrack{i}' for i in range(2,6)]]
        snapshot['assets'] += [{'key':key,'path':f'audio/{key}.wav'} for key in keys]
        body=BytesIO()
        with zipfile.ZipFile(body,'w') as archive:
            archive.writestr('song-part.json',json.dumps(snapshot));archive.writestr('audio/bastardL.wav',wav)
            for key in keys:archive.writestr(f'audio/{key}.wav',wav)
        song=self.create();base=f'/api/songs/{song["id"]}'
        song=self.request('POST',base+'/parts?name=FiveTakes',body=body.getvalue()).response['song']
        result=self.convert(song);self.assertEqual(result.status,200,result.response)
        saved=result.response['song'];part=saved['parts'][0]
        raw=self.request('GET',base+f'/parts/{part["id"]}').wfile.getvalue()
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            migrated=json.loads(archive.read('song-part.json'))['state']['modes']['kMultitrack']
            self.assertEqual(migrated['version'],2);self.assertEqual(migrated['selected'],3)
            for i,track in enumerate(migrated['tracks']):
                self.assertTrue(all(track[k]==v for k,v in tracks[i].items()))
                self.assertEqual(track['processing']['semitone'],7);self.assertEqual(track['processing']['cutoff'],900)
                self.assertEqual(archive.read(f'audio/{keys[i]}.wav'),wav)

    def test_lock_loss_at_commit_cleans_staging_without_any_source_or_manifest_update(self):
        song=self.upload(self.create());folder=SONGS.SONGS_ROOT/song['id'];before=(folder/'song.json').read_bytes();files=self.contents(song)
        check=SONGS.require_song_editor;calls=[]
        def lose_at_commit(*args):
            calls.append(1)
            if len(calls)==2:raise SONGS.SongEditError('Editing lock expired',code='SONG_LOCK_LOST')
            return check(*args)
        with patch.object(SONGS,'require_song_editor',side_effect=lose_at_commit):result=self.convert(song)
        self.assertEqual(result.status,423,result.response)
        self.assertEqual((folder/'song.json').read_bytes(),before);self.assertEqual(self.contents(song),files)

# The base class is used only for fixture methods, not duplicate suite discovery.
del SongBackendTests
