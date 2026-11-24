import copy,io,json,math,subprocess,unittest,zipfile,pathlib,importlib.util
import test_song_backend as backend
S=backend.SONGS
G=S.GLASSHAUS
ROOT=pathlib.Path(__file__).resolve().parents[1]
recipe=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./glasshaus-dsp.js').normalize({enabled:true})))"],cwd=ROOT))
def source(value=None,bars=1):
    raw=backend.part_zip()
    with zipfile.ZipFile(io.BytesIO(raw)) as z: entries={i.filename:z.read(i.filename) for i in z.infolist()}
    manifest=json.loads(entries['song-part.json'])
    if value is not None:manifest['state']['modes']['glasshaus']=copy.deepcopy(value)
    manifest['extra']['patternCycleMultiplier']=bars
    entries['song-part.json']=json.dumps(manifest).encode()
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for k,v in entries.items():z.writestr(k,v)
    return out.getvalue()
class GlassHausTests(unittest.TestCase):
    def test_valid_and_exact_nonmutation(self):
        r=copy.deepcopy(recipe);G.validate(r);self.assertEqual(r,recipe);self.assertEqual(G.render_version(r),38);self.assertEqual(S.validate_part_zip(source(r))['emberVersion'],38)
    def test_three_object_and_sequence_bounds(self):
        for key,bad in [('objects',[]),('steps',[]),('root',True),('bars',3),('bars',True),('mode','sample')]:
            with self.subTest(key=key),self.assertRaises(ValueError):G.validate({**recipe,key:bad})
        for val in [float('nan'),float('inf'),-1,121,True]:
            r=copy.deepcopy(recipe);r['objects'][0]['decay']=val
            with self.subTest(decay=val),self.assertRaises(ValueError):G.validate(r)
        r=copy.deepcopy(recipe);r['objects'][0]['decay']=120;G.validate(r)
    def test_absent_and_off_legacy_identity(self):
        old=S.validate_part_zip(source());r=copy.deepcopy(recipe);r['enabled']=False
        self.assertEqual(S.validate_part_zip(source(r)),old)
    def test_lcm_cycle(self):
        for bars in [1,2,4,8]:
            r={**recipe,'bars':bars};details=S.validate_part_zip(source(r,bars));self.assertEqual(details['patternCycleMultiplier'],bars)
    def test_admission_requires_new_engine_and_immutable_source(self):
        raw=source(recipe);f=backend.SongBackendTests();f.setUp()
        try:
            song=f.create();reply=f.request('POST',f'/api/songs/{song["id"]}/parts?name=GlassHaus&repeats=1',body=raw);self.assertEqual(reply.status,201,reply.response);part=reply.response['song']['parts'][0];url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1';wav=backend.render_wav(part)
            self.assertEqual(f.request('POST',url+'&ember=37',body=wav).status,400)
            reply=f.request('POST',url+'&ember=38',body=wav);self.assertEqual(reply.status,200,reply.response)
            self.assertEqual(f.request('GET',url).status,200)
            self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
        finally:f.tearDown()

class GlassHausContactTests(unittest.TestCase):
    def test_optional_contact_preserves_old_recipe_and_accepts_both_tools(self):
        old=copy.deepcopy(recipe);old.pop('contact',None);G.validate(old)
        for tool in ('auto','finger','mallet'):
            value={**old,'contact':tool};before=copy.deepcopy(value);G.validate(value);self.assertEqual(value,before)
        for bad in ('bow',None,False,[],{}):
            with self.subTest(contact=bad),self.assertRaises(ValueError):G.validate({**old,'contact':bad})

class GlassHausDrawnTests(unittest.TestCase):
    def drawn(self):
        r=copy.deepcopy(recipe);r['lanes']=[[.6]*128,[0]*128,[0]*128];return r
    def test_strict_curve_validation_and_selective_audibility(self):
        r=self.drawn();before=copy.deepcopy(r);G.validate(r);self.assertEqual(r,before);self.assertEqual(G.render_version(r),39)
        for bad in [None,[],[[0]*128],[[0]*127]*3,[[True]*128]*3,[[float('nan')]*128]*3,[[1.1]*128]*3]:
            with self.subTest(value=str(bad)[:20]),self.assertRaises(ValueError):G.validate({**r,'lanes':bad})
        r['lanes']=[[0]*128]*3;self.assertFalse(G.audible(r));self.assertEqual(G.render_version(r),0)
        r['lanes'][1]=[1]*128;self.assertFalse(G.audible(r));r['objects'][1]['enabled']=True;self.assertTrue(G.audible(r))
    def test_legacy_identity_is_unchanged_and_curves_have_their_own_identity(self):
        old=S.validate_part_zip(source(recipe));self.assertEqual(old['emberVersion'],38)
        r=self.drawn();new=S.validate_part_zip(source(r));self.assertEqual(new['emberVersion'],39);self.assertNotEqual(old['contentSha256'],new['contentSha256'])
        changed=copy.deepcopy(r);changed['lanes'][0][30]=.2;self.assertNotEqual(S.validate_part_zip(source(changed))['contentSha256'],new['contentSha256'])
        r['enabled']=False;self.assertEqual(S.validate_part_zip(source(r))['contentSha256'],S.validate_part_zip(source())['contentSha256'])
    def test_curves_require_cap39_and_preserve_the_uploaded_archive(self):
        raw=source(self.drawn());f=backend.SongBackendTests();f.setUp()
        try:
            reply=f.request('POST',f'/api/songs/{f.create()["id"]}/parts?name=Drawn&repeats=1',body=raw);self.assertEqual(reply.status,201,reply.response);song=reply.response['song'];part=song['parts'][0];url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1';wav=backend.render_wav(part)
            self.assertEqual(f.request('POST',url+'&ember=38',body=wav).status,400)
            self.assertEqual(f.request('POST',url+'&ember=39',body=wav).status,200)
            self.assertEqual(f.request('GET',url).status,200)
            self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
        finally:f.tearDown()

class GlassHausHitTests(unittest.TestCase):
    def hit_recipe(self):
        r=copy.deepcopy(recipe);r['mode']='strike';r['lanes']=[[.7]*128,[0]*128,[0]*128];r['hits']=[[False]*128 for _ in range(3)];r['hits'][0][3]=True;return r
    def test_exact_hit_schema_audibility_and_identity(self):
        r=self.hit_recipe();before=copy.deepcopy(r);G.validate(r);self.assertEqual(r,before);self.assertEqual(G.render_version(r),40);self.assertEqual(S.validate_part_zip(source(r))['emberVersion'],40)
        for bad in [None,[],[[False]*128],[[False]*127]*3,[[0]*128]*3]:
            with self.subTest(hits=str(bad)[:20]),self.assertRaises(ValueError):G.validate({**r,'hits':bad})
        r['hits'][0][3]=False;self.assertFalse(G.audible(r));self.assertEqual(G.render_version(r),0);self.assertEqual(S.validate_part_zip(source(r))['contentSha256'],S.validate_part_zip(source())['contentSha256'])
        r['mode']='rub';self.assertTrue(G.audible(r));r['lanes'][0]=[0]*128;self.assertFalse(G.audible(r))
    def test_hits_require_cap40_and_original_zip_remains_exact(self):
        raw=source(self.hit_recipe());f=backend.SongBackendTests();f.setUp()
        try:
            reply=f.request('POST',f'/api/songs/{f.create()["id"]}/parts?name=Explicit-hits&repeats=1',body=raw);self.assertEqual(reply.status,201,reply.response);song=reply.response['song'];part=song['parts'][0];url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1';wav=backend.render_wav(part)
            self.assertEqual(f.request('POST',url+'&ember=39',body=wav).status,400);self.assertEqual(f.request('POST',url+'&ember=40',body=wav).status,200);self.assertEqual(f.request('GET',url).status,200);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
        finally:f.tearDown()

class GlassHausSlideGainTests(unittest.TestCase):
    def test_optional_strict_gain_and_selective_identity(self):
        for bad in [True,0,17,float('nan'),float('inf'),'8',None]:
            with self.subTest(gain=bad),self.assertRaises(ValueError):G.validate({**recipe,'slideGain':bad})
        old={**recipe,'mode':'rub'};baseline=S.validate_part_zip(source(old))
        for gain in [1,2,4,8,16]:
            r={**old,'slideGain':gain};before=copy.deepcopy(r);G.validate(r);self.assertEqual(r,before)
            self.assertEqual(G.render_version(r),38 if gain==1 else 41)
            current=S.validate_part_zip(source(r));self.assertEqual(current['emberVersion'],38 if gain==1 else 41)
            self.assertEqual(current['contentSha256']==baseline['contentSha256'],gain==1)
        for mode in ['strike','both']:
            a={**recipe,'mode':mode};self.assertEqual(S.validate_part_zip(source(a)),S.validate_part_zip(source({**a,'slideGain':16})))
        r={**old,'enabled':False,'slideGain':8};self.assertEqual(S.validate_part_zip(source(r)),S.validate_part_zip(source()))
    def test_boost_requires_cap41_and_preserves_exact_archive(self):
        raw=source({**recipe,'mode':'rub','slideGain':8});f=backend.SongBackendTests();f.setUp()
        try:
            reply=f.request('POST',f'/api/songs/{f.create()["id"]}/parts?name=Boosted-slide&repeats=1',body=raw);self.assertEqual(reply.status,201,reply.response);song=reply.response['song'];part=song['parts'][0];url=f'/api/songs/{song["id"]}/parts/{part["id"]}/render?sha256={part["sha256"]}&samplecuts=1';wav=backend.render_wav(part)
            self.assertEqual(f.request('POST',url+'&ember=40',body=wav).status,400);self.assertEqual(f.request('POST',url+'&ember=41',body=wav).status,200);self.assertEqual(f.request('GET',url).status,200);self.assertEqual(f.request('GET',f'/api/songs/{song["id"]}/parts/{part["id"]}').wfile.getvalue(),raw)
        finally:f.tearDown()

if __name__=='__main__':unittest.main()
