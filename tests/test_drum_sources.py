import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / 'fs7300-documenter' / 'server.py'
SPEC = importlib.util.spec_from_file_location('mygrain_drum_source_tests', MODULE_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class DrumSourcesTests(unittest.TestCase):
    def test_clap_and_cymbal_sources_resolve_to_the_requested_local_mirrors(self):
        for source, folder in [('samples_clap', 'SAMPLES_CLAP'), ('samples_crash', 'SAMPLES_CRASH')]:
            with self.subTest(source=source):
                self.assertEqual(SERVER.get_bastardloop_local_source_root(source), SERVER.MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT / folder)
                self.assertEqual(SERVER.MYGRAIN_BASTARDLOOP_SOURCE_CONFIG[source]['label'], folder)

    def test_existing_mirrors_are_listed_and_loaded_without_dropbox_or_rclone(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            for source, name in [('samples_clap', 'SAMPLES_CLAP'), ('samples_crash', 'SAMPLES_CRASH')]:
                sample = root / name / 'nested' / 'sample.wav'
                sample.parent.mkdir(parents=True)
                sample.write_bytes(b'fixture-audio')
                with patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT', root), patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_SAMPLE_CACHE', {}), patch.object(SERVER.subprocess, 'run', side_effect=AssertionError('Local samples must not use rclone')):
                    self.assertEqual(SERVER.list_bastardloop_source_files(source, force_refresh=True), ['nested/sample.wav'])
                    self.assertEqual(SERVER.resolve_bastardloop_source_sample(source, relative_path='nested/sample.wav')['bytes'], b'fixture-audio')
                    self.assertEqual(SERVER.choose_bastardloop_source_sample(source, seed='fixture')['sourceKey'], source)

    def test_new_sources_reject_paths_outside_the_local_mirror(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            (root / 'SAMPLES_CLAP').mkdir()
            with patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT', root):
                with self.assertRaises(ValueError):
                    SERVER.fetch_bastardloop_sample_bytes('samples_clap', '../outside.wav')


if __name__ == '__main__':
    unittest.main()
