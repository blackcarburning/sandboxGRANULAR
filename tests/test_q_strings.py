import hashlib
import json
import pathlib
import struct
import unittest
import wave
import zipfile
from io import BytesIO

from test_q_piano import SONGS


ROOT = pathlib.Path(__file__).resolve().parents[1]


def fixture():
    samples = [{'id': f'viola{midi}v96', 'midi': midi, 'velocity': 96, 'offset': index * 10,
                'frames': 10, 'loopStart': 2, 'loopEnd': 10} for index, midi in enumerate([48, 52, 55])]
    state = {'q': {'version': 1, 'instrument': 'strings', 'enabled': True, 'transpose': 0,
                   'sequence': [{'notes': [48, 52, 55], 'velocity': 96, 'gate': 4}] + [None] * 63,
                   'bank': {'version': 1, 'instrument': 'vsco2-ce-q-strings-2layer-44100-v1',
                            'sampleRate': 44100, 'samples': samples}}}
    assets = [{'key': 'bastardQ', 'channels': 2, 'frames': 30, 'sampleRate': 44100}]
    return state, assets


class QStringValidation(unittest.TestCase):
    def test_complete_string_bank_is_accepted(self):
        self.assertTrue(SONGS.validate_q_piano(*fixture()))

    def test_incorrect_instrument_section_layer_and_loop_metadata_are_rejected(self):
        for mutate in [lambda state: state['q'].update(instrument='organ'),
                       lambda state: state['q'].update(instrument='piano'),
                       lambda state: state['q']['bank'].pop('instrument'),
                       lambda state: state['q']['bank']['samples'].pop(),
                       lambda state: state['q']['bank']['samples'][0].update(id='cello48v96'),
                       lambda state: state['q']['bank']['samples'][0].update(loopStart=True),
                       lambda state: state['q']['bank']['samples'][0].update(loopEnd=11),
                       lambda state: state['q']['bank']['samples'][0].pop('loopStart'),
                       lambda state: state['q']['sequence'][0].update(velocity=32)]:
            with self.subTest(mutate=mutate):
                state, assets = fixture()
                mutate(state)
                with self.assertRaises(ValueError):
                    SONGS.validate_q_piano(state, assets)

    def test_string_parts_have_version_five_metadata_even_without_reverb(self):
        for room in [0, .4]:
            state, assets = fixture()
            state.update(modes={}, patternLength=16, globalBpm=120)
            state['q']['room'] = room
            assets[0].update(path='audio/bastardQ.wav')
            snapshot = {'format': 'mygrain-song-part', 'version': 1, 'state': state,
                        'extra': {'sequencerSteps': [None] * 16}, 'assets': assets}
            audio = BytesIO()
            with wave.open(audio, 'wb') as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(b'\0\0\0\0' * 30)
            assets[0]['sha256'] = hashlib.sha256(audio.getvalue()).hexdigest()
            archive = BytesIO()
            with zipfile.ZipFile(archive, 'w') as output:
                output.writestr('song-part.json', json.dumps(snapshot))
                output.writestr('audio/bastardQ.wav', audio.getvalue())
            self.assertEqual(SONGS.validate_part_zip(archive.getvalue())['qVersion'], 5)

    def test_local_strings_are_stereo_pcm16_with_verified_hashes_and_safe_loops(self):
        repository = ROOT / 'SAMPLES_Q_STRINGS'
        manifest = json.loads((repository / 'manifest.json').read_text())
        self.assertEqual(manifest['license'], 'CC0 1.0')
        self.assertEqual(len(manifest['samples']), 34)
        for sample in manifest['samples']:
            path = repository / sample['file']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), sample['sha256'])
            with wave.open(str(path), 'rb') as audio:
                self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()), (2, 2, 44100, sample['frames']))
                pcm = audio.readframes(audio.getnframes())
            self.assertTrue(0 < sample['loopStart'] < sample['loopEnd'] <= sample['frames'])
            self.assertEqual(struct.unpack_from('<hh', pcm, len(pcm) - 4), struct.unpack_from('<hh', pcm, (sample['loopStart'] - 1) * 4))
            original = (repository / 'originals' / sample['sourceFile']).read_bytes()
            self.assertEqual(hashlib.sha1(f'blob {len(original)}\0'.encode() + original).hexdigest(), sample['sourceGitBlob'])


if __name__ == '__main__':
    unittest.main()
