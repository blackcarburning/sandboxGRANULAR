"""Measure captures from pink-generated-drums.test.cjs; requires numpy."""
import json, sys
from pathlib import Path
import numpy as np
folder = Path(sys.argv[1])
rows = []
for rate in (44100, 48000):
    x = np.fromfile(folder / f'pink-noise-{rate}.f32', dtype='<f4').astype(float)
    n = 8192
    power = np.mean([abs(np.fft.rfft(x[i:i+n] * np.hanning(n))) ** 2
                     for i in range(n//2, len(x)-n, n//2)], axis=0)
    hz = np.fft.rfftfreq(n, 1 / rate)
    selected = (hz >= 100) & (hz <= 8000)
    slope = float(np.polyfit(np.log2(hz[selected]), 10*np.log10(power[selected]), 1)[0])
    assert -3.8 < slope < -2.2, (rate, slope)
    rows.append(dict(rate=rate, pinkSlopeDbPerOctave=slope))
(folder / 'pink-spectrum.json').write_text(json.dumps(rows, indent=2))
print('PASS pink-noise slopes:', rows)
