"""Check straight-to-ratcheted Snare Roll hits in actual server fixture WAVs."""
import json
import pathlib
import sys
import wave
import numpy as np
root=pathlib.Path(sys.argv[1])
def read(name):
    with wave.open(str(root/name)) as audio:
        rate=audio.getframerate()
        pcm=np.frombuffer(audio.readframes(audio.getnframes()),'<i2').reshape(-1,2)/32768
    assert np.max(abs(pcm))<=.971
    wrap=float(np.max(abs(pcm[0]-pcm[-1])))
    adjacent=max(float(np.max(abs(np.diff(pcm[-256:],axis=0)))),float(np.max(abs(np.diff(pcm[:256],axis=0)))))
    assert wrap<=adjacent+1/32768
    return rate,pcm.mean(axis=1)
def snare(audio,at):
    rate,pcm=audio
    start=round((at+.007)*rate);data=pcm[start:start+round(.025*rate)];win=np.hanning(len(data))
    return float(2*abs(sum(data*win*np.exp(-2j*np.pi*1000*np.arange(len(data))/rate)))/sum(win))
off=read('chromium-retry.wav');result={}
# Subtle 120 BPM: last beat before 16s, two straight then two doubled steps.
times=[15.5,15.625,15.75,15.8125,15.875,15.9375]
for name in sys.argv[2:] or ['chromium.wav','webkit.wav']:
    on=read(name);levels=[snare(on,t) for t in times]
    assert min(levels)>.003, 'All six Roll hits must reach the real rendered mix'
    for t in times[1:]:
        assert snare(on,t)>snare(off,t)*8, 'New Roll notes/ratchets must disappear with Drums off'
    # No new Roll steps in the original opening/closing groove.
    for t in [1.625,1.8125,1.9375,29.625,29.8125,29.9375]:
        assert snare(on,t)<min(levels)*.3
    result[name]={'hitTimes':times,'snareLevels':levels}
print(json.dumps(result,indent=2))
