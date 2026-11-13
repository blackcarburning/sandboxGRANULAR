"""Dropbox is an additive standard FX lane, not a migration of old audio."""
import copy
import itertools
import unittest
from test_song_backend import SONGS


class DropboxLoopFxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = SONGS.convert_fx_snapshot({'state': {'modes': {}}, 'assets': [], 'extra': {}})['snapshot']['state']['modes']['loopFx']

    def test_historical_and_new_optional_channel_shapes_are_accepted(self):
        self.assertIn('sample', self.current['channels'])
        for selected in itertools.product((False, True), repeat=3):
            chosen = {key for key, on in zip(('D', 'N', 'sample'), selected) if on}
            fx = copy.deepcopy(self.current)
            fx['channels'] = {key: channel for key, channel in fx['channels'].items() if key not in ('D', 'N', 'sample') or key in chosen}
            SONGS.validate_loop_fx(fx)

    def test_unknown_or_incomplete_channel_sets_are_rejected(self):
        bad = copy.deepcopy(self.current)
        bad['channels']['unknown'] = bad['channels']['sample']
        with self.assertRaises(ValueError):
            SONGS.validate_loop_fx(bad)
        del bad['channels']['unknown']
        del bad['channels']['A']
        with self.assertRaises(ValueError):
            SONGS.validate_loop_fx(bad)

    def test_old_standard_archives_do_not_need_a_dry_channel_migration(self):
        old = copy.deepcopy(self.current)
        del old['channels']['sample']
        snapshot = {'state': {'modes': {'loopFx': old}}, 'assets': [], 'extra': {}}
        converted = SONGS.convert_fx_snapshot(snapshot)
        self.assertFalse(converted['changed'])
        self.assertEqual(converted['snapshot'], snapshot)


if __name__ == '__main__':
    unittest.main()
