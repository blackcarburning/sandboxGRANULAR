import io, json, unittest, zipfile
import test_song_backend as F
S=F.SONGS

def body(loop=1,drums=1,**changes):
    with zipfile.ZipFile(io.BytesIO(F.part_zip())) as source:
        files={n:source.read(n) for n in source.namelist()}
    m=json.loads(files['song-part.json']);m['state']['modes'].update({'clockDividers':{'loop':loop,'drums':drums},'drumMachineEnabled':True})
    m['extra']['patternCycleMultiplier']=drums
    m['state']['modes'].update(changes)
    files['song-part.json']=json.dumps(m).encode();out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for n,b in files.items():z.writestr(n,b)
    return out.getvalue()

class ClockDividers(unittest.TestCase):
    def test_defaults_legacy_and_strict_divisions(self):
        # Frozen pre-divider fixture identity: defaults must not invalidate old audio.
        self.assertEqual(S.validate_part_zip(F.part_zip()),{'bpm':120.0,'patternSteps':16,'patternCycleMultiplier':1,'audioAssets':1,'contentSha256':'2fedf24cb4e550b67441e4a538471d6f30d2317a2046d841418769da10c60d7d'})
        for loop in S.CLOCK_DIVISIONS:
            for drums in S.CLOCK_DIVISIONS:
                d=S.validate_part_zip(body(loop,drums));self.assertEqual(d['bpm'],120/loop);self.assertEqual(d['patternCycleMultiplier'],drums)
                self.assertEqual(d.get('clockDividerVersion',0),int(loop!=1 or drums!=1))
        for bad in [None,True,False,'2',0,5,17,2.5,{},[]]:
            state={'modes':{'clockDividers':{'loop':bad,'drums':1}}}
            with self.assertRaises(ValueError):S.clock_dividers(state)
        state={'modes':{'clockDividers':{'loop':1,'drums':1,'unknown':2}}}
        with self.assertRaises(ValueError):S.clock_dividers(state)
    def test_raw_snapshot_admission_and_immutable_source(self):
        f=F.SongBackendTests();f.setUp()
        try:
            song=f.create();source=body(2,3);base=f'/api/songs/{song["id"]}';reply=f.request('POST',base+'/parts?name=Divided',body=source)
            self.assertEqual(reply.status,201);part=reply.response['song']['parts'][0];url=base+f'/parts/{part["id"]}';query=f'/render?sha256={part["sha256"]}'
            wav=F.render_wav({**part,'patternSteps':part['patternSteps']*part['patternCycleMultiplier']})
            self.assertEqual(f.request('POST',url+query,body=wav).status,400)
            self.assertEqual(f.request('POST',url+query+'&clockdividers=1',body=wav).status,200)
            folder,stored=S.read_song(song['id'],S.owner_hash({'X-Mygrain-Song-Key':'a'*64}));revision=stored['revision'];stored['parts'][0].pop('clockDividerVersion');stored['parts'][0]['render'].pop('clockDividerVersion');S.write_song(folder,stored,advance_revision=False)
            self.assertEqual(f.request('GET',url+'/render').status,404)
            self.assertEqual(f.request('POST',url+query,body=wav).status,400)
            self.assertEqual(f.request('GET',url).wfile.getvalue(),source)
            result=f.request('POST',url+query+'&clockdividers=1',body=wav);self.assertEqual(result.status,200);self.assertEqual(result.response['song']['revision'],revision)
        finally:f.tearDown()
if __name__=='__main__':unittest.main()
