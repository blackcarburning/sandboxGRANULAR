"""Real CUDA / scratch integration plus fixed-source and numerical regressions."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
from io import BytesIO
import numpy as np
from scipy.io import wavfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import mygrain_restructure as r


def recording(frequency):
    x=np.arange(48000)/48000
    audio=np.stack([np.sin(2*np.pi*frequency*x),np.sin(2*np.pi*(frequency+73)*x)],axis=1)*.6
    b=BytesIO();wavfile.write(b,48000,(audio*32767).astype(np.int16));return b.getvalue()


class RestructureTests(unittest.TestCase):
    def test_rejects_other_sources_and_invalid_timing_before_io(self):
        for payload in [{'source':'sampledrop'}, {'bpm':float('nan')}, {'bpm':301}, {'bpm':0}, {'divisions':[]}, {'divisions':['1/256']}, {'divisions':'1/8'}, {'divisions':[None]}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                r.build(payload,owner='test',list_files=lambda _:self.fail('must reject before I/O'),fetch_bytes=None)

    def test_next_generation_divisions_preserve_legacy_audio_content_identity(self):
        import zipfile
        import mygrain_songs as songs
        archive=r.APP.parent/'output/mygrain-restructure-20261121T185303Z/new-source.zip'
        original=archive.read_bytes();expected=songs.validate_part_zip(original)['contentSha256']
        with zipfile.ZipFile(BytesIO(original)) as z:
            entries={name:z.read(name) for name in z.namelist()}
        original_snapshot=json.loads(entries['song-part.json'])
        for selected in [['1/16'],['uncut'],['1/4','1/8']]:
            snapshot=json.loads(json.dumps(original_snapshot));snapshot['state']['modes']['restructureDivisions']=selected
            controls=snapshot['extra']['controls']
            for suffix,value in [('Four','4'),('Two','2'),('Whole','1'),('Half','1/2'),('Quarter','1/4'),('Eighth','1/8'),('Sixteenth','1/16'),('ThirtySecond','1/32'),('Uncut','uncut')]:
                controls.append({'id':'performanceRestructureDivision'+suffix,'type':'checkbox','value':value,'checked':value in selected})
            out=BytesIO()
            with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_STORED) as z:
                for name,data in entries.items():z.writestr(name,json.dumps(snapshot).encode() if name=='song-part.json' else data)
            self.assertEqual(songs.validate_part_zip(out.getvalue())['contentSha256'],expected)

    def test_no_sources_keeps_workspace_clean(self):
        with self.assertRaisesRegex(ValueError,'empty'):
            r.build({},owner='test',list_files=lambda _:[],fetch_bytes=None)

    def test_real_gpu_exact_bar_stereo_determinism_and_cleanup(self):
        corpus={'a.wav':recording(220),'b.wav':recording(430)};folders=[]
        real_workspace=r.pool.workspace
        def workspace(prefix):
            folder=Path(tempfile.mkdtemp(prefix=prefix,dir=os.environ.get('MYGRAIN_SCRATCH_ROOT')));folders.append(folder);return folder
        env={'MYGRAIN_WORKER_DB':'','MYGRAIN_SCRATCH_ROOT':os.environ.get('MYGRAIN_SCRATCH_ROOT',tempfile.gettempdir())}
        with patch.dict(os.environ,env),patch.object(r.pool,'workspace',workspace):
            results=[]
            for _ in range(2):
                data,meta=r.build({'source':'samples_public','bpm':137,'seed':'deterministic-test'},owner='test',
                    list_files=lambda source:list(corpus) if source=='samples_public' else self.fail(source),
                    fetch_bytes=lambda source,name:corpus[name] if source=='samples_public' else self.fail(source))
                sr,pcm=wavfile.read(BytesIO(data));self.assertEqual(sr,48000)
                self.assertEqual(pcm.shape,(round(48000*240/137),2));self.assertTrue(np.isfinite(pcm).all())
                self.assertLessEqual(float(abs(pcm).max()),.89001);self.assertGreater(float((pcm**2).mean()),.001)
                self.assertGreater(float(abs(pcm[:,0]-pcm[:,1]).mean()),.01)
                self.assertEqual(meta['engine'],'CUDA');self.assertEqual(meta['grains'],16)
                self.assertEqual(meta['grainNote'],'1/16');self.assertEqual(meta['version'],4)
                self.assertEqual(meta['effect']['name'],'per-grain Cooking Pot')
                self.assertEqual(len(meta['effectPool']),11)
                self.assertGreater(len({g['effect']['name'] for g in meta['recipe']}),1)
                targets=[g['gainMatch']['targetRms'] for g in meta['recipe']]
                self.assertLess(max(targets)-min(targets),1e-9)
                self.assertTrue(2 <= len(meta['gapSteps']) <= 6)
                cursor=0
                for step,grain in enumerate(meta['recipe']):
                    self.assertLessEqual(abs(grain['frames']-48000*60/137/4),1)
                    segment=pcm[cursor:cursor+grain['frames']]
                    self.assertEqual(grain['gap'],step in meta['gapSteps'])
                    if grain['gap']: self.assertTrue(np.all(segment==0))
                    else: self.assertGreater(float((segment**2).mean()),.0001)
                    self.assertTrue(np.all(pcm[cursor]==0));cursor+=grain['frames'];self.assertTrue(np.all(pcm[cursor-1]==0))
                self.assertEqual(cursor,len(pcm));results.append(data)
            self.assertEqual(results[0],results[1])
        self.assertTrue(all(not f.exists() for f in folders))

    def test_selected_divisions_and_gaps_on_real_gpu(self):
        corpus={'a.wav':recording(220),'b.wav':recording(430)}
        root=os.environ.get('MYGRAIN_SCRATCH_ROOT',tempfile.gettempdir())
        def workspace(prefix): return Path(tempfile.mkdtemp(prefix=prefix,dir=root))
        selections=[[value] for value in r.DIVISIONS]+[['1/4','1/8','1/32']]
        with patch.dict(os.environ,{'MYGRAIN_WORKER_DB':'','MYGRAIN_SCRATCH_ROOT':root}),patch.object(r.pool,'workspace',workspace):
            for divisions in selections:
                with self.subTest(divisions=divisions):
                    data,meta=r.build({'bpm':137,'seed':'division-'+','.join(divisions),'divisions':divisions},owner='test',list_files=lambda _:list(corpus),fetch_bytes=lambda _,name:corpus[name])
                    _,pcm=wavfile.read(BytesIO(data))
                    self.assertEqual(meta['divisions'],divisions)
                    self.assertEqual(len(pcm),round(48000*240/137))
                    self.assertEqual(sum(item['frames'] for item in meta['recipe']),len(pcm))
                    self.assertTrue(np.isfinite(pcm).all());self.assertGreater(float((pcm**2).mean()),.0001)
                    for grain in meta['recipe']:
                        self.assertIn(grain['division'],divisions)
                        value=grain['division'];fraction=1 if value in ('4','2','1','uncut') else 1/int(value.split('/')[1])
                        self.assertLessEqual(abs(grain['frames']-len(pcm)*fraction),1)
                    self.assertTrue(2 <= len(meta['gapWindows']) <= 6)
                    for gap in meta['gapWindows']:
                        self.assertTrue(np.all(pcm[gap['startFrame']:gap['startFrame']+gap['frames']]==0))
                    if len(divisions)==1:
                        value=divisions[0];expected=1 if value in ('4','2','1','uncut') else int(value.split('/')[1])
                        self.assertEqual(meta['grains'],expected)

    def test_gpu_failure_releases_workspace(self):
        folders=[];real_workspace=r.pool.workspace
        def workspace(prefix):
            f=real_workspace(prefix);folders.append(f);return f
        with patch.dict(os.environ,{'MYGRAIN_WORKER_DB':'','MYGRAIN_SCRATCH_ROOT':tempfile.gettempdir(),'MYGRAIN_GPU_PYTHON':'/bin/false'}),patch.object(r.pool,'workspace',workspace):
            with self.assertRaisesRegex(RuntimeError,'Previous audio is unchanged'):
                r.build({},owner='test',list_files=lambda _:['a.wav'],fetch_bytes=lambda *_:recording(220))
        self.assertTrue(all(not f.exists() for f in folders))

    def test_cuda_splice_matches_cpu_reference(self):
        script=r.APP/'scripts/restructure-gpu.py'
        code=f'''import importlib.util,numpy as np,cupy as cp
s=importlib.util.spec_from_file_location('grain', {str(script)!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
rng=np.random.default_rng(8);bank=rng.normal(size=(10000,2)).astype(np.float32);indices=rng.integers(0,10000,96000);gains=rng.uniform(size=96000).astype(np.float32)
gains[12000:18000]=0
dry=m.assemble(np,bank,indices,gains)
for name in m.EFFECTS:
 effect={{'name':name,'amount':.63}}
 a=m.assemble(np,bank,indices,gains,effect);b=cp.asnumpy(m.assemble(cp,bank,indices,gains,effect))
 np.testing.assert_allclose(a,b,rtol=2e-5,atol=2e-5)
 assert np.all(b[12000:18000]==0),name
 assert np.isfinite(b).all() and abs(b).max()<=.89001,name
 assert np.mean(abs(a-dry))>.0001,name
# New stereo-linked matching is measured numerically, not just recipe metadata.
import copy
wet=rng.normal(size=(18000,2)).astype(np.float32)
wet[:6000]*=.015;wet[6000:12000]*=.6;wet[12000:]*=2
recipe=[{{'frames':6000}} for _ in range(3)]
a=m.match_and_splice(np,wet,np.ones(18000,dtype=np.float32),copy.deepcopy(recipe))
b=cp.asnumpy(m.match_and_splice(cp,wet,np.ones(18000,dtype=np.float32),copy.deepcopy(recipe)))
np.testing.assert_allclose(a,b,rtol=2e-5,atol=2e-5)
levels=[np.sqrt(np.mean(a[i:i+6000]**2)) for i in range(0,18000,6000)]
assert max(levels)/min(levels)<1.0001,levels
assert abs(a).max()<=.89001
print('CUDA/CPU parity and measured equal grain RMS passed')'''
        subprocess.run([str(r.APP/'.venv-gpu/bin/python'),'-c',code],check=True)


if __name__=='__main__':unittest.main()
