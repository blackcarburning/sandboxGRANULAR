import hashlib
import json
import os
import zipfile

from test_song_manifests import SongManifestTests, SONGS


class SongAudioAssetTests(SongManifestTests):
    # Re-run manifest guarantees for the extended JSON-only descriptor cache.
    def audio(self, song, index=0, key='bastardL', digest=None, library='a' * 64):
        part = song['parts'][index]
        return self.request('GET', f'/api/songs/{song["id"]}/parts/{part["id"]}/audio?sha256={digest or part["sha256"]}&key={key}', key=library)

    def test_sound_is_exact_hash_bound_and_reused_without_song_writes(self):
        song = self.reuse(self.upload(self.create()))
        folder = SONGS.SONGS_ROOT / song['id']
        before = {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
        manifest = self.manifest(song).response
        record = manifest['audioAssets'][0]
        self.assertEqual(record['key'], 'bastardL')
        self.assertTrue(record['pcm16'])
        self.assertEqual(self.request('GET').response['features']['partAudioAssets'], 1)
        audio = self.audio(song)
        reused = self.audio(song, 1)
        self.assertEqual(audio.status, 200)
        self.assertEqual(reused.wfile.getvalue(), audio.wfile.getvalue())
        self.assertEqual(audio.response_headers['Content-Type'], 'audio/wav')
        self.assertEqual(audio.response_headers['Cache-Control'], 'no-store')
        body = audio.wfile.getvalue()
        self.assertEqual(len(body), record['bytes'])
        self.assertEqual(hashlib.sha256(body).hexdigest(), record['sha256'])
        with zipfile.ZipFile(folder / 'parts' / (song['parts'][0]['id'] + '.zip')) as archive:
            self.assertEqual(body, archive.read(record['path']))
        self.assertEqual(before, {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob('*') if p.is_file()})

    def test_sound_rejects_foreign_library_stale_source_missing_key_and_paths(self):
        song = self.upload(self.create())
        self.manifest(song)
        self.assertEqual(self.audio(song, library='b' * 64).status, 404)
        self.assertEqual(self.audio(song, digest='b' * 64).status, 409)
        for key in ['missing', '../song-part.json', 'audio/bastardL.wav', 'song-part.json', '']:
            with self.subTest(key=key):
                self.assertEqual(self.audio(song, key=key).status, 404)

    def test_sound_refuses_corrupt_or_symlinked_archive_after_cache_warming(self):
        song = self.upload(self.create())
        self.manifest(song)
        folder = SONGS.SONGS_ROOT / song['id']
        path = folder / 'parts' / (song['parts'][0]['id'] + '.zip')
        body = path.read_bytes(); stat = path.stat()
        corrupt = bytearray(body); corrupt[-80] ^= 1; path.write_bytes(corrupt)
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        self.assertEqual(self.audio(song).status, 400)
        target = folder / 'outside.zip'; target.write_bytes(body)
        path.unlink(); path.symlink_to(target)
        self.assertEqual(self.audio(song).status, 404)
