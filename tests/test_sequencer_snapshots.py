import copy
import hashlib
import io
import json
import os
import pathlib
import sys
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import mygrain_songs as songs


class SequencerSnapshots(unittest.TestCase):
    def test_legacy_absence_and_unbounded_list(self):
        songs.validate_sequencer_snapshots(None)
        entry = {'id': 'memory', 'name': 'Verse', 'data': {'version': 1, 'card': 'L', 'patternLength': 32, 'sequence': []}}
        value = {'version': 1, 'cards': {'L': [{**copy.deepcopy(entry), 'id': f'memory-{i}'} for i in range(1000)]}}
        before = copy.deepcopy(value)
        songs.validate_sequencer_snapshots(value)
        self.assertEqual(before, value)

    def test_invalid_metadata_does_not_accept_audio(self):
        entry = {'id': 'memory', 'name': 'Verse', 'data': {'version': 1, 'card': 'L'}}
        for bad in [[], 9, {'version': 2, 'cards': {}}, {'version': 1, 'cards': {'unknown': []}}]:
            with self.assertRaises(ValueError):
                songs.validate_sequencer_snapshots(bad)
        for change in [lambda e: e.update(name='\n'), lambda e: e['data'].update(card='Q'), lambda e: e['data'].update(pcm=[0, 1]), lambda e: e['data'].update(audio={'base64': 'AAAA'})]:
            bad = copy.deepcopy(entry)
            change(bad)
            with self.assertRaises(ValueError):
                songs.validate_sequencer_snapshots({'version': 1, 'cards': {'L': [bad]}})
        with self.assertRaises(ValueError):
            songs.validate_sequencer_snapshots({'version': 1, 'cards': {'L': [entry, entry]}})

    def test_local_bindings_are_references_only(self):
        identity = '44100:4410:' + 'a' * 64
        value = {'version': 1, 'cards': {'L': [{'id': 'local', 'name': 'Local', 'data': {'version': 1, 'card': 'L', 'reference': {'patchAudio': [identity]}}}]}, 'bindings': {'L': [identity]}}
        songs.validate_sequencer_snapshots(value)
        for bad in ({'L': ['48000:4800:' + 'b' * 64]}, {'L': {'pcm': [0, 1]}}, {'unknown': [identity]}, {'drums:kick': [identity]}):
            with self.assertRaises(ValueError):
                songs.validate_sequencer_snapshots({**value, 'bindings': bad})

    @unittest.skipUnless(os.environ.get('MYGRAIN_SNAPSHOT_FIXTURE'), 'Run browser fixtures first and set MYGRAIN_SNAPSHOT_FIXTURE')
    def test_complete_archives_keep_audio_and_render_identity(self):
        folder = pathlib.Path(os.environ['MYGRAIN_SNAPSHOT_FIXTURE'])
        for engine in ('chromium', 'webkit'):
            with self.subTest(engine=engine):
                a = (folder / f'{engine}-with.zip').read_bytes()
                b = (folder / f'{engine}-without.zip').read_bytes()
                before = hashlib.sha256(a).hexdigest()
                current, legacy = songs.validate_part_zip(a), songs.validate_part_zip(b)
                self.assertEqual(current, legacy)
                self.assertEqual(before, hashlib.sha256(a).hexdigest())
                with zipfile.ZipFile(io.BytesIO(a)) as first, zipfile.ZipFile(io.BytesIO(b)) as second:
                    for name in first.namelist():
                        if name.startswith('audio/'):
                            self.assertEqual(first.read(name), second.read(name))
                    state = json.loads(first.read('song-part.json'))['state']
                    self.assertEqual(set(state['modes']['sequencerSnapshots']['cards']), {'drums', 'L', 'X', 'Q', 'R', 'E'})
                    prior = json.loads(second.read('song-part.json'))['state']
                    self.assertEqual(state.get('selects'), prior.get('selects'))
                    self.assertFalse(any('sequencerSnapshot' in k for k in state.get('selects', {})))


if __name__ == '__main__':
    unittest.main()
