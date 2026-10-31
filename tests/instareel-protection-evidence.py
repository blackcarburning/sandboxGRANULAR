"""Check protected V/W phrases and still-developing A/B/C in a real server WAV.
Run instareel-browser with RECUT_TEST=1, PROTECTED=V,W and evidence directory.
"""
import pathlib
import sys
import wave
import numpy as np
p=pathlib.Path(sys.argv[1])/'chromium.wav'
with wave.open(str(p)) as wav:
 rate=wav.getframerate()
 assert wav.getnframes()==30*rate
 pcm=np.frombuffer(wav.readframes(wav.getnframes()),'<i2').reshape(-1,2)/32768
assert np.isfinite(pcm).all() and .001<np.sqrt(np.mean(pcm**2)) and abs(pcm).max()<=.971
mono=pcm.mean(axis=1)
for lane,notes in {'V':[220,330,440,550],'W':[880,1100,1320,1540],'A':[2000,2200,2400,2600],'B':[3000,3200,3400,3600],'C':[4000,4200,4400,4600]}.items():
 n=round(rate*.04);window=np.hanning(n)
 basis=np.exp(-2j*np.pi*np.asarray(notes)[:,None]*np.arange(n)/rate)*window
 profiles=[]
 for start in range(0,30,2):
  profile=np.asarray([2*abs(basis@mono[round((start+t)*rate):round((start+t)*rate)+n])/window.sum() for t in np.arange(.3,1.9,.05)])
  assert profile.max()>.0002,lane+' audible'
  profiles.append(profile)
 errors=[float(np.mean(abs(p-profiles[0]))/profiles[0].max()) for p in profiles[1:-1]]
 if lane in ('V','W'):
  assert max(errors)<.04,(lane,'protected phrase/level changed',errors)
 else:
  assert max(errors)>.04,(lane,'unprotected layer must still develop',errors)
 print(lane,'max relative phrase/level difference',round(max(errors),5))
print('PASS real server PCM: protected V/W unchanged; A/B/C still evolve')
