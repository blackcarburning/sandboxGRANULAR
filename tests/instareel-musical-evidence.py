"""Verify actual X/L pitch changes and prequeued Roll fills in browser-fixture PCM."""
import json
import pathlib
import sys
import wave
import numpy as np
root = pathlib.Path(sys.argv[1])
def read(name, seconds):
    with wave.open(str(root / name)) as audio:
        rate=audio.getframerate();frames=audio.getnframes()
        assert frames==round(seconds*rate)
        pcm=np.frombuffer(audio.readframes(frames),dtype='<i2').reshape(-1,2)/32768
    assert np.max(abs(pcm))<=.971
    wrap=float(np.max(abs(pcm[0]-pcm[-1])))
    adjacent=max(float(np.max(abs(np.diff(pcm[-256:],axis=0)))),float(np.max(abs(np.diff(pcm[:256],axis=0)))))
    assert wrap<=adjacent+1/32768
    return rate,pcm.mean(axis=1),wrap
def tone(rate,pcm,at,frequency,seconds=.06):
    data=pcm[int(at*rate):int((at+seconds)*rate)];window=np.hanning(len(data))
    return float(2*abs(np.sum(data*window*np.exp(-2j*np.pi*frequency*np.arange(len(data))/rate)))/sum(window))
a=read(sys.argv[2] if len(sys.argv)>2 else 'chromium.wav',30);b=read('chromium-retry.wav',60)
result={'onWrapStep':a[2],'offWrapStep':b[2],'notes':{}}
for lane,frequency in [('X',196),('L',392)]:
    on=max(tone(*a[:2],at,frequency) for at in np.arange(2.05,27.9,.125))
    off=max(tone(*b[:2],at,frequency) for at in np.arange(2.05,27.9,.125))
    assert on>off*2.5, f'{lane} root-related fifth must appear in real PCM only when requested'
    result['notes'][lane]={'on':on,'off':off}
on=max(tone(*a[:2],at,1000,.035) for at in [15.755,15.88])
off=max(tone(*b[:2],at,1000,.035) for at in [15.755,15.88])
assert on>.005 and on>off*100, 'Real Roll fill hits must be audible and disappear with Drums off'
result['roll']={'on':on,'off':off}
print(json.dumps(result,indent=2))
