import importlib.util
import io
import json
import pathlib
import struct
import tempfile
import unittest
import wave
import zipfile
from concurrent.futures import Future
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('daw_export_tests', pathlib.Path(__file__).resolve().parents[1] / 'backend/mygrain_daw.py')
daw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daw)


class DawExportTest(unittest.TestCase):
    def test_queued_cancel_cleans_sources_without_waiting_for_worker(self):
        future = Future()
        submitted = []
        executor = SimpleNamespace(submit=lambda *args: (submitted.append(args), future)[1])
        handler = SimpleNamespace(command='POST', headers={'Content-Length': '0'}, server=SimpleNamespace(server_address=('127.0.0.1', 18933)), send_json=lambda data, **kwargs: data)
        ftp = SimpleNamespace(parts=lambda path: [], home=lambda user: '', directory=lambda *args: nullcontext(), NO_CACHE={})
        user = {'id': 'queue-test', 'username': 'queue-test'}
        with patch.object(daw, 'EXECUTOR', executor):
            result = daw.handle(handler, user, None, ftp, 'daw-start', {'scope': ['song']})
            identifier = result['job']['id']
            folder = submitted[0][3]
            payload = submitted[0][2]
            self.assertTrue(folder.exists())
            try:
                result = daw.handle(handler, user, None, ftp, 'daw-cancel', {'id': [identifier]})
                self.assertEqual(result['job']['state'], 'cancelled')
                self.assertTrue(future.cancelled())
                self.assertFalse(folder.exists())
                self.assertEqual(payload, {})
            finally:
                daw.JOBS.pop(identifier, None)

    def test_aligned_audio_repeats_silence_tail_and_midi(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            with wave.open(str(root / 'tone.wav'), 'wb') as out:
                out.setparams((2, 3, 48000, 0, 'NONE', ''))
                out.writeframes(bytes([0, 0, 16]) * 2 * 4800)
            manifest = {'parts': {'a': {'stems': {'Drums kick': 'tone.wav'}, 'midi': [{'track': 'Kick', 'note': 36, 'velocity': 96, 'start': 0, 'duration': .05, 'drum': True}]}, 'b': {'stems': {}, 'midi': []}}, 'arrangement': [{'renderKey': 'b', 'bpm': 120, 'duration': .25, 'name': 'Silence'}, {'renderKey': 'a', 'bpm': 150, 'duration': .25, 'name': 'Hit'}, {'renderKey': 'a', 'bpm': 150, 'duration': .25, 'name': 'Repeat'}]}
            daw.assemble(root, manifest, root / 'out.zip')
            with zipfile.ZipFile(root / 'out.zip') as z:
                with wave.open(io.BytesIO(z.read('audio/Drums kick.wav'))) as audio:
                    self.assertEqual((audio.getframerate(), audio.getsampwidth(), audio.getnchannels(), audio.getnframes()), (48000, 3, 2, 132000))
                    self.assertEqual(audio.readframes(12000), bytes(72000))
                    self.assertNotEqual(audio.readframes(4800), bytes(28800))
                    audio.setpos(24000)
                    self.assertNotEqual(audio.readframes(4800), bytes(28800))
                midi = z.read('MIDI/Arrangement.mid')
                self.assertEqual(midi[:4], b'MThd')
                self.assertEqual(struct.unpack('>HHH', midi[8:14]), (1, 2, 960))
                self.assertIn(b'\x99\x24\x60', midi)
                self.assertIn(b'\x07\xa1\x20', midi)  # 120 BPM
                self.assertIn(b'\x06\x1a\x80', midi)  # 150 BPM
                readme = z.read('README.txt').decode('utf8')
                for title in ('Cubase', 'Bitwig Studio', 'Ableton Live', 'FL Studio'):
                    self.assertIn(title, readme)
                self.assertIn('Realign events off', readme)
                saved = json.loads(z.read('manifest.json'))
                self.assertEqual(saved['startBar'], 1)
                self.assertIn(saved['parts']['a']['stems']['Drums kick'], z.namelist())

    def test_cancel_never_completes_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            manifest = {'parts': {'a': {'stems': {'A': 'a.wav'}, 'midi': []}}, 'arrangement': [{'renderKey': 'a', 'bpm': 120, 'duration': 1, 'name': 'A'}]}
            with self.assertRaisesRegex(ValueError, 'cancelled'):
                daw.assemble(root, manifest, root / 'cancelled.zip', lambda: True)


if __name__ == '__main__':
    unittest.main()
