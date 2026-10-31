"""Track identity and artwork binding, without rendering or production storage."""
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'backend' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

mastering = module('mygrain_mastering')
art = module('mygrain_wav_art')
patterns = module('mygrain_wav_patterns')

class ReplacementIdentity(unittest.TestCase):
    def test_art_bytes_and_timestamp_survive_repeated_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source = root / 'Keep my name.wav'; source.write_bytes(b'original audio')
            output = root / 'render.tmp'; output.write_bytes(b'new audio')
            image = io.BytesIO(); Image.new('RGB', (64, 32), 'purple').save(image, 'PNG')
            artwork = art.save(root, source.name, image.getvalue())
            paths = art.paths(root, source.name)
            image_bytes, thumb_bytes = paths[2].read_bytes(), paths[3].read_bytes()
            _, patch, meta = patterns.paths(root, source.name)
            patch.parent.mkdir(); patch.write_bytes(b'unchanged source patch fixture')
            meta.write_text(json.dumps({'wavSignature': patterns.signature(source), 'patternSignature': patterns.signature(patch), 'sha256': hashlib.sha256(patch.read_bytes()).hexdigest()}))
            original_patch = patterns.read_pattern(root, source.name)
            original_mtime = source.stat().st_mtime_ns
            for _ in range(2):
                expected = hashlib.sha256(source.read_bytes()).hexdigest()
                old_patch_signature = patterns.signature(source)
                old_signature = mastering.replace_wav(root, source.name, output, expected, lambda path, boundary: path)
                art.rebind_after_replace(root, source.name, old_signature)
                patterns.rebind_after_replace(root, source.name, old_patch_signature)
                self.assertEqual(patterns.read_pattern(root, source.name), original_patch)
                self.assertEqual(art.info(root, source.name), artwork)
                self.assertEqual(paths[2].read_bytes(), image_bytes)
                self.assertEqual(paths[3].read_bytes(), thumb_bytes)
                self.assertEqual(source.stat().st_mtime_ns, original_mtime)
                self.assertTrue(mastering.replacement_info(root, source.name))
                self.assertIsNone(mastering.info(root, source.name))
            renamed = root / 'Renamed.wav'; source.rename(renamed)
            mastering.rename_info(root, source.name, renamed.name)
            self.assertTrue(mastering.replacement_info(root, renamed.name))
            copied = root / 'Copy.wav'; copied.write_bytes(renamed.read_bytes())
            mastering.copy_info(root, renamed.name, root, copied.name)
            self.assertTrue(mastering.replacement_info(root, copied.name))
            copied.write_bytes(b'external unrelated replacement')
            self.assertFalse(mastering.replacement_info(root, copied.name))
            mastering.delete_info(root, renamed.name)
            self.assertFalse(mastering.replacement_info(root, renamed.name))

    def test_stale_art_is_not_attached_to_an_unrelated_upload(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder); source = root / 'track.wav'; source.write_bytes(b'old')
            image = io.BytesIO(); Image.new('RGB', (8, 8), 'red').save(image, 'PNG')
            art.save(root, source.name, image.getvalue())
            source.write_bytes(b'unrelated new upload')
            old_signature = art.signature(source)
            source.write_bytes(b'master of unrelated new upload')
            art.rebind_after_replace(root, source.name, old_signature)
            self.assertIsNone(art.info(root, source.name))

    def test_corrupt_or_unrelated_patches_are_not_adopted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder); wav = root / 'track.wav'; wav.write_bytes(b'original')
            _, patch, meta = patterns.paths(root, wav.name)
            patch.parent.mkdir(); patch.write_bytes(b'original source patch')
            saved = {'wavSignature':patterns.signature(wav), 'patternSignature':patterns.signature(patch), 'sha256': hashlib.sha256(patch.read_bytes()).hexdigest()}
            meta.write_text(json.dumps(saved)); previous = patterns.signature(wav)
            wav.write_bytes(b'mastered'); patch.write_bytes(b'corrupt source patch')
            metadata_before = meta.read_bytes()
            patterns.rebind_after_replace(root, wav.name, previous)
            self.assertEqual(meta.read_bytes(), metadata_before)
            self.assertIsNone(patterns.info(root, wav.name))
            # Even an internally valid patch must match the approved prior WAV.
            patch.write_bytes(b'original source patch'); saved['patternSignature'] = patterns.signature(patch)
            meta.write_text(json.dumps(saved)); metadata_before = meta.read_bytes()
            patterns.rebind_after_replace(root, wav.name, patterns.signature(wav))
            self.assertEqual(meta.read_bytes(), metadata_before)
            self.assertIsNone(patterns.info(root, wav.name))

if __name__ == '__main__':
    unittest.main()
