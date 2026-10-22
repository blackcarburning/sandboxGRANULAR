import math
import unittest
import test_song_backend as backend

SONGS = backend.SONGS


def roll(length=128):
    return {'version': 1, 'length': length, 'pattern': [False] * (length - 1) + [True], 'ratchets': [0] * (length - 1) + [4]}


def part(length=128, base=16, cycle=None):
    def mutate(snapshot):
        snapshot['state']['modes'].update(drumMachineEnabled=True, drumMachineRoll=roll(length))
        snapshot['extra']['patternCycleMultiplier'] = cycle if cycle is not None else math.lcm(base, length) // base
    return backend.rewrite_part(backend.part_zip(base), mutate)


class DrumRollValidation(unittest.TestCase):
    def test_arbitrary_integer_lengths_capture_the_complete_combined_cycle(self):
        for base, length, cycle in [(16, 128, 8), (64, 128, 2), (16, 24, 3), (64, 24, 3), (8, 1024, 128), (16, 1, 1)]:
            with self.subTest(base=base, length=length):
                self.assertEqual(SONGS.validate_part_zip(part(length, base))['patternCycleMultiplier'], cycle)
                slow = math.lcm(base * 8, length) // base
                self.assertEqual(SONGS.validate_part_zip(part(length, base, slow))['patternCycleMultiplier'], slow)
        with self.assertRaisesRegex(ValueError, 'cycle length'):
            SONGS.validate_part_zip(part(128, 16, 1))

    def test_roll_format_rejects_corrupt_lengths_notes_and_ratchets(self):
        for field, value in [('version', True), ('length', 0), ('length', 1025), ('length', '128'), ('pattern', [True]), ('ratchets', [0] * 127 + [9]), ('ratchets', [0] * 127 + [True])]:
            body = backend.rewrite_part(part(), lambda s: s['state']['modes']['drumMachineRoll'].update({field: value}))
            with self.subTest(field=field, value=str(value)[:20]), self.assertRaisesRegex(ValueError, 'Roll pattern'):
                SONGS.validate_part_zip(body)

    def test_disabled_and_empty_roll_keep_legacy_cycle_semantics(self):
        for mutation in [lambda s: s['state']['modes'].update(drumMachineEnabled=False), lambda s: s['state']['modes']['drumMachineRoll'].update(pattern=[False] * 128)]:
            def change(snapshot):
                mutation(snapshot)
                snapshot['extra']['patternCycleMultiplier'] = 1
            self.assertEqual(SONGS.validate_part_zip(backend.rewrite_part(part(), change))['patternCycleMultiplier'], 1)


class DrumRollPersistence(unittest.TestCase):
    setUp = backend.SongBackendTests.setUp
    tearDown = backend.SongBackendTests.tearDown
    request = backend.SongBackendTests.request
    create = backend.SongBackendTests.create

    def test_server_freeze_retains_the_full_128_steps_and_roll_marker(self):
        song = self.create()
        base = f'/api/songs/{song["id"]}'
        song = self.request('POST', base + '/parts?name=Roll', body=part()).response['song']
        saved = song['parts'][0]
        self.assertEqual(saved['patternCycleMultiplier'], 8)
        path = base + f'/parts/{saved["id"]}/render?sha256={saved["sha256"]}'
        full = backend.render_wav({**saved, 'patternSteps': 128})
        result = self.request('POST', path + '&drumroll=1&drumsample=1', body=full)
        self.assertEqual(result.status, 200)
        freeze = result.response['song']['parts'][0]['render']
        self.assertEqual(freeze['frames'], 16 * 8000)
        self.assertEqual(freeze['drumRollVersion'], 1)
        self.assertEqual(freeze['drumSampleVersion'], 1)
        self.assertEqual(self.request('GET', '/api/songs').response['features']['drumRollRenders'], 1)
        self.assertEqual(self.request('POST', path + '&drumroll=2', body=full).status, 400)
        self.assertEqual(self.request('POST', path + '&drumroll=1', body=backend.render_wav(saved)).status, 400)
        self.assertEqual(self.request('GET', base).response['song']['parts'][0]['render'], freeze)


if __name__ == '__main__':
    unittest.main()
