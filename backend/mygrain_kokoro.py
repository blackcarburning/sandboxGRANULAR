"""Isolated CPU/CUDA Kokoro speech worker. Models are installed locally; inference is offline.

Render a whole utterance for natural context, then split its original whitespace
words using Kokoro's phoneme-duration timestamps. No rate-changing audio playback.
"""
import base64
import io
import json
import os
import select
import time
from pathlib import Path
import sys
import wave

MODEL_ROOT = Path('/opt/openclaw-kokoro/models')
VOICES = ('af_heart', 'af_bella', 'bf_emma', 'am_michael', 'am_puck', 'bm_george', 'af_nicole', 'af_sarah', 'af_aoede', 'af_kore', 'af_nova', 'af_alloy', 'am_fenrir', 'bf_isabella', 'bm_fable', 'bm_lewis')
MODEL = None
PIPELINES = {}
DEVICE = None


def trim_word_edges(audio, rate):
    """Remove quiet model padding, not pauses inside a spoken word.

    A low, word-relative 2 ms RMS threshold (-50.5 dB) retains quiet consonants
    without keeping long tails of isolated model-noise peaks. Short guards
    protect attacks/tails from the existing 3 ms edge fades. No gate, gain,
    time stretch or added silence.
    This runs only during explicit Kokoro synthesis, never saved PCM recall.
    """
    import numpy as np

    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError('Natural voice returned invalid word audio.')
    peak = float(np.max(np.abs(audio)))
    window = min(len(audio), max(1, round(rate * .002)))
    energy = np.convolve(audio.astype(float) ** 2, np.ones(window) / window, mode='valid')
    active = np.flatnonzero(energy > max(1 / 32768, peak * .003) ** 2)
    if not len(active):
        raise ValueError('Natural voice returned a silent word. Try simpler punctuation.')
    start = max(0, int(active[0]) - round(rate * .004))
    end = min(len(audio), int(active[-1]) + window + round(rate * .008))
    return audio[start:end]


def render(payload):
    import numpy as np
    import torch
    import spacy
    from kokoro import KModel, KPipeline

    words = payload['words']
    voice = payload['voice']
    if voice not in VOICES or not 1 <= len(words) <= 16:
        raise ValueError('Invalid natural voice request.')
    if not spacy.util.is_package('en_core_web_sm'):
        raise ValueError('Natural voice language model is not installed.')
    global MODEL, DEVICE
    reused = MODEL is not None
    if MODEL is None:
        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
        MODEL = KModel(repo_id='hexgrad/Kokoro-82M', config=str(MODEL_ROOT / 'config.json'),
                       model=str(MODEL_ROOT / 'kokoro-v1_0.pth')).to(DEVICE).eval()
    if voice[0] not in PIPELINES:
        PIPELINES[voice[0]] = KPipeline(lang_code=voice[0], repo_id='hexgrad/Kokoro-82M', model=MODEL, device=DEVICE)
    pipeline = PIPELINES[voice[0]]
    started = time.monotonic()
    text = ' '.join(words)
    ranges = []
    pos = 0
    for word in words:
        ranges.append((pos, pos + len(word)))
        pos += len(word) + 1
    timings = [[] for _ in words]
    chunks = []
    cursor = 0
    frames = 0
    rate = 24000
    for result in pipeline(text, voice=str(MODEL_ROOT / 'voices' / (voice + '.pt')),
                           speed=payload['speed'] / 170, split_pattern=None):
        audio = result.audio.numpy().reshape(-1)
        if not len(audio) or not np.isfinite(audio).all():
            raise ValueError('Natural voice returned invalid audio.')
        for token in result.tokens:
            start = text.find(token.text, cursor)
            if start < 0 or text[cursor:start].strip():
                raise ValueError('Could not align words. Try simpler punctuation.')
            end = start + len(token.text)
            cursor = end
            if token.start_ts is None or token.end_ts is None:
                continue
            for i, (left, right) in enumerate(ranges):
                if start < right and end > left:
                    timings[i].append((frames / rate + token.start_ts, frames / rate + token.end_ts))
        chunks.append(audio)
        frames += len(audio)
    if any(not t for t in timings) or text[cursor:].strip():
        raise ValueError('Could not pronounce every word. Try spelling out abbreviations or symbols.')
    audio = np.concatenate(chunks)
    peak = float(np.max(np.abs(audio)))
    if peak < .001:
        raise ValueError('Natural voice returned silent audio.')
    audio = audio * min(4, .74 / peak)
    bounds = [0]
    for previous, following in zip(timings, timings[1:]):
        seam = round((previous[-1][1] + following[0][0]) * rate / 2)
        bounds.append(min(frames, max(bounds[-1], seam)))
    bounds.append(frames)
    lanes = []
    pcm = []
    offset = 0
    for i, word in enumerate(words):
        segment = trim_word_edges(audio[bounds[i]:bounds[i + 1]], rate).copy()
        if not rate * .001 <= len(segment) <= rate * 8:
            raise ValueError('A spoken word exceeds eight seconds. Increase speech speed.')
        fade = min(round(rate * .003), len(segment) // 2)
        if fade:
            ramp = np.linspace(0, 1, fade)
            segment[:fade] *= ramp
            segment[-fade:] *= ramp[::-1]
        pcm.append(np.rint(np.clip(segment, -1, 1) * 32767).astype('<i2').tobytes())
        lanes.append({'word': word, 'offset': offset / rate, 'duration': len(segment) / rate})
        offset += len(segment)
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b''.join(pcm))
    return {'audioBase64': base64.b64encode(stream.getvalue()).decode('ascii'), 'lanes': lanes,
            'device': DEVICE, 'gpu': torch.cuda.get_device_name(0) if DEVICE == 'cuda' else None,
            'workerReused': reused, 'inferenceSeconds': round(time.monotonic() - started, 3)}


if __name__ == '__main__':
    if '--worker' in sys.argv:
        # Parent retires at 45s; this independent deadline also frees abandoned GPUs.
        for index in range(32):
            if not select.select([sys.stdin], [], [], 75)[0]:
                break
            line = sys.stdin.readline(8192)
            if not line:
                break
            try:
                payload = json.loads(line)
                result = render(payload)
                result['retire'] = index == 31
                print(json.dumps(result, separators=(',', ':')), flush=True)
                del result, payload, line
            except Exception as exc:
                print(json.dumps({'error': str(exc)}), flush=True)
                break
    else:
        try:
            print(json.dumps(render(json.load(sys.stdin)), separators=(',', ':')))
        except ValueError as exc:
            print(json.dumps({'error': str(exc)}))
            sys.exit(1)
