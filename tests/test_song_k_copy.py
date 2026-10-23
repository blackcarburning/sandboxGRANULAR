"""Saved ZIP and API regression tests; no production songs are changed."""
import copy
import json
import zipfile
from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
import test_song_backend as backend
from test_song_loop_copy import drum_part, unpack

SONGS = backend.SONGS
K_KEYS = ['bastardK', 'bastardKTrack2', 'bastardKTrack3', 'bastardKTrack4', 'bastardKTrack5']


def k_part(tag, version=2, empty=()):
    with zipfile.ZipFile(BytesIO(drum_part(tag))) as archive:
        entries = {n: archive.read(n) for n in archive.namelist()}
    snapshot = json.loads(entries.pop('song-part.json'))
    modes = snapshot['state']['modes']
    modes.update(bastardLoopKEnabled=tag == 1, bastardLoopKSourceBpm=120,
                 bastardLoopKRecordingSteps=32, bastardLoopKReverse=tag == 1)
    snapshot['state']['sliders'].update(performanceBastardLoopKLevel=str(tag * 20), performanceBastardLoopKSemitone=str(tag))
    snapshot['extra']['controls'].append({'id': 'performanceBastardLoopKFilterCutoff', 'value': str(tag * 1000)})
    tracks = [dict(enabled=i != 4, level=.1 * (i + tag), mute=i == tag, pan=(i - 2) / 2,
                   steps=16 + i * 8, sourceBpm=100 + tag * 10,
                   processing=dict(semitone=tag + i, fine=tag, reverse=tag == 1, filterMode='lowpass-24', cutoff=1000 * (i + tag),
                                   resonance=1, envelope=.2, drive=tag, delayMix=.1 * tag, reverbMix=.1),
                   metadata={'sentinel': tag, 'track': i + 1, 'durationSeconds': 128 / 44100}) for i in range(5)]
    if version:
        modes['kMultitrack'] = dict(version=version, selected=tag, tracks=tracks)
    for i, key in enumerate([*K_KEYS, 'bastardKRender']):
        if (version is None and key not in ['bastardK', 'bastardKRender']) or key in empty:
            snapshot['extra']['audioSlots'][key] = False
            continue
        path = f'audio/{key}.wav'
        # Distinct valid PCM for each take and each saved part.
        body = bytearray(entries['audio/drumKick.wav']);body[-2:] = (tag * 100 + i).to_bytes(2, 'little')
        entries[path] = bytes(body)
        snapshot['assets'].append(dict(key=key, path=path, channels=1, frames=128, sampleRate=44100))
        snapshot['extra']['metadata'][key] = {'sentinel': tag, 'track': i + 1}
        snapshot['extra']['audioSlots'][key] = True
    entries['song-part.json'] = json.dumps(snapshot).encode()
    out = BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        for n, b in entries.items(): archive.writestr(n, b)
    return out.getvalue()


class KTrackCopyTests(TestCase):
    def test_each_track_keeps_all_other_settings_and_wav_bytes(self):
        source_body, target_body = k_part(1), k_part(2)
        source, sa = unpack(source_body); target, ta = unpack(target_body)
        for index in range(5):
            with self.subTest(track=index + 1):
                body = SONGS.paste_loop_archive(target_body, source_body, [f'K{index + 1}'])
                SONGS.validate_part_zip(body)
                saved, audio = unpack(body)
                expected = copy.deepcopy(target)
                expected['state']['modes']['kMultitrack']['tracks'][index] = source['state']['modes']['kMultitrack']['tracks'][index]
                self.assertEqual(saved['state'], expected['state'])
                self.assertEqual(saved['extra']['controls'], target['extra']['controls'])
                keys = {K_KEYS[index]} | ({'bastardKRender'} if index == 0 else set())
                for key in audio:
                    self.assertEqual(audio[key], (sa if key in keys else ta)[key])
                    self.assertEqual(saved['extra']['metadata'][key], (source if key in keys else target)['extra']['metadata'][key])
                self.assertEqual(saved['extra']['sequencerSteps'], target['extra']['sequencerSteps'])

    def test_multi_track_loop_and_drum_are_merged_together(self):
        saved, audio = unpack(SONGS.paste_loop_archive(k_part(2), k_part(1), ['K5', 'K1', 'V', 'M', 'drumKick', 'K5']))
        source, sa = unpack(k_part(1)); target, ta = unpack(k_part(2))
        for i in range(5):
            self.assertEqual(saved['state']['modes']['kMultitrack']['tracks'][i], (source if i in (0, 4) else target)['state']['modes']['kMultitrack']['tracks'][i])
        selected = {'bastardV', 'bastardM', 'bastardMRender', 'drumKick', 'bastardK', 'bastardKRender', 'bastardKTrack5'}
        for key in audio: self.assertEqual(audio[key], (sa if key in selected else ta)[key])
        self.assertEqual(saved['state']['globalBpm'], target['state']['globalBpm'])

    def test_empty_take_clears_only_selected_audio_and_legacy_render(self):
        for index in range(5):
            key = K_KEYS[index]; empty = [key] + (['bastardKRender'] if index == 0 else [])
            body = SONGS.paste_loop_archive(k_part(2), k_part(1, empty=empty), [f'K{index + 1}'])
            SONGS.validate_part_zip(body); saved, audio = unpack(body)
            for item in empty:
                self.assertNotIn(item, audio); self.assertIs(saved['extra']['audioSlots'][item], False)
                self.assertNotIn(item, saved['extra']['metadata'])
            self.assertEqual(set(audio) & set(K_KEYS), set(K_KEYS) - {key})

    def test_legacy_source_and_destination_migrate_on_server_preserving_unselected_audio(self):
        for source_version, destination_version in [(None, 2), (1, 2), (2, None), (2, 1)]:
            with self.subTest(source=source_version, destination=destination_version):
                sb, tb = k_part(1, source_version), k_part(2, destination_version)
                saved, audio = unpack(SONGS.paste_loop_archive(tb, sb, ['K1']))
                source = SONGS.convert_k_snapshot(unpack(sb)[0])['snapshot']
                target = SONGS.convert_k_snapshot(unpack(tb)[0])['snapshot']
                expected = copy.deepcopy(target['state']['modes']['kMultitrack'])
                expected['tracks'][0] = source['state']['modes']['kMultitrack']['tracks'][0]
                self.assertEqual(saved['state']['modes']['kMultitrack'], expected)
                self.assertEqual(saved['state']['modes']['bastardLoopKEnabled'], False)
                for key, value in unpack(tb)[1].items():
                    self.assertEqual(audio[key], unpack(sb)[1][key] if key in ('bastardK', 'bastardKRender') else value)
                SONGS.validate_part_zip(SONGS.paste_loop_archive(tb, sb, ['K1']))

    def test_legacy_missing_k5_clears_destination_take_without_touching_k1(self):
        saved, audio = unpack(SONGS.paste_loop_archive(k_part(2), k_part(1, None), ['K5']))
        self.assertNotIn('bastardKTrack5', audio)
        self.assertEqual(audio['bastardK'], unpack(k_part(2))[1]['bastardK'])
        self.assertIs(saved['extra']['audioSlots']['bastardKTrack5'], False)

    def test_loop_a_never_overwrites_k_master_or_legacy_processing(self):
        saved, _ = unpack(SONGS.paste_loop_archive(k_part(2), k_part(1), ['A']))
        target = unpack(k_part(2))[0]
        for section in ['modes', 'sliders']:
            for key, value in target['state'][section].items():
                if key.startswith(('bastardLoopK', 'performanceBastardLoopK', 'kMultitrack')):
                    self.assertEqual(saved['state'][section][key], value)


class KCopyEndpointTests(TestCase):
    setUp = backend.SongBackendTests.setUp
    tearDown = backend.SongBackendTests.tearDown
    request = backend.SongBackendTests.request
    create = backend.SongBackendTests.create
    reuse = backend.SongBackendTests.reuse

    def fixture(self):
        song = self.create()
        for tag in (1, 2):
            song = self.request('POST', f'/api/songs/{song["id"]}/parts?name=K{tag}&repeats={tag}', body=k_part(tag)).response['song']
        source, target = song['parts']
        copied = dict(sourceSongId=song['id'], sourcePartId=source['id'], sourceSha256=source['sha256'], layers=['V', 'K2', 'K4', 'drumKick'])
        return song, source, target, copied

    def test_api_keeps_source_history_and_shared_uses_and_invalidates_only_target_render(self):
        song, source, target, copied = self.fixture()
        base = f'/api/songs/{song["id"]}'
        song = self.reuse(song, 1)
        rendered = self.request('POST',base+f'/parts/{target["id"]}/render?sha256={target["sha256"]}&portable=1&q=8',body=backend.render_wav(target))
        self.assertEqual(rendered.status, 200, rendered.response)
        song = rendered.response['song']
        result = self.request('POST', base+f'/parts/{target["id"]}/paste-loop?sha256={target["sha256"]}', payload=copied)
        self.assertEqual(result.status, 200, result.response)
        saved = result.response['song']
        self.assertEqual(saved['revision'], song['revision'] + 1)
        self.assertEqual(saved['parts'][0], source)
        self.assertEqual(saved['parts'][1]['sha256'], saved['parts'][2]['sha256'])
        self.assertNotIn('render', saved['parts'][1])
        self.assertEqual([p['repeats'] for p in saved['parts']], [1, 2, 2])
        folder = SONGS.SONGS_ROOT / song['id'];stored = json.loads((folder/'song.json').read_text())
        self.assertEqual(len(stored['history']), 1)
        self.assertEqual(unpack((folder/'parts'/saved['parts'][1]['archive']).read_bytes())[1]['bastardKTrack2'], unpack(k_part(1))[1]['bastardKTrack2'])

    def test_server_conversion_failure_leaves_song_and_files_unchanged(self):
        song, source, target, copied = self.fixture();folder = SONGS.SONGS_ROOT/song['id']
        before = {str(p.relative_to(folder)):p.read_bytes() for p in folder.rglob('*') if p.is_file() and p.name != '.edit-lock.json'}
        with patch.object(SONGS, 'convert_k_snapshot', side_effect=ValueError('conversion unavailable')):
            result = self.request('POST', f'/api/songs/{song["id"]}/parts/{target["id"]}/paste-loop?sha256={target["sha256"]}', payload=copied)
        self.assertEqual(result.status, 400)
        for name, body in before.items(): self.assertEqual((folder/name).read_bytes(), body)
