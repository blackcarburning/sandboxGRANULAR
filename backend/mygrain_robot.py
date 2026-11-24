"""Bounded local, per-word Robot speech. No network or persistent utterance cache."""
import array
import base64
import json
import os
import io
import math
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import wave
import sys

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
import mygrain_worker_pool as pool
import mygrain_speech_workers as speech_workers
import mygrain_robot_voices as extra_voices

VOICES = {'male1': 'm1', 'male2': 'm3', 'male3': 'm5', 'female1': 'f1', 'female2': 'f3', 'female3': 'f4'}
KOKORO_VOICES = frozenset('kokoro_' + v for v in ('af_heart', 'af_bella', 'bf_emma', 'am_michael', 'am_puck', 'bm_george', 'af_nicole', 'af_sarah', 'af_aoede', 'af_kore', 'af_nova', 'af_alloy', 'am_fenrir', 'bf_isabella', 'bm_fable', 'bm_lewis'))
KOKORO_PYTHON = '/opt/openclaw-kokoro/venv/bin/python'
NATURAL_GATE = threading.BoundedSemaphore(2)
DATA = Path('/usr/lib/x86_64-linux-gnu/espeak-ng-data')
GATE = threading.BoundedSemaphore(2)


def build(payload, *, owner=""):
    if not isinstance(payload, dict):
        raise ValueError('Invalid Robot phrase.')
    text = payload.get('text', '')
    if not isinstance(text, str) or len(text) > 512 or any(ord(c) < 32 and not c.isspace() for c in text):
        raise ValueError('Use a phrase of up to 16 words / 512 characters.')
    words = text.split()
    if not 1 <= len(words) <= 16 or any(len(w) > 48 or not any(c.isalnum() for c in w) for w in words):
        raise ValueError('Use 1–16 words, at most 48 characters each.')
    voice, note, speed = payload.get('voice', 'male1'), payload.get('note'), payload.get('speed', 210)
    if not isinstance(voice, str) or voice not in VOICES and voice not in KOKORO_VOICES and voice not in extra_voices.VOICES or (note is not None and (type(note) is not int or not 36 <= note <= 84)) or type(speed) is not int or not 100 <= speed <= 450:
        raise ValueError('Invalid Robot voice, note or speech speed.')
    if voice in extra_voices.VOICES:
        if note is not None:
            raise ValueError('Use natural pitch, or the DiffSinger melody editor for scored singing.')
        return build_extra(words, voice, speed, payload.get('melody'), owner=owner)
    if voice in KOKORO_VOICES:
        if note is not None:
            raise ValueError('Kokoro uses natural pitch. Select a classic voice for note / key.')
        return build_natural(words, voice, speed, owner=owner)
    if not GATE.acquire(timeout=1):
        raise ValueError('Robot is busy. Please try again in a moment.')
    try:
        with tempfile.TemporaryDirectory(prefix='mygrain-robot-') as folder:
            root = Path(folder)
            # eSpeak voice variants support an exact monotone base/range in Hz.
            # Build a private data overlay: installed dictionaries remain read-only.
            data = root / 'espeak-ng-data'; data.mkdir()
            for item in DATA.iterdir():
                if item.name != 'voices':
                    (data / item.name).symlink_to(item, target_is_directory=item.is_dir())
            variants = data / 'voices' / '!v'; variants.mkdir(parents=True)
            variant = (DATA / 'voices' / '!v' / VOICES[voice]).read_text()
            if note is not None:
                # eSpeak NG 1.51 voices.c subtracts 9 Hz from pitch_base.
                # Compensate here so the selected musical note is not flat.
                hz = round(440 * 2 ** ((note - 69) / 12)) + 9
                variant = re.sub(r'^pitch\s+.*$', f'pitch {hz} {hz}', variant, flags=re.M)
                variant += '\nflutter 0\n'
            (variants / 'robot').write_text(variant)
            pcm = array.array('h'); lanes = []; sample_rate = None
            for index, word in enumerate(words):
                output = root / f'{index}.wav'
                subprocess.run(['/usr/bin/espeak-ng', f'--path={root}', '-v', 'en-us+robot', '-s', str(speed), '-a', '100', '-z', '-b', '1', '-w', str(output), '--stdin'], input=word.encode('utf-8'), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=8, check=True)
                with wave.open(str(output), 'rb') as wav:
                    if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getnframes() > wav.getframerate() * 8:
                        raise ValueError('Unexpected speech output.')
                    sample_rate = wav.getframerate()
                    samples = array.array('h', wav.readframes(wav.getnframes()))
                # Remove only quiet edges; preserve complete consonants and add 3 ms fades.
                active = [i for i, n in enumerate(samples) if abs(n) > 120]
                if not active:
                    raise ValueError('Could not speak word: ' + word)
                pad = int(sample_rate * .012)
                samples = samples[max(0, active[0]-pad):min(len(samples), active[-1]+pad+1)]
                peak = max(abs(n) for n in samples)
                gain = min(4, 24000 / max(1, peak)); fade = max(1, int(sample_rate * .003))
                samples = array.array('h', (round(n * gain * min(1, i/fade, (len(samples)-1-i)/fade)) for i, n in enumerate(samples)))
                lanes.append({'word': word, 'offset': len(pcm)/sample_rate, 'duration': len(samples)/sample_rate})
                pcm.extend(samples)
            stream = io.BytesIO()
            with wave.open(stream, 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sample_rate); wav.writeframes(pcm.tobytes())
            return stream.getvalue(), {'engine': 'espeak-ng-1.51', 'voice': voice, 'note': note, 'speed': speed, 'lanes': lanes}
    finally:
        GATE.release()


def build_natural(words, voice, speed, *, owner=""):
    if not Path(KOKORO_PYTHON).is_file():
        raise ValueError('Natural voices are not installed on this server.')
    if not NATURAL_GATE.acquire(timeout=1):
        raise ValueError('Natural voice workers are busy. Please try again shortly.')
    lease = None
    success = False
    try:
        lease = pool.acquire('robot-speech', owner, timeout=90)
        data = speech_workers.render({'words': words, 'voice': voice[7:], 'speed': speed})
        audio = base64.b64decode(data['audioBase64'], validate=True)
        # Validate the IPC boundary before audio enters a portable patch.
        with wave.open(io.BytesIO(audio), 'rb') as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 24000 or not 0 < wav.getnframes() <= 24000 * 128:
                raise ValueError('Natural voice returned invalid audio.')
            frames = wav.getnframes()
        lanes = data['lanes']
        if len(lanes) != len(words) or any(l['word'] != word or not math.isfinite(l['offset']) or not math.isfinite(l['duration']) or l['offset'] < 0 or not .001 <= l['duration'] <= 8 or l['offset'] + l['duration'] > frames / 24000 + 2 / 24000 for l, word in zip(lanes, words)):
            raise ValueError('Natural voice returned invalid word boundaries.')
        success = True
        return audio, {'engine': 'kokoro-82m-v1.0', 'voice': voice, 'note': None,
            'speed': speed, 'lanes': lanes, 'device': data['device'], 'gpu': data.get('gpu'),
            'workerReused': data['workerReused'], 'serverSeconds': data['serverSeconds']}
    finally:
        if lease is not None:
            lease.close('done' if success else 'failed')
        NATURAL_GATE.release()


def build_extra(words, voice, speed, score, *, owner=''):
    import mygrain_robot_engine_workers as workers
    engine = extra_voices.VOICES[voice][0]
    payload = {'words': words, 'voice': voice, 'speed': speed}
    if engine == 'diffsinger':
        payload['melody'] = extra_voices.melody(score, len(words))
    if engine == 'bark' and (len(words) > 8 or sum(map(len, words)) > 100):
        raise ValueError('Experimental Bark clips support up to 8 words / 100 letters.')
    lease = pool.acquire('robot-speech', owner, timeout=90)
    success = False
    try:
        data = workers.render(engine, payload)
        audio = base64.b64decode(data['audioBase64'], validate=True)
        with wave.open(io.BytesIO(audio), 'rb') as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 24000 or not 0 < wav.getnframes() <= 24000*128:
                raise ValueError('Voice worker returned invalid PCM.')
            seconds = wav.getnframes()/24000
        lanes = data['lanes']
        clip = engine in ('bark', 'diffsinger')
        expected = ['Sung phrase' if engine == 'diffsinger' or voice == 'bark_sing' else 'Vocal phrase'] if clip else words
        if len(lanes) != len(expected) or any(l['word'] != word or not math.isfinite(l['offset']) or not math.isfinite(l['duration']) or l['offset'] < 0 or not .001 <= l['duration'] <= (26 if clip else 8) or l['offset']+l['duration'] > seconds+2/24000 for l,word in zip(lanes,expected)):
            raise ValueError('Voice worker returned invalid lane boundaries.')
        success = True
        return audio, {'engine': engine, 'voice': voice, 'note': None, 'speed': speed, 'lanes': lanes,
            'device': data['device'], 'gpu': data.get('gpu'), 'workerReused': data['workerReused'],
            'serverSeconds': data['serverSeconds'], 'inferenceSeconds': data.get('inferenceSeconds'),
            **({'melody': payload['melody']} if 'melody' in payload else {})}
    finally:
        lease.close('done' if success else 'failed')


def cycle_steps(value, transport_steps):
    return 16 * value['loopBars'] if value.get('loopBars') else max(16, transport_steps)

def alignment_advance(value, phrase, lane):
    snap = value.get('snap')
    if not snap or not phrase.get('voice', '').startswith('kokoro_'):
        return 0
    return min(lane.get('markers', {}).get(snap['method'], 0) * snap['strength'] / 100,
               snap['maxShiftMs'] / 1000)


def pre_roll_seconds(value):
    if not audible(value) or not value.get('snap'):
        return 0
    steps = min(16, 16 * value['loopBars'] / value['timingBars']) if value.get('loopBars') and value.get('timingBars') else 16
    return max((alignment_advance(value, p, l) for p in value['phrases'] if p['enabled']
                for l in p['lanes'] if any(n and i < steps for i, n in enumerate(l['pattern']))), default=0)


def render_version(value):
    return (36 if pre_roll_seconds(value) > 0 else 35 if value.get('timingBars') and value.get('loopBars') else 34) if audible(value) else 0


def audible(value):
    return isinstance(value, dict) and value.get('enabled') is True and value.get('level', 0) > 0 and any(p.get('enabled') is True and any(any(l.get('pattern', [])) for l in p.get('lanes', [])) for p in value.get('phrases', []))


def validate(value):
    if value is None:
        return
    def number(n, low, high):
        return type(n) in (int, float) and math.isfinite(n) and low <= n <= high
    if not isinstance(value, dict) or type(value.get('version')) is not int or value.get('version') != 1 or type(value.get('enabled')) is not bool or not number(value.get('level'), 0, 1):
        raise ValueError('Invalid Robot settings.')
    if 'loopBars' in value and (type(value['loopBars']) is not int or value['loopBars'] not in (1, 2, 4, 8, 16)):
        raise ValueError('Invalid Robot loop length.')
    if 'snap' in value:
        snap = value['snap']
        if (not isinstance(snap, dict) or set(snap) != {'method', 'strength', 'maxShiftMs'}
                or snap['method'] not in ('peakPower', 'attack', 'manual')
                or not number(snap['strength'], 0, 100) or not number(snap['maxShiftMs'], 0, 200)):
            raise ValueError('Invalid Robot word alignment settings.')
    if 'timingBars' in value and (type(value['timingBars']) is not int or value['timingBars'] not in (1, 2, 4, 8, 16)):
        raise ValueError('Invalid Robot preserved timing span.')
    if 'maximiser' in value and not number(value['maximiser'], 0, 100):
        raise ValueError('Invalid Robot maximiser.')
    phrases = value.get('phrases')
    if not isinstance(phrases, list) or len(phrases) > 16:
        raise ValueError('Robot supports at most 16 phrases.')
    ids = set()
    for p in phrases:
        if not isinstance(p, dict) or not isinstance(p.get('id'), str) or not 1 <= len(p['id']) <= 64 or p['id'] in ids or type(p.get('enabled')) is not bool:
            raise ValueError('Invalid Robot phrase identity.')
        ids.add(p['id'])
        if not isinstance(p.get('text'), str) or len(p['text']) > 512 or not isinstance(p.get('voice'), str) or p.get('voice') not in VOICES and p.get('voice') not in KOKORO_VOICES and p.get('voice') not in extra_voices.VOICES or (p.get('note') is not None and (type(p['note']) is not int or not 36 <= p['note'] <= 84)) or type(p.get('speed')) is not int or not 100 <= p['speed'] <= 450:
            raise ValueError('Invalid Robot speech recipe.')
        if 'melody' in p:
            if p['voice'] != 'diffsinger_qixuan':
                raise ValueError('Only scored singing has a melody recipe.')
            extra_voices.melody(p['melody'], len(p['text'].split()))
        lanes = p.get('lanes')
        if not isinstance(lanes, list) or not 1 <= len(lanes) <= 16:
            raise ValueError('Invalid Robot word lanes.')
        for l in lanes:
            if not isinstance(l, dict) or not isinstance(l.get('word'), str) or not 1 <= len(l['word']) <= 48 or not number(l.get('offset'), 0, 2048) or not number(l.get('duration'), .001, 26 if p['voice'].startswith(('bark_', 'diffsinger_')) else 8):
                raise ValueError('Invalid Robot word audio range.')
            if 'markers' in l:
                markers = l['markers']
                if (not isinstance(markers, dict) or not markers or set(markers) - {'peakPower', 'attack', 'manual'}
                        or any(not number(n, 0, l['duration']) for n in markers.values())):
                    raise ValueError('Invalid Robot word alignment markers.')
            pattern = l.get('pattern')
            if not isinstance(pattern, list) or len(pattern) != 16 or any(type(n) is not int or not 0 <= n <= 4 for n in pattern):
                raise ValueError('Invalid Robot ratchet grid.')


def validate_asset(value, assets):
    if not value or not value.get('phrases'):
        return
    source = next((a for a in assets if a['key'] == 'robotWords'), None)
    if not source or not source.get('sampleRate') or source.get('channels') != 1:
        raise ValueError('Robot phrases are missing their embedded mono word audio.')
    length = source['frames'] / source['sampleRate']
    if length > 2048 or any(l['offset'] + l['duration'] > length + 2 / source['sampleRate'] for p in value['phrases'] for l in p['lanes']):
        raise ValueError('Robot word range exceeds its embedded audio.')
