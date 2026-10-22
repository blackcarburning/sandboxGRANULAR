import hashlib
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import test_song_backend as base


SONGS = base.SONGS


class SongManifestTests(unittest.TestCase):
    setUp = base.SongBackendTests.setUp
    tearDown = base.SongBackendTests.tearDown
    request = base.SongBackendTests.request
    create = base.SongBackendTests.create
    upload = base.SongBackendTests.upload
    reuse = base.SongBackendTests.reuse

    def manifest(self, song, index=0, key='a' * 64, digest=None):
        part = song['parts'][index]
        return self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}/manifest?sha256={digest or part["sha256"]}', key=key)

    def test_manifest_is_hash_bound_small_read_only_and_shared_by_reused_occurrences(self):
        song = self.reuse(self.upload(self.create()))
        folder = SONGS.SONGS_ROOT / song['id']
        before = {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
        with patch.object(SONGS, 'validate_part_zip', wraps=SONGS.validate_part_zip) as validate:
            first = self.manifest(song)
            second = self.manifest(song, 1)
            self.assertEqual(first.status, 200)
            self.assertEqual(first.response, second.response)
            self.assertEqual(validate.call_count, 1)
        self.assertEqual(first.response['format'], 'mygrain-song-part-manifest')
        self.assertEqual(first.response['version'], 1)
        self.assertEqual(first.response['sourceSha256'], song['parts'][0]['sha256'])
        self.assertEqual(first.response['snapshot']['format'], 'mygrain-song-part')
        self.assertEqual(first.response_headers['Cache-Control'], 'no-store')
        self.assertEqual(before, {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob('*') if p.is_file()})
        self.assertEqual(self.request('GET').response['features']['partManifests'], 1)

    def test_foreign_library_stale_hash_and_invalid_asset_paths_cannot_use_cached_metadata(self):
        song = self.upload(self.create())
        self.assertEqual(self.manifest(song).status, 200)
        self.assertEqual(self.manifest(song, key='b' * 64).status, 404)
        self.assertEqual(self.manifest(song, digest='b' * 64).status, 409)
        folder = SONGS.SONGS_ROOT / song['id']
        for filename in ['../outside.zip', 'bad.json']:
            with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, 'Invalid part asset'):
                SONGS.read_part_manifest(folder, {**song['parts'][0], 'archive': filename})

    def test_amendment_and_cache_warming_do_not_reuse_metadata_from_an_older_hash(self):
        song = self.upload(self.create())
        first = self.manifest(song).response
        part = song['parts'][0]
        body = base.rewrite_part(base.part_zip(), lambda s: s['state'].update({'globalBpm': '100'}))
        updated = self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/save?sha256={part["sha256"]}', body=body)
        self.assertEqual(updated.status, 200)
        newer = updated.response['song']
        self.assertEqual(self.manifest(newer, digest=part['sha256']).status, 409)
        manifest = self.manifest(newer)
        self.assertEqual(manifest.status, 200)
        self.assertNotEqual(manifest.response['sourceSha256'], first['sourceSha256'])
        self.assertEqual(manifest.response['snapshot']['state']['globalBpm'], '100')

    def test_cached_metadata_is_invalidated_by_on_disk_corruption_even_with_preserved_mtime(self):
        import os
        song = self.upload(self.create())
        self.assertEqual(self.manifest(song).status, 200)
        path = SONGS.SONGS_ROOT / song['id'] / 'parts' / (song['parts'][0]['id'] + '.zip')
        stat = path.stat()
        data = bytearray(path.read_bytes()); data[80] ^= 1; path.write_bytes(data)
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        bad = self.manifest(song)
        self.assertEqual(bad.status, 400)
        self.assertIn('integrity check failed', bad.response['error'])

    def test_manifest_checks_audio_crc_and_dimensions_not_just_json_or_outer_hash(self):
        song = self.upload(self.create())
        folder = SONGS.SONGS_ROOT / song['id']
        part = song['parts'][0]
        path = folder / 'parts' / (part['id'] + '.zip')
        body = base.rewrite_part(path.read_bytes(), lambda s: s['assets'][0].update({'frames': 123456}))
        path.write_bytes(body)
        # Even if an outer hash matches, bad saved WAV dimensions fail closed.
        with self.assertRaisesRegex(ValueError, 'dimensions do not match'):
            SONGS.read_part_manifest(folder, {**part, 'sha256': hashlib.sha256(body).hexdigest()})

    def test_metadata_cache_is_bounded_and_isolated_by_file_identity(self):
        song = self.upload(self.create())
        part = song['parts'][0]
        folder = SONGS.SONGS_ROOT / song['id']
        self.assertEqual(self.manifest(song).status, 200)
        with tempfile.TemporaryDirectory() as other:
            target = pathlib.Path(other); (target / 'parts').mkdir()
            # Identical part IDs/hashes in another account never inherit a
            # cache entry without verifying that account's actual archive.
            (target / 'parts' / (part['id'] + '.zip')).write_bytes(b'broken')
            with self.assertRaisesRegex(ValueError, 'integrity check failed'):
                SONGS.read_part_manifest(target, part)
        with patch.object(SONGS, 'PART_MANIFEST_CACHE_BYTES', 1):
            with SONGS.PART_MANIFEST_CACHE_LOCK:
                SONGS.PART_MANIFEST_CACHE.clear()
            self.assertEqual(self.manifest(song).status, 200)
            self.assertEqual(len(SONGS.PART_MANIFEST_CACHE), 0)


if __name__ == '__main__':
    unittest.main()
