"""Check real browser-fixture WAVs, not plan metadata (requires numpy)."""
import json
import pathlib
import sys
import wave
import numpy as np
root = pathlib.Path(sys.argv[1])
results = []
for filename, duration in [('chromium.wav', 30), ('chromium-retry.wav', 60)]:
    with wave.open(str(root / filename)) as audio:
        rate = audio.getframerate()
        channels = audio.getnchannels()
        frames = audio.getnframes()
        pcm = np.frombuffer(audio.readframes(frames), dtype='<i2').reshape(-1, channels) / 32768
    assert frames == rate * duration
    def tone(at):
        data = pcm[int(at * rate):int((at + .5) * rate), 0]
        return float(abs(np.mean(data * np.exp(-2j * np.pi * 880 * np.arange(len(data)) / rate))) * 2)
    opening, middle, ending = tone(1), tone(duration / 2), tone(duration - 1)
    assert middle > .002 and middle > 100 * max(opening, ending), 'Dormant 880Hz layer must enter audibly and leave again'
    wrap = float(np.max(abs(pcm[0] - pcm[-1])))
    adjacent = float(max(np.max(abs(np.diff(pcm[-256:], axis=0))), np.max(abs(np.diff(pcm[:256], axis=0)))))
    assert wrap <= adjacent + 1 / 32768
    assert np.max(abs(pcm)) <= .971
    results.append(dict(file=filename, seconds=duration, opening880=opening, middle880=middle, ending880=ending, wrapStep=wrap))
assert results[1]['middle880'] > results[0]['middle880'] * 1.4, 'Moderate addition must be audibly stronger than Subtle'
with wave.open(str(root / 'webkit.wav')) as audio:
    rate=audio.getframerate(); pcm=np.frombuffer(audio.readframes(audio.getnframes()),dtype='<i2').reshape(-1,2)/32768
opening=float(np.sqrt(np.mean(pcm[rate:rate*2]**2)))
middle=float(np.sqrt(np.mean(pcm[rate*15:rate*16]**2)))
assert 0 < middle < opening*.9, 'A single active source must audibly develop without optional layers'
results.append(dict(file='webkit.wav',openingRms=opening,middleRms=middle))
print(json.dumps(results, indent=2))
