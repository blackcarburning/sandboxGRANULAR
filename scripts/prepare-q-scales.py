import io
import json
import pathlib
import re
import tarfile
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
REVISION = 'e555422aef910daa87cb924028f71f0a013f3ed7'
SOURCE = f'https://raw.githubusercontent.com/tonaljs/tonal/{REVISION}/packages/scale-type/data.ts'


def download(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return response.read()


def semitones(interval):
    match = re.fullmatch(r'([1-9])(P|M|m|A|d)', interval)
    degree = int(match[1]) - 1
    base = [0, 2, 4, 5, 7, 9, 11][degree % 7] + 12 * (degree // 7)
    quality = match[2]
    offset = {'P': 0, 'M': 0, 'm': -1, 'A': 1, 'd': -1 if degree % 7 in [0, 3, 4] else -2}[quality]
    return (base + offset) % 12


source = re.sub(r'//[^\n]*', '', download(SOURCE).decode())
scales = []
for entry in re.findall(r'\[\s*"[^\n\]]+\]', source):
    values = json.loads(entry)
    scales.append({'name': values[1], 'aliases': values[2:], 'intervals': sorted(set(map(semitones, values[0].split())))})
if len(scales) < 80:
    raise ValueError('Scale dictionary is incomplete.')
(ROOT / 'q-scales.json').write_text(json.dumps({'source': SOURCE, 'revision': REVISION, 'license': 'MIT', 'scales': scales}, indent=2) + '\n')
(ROOT / 'third-party').mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(download('https://registry.npmjs.org/@tonaljs/scale-type/-/scale-type-4.9.2.tgz')), mode='r:gz') as archive:
    (ROOT / 'third-party' / 'tonal-scale-type-LICENSE.txt').write_bytes(archive.extractfile('package/LICENSE').read())
print(f'Prepared {len(scales)} named scales with aliases and MIT attribution.')
