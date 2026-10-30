"""Measure recurring original V phrases and fresh A/B/C/V/W cuts in actual PCM."""
import json
import pathlib
import sys
import wave
import numpy as np
root = pathlib.Path(sys.argv[1])
frequencies = {'A': [2000,2200,2400,2600], 'B': [3000,3200,3400,3600], 'C': [4000,4200,4400,4600], 'V': [220,330,440,550], 'W': [880,1100,1320,1540]}
result = {}
for name, seconds, v_enabled in [('chromium',30,True), ('webkit',30,True), ('chromium-retry',60,False)]:
    if len(sys.argv)>2 and name not in sys.argv[2:]:continue
    with wave.open(str(root / (name + '.wav'))) as audio:
        rate = audio.getframerate()
        assert audio.getnframes() == seconds * rate
        stereo = np.frombuffer(audio.readframes(audio.getnframes()), '<i2').reshape(-1,2) / 32768
    assert np.isfinite(stereo).all() and .001 < np.sqrt(np.mean(stereo ** 2)) and np.max(abs(stereo)) <= .971
    wrap = float(np.max(abs(stereo[0] - stereo[-1])))
    adjacent = max(float(np.max(abs(np.diff(stereo[:256],axis=0)))),float(np.max(abs(np.diff(stereo[-256:],axis=0)))))
    assert wrap <= adjacent + 1/32768
    pcm = stereo.mean(axis=1)
    lanes = {}
    for lane, notes in frequencies.items():
        length = round(rate * .04)
        window = np.hanning(length)
        basis = np.exp(-2j * np.pi * np.asarray(notes)[:,None] * np.arange(length) / rate) * window
        profiles = []
        for start in range(0, seconds, 2):
            profile = np.asarray([2 * abs(basis @ pcm[round((start+t)*rate):round((start+t)*rate)+length]) / window.sum() for t in np.arange(.3,1.9,.05)])
            assert profile.max() > .0002, lane + ' must be audible'
            profiles.append(profile / profile.max())
        distance = lambda a,b: float(np.mean(abs(a-b)))
        opening = profiles[0]
        closing_error = distance(opening,profiles[-1])
        assert closing_error < .03, (name,lane,'original closing phrase',closing_error)
        if lane == 'V':
            originals = list(range(2,len(profiles)-1,2)) if v_enabled else list(range(1,len(profiles)-1))
            errors = [distance(opening,profiles[i]) for i in originals]
            assert max(errors) < .04, (name,'V must return to its original phrase',errors)
            developed = list(range(1,len(profiles)-1,2)) if v_enabled else []
        else:
            developed = list(range(1,len(profiles)-1))
            originals = []
        changed = [distance(opening,profiles[i]) for i in developed]
        fresh = [distance(profiles[a],profiles[b]) for a,b in zip(developed,developed[1:])]
        assert not changed or min(changed) > .02, (name,lane,'audible cuts required',changed)
        assert not fresh or min(fresh) > .012, (name,lane,'every developed repeat must be fresh',fresh)
        lanes[lane] = {'originalRepeatIndices':originals,'developedRepeatIndices':developed,'openingDifferences':changed,'successiveCutDifferences':fresh,'closingError':closing_error}
    result[name] = {'wrapStep':wrap,'lanes':lanes}
print(json.dumps(result,indent=2))
