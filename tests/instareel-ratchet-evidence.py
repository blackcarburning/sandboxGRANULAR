"""Measure periodic, withdrawing hat doubles in the actual 5kHz fixture WAVs."""
import json
import pathlib
import sys
import wave
import numpy as np
from scipy.signal import butter, sosfilt, hilbert, find_peaks
root=pathlib.Path(sys.argv[1])
def bursts(name):
    with wave.open(str(root/name)) as audio:
        rate=audio.getframerate()
        pcm=np.frombuffer(audio.readframes(audio.getnframes()),'<i2').reshape(-1,2).mean(axis=1)/32768
    band=sosfilt(butter(4,[4500,5500],btype='bandpass',fs=rate,output='sos'),pcm)
    envelope=np.convolve(abs(hilbert(band)),np.ones(200)/200,mode='same')
    peaks,_=find_peaks(envelope,height=.0003,distance=int(.035*rate),prominence=.00025)
    times=peaks/rate
    # A 120 BPM sixteenth is .125s: genuine doubles introduce .0625s spacings.
    doubles=times[1:][abs(np.diff(times)-.0625)<.006]
    counts=[int(sum((doubles>=s)&(doubles<s+2))) for s in range(0,30,2)]
    return counts
result={}
for name in sys.argv[2:] or ['webkit.wav']:
    counts=bursts(name)
    assert counts[:2]==[0,0], 'No opening burst'
    assert all(counts[i]>0 for i in [2,5,8,11]), 'Bursts must recur audibly, not only in plan metadata'
    assert all(counts[i]==0 for i in [3,4,6,7,9,10,12,13]), 'Added ratchets must withdraw again'
    assert counts[14]==0, 'No generated closing burst'
    result[name]=counts
counts=bursts('chromium-retry.wav');assert not any(counts), 'Unchecked drum option must remove all generated doubles'
result['offFirst30s']=counts
print(json.dumps(result,indent=2))
