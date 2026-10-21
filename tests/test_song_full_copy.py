import unittest
from unittest.mock import patch

import test_song_backend as backend
from test_song_loop_copy import complete_part

SONGS = backend.SONGS


class FullCopyTests(unittest.TestCase):
    setUp = backend.SongBackendTests.setUp
    tearDown = backend.SongBackendTests.tearDown
    request = backend.SongBackendTests.request
    create = backend.SongBackendTests.create
    reuse = backend.SongBackendTests.reuse

    def fixture(self, rendered=True):
        song = self.create()
        body = complete_part(2)
        song = self.request('POST', f'/api/songs/{song["id"]}/parts?name=Intro&repeats=2', body=body).response['song']
        part = song['parts'][0]
        self.base = f'/api/songs/{song["id"]}'
        if rendered:
            song = self.request('POST', self.base + f'/parts/{part["id"]}/render?sha256={part["sha256"]}&q=7&portable=1&keyboard=1&grain=1', body=backend.render_wav(part)).response['song']
        self.folder = SONGS.SONGS_ROOT / song['id']
        return song, body

    def duplicate(self, song, index=0):
        part = song['parts'][index]
        return self.request('POST', f'/api/songs/{song["id"]}/parts/{part["id"]}/full-copy?sha256={part["sha256"]}')

    def asset(self, part, action=''):
        return self.request('GET', self.base + f'/parts/{part["id"]}' + ('/' + action if action else '')).wfile.getvalue()

    def test_full_copy_has_independent_id_archive_render_and_identical_complete_audio(self):
        song, body = self.fixture()
        original = song['parts'][0]
        result = self.duplicate(song)
        self.assertEqual(result.status, 201)
        saved = result.response['song']
        copied = saved['parts'][-1]
        self.assertEqual(saved['parts'][:-1], song['parts'])
        self.assertEqual(saved['revision'], song['revision'] + 1)
        self.assertEqual(result.response['partId'], copied['id'])
        self.assertNotEqual(copied['id'], original['id'])
        self.assertNotIn('sourcePartId', copied)
        self.assertEqual(copied['name'], 'Intro_full_copy')
        self.assertEqual((copied['repeats'], copied['revision']), (2, 1))
        self.assertEqual(self.asset(copied), body)
        self.assertEqual(self.asset(copied, 'render'), self.asset(original, 'render'))
        self.assertNotEqual(copied['render']['file'], original['render']['file'])
        self.assertNotEqual((self.folder / 'parts' / copied['archive']).stat().st_ino,
                            (self.folder / 'parts' / f'{original["id"]}.zip').stat().st_ino)
        for key in ('sha256', 'contentSha256', 'bpm', 'patternSteps', 'qVersion'):
            self.assertEqual(copied[key], original[key])
        self.assertEqual(self.request('GET', self.base).response['song'], saved)

    def test_copying_reused_occurrence_keeps_its_repeats_but_not_its_shared_identity(self):
        song, _ = self.fixture()
        song = self.reuse(song)
        song['parts'][1]['repeats'] = 7
        song = self.request('POST', self.base + '/arrange', payload={'parts': song['parts']}).response['song']
        song = self.request('POST', self.base + f'/parts/{song["parts"][0]["id"]}/colour?sha256={song["parts"][0]["sha256"]}', payload={'colour': '#123456'}).response['song']
        saved = self.duplicate(song, 1).response['song']
        copied = saved['parts'][-1]
        self.assertEqual((copied['repeats'], copied['colour']), (7, '#123456'))
        self.assertNotIn('sourcePartId', copied)
        self.assertEqual(saved['parts'][:-1], song['parts'])
        self.assertEqual(self.asset(copied), self.asset(song['parts'][1]))

    def test_amending_copy_then_original_changes_neither_other_part_nor_its_render(self):
        song, original_body = self.fixture()
        song = self.reuse(song)
        saved = self.duplicate(song).response['song']
        copied = saved['parts'][-1]
        changed = self.request('POST', self.base + f'/parts/{copied["id"]}/save?sha256={copied["sha256"]}&name=Independent&repeats=4', body=complete_part(3)).response['song']
        self.assertEqual(changed['parts'][:-1], song['parts'])
        for part in changed['parts'][:-1]:
            self.assertEqual(self.asset(part), original_body)
            self.assertEqual(self.asset(part, 'render'), backend.render_wav(song['parts'][0]))
        self.assertEqual(changed['parts'][-1]['name'], 'Independent')
        copy_after = changed['parts'][-1]
        original = changed['parts'][0]
        again = self.request('POST', self.base + f'/parts/{original["id"]}/save?sha256={original["sha256"]}&name=OriginalChanged', body=complete_part(4)).response['song']
        self.assertEqual(again['parts'][-1], copy_after)
        self.assertEqual(self.asset(copy_after), complete_part(3))
        self.assertEqual([part['name'] for part in again['parts']], ['OriginalChanged', 'OriginalChanged', 'Independent'])

    def test_copy_survives_original_deletion_and_long_names_keep_the_suffix(self):
        song, body = self.fixture(False)
        song['parts'][0]['name'] = 'x' * 100
        song = self.request('POST', self.base + '/arrange', payload={'parts': song['parts']}).response['song']
        saved = self.duplicate(song).response['song']
        original, copied = saved['parts']
        self.assertEqual(copied['name'], 'x' * 90 + '_full_copy')
        self.assertNotIn('render', copied)
        deleted = self.request('POST', self.base + f'/parts/{original["id"]}/delete?sha256={original["sha256"]}').response['song']
        self.assertEqual(deleted['parts'], [copied])
        self.assertEqual(self.asset(copied), body)

    def test_copy_uses_current_amended_archive_and_can_itself_be_fully_copied(self):
        song, _ = self.fixture(False)
        original = song['parts'][0]
        song = self.request('POST', self.base + f'/parts/{original["id"]}/save?sha256={original["sha256"]}&name=Verse', body=complete_part(3)).response['song']
        saved = self.duplicate(song).response['song']
        copied = saved['parts'][-1]
        self.assertEqual(copied['name'], 'Verse_full_copy')
        self.assertEqual(copied['revision'], 1)
        self.assertEqual(self.asset(copied), self.asset(saved['parts'][0]))
        again = self.duplicate(saved, 1).response['song']['parts'][-1]
        self.assertEqual(again['name'], 'Verse_full_copy_full_copy')
        self.assertNotIn('sourcePartId', again)
        self.assertNotEqual(again['id'], copied['id'])
        self.assertEqual(self.asset(again), self.asset(copied))

    def test_copy_rejects_bad_hash_foreign_library_and_full_song_without_any_asset_changes(self):
        song, _ = self.fixture()
        original = song['parts'][0]
        endpoint = self.base + f'/parts/{original["id"]}/full-copy?sha256={original["sha256"]}'
        before = set((self.folder / 'parts').iterdir())
        self.assertEqual(self.request('POST', endpoint.replace(original['sha256'], '0' * 64)).status, 409)
        self.assertEqual(self.request('POST', endpoint, key='b' * 64).status, 404)
        with patch.object(SONGS, 'MAX_PARTS', 1):
            self.assertEqual(self.request('POST', endpoint).status, 400)
        self.assertEqual(set((self.folder / 'parts').iterdir()), before)
        self.assertEqual(self.request('GET', self.base).response['song'], song)

    def test_failed_manifest_write_rolls_back_both_new_assets(self):
        song, _ = self.fixture()
        before = set((self.folder / 'parts').iterdir())
        manifest = (self.folder / 'song.json').read_bytes()
        with patch.object(SONGS, 'write_song', side_effect=OSError('Disk full')):
            self.assertEqual(self.duplicate(song).status, 500)
        self.assertEqual(set((self.folder / 'parts').iterdir()), before)
        self.assertEqual((self.folder / 'song.json').read_bytes(), manifest)

    def test_failed_second_asset_write_and_lost_lease_leave_no_copy_or_orphan(self):
        song, _ = self.fixture()
        before = set((self.folder / 'parts').iterdir())
        manifest = (self.folder / 'song.json').read_bytes()
        with patch.object(SONGS.os, 'fsync', side_effect=[None, OSError('Disk full')]):
            self.assertEqual(self.duplicate(song).status, 500)
        self.assertEqual(set((self.folder / 'parts').iterdir()), before)
        with patch.object(SONGS, 'require_song_editor', side_effect=[None, SONGS.SongEditError('Lease lost')]):
            self.assertEqual(self.duplicate(song).status, 423)
        self.assertEqual(set((self.folder / 'parts').iterdir()), before)
        self.assertEqual((self.folder / 'song.json').read_bytes(), manifest)

    def test_corrupt_source_audio_or_render_never_creates_a_partial_copy(self):
        song, _ = self.fixture()
        part = song['parts'][0]
        for filename in (f'{part["id"]}.zip', part['render']['file']):
            path = self.folder / 'parts' / filename
            body = path.read_bytes()
            before = set((self.folder / 'parts').iterdir())
            path.write_bytes(body + b'corrupt')
            self.assertEqual(self.duplicate(song).status, 400)
            self.assertEqual(set((self.folder / 'parts').iterdir()), before)
            self.assertEqual(self.request('GET', self.base).response['song'], song)
            path.write_bytes(body)


if __name__ == '__main__':
    unittest.main()
