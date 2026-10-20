#!/usr/bin/env python3
"""Run the existing full-file tonal analyser against unchanged original AIFFs.

Uses the same offline SQLite/CSV/JSONL/SQL workflow as the other repositories.
Only metadata outputs are written; sample audio is never edited.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys

APP = Path(__file__).resolve().parents[1]
CATALOGUER = APP.parent / 'sample-catalogue'
sys.path.insert(0, str(CATALOGUER))
import catalogue as c
from tonal_metadata import parse_filename as tonal_parse
from finish_tonal import finish

original_signature = c.signature

def parse_filename(name):
    value = tonal_parse(name)
    match = re.fullmatch(r'(Pulse Bass|Saw Bass split)-(\d+)-(\d+)\.aif', name)
    if match:
        # These are MIDI-key / velocity numbers, not tempo declarations.
        value['source_numeric_tokens'] = {'keyboard_midi': int(match[2]), 'velocity': int(match[3]), 'source': 'upstream SFZ mapping; verified separately against manifest'}
        value['rejected_bpm_candidates'] = value['bpm_candidates']
        value['bpm_candidates'], value['bpm'], value['bpm_ambiguous'] = [], None, False
    return value

def signature():
    _, settings = original_signature()
    settings['filename_extension'] = {'tonal_metadata.py': c.file_hash(CATALOGUER / 'tonal_metadata.py'), 'index-altbass.py': c.file_hash(Path(__file__))}
    return hashlib.sha256(c.encode(settings).encode()).hexdigest(), settings

def aiff_metadata(path):
    data = path.read_bytes()
    if data[:4] != b'FORM' or data[8:12] not in (b'AIFF', b'AIFC'):
        raise ValueError('Not an original AIFF')
    chunks = []
    offset = 12
    while offset + 8 <= len(data):
        kind = data[offset:offset+4].decode('latin1')
        size = int.from_bytes(data[offset+4:offset+8], 'big')
        payload = data[offset+8:offset+8+size]
        if len(payload) != size:
            raise ValueError('Incomplete AIFF chunk')
        parsed = {'container': 'AIFF', 'endianness': 'big', 'source': 'embedded; unverified'}
        if kind == 'INST' and len(payload) >= 20:
            parsed.update(base_note=payload[0], detune=int.from_bytes(payload[1:2], 'big', signed=True))
        chunks.append((len(chunks), kind, offset, size, None if kind == 'SSND' else payload, c.encode(parsed)))
        offset += 8 + size + size % 2
    return chunks

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=2, choices=range(1,5))
    args = parser.parse_args()
    root = APP / 'SAMPLES_ALTBASS'
    output = CATALOGUER / 'catalogues/SAMPLES_ALTBASS'
    manifest = json.loads((root / 'manifest.json').read_text())
    for item in manifest['samples']:
        if c.file_hash(root / item['name']) != item['sourceSha256'] or item['sha256'] != item['sourceSha256']:
            raise ValueError('Original source checksum mismatch: ' + item['name'])
    c.parse_filename, c.signature = parse_filename, signature
    if c.run(root, output, workers=args.workers):
        raise RuntimeError('Incomplete bass audio analysis; not publishing')
    db = sqlite3.connect(output / 'catalogue.sqlite')
    db.execute('CREATE TABLE IF NOT EXISTS source_mappings(file_id TEXT PRIMARY KEY REFERENCES files(file_id), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)))')
    for item in manifest['samples']:
        fid = db.execute('SELECT file_id FROM files WHERE source_root=? AND relative_path=?', (str(root), item['name'])).fetchone()[0]
        mapping = {**item, 'repository': manifest['repository'], 'revision': manifest['revision'], 'archive': manifest['archive'], 'playbackRootSource': 'Original upstream SFZ keyboard key; not acoustically retuned', 'audioProcessing': 'none; original archive bytes'}
        db.execute('INSERT OR REPLACE INTO source_mappings VALUES (?,?)', (fid, c.encode(mapping)))
        db.execute('DELETE FROM wave_chunks WHERE file_id=?', (fid,))
        db.executemany('INSERT INTO wave_chunks VALUES (?,?,?,?,?,?,?)', [(fid, *chunk) for chunk in aiff_metadata(root / item['name'])])
    db.commit()
    db.close()
    finish(output)
    # The existing independent verifier checks hashes, full-file coverage,
    # embedded bytes, database integrity and restoration of portable SQL.
    from verify_catalogue import verify
    verified = verify(root, output)
    if verified != 0:
        raise RuntimeError('Independent catalogue verification failed')
    report = output / 'REPORT.md'
    report.write_text(report.read_text().replace('SAMPLES_ORCH', 'SAMPLES_ALTBASS').replace('**No MYGRAIN integration. Source audio was not modified. No files were uploaded or deployed.**', '**Offline analysis; MYGRAIN reads this finished catalogue read-only. Original AIFF source bytes are unchanged.**') + '\nPlayback roots come from original upstream SFZ keyboard keys, separately from tentative acoustic pitch. `source_mappings` retains original hashes, archive CRC32, velocity, patch and SFZ regions. No octave remapping or audio conversion.\n')
    print('VERIFIED: original AIFFs fully indexed with source mappings.', flush=True)

if __name__ == '__main__':
    main()
