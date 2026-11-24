"""Check actual saved-Song PCM for the requested shared-clock LFO frequency.
Run after heavy-lifter-lfo-song.cjs with OUT and STORE pointing to its isolated fixtures.
Requires NumPy for the least-squares sinusoidal fit; not a runtime app dependency.
"""
import json, os, wave
from pathlib import Path
import numpy as np

out = Path(os.environ['OUT'])
store = Path(os.environ['STORE'])
assert str(store).startswith('/tmp/')
receipt = json.loads((out / 'heavy-lfo-song.json').read_text())
folder = store / 'admin/songs' / receipt['initial']['id']
song = json.loads((folder / 'song.json').read_text())
signals = []
for index in (0, 1, 2):
    with wave.open(str(folder / 'parts' / song['parts'][index]['render']['file'])) as f:
        assert f.getsampwidth() == 2 and f.getnchannels() == 2
        signals.append(np.frombuffer(f.readframes(f.getnframes()), dtype='<i2').astype(float).reshape(-1, 2)[:, 0] / 32768)
reference = signals[1] - signals[0]
modulated = signals[2] - signals[0]
times, gains = [], []
for offset in range(4410, 44100 - 441, 441):
    r, m = reference[offset:offset+441], modulated[offset:offset+441]
    times.append((offset + 220) / 44100)
    gains.append(np.dot(r, m) / (np.dot(r, r) + 1e-20))
times, gains = np.array(times), np.array(gains)
def fit(frequency):
    matrix = np.stack([np.ones_like(times), np.sin(2*np.pi*frequency*times), np.cos(2*np.pi*frequency*times)], axis=1)
    predicted = matrix @ np.linalg.lstsq(matrix, gains, rcond=None)[0]
    return float(1 - np.sum((gains-predicted)**2) / np.sum((gains-gains.mean())**2))
result = dict(bpm=240, beats=.5, timing='dotted', expectedHz=240/60/(.5*1.5), expectedFrequencyR2=fit(240/60/(.5*1.5)), incorrectDefault120BpmR2=fit(120/60/(.5*1.5)), gainMin=float(gains.min()), gainMax=float(gains.max()))
assert result['expectedFrequencyR2'] > .9 and result['incorrectDefault120BpmR2'] < .5, result
(out / 'heavy-lfo-song-bpm.json').write_text(json.dumps(result, indent=2))
print('PASS actual saved-Song LFO BPM', result)
