"""Real N-entry, V/W re-cut and optional L/X evidence for the evolution fixture."""
import json
import pathlib
import sys
import wave
import numpy as np
root = pathlib.Path(sys.argv[1])

def read(name, seconds):
    with wave.open(str(root / (name + '.wav'))) as audio:
        rate = audio.getframerate()
        assert audio.getnframes() == seconds * rate
        pcm = np.frombuffer(audio.readframes(audio.getnframes()), '<i2').reshape(-1, 2) / 32768
    assert np.isfinite(pcm).all() and .001 < np.sqrt(np.mean(pcm ** 2)) and np.max(abs(pcm)) <= .971
    wrap = float(np.max(abs(pcm[0] - pcm[-1])))
    local = max(float(np.max(abs(np.diff(pcm[:256], axis=0)))), float(np.max(abs(np.diff(pcm[-256:], axis=0)))))
    assert wrap <= local + 1 / 32768
    return rate, pcm.mean(axis=1), wrap

def tone(audio, at, frequency, duration=.1):
    rate, pcm, _ = audio
    data = pcm[int(at * rate):int((at + duration) * rate)]
    window = np.hanning(len(data))
    return float(2 * abs(np.sum(data * window * np.exp(-2j * np.pi * frequency * np.arange(len(data)) / rate))) / window.sum())

def noise(audio, at):
    rate, pcm, _ = audio
    data = pcm[int(at * rate):int((at + .1) * rate)]
    spectrum = abs(np.fft.rfft(data * np.hanning(len(data)))) ** 2
    frequency = np.fft.rfftfreq(len(data), 1 / rate)
    return float(spectrum[(frequency > 2200) & (frequency < 7000)].sum() / len(data) ** 2)

result = {}
audios = {name: read(name, seconds) for name, seconds in [('chromium', 30), ('webkit', 30), ('chromium-retry', 60)]}
for name, audio in audios.items():
    seconds = 60 if name.endswith('retry') else 30
    on = [noise(audio, t) for t in [2.1, 4.1, 8.1, 10.1]]
    off = [noise(audio, t) for t in [.1, 6.1, 12.1, seconds - 1.9]]
    assert min(on) > max(off) * 100, 'N must audibly enter, withdraw and be absent at original boundaries'
    cuts = {}
    for lane, frequencies in [('V', [220, 330, 440, 550]), ('W', [880, 1100, 1320, 1540])]:
        def melody(offset):
            return [frequencies[int(np.argmax([tone(audio, offset + t, f) for f in frequencies]))] for t in [.6, 1.1, 1.6]]
        original, changed, closing = melody(0), melody(4), melody(seconds - 2)
        assert original == frequencies[1:] and closing == original
        if lane == 'V':
            assert changed == original, 'Unselected V must retain its signature phrase'
        else:
            assert any(melody(at) != original for at in range(2,26,2)), 'W re-cuts must change audible source order'
        cuts[lane] = {'opening': original, 'developed': changed, 'closing': closing}
    result[name] = {'wrapStep': audio[2], 'noiseOnPower': on, 'noiseOffPower': off, 'cuts': cuts}
assert min(result['webkit']['noiseOnPower']) > max(result['chromium']['noiseOnPower']) * 3, 'Extreme N must be stronger than Subtle'
for lane, frequency in [('L', 392), ('X', 196)]:
    levels = {name: max(tone(audio, at, frequency, .06) for at in np.arange(2.05, 27.9, .125)) for name, audio in audios.items()}
    assert min(levels['chromium'], levels['webkit']) > levels['chromium-retry'] * 2.5, lane + ' root-related variation must appear only with notes selected'
    result[lane] = levels
print(json.dumps(result, indent=2))
