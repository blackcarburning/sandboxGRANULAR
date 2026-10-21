import unittest
import test_song_backend as backend

SONGS = backend.SONGS

class FullPatternTests(unittest.TestCase):
    def test_new_cycle_duration_retains_grid_and_validates_the_full_render(self):
        for cycle in (1, 2, 4, 8):
            with self.subTest(cycle=cycle):
                body = backend.rewrite_part(backend.part_zip(64), lambda s: s['extra'].update(patternCycleMultiplier=cycle))
                details = SONGS.validate_part_zip(body)
                self.assertEqual(details['patternSteps'], 64)
                self.assertEqual(details['patternCycleMultiplier'], cycle)
                part = {**details, 'sha256': 'a' * 64}
                full = backend.render_wav({**part, 'patternSteps':64 * cycle})
                self.assertEqual(SONGS.validate_render(full, part)['frames'], 8 * cycle * 8000)
                if cycle > 1:
                    with self.assertRaisesRegex(ValueError, 'exactly one saved pattern'):
                        SONGS.validate_render(backend.render_wav(part), part)

    def test_legacy_duration_is_not_reinterpreted_and_invalid_cycles_reject(self):
        self.assertEqual(SONGS.validate_part_zip(backend.part_zip())['patternCycleMultiplier'], 1)
        for value in (0, 3, 16, '2', True, None):
            body = backend.rewrite_part(backend.part_zip(), lambda s: s['extra'].update(patternCycleMultiplier=value))
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'cycle length'):
                SONGS.validate_part_zip(body)


class FullPatternPersistenceTests(unittest.TestCase):
    setUp = backend.SongBackendTests.setUp
    tearDown = backend.SongBackendTests.tearDown
    request = backend.SongBackendTests.request
    create = backend.SongBackendTests.create
    reuse = backend.SongBackendTests.reuse

    def test_new_reused_copied_and_amended_parts_preserve_or_reset_the_cycle(self):
        song = self.create()
        base = f'/api/songs/{song["id"]}'
        body = backend.rewrite_part(backend.part_zip(64), lambda s: s['extra'].update(patternCycleMultiplier=2))
        song = self.request('POST', base + '/parts?name=Long', body=body).response['song']
        original = song['parts'][0]
        self.assertEqual((original['patternSteps'], original['patternCycleMultiplier']), (64, 2))
        song = self.reuse(song)
        self.assertEqual(song['parts'][1]['patternCycleMultiplier'], 2)
        copied = self.request('POST', base + f'/parts/{original["id"]}/full-copy?sha256={original["sha256"]}').response['song']['parts'][-1]
        self.assertEqual((copied['patternSteps'], copied['patternCycleMultiplier']), (64, 2))
        changed = self.request('POST', base + f'/parts/{original["id"]}/save?sha256={original["sha256"]}', body=backend.part_zip(16)).response['song']
        self.assertEqual([(p['patternSteps'], p['patternCycleMultiplier']) for p in changed['parts']], [(16, 1), (16, 1), (64, 2)])
        self.assertEqual(self.request('GET', base).response['song'], changed)
