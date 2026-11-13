import copy, importlib.util, json, os, pathlib, sys, types, unittest, zipfile
from io import BytesIO
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from test_song_backend import part_zip, rewrite_part, SongBackendTests, render_wav
spec = importlib.util.spec_from_file_location('drum_normalization_songs', ROOT / 'backend/mygrain_songs.py')
current = importlib.util.module_from_spec(spec); spec.loader.exec_module(current)
baseline = None
if os.environ.get('MYGRAIN_DRUM_BASELINE_BACKEND'):
    baseline = types.ModuleType('before_drum_normalization')
    baseline.__file__ = str(ROOT / 'backend/mygrain_songs.py')
    exec(compile(pathlib.Path(os.environ['MYGRAIN_DRUM_BASELINE_BACKEND']).read_text(), baseline.__file__, 'exec'), baseline.__dict__)

def fixture(processing=None, enabled=True, drive=0):
    def mutate(m):
        m['state']['modes'].update(drumMachineEnabled=enabled, drumMachineSnarePattern=[True]+[False]*15)
        m['state']['sliders'] = {'drumMachineSnareDistortion': str(drive)}
        if processing is not None: m['state']['modes']['drumMachineSampleProcessing'] = processing
        m['assets'][0].update(key='drumSnare', path='audio/drumSnare.wav')
    body = rewrite_part(part_zip(), mutate)
    result=BytesIO()
    with zipfile.ZipFile(BytesIO(body)) as source, zipfile.ZipFile(result,'w') as target:
        for name in source.namelist(): target.writestr('audio/drumSnare.wav' if name=='audio/bastardL.wav' else name, source.read(name))
    return result.getvalue()

class DrumNormalization(unittest.TestCase):
    @unittest.skipUnless(baseline, 'Set MYGRAIN_DRUM_BASELINE_BACKEND to the pre-change module for identity comparison.')
    def test_legacy_audio_hash_and_render_identity_are_unchanged(self):
        for body in [part_zip(), fixture(), fixture(drive=1)]:
            self.assertEqual(current.validate_part_zip(body), baseline.validate_part_zip(body))

    def test_next_load_settings_and_peak_metadata_do_not_change_audio_identity(self):
        for enabled in [True, False]:
            processing={'version':1,'autoNormalize':enabled,'snareDrive':'smooth','lanes':{}}
            self.assertEqual(current.validate_part_zip(fixture(processing)), current.validate_part_zip(fixture()))

    def test_only_audible_normalization_and_smooth_drive_get_revision(self):
        for enabled, gain, bypass, drive, response, expected in [(True,5,False,0,'legacy',1),(True,5,True,0,'legacy',None),(False,5,False,0,'legacy',None),(True,1,False,1,'smooth',1),(True,1,False,0,'smooth',None)]:
            processing={'version':1,'snareDrive':response,'lanes':{'snare':{'enabled':not bypass,'gain':gain,'peak':.1}}}
            details=current.validate_part_zip(fixture(processing,enabled,drive))
            self.assertEqual(details.get('drumProcessingVersion'),expected)
        processing={'version':1,'lanes':{'snare':{'enabled':True,'gain':5,'peak':.1}}}
        a=current.validate_part_zip(fixture(processing));processing['lanes']['snare']['peak']=.01
        self.assertEqual(a,current.validate_part_zip(fixture(processing)))

    def test_invalid_versions_gains_and_flags_are_rejected(self):
        for value in [{'version':2,'lanes':{}},{'version':1,'lanes':{'snare':{'gain':20}}},{'version':1,'lanes':{'snare':{'gain':True}}},{'version':1,'autoNormalize':'yes','lanes':{}}]:
            with self.assertRaises(ValueError): current.validate_part_zip(fixture(value))

    def test_partial_lane_copy_moves_only_matching_processing(self):
        def settings(gain): return {'version':1,'snareDrive':'smooth','lanes':{'snare':{'enabled':True,'gain':gain,'peak':.1},'kick':{'enabled':True,'gain':2,'peak':.25}}}
        source, target=fixture(settings(5)), fixture(settings(3))
        body=current.paste_loop_archive(target,source,['drumSnare'])
        with zipfile.ZipFile(BytesIO(body)) as z: processing=json.loads(z.read('song-part.json'))['state']['modes']['drumMachineSampleProcessing']
        self.assertEqual(processing['lanes']['snare']['gain'],5);self.assertEqual(processing['lanes']['kick']['gain'],2)
        body=current.paste_loop_archive(target,fixture(),['drumSnare'])
        with zipfile.ZipFile(BytesIO(body)) as z: processing=json.loads(z.read('song-part.json'))['state']['modes']['drumMachineSampleProcessing']
        self.assertEqual(processing['lanes']['snare']['gain'],1);self.assertEqual(processing['snareDrive'],'legacy')

    def test_render_endpoint_requires_version_and_preserves_source(self):
        case = SongBackendTests(methodName='runTest'); case.setUp()
        try:
            song = case.create()
            processing = {'version':1,'lanes':{'snare':{'enabled':True,'gain':5,'peak':.1}}}
            song = case.request('POST',f'/api/songs/{song["id"]}/parts?name=Normalized&repeats=1',body=fixture(processing)).response['song']
            part = song['parts'][0]; path=f'/api/songs/{song["id"]}/parts/{part["id"]}'
            original=case.request('GET',path).wfile.getvalue()
            for flags in ['', '&drumprocessing=2']:
                self.assertEqual(case.request('POST',path+'/render?sha256='+part['sha256']+flags,body=render_wav(part)).status,400)
                self.assertEqual(case.request('GET',f'/api/songs/{song["id"]}').response['song'],song)
            result=case.request('POST',path+'/render?sha256='+part['sha256']+'&drumprocessing=1',body=render_wav(part))
            self.assertEqual(result.status,200);self.assertEqual(result.response['song']['parts'][0]['render']['drumProcessingVersion'],1)
            self.assertEqual(case.request('GET',path).wfile.getvalue(),original)
        finally: case.tearDown()

if __name__=='__main__': unittest.main()
