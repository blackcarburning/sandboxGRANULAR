import io
import unittest
from PIL import Image
from test_mygrain_accounts import AccountHTTPTests, wav_bytes, SERVER


class ArtworkTests(unittest.TestCase):
    setUp = AccountHTTPTests.setUp
    tearDown = AccountHTTPTests.tearDown
    success = AccountHTTPTests.success
    def test_artwork_lifecycle_and_isolation(self):
        name = self.success(self.admin, 'POST', '/mygrain-wavs/api/upload', body=wav_bytes(), headers={'X-Filename': 'art.wav'})['savedName']
        data = io.BytesIO()
        Image.new('RGBA', (1600, 800), (100, 30, 220, 120)).save(data, 'PNG')
        art = self.success(self.admin, 'POST', '/mygrain-wavs/api/art?filename=' + name, body=data.getvalue())['artwork']
        self.assertEqual((art['width'], art['height']), (768, 384))
        self.assertLessEqual(art['size'], 128 * 1024)
        self.assertLessEqual(art['thumbnailSize'], 8192)
        body = self.success(self.admin, 'GET', art['url'])
        image = Image.open(io.BytesIO(body))
        self.assertEqual(image.format, 'WEBP')
        self.assertEqual(image.size, (768, 384))
        self.assertEqual(Image.open(io.BytesIO(self.success(self.admin, 'GET', art['thumbnailUrl']))).size, (96, 48))
        self.assertEqual(self.dan.request('GET', art['url'])[0], 401)
        self.assertEqual(self.anonymous.request('GET', art['url'])[0], 401)
        self.assertEqual(self.admin.request('GET', art['url'] + '&mygrainUser=dan')[0], 401)
        self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/art?filename=../art.wav', body=data.getvalue())[0], 400)
        self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/art?filename=' + name, body=b'<svg/>')[0], 400)
        self.assertEqual(self.admin.request('POST', '/mygrain-wavs/api/art?filename=' + name, body=b'x' * (2*1024*1024+1))[0], 400)
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain-wavs/api/list')['files'][0]['artwork'], art)
        self.assertEqual(self.success(self.admin, 'GET', '/mygrain-wavs/' + name), wav_bytes())
        renamed = self.success(self.admin, 'POST', '/mygrain-wavs/api/rename', data={'from': name, 'to': 'renamed.wav'})['savedName']
        renamed_art = self.success(self.admin, 'GET', '/mygrain-wavs/api/list')['files'][0]['artwork']
        self.assertIn('renamed.wav', renamed_art['url'])
        self.assertEqual(self.success(self.admin, 'GET', renamed_art['url']), body)
        shared = self.success(self.admin, 'POST', '/mygrain-wavs/api/share', data={'filename': renamed, 'username': 'dan'})['share']
        recipient_art = self.success(self.dan, 'GET', '/mygrain-wavs/api/list')['files'][0]['artwork']
        self.assertEqual(self.success(self.dan, 'GET', recipient_art['url']), body)
        self.success(self.admin, 'DELETE', '/mygrain-wavs/api/delete?filename=' + renamed)
        self.assertEqual(self.admin.request('GET', renamed_art['url'])[0], 404)
        self.assertEqual(self.success(self.dan, 'GET', recipient_art['url']), body)
        # Replacing audio must never carry unrelated artwork onto the new render.
        root = self.accounts.path_for('wavs', self.accounts.lookup_user('dan'))
        (root / shared['recipientFilename']).write_bytes(wav_bytes(value=9))
        self.assertNotIn('artwork', self.success(self.dan, 'GET', '/mygrain-wavs/api/list')['files'][0])

    def test_dense_artwork_has_hard_size_limits(self):
        import random
        self.success(self.admin, 'POST', '/mygrain-wavs/api/upload', body=wav_bytes(), headers={'X-Filename': 'dense.wav'})
        image = Image.frombytes('RGB', (768, 768), random.Random(17).randbytes(768 * 768 * 3))
        buffer = io.BytesIO()
        image.save(buffer, 'PNG')
        art = self.success(self.admin, 'POST', '/mygrain-wavs/api/art?filename=dense.wav', body=buffer.getvalue())['artwork']
        self.assertLessEqual(art['size'], 128 * 1024)
        self.assertLessEqual(art['thumbnailSize'], 8192)
        self.assertLessEqual(art['width'], 768)
        self.assertGreater(art['width'], 0)
        original = self.success(self.admin, 'GET', art['url'])
        self.assertNotEqual(original, buffer.getvalue())
        self.assertEqual(len(original), art['size'])


if __name__ == '__main__':
    unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ArtworkTests))
