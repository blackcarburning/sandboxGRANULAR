import copy,json,subprocess,zipfile
from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
from test_song_backend import SONGS,Handler,SongBackendTests,part_zip,rewrite_part,render_wav
class ServerWConversionTests(TestCase):
    setUp=SongBackendTests.setUp
    tearDown=SongBackendTests.tearDown
    request=SongBackendTests.request
    create=SongBackendTests.create
    def upload(self,song):
        body=rewrite_part(part_zip(),lambda s:s['extra'].update(freezeStateVersion=1,audioSlots={'bastardL':True}))
        return self.request('POST',f'/api/songs/{song["id"]}/parts?name=LegacyW',body=body).response['song']
    reuse=SongBackendTests.reuse
    def convert(self,song):return self.request('POST',f'/api/songs/{song["id"]}/convert-w')
    def files(self,song):return {p.name:p.read_bytes() for p in (SONGS.SONGS_ROOT/song['id']/'parts').iterdir()}
    def test_unique_hidden_sources_audio_renders_history_and_idempotence(self):
        for hidden in (False,True):
            song=self.upload(self.upload(self.create()));base=f'/api/songs/{song["id"]}';part=song['parts'][0]
            song=self.request('POST',base+f'/parts/{part["id"]}/render?sha256={part["sha256"]}&portable=1',body=render_wav(part)).response['song'];song=self.reuse(song)
            if hidden:song=self.request('POST',base+f'/parts/{part["id"]}/delete?sha256={part["sha256"]}').response['song']
            old=copy.deepcopy(song);files=self.files(song);result=self.convert(song);self.assertEqual(result.status,200,result.response);self.assertEqual(result.response['converted'],2);saved=result.response['song'];self.assertEqual(saved['revision'],old['revision']+1)
            for before,after in zip(old['parts'],saved['parts']):
                for key in ['id','name','repeats','sourcePartId']:self.assertEqual(before.get(key),after.get(key))
                self.assertEqual(before.get('render',{}).get('sha256'),after.get('render',{}).get('sha256'))
                raw=self.request('GET',base+f'/parts/{after["id"]}').wfile.getvalue()
                with zipfile.ZipFile(BytesIO(raw)) as archive:
                    snap=json.loads(archive.read('song-part.json'));self.assertIs(snap['extra']['audioSlots']['bastardW'],False);self.assertIs(snap['state']['modes']['bastardLoopWEnabled'],False);self.assertEqual(archive.read('audio/bastardL.wav'),zipfile.ZipFile(BytesIO(part_zip())).read('audio/bastardL.wav'))
            after_files=self.files(saved);self.assertTrue(all(after_files[k]==v for k,v in files.items()));again=self.convert(saved);self.assertEqual(again.response['converted'],0);self.assertEqual(again.response['song'],saved);self.assertEqual(self.files(saved),after_files)
    def test_later_part_or_disk_failure_rolls_back_all_changes(self):
        for failure in ('later','commit'):
            song=self.upload(self.upload(self.create()));folder=SONGS.SONGS_ROOT/song['id'];before=(folder/'song.json').read_bytes();files=self.files(song);run=SONGS.subprocess.run;calls=[]
            def fail_later(*args,**kwargs):
                calls.append(1)
                return subprocess.CompletedProcess(args[0],1,'','bad W') if len(calls)==2 else run(*args,**kwargs)
            with patch.object(SONGS.subprocess,'run',side_effect=fail_later) if failure=='later' else patch.object(SONGS,'write_song',side_effect=OSError('disk failure')):result=self.convert(song)
            self.assertIn(result.status,(400,500));self.assertEqual((folder/'song.json').read_bytes(),before);self.assertEqual(self.files(song),files)
    def test_modern_w_keeps_audio_fx_and_revision(self):
        def modify(s):
            s['extra'].update(freezeStateVersion=1,audioSlots={'bastardL':True,'bastardW':True});s['state']['modes']['bastardLoopWEffects']={'room':.4};s['assets'].append({'key':'bastardW','path':'audio/bastardW.wav'})
        with zipfile.ZipFile(BytesIO(rewrite_part(part_zip(),modify))) as z:entries={n:z.read(n) for n in z.namelist()}
        entries['audio/bastardW.wav']=entries['audio/bastardL.wav'];body=BytesIO()
        with zipfile.ZipFile(body,'w') as z:
            for n,b in entries.items():z.writestr(n,b)
        song=self.create();song=self.request('POST',f'/api/songs/{song["id"]}/parts?name=ModernW',body=body.getvalue()).response['song'];files=self.files(song);result=self.convert(song);self.assertEqual(result.status,200,result.response);self.assertEqual(result.response['converted'],0);self.assertEqual(result.response['song'],song);self.assertEqual(self.files(song),files)
    def test_editor_and_revision_required(self):
        song=self.upload(self.create());path=f'/api/songs/{song["id"]}/convert-w'
        for headers,status in [({},423),({'X-Mygrain-Song-Device':'1'*32,'X-Mygrain-Song-Session':'2'*32,'X-Mygrain-Song-Lock':self.edit_tokens[song['id']],'If-Match':'"0"'},409)]:
            h=Handler(path='/mygrain'+path);h.headers.update(headers);SONGS.handle_song_request(h,'POST',path);self.assertEqual(h.status,status,h.response)
    def test_incomplete_w_rejected(self):
        body=rewrite_part(part_zip(),lambda s:(s['state']['modes'].update(bastardLoopWEnabled=True),s['extra'].update(freezeStateVersion=1,audioSlots={'bastardL':True})));song=self.create();song=self.request('POST',f'/api/songs/{song["id"]}/parts?name=BrokenW',body=body).response['song'];files=self.files(song);result=self.convert(song);self.assertEqual(result.status,400,result.response);self.assertIn('incomplete for bastardW',result.response['error']);self.assertEqual(self.files(song),files)
