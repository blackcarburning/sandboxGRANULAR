"""PCM evidence for REPEAT_TEST=1 VARIATION=none SECONDS=31 server fixture."""
import pathlib
import sys
import wave
import numpy as np
with wave.open(str(pathlib.Path(sys.argv[1])/'chromium.wav')) as audio:
 rate=audio.getframerate()
 assert audio.getnframes()==31*rate,'Repeat-only duration must be exact, not rounded to 32 seconds'
 pcm=np.frombuffer(audio.readframes(audio.getnframes()),'<i2').reshape(-1,2)/32768
assert np.isfinite(pcm).all() and .001<np.sqrt(np.mean(pcm**2)) and abs(pcm).max()<=.971
mono=pcm.mean(axis=1)
for lane,notes in {'A':[2000,2200,2400,2600],'B':[3000,3200,3400,3600],'C':[4000,4200,4400,4600],'V':[220,330,440,550],'W':[880,1100,1320,1540]}.items():
 n=round(rate*.04);window=np.hanning(n);basis=np.exp(-2j*np.pi*np.asarray(notes)[:,None]*np.arange(n)/rate)*window
 profiles=[]
 for start in range(0,30,2):
  p=np.asarray([2*abs(basis@mono[round((start+t)*rate):round((start+t)*rate)+n])/window.sum() for t in np.arange(.3,1.9,.05)])
  assert p.max()>.0002,lane+' must stay audible'
  profiles.append(p)
 errors=[float(np.mean(abs(p-profiles[0]))/profiles[0].max()) for p in profiles[1:]]
 assert max(errors)<.04,(lane,'repeat changed',errors)
 print(lane,'max relative repeat/level difference',round(max(errors),5))
print('PASS exact 31-second server WAV, all five source phrases repeat without development')
