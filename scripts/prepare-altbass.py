#!/usr/bin/env python3
"""Fetch original Juno-6 bass AIFFs unchanged using bounded ZIP HTTP ranges.

No conversion, resampling, tuning, trimming or normalisation. SFZ key/range
metadata is recorded separately; it never changes the downloaded audio bytes.
"""
import aifc
import hashlib
import io
import json
import pathlib
import re
import zipfile
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'SAMPLES_ALTBASS'
REPO = 'https://github.com/publicsamples/Roland-Juno-6'
ARCHIVE = REPO + '/releases/download/1.0/Audio.zip'
REVISION = 'e407c041a66312bf4140966fd69b49ce2be105b8'

class RemoteZip(io.RawIOBase):
    def __init__(self):
        r = requests.get(ARCHIVE, stream=True, timeout=60)
        r.raise_for_status()
        self.url, self.length, self.pos = r.url, int(r.headers['Content-Length']), 0
        r.close()
    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.length + offset
        return self.pos
    def tell(self):
        return self.pos
    def read(self, count=-1):
        count = min(count if count >= 0 else self.length, self.length - self.pos)
        if count <= 0:
            return b''
        r = requests.get(self.url, headers={'Range': f'bytes={self.pos}-{self.pos+count-1}'}, timeout=60)
        r.raise_for_status()
        if r.status_code != 206 or len(r.content) != count:
            raise IOError('Archive HTTP range unavailable')
        self.pos += count
        return r.content

def main():
    ROOT.mkdir(exist_ok=True)
    base = 'https://raw.githubusercontent.com/publicsamples/Roland-Juno-6/' + REVISION + '/'
    response = requests.get(base + 'LICENSE', timeout=60)
    response.raise_for_status()
    (ROOT / 'LICENSE.txt').write_text(response.text.rstrip() + '\n')
    entries = []
    with zipfile.ZipFile(RemoteZip()) as archive:
        for patch in ['Pulse Bass', 'Saw Bass split']:
            response = requests.get(base + 'SFZ/' + requests.utils.quote(patch) + '.sfz', timeout=60)
            response.raise_for_status()
            sfz_path = ROOT / 'provenance' / (patch + '.sfz')
            sfz_path.parent.mkdir(exist_ok=True)
            sfz_path.write_bytes(response.content)
            for line in response.text.splitlines():
                match = re.search(r'sample=../Audio/(.+)-(\d+)-(\d+)\.aif', line)
                if not match:
                    continue
                midi, velocity = int(match[2]), int(match[3])
                if not 36 <= midi <= (48 if patch == 'Saw Bass split' else 60):
                    continue
                relative = match[0].split('../Audio/')[1]
                member = 'juno6/Audio/' + relative
                data = archive.read(member)  # zipfile verifies upstream CRC32.
                path = ROOT / relative
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(data)
                with aifc.open(io.BytesIO(data), 'rb') as aiff:
                    rate, channels, frames, width = aiff.getframerate(), aiff.getnchannels(), aiff.getnframes(), aiff.getsampwidth()
                start = re.search(r'offset=(\d+)', line)
                end = re.search(r' end=(\d+)', line)
                note = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi % 12] + str(midi // 12 - 1)
                digest = hashlib.sha256(data).hexdigest()
                entries.append({'name': relative, 'rootNote': note, 'midi': midi, 'sourceMidi': midi,
                    'patch': patch, 'velocity': velocity, 'archiveMember': member,
                    'sourceSha256': digest, 'sha256': digest, 'archiveCRC32': f'{archive.getinfo(member).CRC:08x}',
                    'sfzStartFrame': int(start[1]) if start else 0, 'sfzEndFrame': int(end[1]) if end else None,
                    'durationS': frames / rate, 'frames': frames, 'channels': channels, 'sampleRate': rate, 'bitDepth': width * 8})
            print(patch, len(entries), 'originals downloaded', flush=True)
    if len(entries) != 63:
        raise ValueError('Incomplete original sample selection')
    # Only remove previous prepared WAVs after all fresh originals succeeded.
    for path in ROOT.glob('*.wav'):
        path.unlink()
    (ROOT / 'manifest.json').write_text(json.dumps({'repository': REPO, 'revision': REVISION,
        'archive': ARCHIVE, 'license': 'Public domain; upstream LICENSE.txt',
        'processing': 'None. Byte-identical original AIFF archive members. Original SFZ keyboard roots; no octave remapping, tuning, resampling, trimming, normalisation or format conversion.',
        'samples': entries}, indent=2) + '\n')
    print(len(entries), 'original AIFFs', sum((ROOT / e['name']).stat().st_size for e in entries), 'bytes', flush=True)

if __name__ == '__main__':
    main()
