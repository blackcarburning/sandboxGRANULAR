"""CUDA gather, stereo grain envelopes, splicing and peak control; no CPU fallback."""
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import subprocess
import tempfile
import time
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly


EFFECTS = ('saturation', 'bitcrush', 'ring modulation', 'short echo')  # archived parity reference
POT_EFFECTS = ('mutilator', 'bassFace', 'turntable', 'resonator', 'wireWorld',
               'sonicCrystal', 'bubbleChamber', 'wasp', 'playground', 'henrysHose', 'heavyLifter')
DIVISION_TICKS = {'4': 32, '2': 32, '1': 32, '1/2': 16, '1/4': 8,
                  '1/8': 4, '1/16': 2, '1/32': 1, 'uncut': 32}


def slice_plan(divisions, frames, rng):
    """Exact one-bar dyadic tiling, never inventing a finer unselected cut."""
    position, result = 0, []
    while position < 32:
        eligible = [value for value in divisions if DIVISION_TICKS[value] <= 32-position]
        division = str(rng.choice(eligible))
        end = position + DIVISION_TICKS[division]
        result.append((round(frames*position/32), round(frames*end/32), division))
        position = end
    return result


def add_gap_mask(gains, frames, gap_steps, rate):
    """Independent sixteenth-note gaps, de-clicked after the baked-in effect."""
    boundaries = np.rint(np.linspace(0, frames, 17)).astype(np.int64)
    mask = np.ones(frames, dtype=np.float32)
    for step in gap_steps:
        left, right = boundaries[step:step+2]
        mask[left:right] = 0
        fade = min(round(rate*.003), (right-left)//2)
        # Circular guards also cover a gap at the loop's seam.
        for delta in range(fade):
            mask[(left-1-delta)%frames] = min(mask[(left-1-delta)%frames], delta/max(1,fade))
            mask[(right+delta)%frames] = min(mask[(right+delta)%frames], delta/max(1,fade))
    gains *= mask
    return [{'startFrame': int(boundaries[step]), 'frames': int(boundaries[step+1]-boundaries[step])}
            for step in sorted(gap_steps)]


def assemble(xp, bank, indices, gains, effect=None, rate=48000):
    """Same bounded float32 kernel inputs for CUDA and the parity reference."""
    output = xp.asarray(bank)[xp.asarray(indices)]
    if effect:
        amount = effect['amount']
        kind = effect['name']
        if kind == 'saturation':
            drive = 1.8 + amount * 3.
            output = xp.tanh(output * drive) / math.tanh(drive)
        elif kind == 'bitcrush':
            levels = 2 ** (3 + round(amount * 3))
            output = xp.round(output * levels) / levels
        elif kind == 'ring modulation':
            phase = xp.arange(len(output), dtype=xp.float32) * (2 * math.pi * (35 + amount * 265) / rate)
            output = output * (.35 + .65 * xp.sin(phase))[:, None]
        elif kind == 'short echo':
            delay = round(rate * (.025 + amount * .065))
            output = output + (.25 + amount * .25) * xp.roll(output, delay, axis=0)
        else:
            raise ValueError('Unknown restructure effect.')
    # Gate AFTER the effect: even echo cannot fill intentionally empty slots.
    output *= xp.asarray(gains)[:, None]
    peak = float(xp.max(xp.abs(output)))
    return output * min(1., .89 / max(peak, 1e-9))



def match_and_splice(xp, wet, gains, recipe):
    """Stereo-linked equal RMS before joins/gaps, with one common safe target.

    Choose a common RMS that every grain can reach without clipping or more than
    16x amplification. A later common attenuation preserves that match exactly.
    """
    output = xp.asarray(wet).copy()
    measured, cursor = [], 0
    for grain in recipe:
        section = output[cursor:cursor+grain['frames']]
        rms = float(xp.sqrt(xp.mean(section*section)))
        peak = float(xp.max(xp.abs(section)))
        if not math.isfinite(rms) or rms < 1e-8:
            raise ValueError('Cooking Pot produced an inaudible grain.')
        measured.append((cursor, rms, peak))
        cursor += grain['frames']
    target = min(.14, *(min(rms*16., .89*rms/max(peak, 1e-9)) for _, rms, peak in measured))
    for grain, (cursor, rms, peak) in zip(recipe, measured):
        gain = target/rms
        output[cursor:cursor+grain['frames']] *= gain
        grain['gainMatch'] = {'inputRms': rms, 'targetRms': target, 'gain': gain}
    output *= xp.asarray(gains)[:, None]
    peak = float(xp.max(xp.abs(output)))
    return output * min(1., .89/max(peak, 1e-9))


def main():
    import cupy as cp
    folder = Path(sys.argv[1])
    expected = Path(os.environ.get('MYGRAIN_SCRATCH_ROOT', tempfile.gettempdir())).resolve()
    if folder.is_symlink() or folder.resolve() != folder or folder.parent != expected or not re.fullmatch(r'mygrain-restructure-[A-Za-z0-9_-]+', folder.name):
        raise ValueError('Invalid private restructure workspace.')
    manifest = json.loads((folder / 'input.json').read_text())
    rate, bpm = 48000, manifest['bpm']
    # Selected musical divisions tile one exact 4/4 bar; gaps are independent.
    frames = round(rate * 240 / bpm)
    rng = np.random.default_rng(int.from_bytes(hashlib.sha256(manifest['seed'].encode()).digest()[:8], 'little'))
    arrays, offsets, stereo = [], [], []
    cursor = 0
    for item in manifest['sources']:
        sr, raw = wavfile.read(folder / item['file'])
        if raw.ndim == 1:
            raw = raw[:, None]
        if np.issubdtype(raw.dtype, np.integer):
            audio = (raw.astype(np.float32) - (128 if raw.dtype == np.uint8 else 0)) / (128 if raw.dtype == np.uint8 else float(2**(raw.dtype.itemsize*8-1)))
        else:
            audio = raw.astype(np.float32)
        audio = np.nan_to_num(audio[:sr*12], nan=0., posinf=0., neginf=0.)
        divisor = math.gcd(sr, rate)
        if sr != rate:
            audio = resample_poly(audio, rate//divisor, sr//divisor).astype(np.float32)
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        is_stereo = float(np.max(np.abs(audio[:, 0] - audio[:, 1]))) > 1e-5
        # Remove source DC, not stored originals. Keep channels phase-linked.
        audio -= audio.mean(axis=0, keepdims=True)
        offsets.append(cursor); cursor += len(audio)
        arrays.append(audio); stereo.append(is_stereo)
    bank = np.concatenate(arrays)
    indices = np.empty(frames, dtype=np.int64)
    gains = np.ones(frames, dtype=np.float32)
    choices = np.arange(len(arrays))
    weights = np.array([3. if value else 1. for value in stereo]); weights /= weights.sum()
    gaps = set(int(i) for i in rng.choice(16, size=int(rng.integers(2, 7)), replace=False))
    divisions = manifest.get('divisions', ['1/16'])
    plan = slice_plan(divisions, frames, rng)
    recipe = []
    for left, right, division in plan:
        pick = int(rng.choice(choices, p=weights)); length = int(right-left)
        audio = arrays[pick]
        # Audition several positions and choose an audible grain rather than a silent region.
        positions = rng.integers(0, max(1, len(audio)-length+1), size=12)
        energies = [float(np.mean(audio[(np.arange(length)+p)%len(audio)]**2)) for p in positions]
        start = int(positions[int(np.argmax(energies))])
        indices[left:right] = offsets[pick] + (np.arange(length)+start)%len(audio)
        # Native sample-cut contract: 3ms edge guards, bounded by half the grain;
        # no overlap shortening and no destructive editing of original PCM.
        fade = min(round(rate*.003), length//2)
        ramp = np.minimum(1., np.minimum(np.arange(length), np.arange(length)[::-1])/max(1, fade))
        gains[left:right] = ramp
        recipe.append({'source': pick, 'startFrame': start, 'frames': length, 'division': division,
                       'effect': {'name': str(rng.choice(POT_EFFECTS)), 'amount': float(rng.uniform(.2, .85)),
                                  'seed': int(rng.integers(1, 2**31))}})
    gap_windows = add_gap_mask(gains, frames, gaps, rate)
    cursor = 0
    for grain in recipe:
        grain['gap'] = bool(np.all(gains[cursor:cursor+grain['frames']] == 0))
        cursor += grain['frames']
    lock_path = Path(tempfile.gettempdir()) / f'mygrain-checkout-cuda-{os.getuid()}.lock'
    # Release CUDA admission while CPU-native Pot DSP runs, still under the same
    # shared heavy-render lease. Only private scratch intermediates are used.
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cp.get_default_memory_pool().set_limit(size=128*1024**2)
        device = cp.cuda.runtime.getDeviceProperties(0)['name']
        if isinstance(device, bytes): device = device.decode()
        started = time.perf_counter()
        dry = cp.asnumpy(cp.asarray(bank)[cp.asarray(indices)])
        cp.cuda.get_current_stream().synchronize()
        elapsed = (time.perf_counter()-started)*1000
        cp.get_default_memory_pool().free_all_blocks()
    dry.astype('<f4').tofile(folder / 'dry.f32')
    (folder / 'effects.json').write_text(json.dumps({'bpm': bpm, 'recipe': recipe}))
    fx_started = time.perf_counter()
    subprocess.run(['node', str(Path(__file__).with_name('restructure-effects.cjs')), str(folder)],
                   check=True, timeout=65, stdin=subprocess.DEVNULL)
    fx_ms = (time.perf_counter()-fx_started)*1000
    recipe = json.loads((folder / 'effects-result.json').read_text())
    wet = np.fromfile(folder / 'wet.f32', dtype='<f4').reshape(frames, 2)
    if not np.isfinite(wet).all(): raise ValueError('Invalid Cooking Pot result.')
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        started = time.perf_counter()
        output = cp.asnumpy(match_and_splice(cp, wet, gains, recipe))
        cp.cuda.get_current_stream().synchronize()
        elapsed += (time.perf_counter()-started)*1000
    wavfile.write(folder / 'result.wav', rate, output.astype(np.float32))
    metadata = {'version': 4, 'engine': 'CUDA', 'device': device, 'gpuMilliseconds': round(elapsed, 3),
                'sourceKey': 'samples_public', 'bpm': bpm, 'sampleRate': rate, 'frames': frames,
                'grains': len(recipe), 'grainNote': divisions[0] if len(divisions)==1 else 'mixed',
                'divisions': divisions, 'bars': 1, 'seed': manifest['seed'],
                'effect': {'name': 'per-grain Cooking Pot', 'engine': 'native CPU', 'milliseconds': round(fx_ms, 3)},
                'gainMatch': 'stereo-linked RMS before joins and gaps', 'effectPool': list(POT_EFFECTS), 'gapSteps': sorted(gaps), 'gapWindows': gap_windows,
                'stereoSources': sum(stereo), 'sources': manifest['sources'], 'recipe': recipe}
    # Private staging filenames are not part of portable provenance.
    for source in metadata['sources']: source.pop('file', None)
    (folder / 'result.json').write_text(json.dumps(metadata))


if __name__ == '__main__':
    main()
