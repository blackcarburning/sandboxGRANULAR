import json
import unittest
import zipfile
from io import BytesIO
from test_song_backend import SONGS, part_zip


class KMultitrackArchiveTests(unittest.TestCase):
    def archive(self, count):
        with zipfile.ZipFile(BytesIO(part_zip())) as original:
            snapshot = json.loads(original.read('song-part.json'))
            wav = original.read('audio/bastardL.wav')
        keys = ['bastardK', 'bastardKRender', 'bastardKTrack2', 'bastardKTrack3', 'bastardKTrack4', 'bastardKTrack5']
        keys += [f'otherAudio{index}' for index in range(count - len(keys))]
        snapshot['assets'] = [{'key': key, 'path': f'audio/{key}.wav', 'channels': 1, 'frames': 128, 'sampleRate': 44100} for key in keys]
        snapshot['extra'].update(freezeStateVersion=1, audioSlots={key: True for key in keys})
        output = BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('song-part.json', json.dumps(snapshot))
            for key in keys:
                archive.writestr(f'audio/{key}.wav', wav)
        return output.getvalue()

    def test_all_five_k_takes_fit_with_a_full_part_inventory(self):
        for count in [37, 40]:
            SONGS.validate_part_zip(self.archive(count))

    def test_expanded_inventory_still_has_a_hard_bound(self):
        with self.assertRaisesRegex(ValueError, 'archive entries|audio manifest'):
            SONGS.validate_part_zip(self.archive(41))
