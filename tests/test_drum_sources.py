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
        for source, folder in [('samples_clap', 'SAMPLES_CLAP'), ('samples_crash', 'SAMPLES_CRASH'), ('samples_loops', 'SAMPLES_LOOPS'), ('samples_perc', 'SAMPLES_PERC')]:
            with self.subTest(source=source):
                self.assertEqual(SERVER.get_bastardloop_local_source_root(source), SERVER.MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT / folder)
                self.assertEqual(SERVER.MYGRAIN_BASTARDLOOP_SOURCE_CONFIG[source]['label'], folder)

    def test_existing_mirrors_are_listed_and_loaded_without_dropbox_or_rclone(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            for source, name in [('samples_clap', 'SAMPLES_CLAP'), ('samples_crash', 'SAMPLES_CRASH'), ('samples_loops', 'SAMPLES_LOOPS'), ('samples_perc', 'SAMPLES_PERC')]:
                sample = root / name / 'nested' / 'sample.wav'
                sample.parent.mkdir(parents=True)
                sample.write_bytes(b'fixture-audio')
                with patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT', root), patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_SAMPLE_CACHE', {}), patch.object(SERVER.subprocess, 'run', side_effect=AssertionError('Local samples must not use rclone')):
                    self.assertEqual(SERVER.list_bastardloop_source_files(source, force_refresh=True), ['nested/sample.wav'])
                    self.assertEqual(SERVER.resolve_bastardloop_source_sample(source, relative_path='nested/sample.wav')['bytes'], b'fixture-audio')
                    self.assertEqual(SERVER.choose_bastardloop_source_sample(source, seed='fixture')['sourceKey'], source)

    def test_random_pool_includes_every_nested_sample_and_new_arrivals_without_ttl(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            library = root / 'SAMPLES_LOOPS'
            nested = library / 'Bass' / 'Drums' / 'Percussion'
            nested.mkdir(parents=True)
            for i in range(1201):
                (nested / f'{i}.wav').write_bytes(b'audio')
            (nested / 'project.json').write_text('{}')
            with patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT', root), patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_SAMPLE_CACHE', {}):
                self.assertEqual(len(SERVER.list_bastardloop_source_files('samples_loops')), 1201)
                fresh = nested / 'new-arrival.wav'
                fresh.write_bytes(b'new-audio')
                files = SERVER.list_bastardloop_source_files('samples_loops')
                self.assertEqual(len(files), 1202)
                self.assertIn('Bass/Drums/Percussion/new-arrival.wav', files)
                with patch.object(SERVER.random.Random, 'choice', return_value='Bass/Drums/Percussion/new-arrival.wav') as choose:
                    result = SERVER.choose_bastardloop_source_sample('samples_loops')
                    self.assertEqual(len(choose.call_args.args[0]), 1202)
                    self.assertEqual(result['bytes'], b'new-audio')

    def test_nested_aiff_is_decoded_for_random_loop_generation(self):
        import numpy as np
        import soundfile
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            sample = root / 'SAMPLES_LOOPS' / 'Bass' / 'Drums' / 'hit.aiff'
            sample.parent.mkdir(parents=True)
            soundfile.write(sample, np.sin(np.arange(4410) * 0.1).astype(np.float32) * 0.2, 44100, format='AIFF')
            with patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT', root):
                pcm, meta = SERVER.prepare_bastardloop_source('samples_loops', 'Bass/Drums/hit.aiff', 120)
                self.assertGreater(float(np.max(np.abs(pcm))), 0.1)

    def test_new_sources_reject_paths_outside_the_local_mirror(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            (root / 'SAMPLES_CLAP').mkdir()
            with patch.object(SERVER, 'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT', root):
                with self.assertRaises(ValueError):
                    SERVER.fetch_bastardloop_sample_bytes('samples_clap', '../outside.wav')


if __name__ == '__main__':
    unittest.main()
