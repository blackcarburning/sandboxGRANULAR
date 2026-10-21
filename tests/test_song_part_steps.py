import unittest
import test_song_backend as backend

SONGS = backend.SONGS


class PartStepsTests(unittest.TestCase):
    setUp = backend.SongBackendTests.setUp
    tearDown = backend.SongBackendTests.tearDown
    request = backend.SongBackendTests.request
    create = backend.SongBackendTests.create
    reuse = backend.SongBackendTests.reuse

    def fixture(self):
        song = self.create()
        self.base = f'/api/songs/{song["id"]}'
        body = backend.rewrite_part(backend.part_zip(64), lambda s: s['extra'].update(patternCycleMultiplier=2))
        song = self.request('POST', self.base + '/parts?name=Long', body=body).response['song']
        return self.reuse(song), body

    def arrange(self, song, values):
        parts = [{**p, 'playbackSteps': v} for p, v in zip(song['parts'], values)]
        return self.request('POST', self.base + '/arrange', payload={'parts': parts})

    def test_cut_is_per_occurrence_preserves_audio_and_survives_reload_and_restore(self):
        song, body = self.fixture()
        original = song['parts'][0]
        render = backend.render_wav({**original, 'patternSteps': 128})
        song = self.request('POST', self.base + f'/parts/{original["id"]}/render?sha256={original["sha256"]}', body=render).response['song']
        saved = self.arrange(song, [31, 95]).response['song']
        self.assertEqual([p['playbackSteps'] for p in saved['parts']], [31, 95])
        for p in saved['parts']:
            self.assertEqual(p['patternSteps'], 64)
            self.assertEqual(p['sha256'], original['sha256'])
            self.assertEqual(self.request('GET', self.base + f'/parts/{p["id"]}').wfile.getvalue(), body)
            self.assertEqual(self.request('GET', self.base + f'/parts/{p["id"]}/render').wfile.getvalue(), render)
        self.assertEqual(self.request('GET', self.base).response['song'], saved)
        restored = self.arrange(saved, [128, 95]).response['song']
        self.assertEqual([p['playbackSteps'] for p in restored['parts']], [128, 95])
        self.assertEqual(restored['parts'][0]['render'], saved['parts'][0]['render'])

    def test_source_cut_does_not_implicitly_cut_legacy_reference_and_old_arrange_preserves_trim(self):
        song, _ = self.fixture()
        parts = [{**song['parts'][0], 'playbackSteps': 32}, song['parts'][1]]
        saved = self.request('POST', self.base + '/arrange', payload={'parts': parts}).response['song']
        self.assertEqual([p['playbackSteps'] for p in saved['parts']], [32, 128])
        old = [{'id': p['id'], 'name': p['name'], 'repeats': 2} for p in saved['parts']]
        saved = self.request('POST', self.base + '/arrange', payload={'parts': old}).response['song']
        self.assertEqual([p['playbackSteps'] for p in saved['parts']], [32, 128])

    def test_reuse_and_full_copy_keep_the_selected_occurrence_cut_but_remain_independent(self):
        song, _ = self.fixture()
        song = self.arrange(song, [32, 95]).response['song']
        occurrence = song['parts'][1]
        copied = self.request('POST', self.base + f'/parts/{occurrence["id"]}/full-copy?sha256={occurrence["sha256"]}').response['song']
        self.assertEqual(copied['parts'][-1]['playbackSteps'], 95)
        self.assertNotIn('sourcePartId', copied['parts'][-1])
        reused = self.request('POST', self.base + f'/parts/{occurrence["id"]}/reuse?sha256={occurrence["sha256"]}').response['song']
        self.assertEqual(reused['parts'][-1]['playbackSteps'], 95)
        self.assertEqual([p['playbackSteps'] for p in reused['parts'][:2]], [32, 95])

    def test_invalid_values_or_forged_source_length_reject_atomically(self):
        song, _ = self.fixture()
        for value in [0, -1, 129, 1.5, True, '32', None]:
            with self.subTest(value=value):
                result = self.arrange(song, [value, 128])
                self.assertEqual(result.status, 400)
                self.assertEqual(self.request('GET', self.base).response['song'], song)
        forged = [{**p, 'patternSteps': 512, 'patternCycleMultiplier': 8, 'playbackSteps': 129} for p in song['parts']]
        self.assertEqual(self.request('POST', self.base + '/arrange', payload={'parts': forged}).status, 400)

    def test_amendment_preserves_cuts_and_follows_full_length_without_losing_previous_history(self):
        song, _ = self.fixture()
        song = self.arrange(song, [31, 128]).response['song']
        original = song['parts'][0]
        saved = self.request('POST', self.base + f'/parts/{original["id"]}/save?sha256={original["sha256"]}', body=backend.part_zip(16)).response['song']
        self.assertEqual([p['playbackSteps'] for p in saved['parts']], [16, 16])
        _, raw = SONGS.read_song(song['id'], SONGS.owner_hash({'X-Mygrain-Song-Key': 'a' * 64}))
        self.assertEqual(raw['history'][-1]['playbackSteps'], 31)
        body = backend.rewrite_part(backend.part_zip(64), lambda s: s['extra'].update(patternCycleMultiplier=2))
        original = saved['parts'][0]
        saved = self.request('POST', self.base + f'/parts/{original["id"]}/save?sha256={original["sha256"]}', body=body).response['song']
        self.assertEqual([p['playbackSteps'] for p in saved['parts']], [128, 128])
