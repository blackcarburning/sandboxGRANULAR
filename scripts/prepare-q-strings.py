import concurrent.futures
import hashlib
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

import numpy as np
from scipy.io import wavfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
REPOSITORY = ROOT / 'SAMPLES_Q_STRINGS'
SOURCE = 'sgossner/VSCO-2-CE'
REVISION = '440300901dfe9275fd84e0b7763af1f8443ae62e'
MAPPING_REVISION = '6dd651d55dde97fd4028699be9d4481f26917891'
RAW = f'https://raw.githubusercontent.com/{SOURCE}/{REVISION}'
SECTIONS = {
    'cello': ('CelloEnsSusVib', 'Strings/Cello Section/susvib/', [36, 40, 43, 47]),
    'viola': ('ViolaEnsSusVib', 'Strings/Viola Section/susvib/', [48, 50, 52, 55, 59, 62]),
    'violin': ('ViolinEnsSusVib', 'Strings/Violin Section/susVib/', [66, 69, 72, 76, 79, 83, 86]),
}


def download(url):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'MYGRAIN-Q-strings-setup'})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def verified_file(path, entry):
    target = REPOSITORY / 'originals' / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(download(f'{RAW}/{urllib.parse.quote(path)}'))
    payload = target.read_bytes()
    if hashlib.sha1(f'blob {len(payload)}\0'.encode() + payload).hexdigest() != entry['sha']:
        raise ValueError(f'Upstream sample verification failed: {path}')
    return target, payload


def prepare_sample(region):
    target, payload = verified_file(region['path'], region['entry'])
    rate, source = wavfile.read(target)
    if rate != 44100 or source.ndim != 2 or source.shape[1] != 2 or source.dtype not in (np.int16, np.int32):
        raise ValueError(f'Invalid stereo recording: {target}')
    audio = source.astype(np.float64) / 2 ** (np.iinfo(source.dtype).bits - 1)
    frames = round(rate * 4.5)
    if len(audio) < frames + rate // 2:
        raise ValueError(f'Sustain recording is too short: {target}')
    audio = audio[:frames].copy() * 10 ** (region['volume'] / 20)
    loop_start = round(rate * 1.5)
    fade_frames = round(rate * .2)
    mix = np.linspace(0, 1, fade_frames, endpoint=True)[:, None]
    audio[-fade_frames:] = audio[-fade_frames:] * (1 - mix) + audio[loop_start - fade_frames:loop_start] * mix
    return region, payload, audio, loop_start


def main():
    (REPOSITORY / 'samples').mkdir(parents=True, exist_ok=True)
    (REPOSITORY / 'mappings').mkdir(parents=True, exist_ok=True)
    tree = json.loads(download(f'https://api.github.com/repos/{SOURCE}/git/trees/{REVISION}?recursive=1'))
    entries = {entry['path']: entry for entry in tree['tree'] if entry['type'] == 'blob'}
    regions = []
    for section, (mapping, folder, roots) in SECTIONS.items():
        text = download(f'https://raw.githubusercontent.com/{SOURCE}/{MAPPING_REVISION}/{mapping}.sfz').decode()
        (REPOSITORY / 'mappings' / f'{mapping}.sfz').write_text(text)
        for part in text.split('<region>')[1:]:
            midi = int(re.search(r'pitch_keycenter=(\d+)', part)[1])
            high_velocity = int(re.search(r'hivel=(\d+)', part)[1])
            if midi not in roots or high_velocity not in (62, 127):
                continue
            filename = re.search(r'sample=(.+)', part)[1].strip()
            path = folder + filename
            velocity = 32 if high_velocity == 62 else 96
            regions.append({'id': f'{section}{midi}v{velocity}', 'section': section, 'midi': midi,
                            'velocity': velocity, 'path': path, 'entry': entries[path],
                            'volume': float(re.search(r'volume=([\d.-]+)', part)[1])})
    regions.sort(key=lambda region: (region['midi'], region['velocity']))
    if len(regions) != 34 or len({region['id'] for region in regions}) != 34:
        raise ValueError('Incomplete string section mapping.')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        prepared = list(executor.map(prepare_sample, regions))
    attenuation = .65 / max(float(np.max(np.abs(audio))) for _, _, audio, _ in prepared)
    samples = []
    for region, original, audio, loop_start in prepared:
        filename = f'samples/{region["id"]}.wav'
        target = REPOSITORY / filename
        wavfile.write(target, 44100, np.rint(audio * attenuation * 32767).astype(np.int16))
        samples.append({'id': region['id'], 'midi': region['midi'], 'velocity': region['velocity'],
                        'section': region['section'], 'file': filename, 'sampleRate': 44100,
                        'channels': 2, 'frames': len(audio), 'loopStart': loop_start, 'loopEnd': len(audio),
                        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                        'sourceFile': region['path'], 'sourceGitBlob': region['entry']['sha'],
                        'sourceSha256': hashlib.sha256(original).hexdigest(),
                        'sourceGainDb': region['volume'], 'attenuation': attenuation})
    credit = 'VSCO 2 Community Edition by Versilian Studios / Sam Gossner'
    changes = ('Cello, viola and violin section sustain-vibrato recordings mapped across 17 roots (C2–D6), '
               'two dynamic layers (32/96). Numeric pitch centres come from the original SFZ mappings '
               '(their filenames use C3 = MIDI 60). Original SFZ layer gains with a common headroom attenuation; '
               '4.5-second stereo PCM16/44.1 kHz samples, 1.5–4.5-second sustain loops with a 200 ms linear '
               'seam crossfade. Notes outside the recorded range are pitch-shifted. Originals retained; '
               'no endorsement implied.')
    manifest = {'version': 1, 'id': 'vsco2-ce-q-strings-2layer-44100-v1', 'instrument': 'strings',
                'credit': credit, 'license': 'CC0 1.0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
                'source': f'https://github.com/{SOURCE}/tree/{REVISION}', 'revision': REVISION,
                'mappingRevision': MAPPING_REVISION, 'changes': changes, 'samples': samples}
    (REPOSITORY / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (REPOSITORY / 'LICENSE').write_bytes(download(f'{RAW}/LICENSE'))
    (REPOSITORY / 'ATTRIBUTION.txt').write_text(f'{credit}\nLicence: CC0 1.0\nSource: {manifest["source"]}\n'
                                             f'Mappings: {MAPPING_REVISION}\n\n{changes}\n')
    print(json.dumps({'samples': len(samples), 'roots': sorted({sample['midi'] for sample in samples}),
                      'decodedMiB': sum(sample['frames'] * 8 for sample in samples) / 1024 ** 2,
                      'attenuationDb': 20 * np.log10(attenuation)}, indent=2))


if __name__ == '__main__':
    main()
