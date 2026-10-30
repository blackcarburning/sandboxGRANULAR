"""Measure fresh per-pattern Snare Roll rhythms in real server fixture WAVs.

Use instareel-browser.cjs with MUSICAL_TEST and RETRY_TEST to save WAVs/plans.
The fixture's 1 kHz snare is distinct from the L/X notes and 60 Hz kick.
"""
import json
import pathlib
import sys
import wave
import numpy as np

root = pathlib.Path(sys.argv[1])


def read(path):
    with wave.open(str(path)) as audio:
        rate = audio.getframerate()
        pcm = np.frombuffer(audio.readframes(audio.getnframes()), '<i2').reshape(-1, 2) / 32768
    assert np.max(abs(pcm)) <= .971
    wrap = float(np.max(abs(pcm[0] - pcm[-1])))
    adjacent = max(float(np.max(abs(np.diff(pcm[-256:], axis=0)))), float(np.max(abs(np.diff(pcm[:256], axis=0)))))
    assert wrap <= adjacent + 1 / 32768
    return rate, pcm.mean(axis=1)


def snare(audio, at):
    rate, pcm = audio
    start = round((at + .006) * rate)
    data = pcm[start:start + round(.012 * rate)]
    win = np.hanning(len(data))
    return float(2 * abs(sum(data * win * np.exp(-2j * np.pi * 1000 * np.arange(len(data)) / rate))) / sum(win))


def clear_of_backbeat(at):
    # Exclude ordinary snare events AND their 50ms tails from the paired comparison.
    return (at - .5) % 1 > .06


result = {}
for name in sys.argv[2:] or ['chromium.wav', 'webkit.wav']:
    path = root / name
    plan = json.loads(path.with_name(path.stem + '-plan.json').read_text())
    assert plan['version'] == 8 and plan['options']['drums']
    off_path = path.with_name(path.stem + '-retry.wav')
    if not off_path.exists():
        off_path = root / 'chromium-retry.wav'
    on, off = read(path), read(off_path)
    assert abs(len(on[1]) / on[0] - plan['duration']) <= 1 / on[0]
    step = 60 / plan['bpm'] / 4
    assert plan['bpm'] == 120, 'Analysis backbeat exclusions use the documented 120 BPM fixture'
    signatures, measured = [], []
    for fill in plan['fills']:
        decision = next(d for d in plan['rollIterations'] if d['iteration'] == fill['iteration'])
        signatures.append(json.dumps([round((decision['end'] - fill['end']) / step), fill['windowSteps'], fill['notes']], sort_keys=True))
        times = [fill['at'] + (note['step'] + ratchet / note['ratchet']) * step
                 for note in fill['notes'] for ratchet in range(note['ratchet'])]
        candidates = [at for at in times if clear_of_backbeat(at)]
        levels, controls = [snare(on, at) for at in candidates], [snare(off, at) for at in candidates]
        confirmed = [level > .0015 and level > control * 3 for level, control in zip(levels, controls)]
        measured.append({'iteration': fill['iteration'], 'at': fill['at'], 'end': fill['end'],
                         'occupiedSteps': fill['hits'], 'ratchetHits': len(times),
                         'hitTimes': candidates, 'snareLevels': levels, 'drumsOffLevels': controls,
                         'confirmedExtraHits': sum(confirmed), 'comparedExtraHits': len(candidates)})
        assert candidates and all(confirmed), (name, measured[-1])
    assert len(set(signatures)) > 1, 'A real reel must contain different Roll rhythms'
    assert all(a != b for a, b in zip(signatures, signatures[1:])), 'Successive rolls must not copy the same shape'
    assert len({fill['hits'] for fill in plan['fills']}) > 1, 'Audible fills must not all be four occupied steps'
    # There are no generated fills in the original boundary or empty iterations.
    probes = [.125, .875, 1.875, plan['duration'] - .875, plan['duration'] - .125]
    for decision in plan['rollIterations']:
        if not decision['fill']:
            probes.extend(np.arange(decision['at'] + .125, decision['end'] - .06, .125).tolist())
    assert all(snare(on, at) < .002 for at in probes if clear_of_backbeat(at)), 'No copied Roll in an empty/protected pattern'
    result[name] = {'planVersion': plan['version'], 'seconds': plan['duration'],
                    'patternDecisions': len(plan['rollIterations']), 'fills': len(measured),
                    'emptyIterations': sum(not d['fill'] for d in plan['rollIterations']),
                    'distinctRhythms': len(set(signatures)), 'occupiedSteps': sorted({f['hits'] for f in plan['fills']}),
                    'measuredExtraHits': sum(f['confirmedExtraHits'] for f in measured), 'measurements': measured}

(root / 'audio-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({name: {key: value for key, value in data.items() if key != 'measurements'} for name, data in result.items()}, indent=2))
