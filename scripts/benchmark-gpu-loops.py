import importlib.util,pathlib,time,os,json,tempfile,hashlib,statistics
import numpy as np
from scipy.io import wavfile
root=pathlib.Path(__file__).resolve().parents[1];spec=importlib.util.spec_from_file_location('benchmark_server',root.parent/'fs7300-documenter/server.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
# Dedicated store, no account data/source ZIPs touched.
store=tempfile.TemporaryDirectory();s.configure_mygrain_accounts(pathlib.Path(store.name));s.MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT=pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-source-mirrors')
s.MYGRAIN_BASTARDLOOPS_ROOT=pathlib.Path(store.name)/'generated'
name='KSHMR_sok5_120_vocal_indigenous_loop_breath_fast_whispers.wav';path=s.MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT/'SAMPLES_VOCAL'/name
before=hashlib.sha256(path.read_bytes()).hexdigest();sr,raw=wavfile.read(path);samples=s.ensure_stereo(s.resample_audio_channels(s.audio_samples_to_float32(raw),sr,48000))
os.environ['MYGRAIN_SOURCE_CACHE']='off'
g=s._gpu_phase
deadline=time.monotonic()+10
while (not g.diagnostics()['running'] or g._lock.locked()) and time.monotonic()<deadline:
 time.sleep(.05)
if not g.diagnostics()['running'] or g._lock.locked():
 raise RuntimeError('CUDA warm-up unavailable/busy: '+str(g.diagnostics()))
results=[]
for seconds in [2,8,30]:
 x=np.tile(samples,(int(np.ceil(seconds*48000/len(samples))),1))[:seconds*48000];c=[];d=[]
 for i in range(3):
  t=time.perf_counter();a=s.time_stretch_audio_preserve_pitch_cpu(x,.83);c.append(time.perf_counter()-t)
  t=time.perf_counter();b=g.stretch(x,.83,s.time_stretch_audio_preserve_pitch_cpu);d.append(time.perf_counter()-t)
 results.append(dict(seconds=seconds,channels=2,cpuSeconds=statistics.median(c),gpuSeconds=statistics.median(d),speedup=statistics.median(c)/statistics.median(d),snrDb=float(10*np.log10(np.mean(a*a)/np.mean((a-b)**2))),maxAbsError=float(np.max(abs(a-b)))))
# Actual seeded V request pipeline including fetch, WAV decode, stretch, cuts, encode.
args=dict(bpm=97,seed='cuda-v-reference',divisions=['1/8'],source_key='samples_vocal',pattern_steps=32,source_files=[name])
# Warm disk/file cache equally.
s.generate_bastardloop_file(**args)
full=[]
for mode in ['off','auto']:
 os.environ['MYGRAIN_GPU']=mode;times=[]
 for i in range(3):
  t=time.perf_counter();r=s.generate_bastardloop_file(**args);times.append(time.perf_counter()-t)
  if mode=='off':cpu=r
  else:gpu=r
 full.append(dict(mode=mode,seconds=times,median=statistics.median(times)))
from io import BytesIO
_,ca=wavfile.read(BytesIO(cpu['bytes']));_,ga=wavfile.read(BytesIO(gpu['bytes']));error=ca.astype('d')-ga.astype('d');snr=float(10*np.log10(np.mean(ca.astype('d')**2)/np.mean(error**2)))
assert before==hashlib.sha256(path.read_bytes()).hexdigest()
assert cpu['samplePaths']==gpu['samplePaths'] and ca.shape==ga.shape
assert snr>85
cache=[]
os.environ['MYGRAIN_SOURCE_CACHE']='on'
for i in range(4):
 t=time.perf_counter();cached=s.generate_bastardloop_file(**args);cache.append(time.perf_counter()-t)
 assert cached['bytes']==gpu['bytes'], 'Cached cuts changed output audio'
uncut_args=dict(args,divisions=['uncut'])
os.environ['MYGRAIN_SOURCE_CACHE']='off';original_uncut=s.generate_bastardloop_file(**uncut_args)
os.environ['MYGRAIN_SOURCE_CACHE']='on'
for _ in range(2):
 assert s.generate_bastardloop_file(**uncut_args)['bytes']==original_uncut['bytes'], 'Cached uncut changed output audio'
print(json.dumps(dict(cachedOutputIdentical=True,cachedUncutOutputIdentical=True,cachedVGeneration=cache,cacheStats=s._source_cache.diagnostics(),device='RTX 3070',fullStretch=results,realVGeneration=full,vPcmSNR=snr,vMaxLsbError=float(np.max(abs(error))),shape=ca.shape,sourceUnchanged=True,diagnostics=g.diagnostics()),indent=2))
g.close()
