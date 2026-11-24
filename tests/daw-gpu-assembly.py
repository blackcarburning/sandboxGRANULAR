"""Real RTX/CPU PCM parity for native checkout assembly, including overlap tails."""
import copy,json,pathlib,subprocess,sys,tempfile,wave,zipfile
import numpy as np
APP=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APP/'backend'))
import mygrain_daw
with tempfile.TemporaryDirectory(prefix='mygrain-daw-gpu-',dir='/tmp') as name:
 folder=pathlib.Path(name);rate=48000
 def wav(file,frequency,gain):
  t=np.arange(rate*3+177)/rate
  pcm=np.stack([np.sin(t*frequency*2*np.pi)*gain,np.cos(t*frequency*2*np.pi)*gain*.63],axis=1)
  data=np.rint(pcm*8388607).astype(np.int32).reshape(-1);packed=np.empty((len(data),3),np.uint8)
  for shift in range(3):packed[:,shift]=(data>>(shift*8))&255
  with wave.open(str(folder/file),'wb') as f:f.setparams((2,3,rate,len(pcm),'NONE','not compressed'));f.writeframes(packed.tobytes())
 wav('one.wav',173,.7);wav('two.wav',281,.55)
 manifest={'parts':{'0':{'stems':{'Drums kick':'one.wav','Loop D':'two.wav'},'midi':[]},'1':{'stems':{'Drums kick':'two.wav','Loop D':'one.wav'},'midi':[]}},'arrangement':[{'renderKey':'0','name':'One','duration':2,'bpm':120},{'renderKey':'1','name':'Two','duration':2,'bpm':120}],'releaseTailSeconds':2,'notes':'Fixture'}
 mygrain_daw.assemble(folder,copy.deepcopy(manifest),folder/'cpu.zip')
 (folder/'render-manifest.json').write_text(json.dumps(manifest))
 subprocess.run([sys.executable,str(APP/'scripts/daw-gpu-assemble.py'),name],check=True)
 with zipfile.ZipFile(folder/'cpu.zip') as cpu,zipfile.ZipFile(folder/'result.zip') as gpu:
  for file in cpu.namelist():
   if file.endswith('.wav'):assert cpu.read(file)==gpu.read(file),file+' PCM changed'
  metadata=json.loads(gpu.read('manifest.json'));assert metadata['finalAssembly']['engine']=='CUDA';assert '3070' in metadata['finalAssembly']['device']
 print('PASS RTX 3070: exact stereo PCM24 parity, two stems, overlapping release tails and native DAW manifest')
