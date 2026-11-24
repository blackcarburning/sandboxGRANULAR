"""Repository-note reads cannot erase stored data or conceal load failures."""
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'fs7300-documenter'))

SPEC = importlib.util.spec_from_file_location(
    'repository_feedback_safety', Path(__file__).resolve().parents[2] / 'fs7300-documenter/server.py')
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class RepositoryFeedbackSafety(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'notes.json'
        self.scope = patch.multiple(SERVER, MYGRAIN_REPOSITORY_FEEDBACK_PATH=self.path,
                                    MYGRAIN_REPOSITORY_FEEDBACK_LOCK=threading.RLock())
        self.scope.start()
        self.addCleanup(self.scope.stop)

    def test_valid_read_preserves_exact_bytes_and_mtime(self):
        raw = json.dumps({'version': 1, 'items': {'/mygrain-wavs::song.wav': {
            'routeBase': '/mygrain-wavs', 'fileName': 'song.wav', 'comment': 'Keep this note',
            'commentBy': 'admin', 'reaction': 'love'}}}, indent=3)
        self.path.write_text(raw)
        before = self.path.stat().st_mtime_ns
        result = SERVER.load_mygrain_repository_feedback_store()
        self.assertEqual(result['items']['/mygrain-wavs::song.wav']['comment'], 'Keep this note')
        self.assertEqual(self.path.read_text(), raw)
        self.assertEqual(self.path.stat().st_mtime_ns, before)

    def test_missing_read_does_not_create_a_store(self):
        self.assertEqual(SERVER.load_mygrain_repository_feedback_store()['items'], {})
        self.assertFalse(self.path.exists())

    def test_invalid_json_is_not_replaced_with_empty_store(self):
        raw = '{"items": {"unfinished'
        self.path.write_text(raw)
        with self.assertRaises(json.JSONDecodeError):
            SERVER.load_mygrain_repository_feedback_store()
        self.assertEqual(self.path.read_text(), raw)

    def test_invalid_structure_is_not_replaced(self):
        for raw in ('[]', '{}', '{"items": []}'):
            with self.subTest(raw=raw):
                self.path.write_text(raw)
                with self.assertRaises(ValueError):
                    SERVER.load_mygrain_repository_feedback_store()
                self.assertEqual(self.path.read_text(), raw)

    def test_unrecognized_entries_cannot_be_silently_dropped(self):
        raw = '{"items": {"unknown": {"comment": "Do not delete me"}}}'
        self.path.write_text(raw)
        with self.assertRaises(ValueError):
            SERVER.load_mygrain_repository_feedback_store()
        self.assertEqual(self.path.read_text(), raw)

    def test_read_error_prevents_subsequent_edit_from_overwriting_store(self):
        self.path.write_text('private notes')
        with patch.object(Path, 'read_text', side_effect=PermissionError('synthetic read failure')):
            with self.assertRaises(PermissionError):
                SERVER.update_mygrain_repository_feedback('/mygrain-wavs', 'song.wav', 'new note')
        self.assertEqual(self.path.read_text(), 'private notes')



    def test_write_keeps_private_exact_previous_version_even_when_clearing(self):
        original = {'version': 1, 'items': {'/mygrain-wavs::song.wav': {
            'routeBase': '/mygrain-wavs', 'fileName': 'song.wav',
            'comment': 'Recover this text', 'commentBy': 'admin'}}}
        raw = json.dumps(original, indent=3).encode()
        self.path.write_bytes(raw)
        SERVER.save_mygrain_repository_feedback_store({'version': 1, 'items': {}})
        snapshots = list((self.path.parent / '.repository-feedback-history').glob('*.json'))
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0].read_bytes(), raw)
        self.assertEqual(snapshots[0].stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.path.read_text())['items'], {})


if __name__ == '__main__':
    unittest.main()
