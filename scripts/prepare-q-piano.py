import concurrent.futures
import ctypes
import hashlib
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request
import wave

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly


ROOT = pathlib.Path(__file__).resolve().parents[1]
REPOSITORY = ROOT / 'SAMPLES_Q'
REVISION = '3382bf9496bba2486f5ab0de55a264d1dfc38404'
SOURCE = 'sfzinstruments/SalamanderGrandPiano'
RAW = f'https://raw.githubusercontent.com/{SOURCE}/{REVISION}'


class AudioInfo(ctypes.Structure):
    _fields_ = [('frames', ctypes.c_int64), ('sample_rate', ctypes.c_int), ('channels', ctypes.c_int),
                ('format', ctypes.c_int), ('sections', ctypes.c_int), ('seekable', ctypes.c_int)]


def convert_audio(original, target):
    library = ctypes.CDLL('libsndfile.so.1')
    library.sf_open.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(AudioInfo)]
    library.sf_open.restype = ctypes.c_void_p
    library.sf_readf_float.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int64]
    library.sf_readf_float.restype = ctypes.c_int64
    library.sf_close.argtypes = [ctypes.c_void_p]
    info = AudioInfo()
    handle = library.sf_open(str(original).encode(), 16, ctypes.byref(info))
    if not handle or info.channels != 2 or info.sample_rate != 48000:
        if handle:
            library.sf_close(handle)
        raise ValueError(f'Invalid source recording: {original.name}')
    try:
        audio = np.empty((info.frames, info.channels), dtype=np.float32)
        if library.sf_readf_float(handle, audio.ctypes.data_as(ctypes.POINTER(ctypes.c_float)), info.frames) != info.frames:
            raise ValueError(f'Truncated source recording: {original.name}')
    finally:
        library.sf_close(handle)
    converted = resample_poly(audio, 147, 160, axis=0)
    wavfile.write(str(target), 44100, np.clip(np.rint(converted * 32768), -32768, 32767).astype(np.int16))


def download(url):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'MYGRAIN-Q-piano-setup'})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def prepare_sample(entry):
    name = pathlib.PurePosixPath(entry['path']).name
    match = re.fullmatch(r'([A-G])(#?)(\d)v(4|8|12|16)\.flac', name)
    original = REPOSITORY / 'originals' / name
    if not original.exists():
        original.write_bytes(download(f'{RAW}/{urllib.parse.quote(entry["path"])}'))
    payload = original.read_bytes()
    digest = hashlib.sha1(f'blob {len(payload)}\0'.encode() + payload).hexdigest()
    if digest != entry['sha']:
        raise ValueError(f'Upstream sample verification failed: {name}')
    target = REPOSITORY / 'samples' / (name.replace('#', 's').removesuffix('.flac') + '.wav')
    if not target.exists():
        convert_audio(original, target)
    with wave.open(str(target), 'rb') as audio:
        frames = audio.getnframes()
        rate = audio.getframerate()
        if audio.getnchannels() != 2 or audio.getsampwidth() != 2 or frames < rate:
            raise ValueError(f'Invalid piano sample: {target.name}')
    pitch_class = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[match[1]] + bool(match[2])
    return {'id': target.stem, 'file': f'samples/{target.name}', 'midi': (int(match[3]) + 1) * 12 + pitch_class,
            'velocity': round(int(match[4]) / 16 * 127), 'frames': frames, 'sampleRate': rate,
            'channels': 2, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


def main():
    for folder in ['originals', 'samples']:
        (REPOSITORY / folder).mkdir(parents=True, exist_ok=True)
    for filename in ['LICENSE', 'README.md']:
        (REPOSITORY / filename).write_bytes(download(f'{RAW}/{filename}'))
    tree = json.loads(download(f'https://api.github.com/repos/{SOURCE}/git/trees/{REVISION}?recursive=1'))
    entries = [entry for entry in tree['tree'] if re.fullmatch(r'Samples/[A-G]#?\dv(4|8|12|16)\.flac', entry['path'])]
    if len(entries) != 120:
        raise ValueError('Expected 30 sampled pitches in each of four velocity layers.')
    samples = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for sample in executor.map(prepare_sample, entries):
            samples.append(sample)
            if len(samples) % 12 == 0:
                print(f'Verified and converted {len(samples)}/120 piano samples', flush=True)
    manifest = {'version': 1, 'id': 'salamander-v3-q-4layer-44100-v1', 'name': 'Salamander Grand Piano V3',
                'author': 'Alexander Holm', 'license': 'CC-BY-3.0', 'source': f'https://github.com/{SOURCE}',
                'revision': REVISION, 'adaptation': 'Four velocity layers (4/8/12/16), converted from 48 kHz 24-bit FLAC to stereo 44.1 kHz PCM16 WAV; no sample trimming or normalization.',
                'midiRange': [21, 108], 'samples': sorted(samples, key=lambda sample: (sample['midi'], sample['velocity']))}
    (REPOSITORY / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (REPOSITORY / 'ATTRIBUTION.txt').write_text(f'{manifest["name"]} by {manifest["author"]}\nCreative Commons Attribution 3.0 Unported (CC BY 3.0)\nhttps://creativecommons.org/licenses/by/3.0/\n{manifest["source"]}\nSource revision: {REVISION}\n{manifest["adaptation"]}\nPrepared for MYGRAIN Q; no endorsement by the original author is implied.\n')
    print(f'Complete: {len(samples)} samples, {sum(sample["bytes"] for sample in samples) / 1e6:.1f} MB WAV audio', flush=True)


if __name__ == '__main__':
    main()
