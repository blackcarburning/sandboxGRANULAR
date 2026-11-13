"""Real PCM joins/padding and selective saved-render compatibility."""
import ast, importlib.util, math, os, pathlib, unittest
import numpy as np
from test_song_backend import part_zip, rewrite_part
APP=pathlib.Path(os.environ.get('MYGRAIN_APP_ROOT',pathlib.Path(__file__).resolve().parents[1]))
WORKSPACE=APP.parent
source=(WORKSPACE/'fs7300-documenter/server.py').read_text()
ns={'np':np,'math':math,'MYGRAIN_BASTARDLOOP_TARGET_SAMPLE_RATE':44100}
for node in ast.parse(source).body:
    if isinstance(node,ast.FunctionDef) and node.name in ('crossfade_sample_joins','fade_sample_edges','trim_or_pad_audio_preserve_pitch'):
        exec(compile(ast.Module(body=[node],type_ignores=[]),'generation-pcm','exec'),ns)
spec=importlib.util.spec_from_file_location('crossfade_songs',APP/'backend/mygrain_songs.py');songs=importlib.util.module_from_spec(spec);spec.loader.exec_module(songs)
class SampleCrossfadeTests(unittest.TestCase):
    def test_stereo_dc_jumps_and_loop_seam(self):
        for sr in (44100,48000):
            p=sr//4;a=np.empty((p*2,2),np.float32);a[:p]=[.8,-.4];a[p:]=[-.6,.3];length=len(a)
            ns['crossfade_sample_joins'](a,[p],sr,True)
            self.assertEqual(len(a),length);np.testing.assert_array_equal(a[0],a[-1]);np.testing.assert_array_equal(a[p],a[p-1]);self.assertLess(np.abs(np.diff(a,axis=0)).max(),.025);np.testing.assert_array_equal(a[:,1],-a[:,0]/2)
    def test_padded_or_trimmed_sources_fade_before_actual_eof(self):
        for target in (1024,8192):
            a=np.full((4096,2),.7,np.float32);before=a.copy();b,start=ns['trim_or_pad_audio_preserve_pitch'](a,target);self.assertEqual(b.shape,(target,2));np.testing.assert_array_equal(a,before);np.testing.assert_array_equal(b[0],0);np.testing.assert_array_equal(b[min(4096,target)-1],0);self.assertLess(np.abs(np.diff(b,axis=0)).max(),.01);self.assertTrue((b[4096:]==0).all())
    def test_selective_hash_and_source_integrity(self):
        before=pathlib.Path(os.environ['MYGRAIN_BEFORE_BACKEND']).read_text();oldns=dict(songs.__dict__);node=next(n for n in ast.parse(before).body if isinstance(n,ast.FunctionDef) and n.name=='validate_part_zip');exec(ast.get_source_segment(before,node),oldns)
        for modes,required in (({},False),({'bastardLoopLEnabled':False},False),({'bastardLoopLEnabled':True,'bastardLoopLSourceMode':'synth'},False),({'bastardLoopLEnabled':True},True)):
            b=rewrite_part(part_zip(),lambda m:m['state']['modes'].update(modes));copy=bytes(b);new=songs.validate_part_zip(b);old=oldns['validate_part_zip'](b);self.assertEqual(b,copy);self.assertEqual(new.get('sampleCutVersion',0),int(required));self.assertEqual(new['contentSha256']==old['contentSha256'],not required)
if __name__=='__main__':unittest.main()
