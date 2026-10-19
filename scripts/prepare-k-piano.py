import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import wave


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'SAMPLES_Q'
TARGET = ROOT / 'SAMPLES_Q_KEYBOARD'
IDENTITY = 'salamander-v3-k-mp3-44100-v1'


def digest(content):
    return hashlib.sha256(content).hexdigest()


def prepare(check=False, decode_check=False):
    original = json.loads((SOURCE / 'manifest.json').read_text())
    existing = json.loads((TARGET / 'catalog.json').read_text()) if check else None
    encoder = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
    if (not check or decode_check) and not encoder:
        raise RuntimeError('Set FFMPEG to a libmp3lame-enabled ffmpeg executable.')
    samples = []
    maximum_padding = 0
    for sample in original['samples']:
        source = SOURCE / sample['file']
        if digest(source.read_bytes()) != sample['sha256']:
            raise ValueError(f'Original sample integrity failed: {source}')
        with wave.open(str(source), 'rb') as audio:
            if (audio.getnframes(), audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (sample['frames'], 44100, 2, 2):
                raise ValueError(f'Original sample dimensions failed: {source}')
        relative = f'samples/{sample["id"]}.mp3'
        target = TARGET / relative
        if not check:
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([encoder, '-nostdin', '-v', 'error', '-y', '-i', str(source),
                            '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', '2', '-write_xing', '1', str(target)], check=True)
        content = target.read_bytes()
        entry = {**sample, 'file': relative, 'bytes': len(content), 'sha256': digest(content), 'sourceSha256': sample['sha256']}
        if check and entry != existing['samples'][len(samples)]:
            raise ValueError(f'Keyboard derivative metadata/integrity failed: {target}')
        if decode_check:
            decoded = subprocess.run([encoder, '-nostdin', '-v', 'error', '-i', str(target), '-f', 's16le', '-'],
                                     check=True, stdout=subprocess.PIPE).stdout
            trailing_frames = len(decoded) // 4 - sample['frames']
            if trailing_frames < 0 or trailing_frames >= sample['sampleRate'] / 1000:
                raise ValueError(f'Keyboard derivative lost source frames: {target}')
            maximum_padding = max(maximum_padding, trailing_frames)
        samples.append(entry)
    catalog = {'version': 1, 'id': IDENTITY, 'sourceId': original['id'], 'codec': 'mp3',
               'name': original['name'], 'author': original['author'], 'license': original['license'],
               'source': original['source'], 'revision': original['revision'],
               'adaptation': 'Keyboard-only full-duration stereo MP3 derivatives of the verified Q PCM16 WAVs; libmp3lame VBR quality 2 with Xing gapless metadata. No trimming, normalization, resampling, looping or synthetic tails.',
               'samples': samples}
    if check:
        if existing != catalog:
            raise ValueError('Keyboard catalog provenance or encoding metadata changed.')
        print(f'Verified {len(samples)} full-duration derivatives: {sum(sample["bytes"] for sample in samples):,} bytes.')
        if decode_check:
            print(f'No source frames removed; maximum extra decoder padding: {maximum_padding} frames at 44.1 kHz (<1 ms).')
    else:
        body = json.dumps(catalog, indent=2) + '\n'
        print('*** Begin Patch\n*** Add File: SAMPLES_Q_KEYBOARD/catalog.json')
        print(''.join(f'+{line}\n' for line in body.splitlines()), end='')
        print('*** End Patch')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build keyboard MP3 assets; pipe the emitted catalog patch to apply_patch.')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--decode-check', action='store_true')
    arguments = parser.parse_args()
    prepare(arguments.check, arguments.decode_check)
