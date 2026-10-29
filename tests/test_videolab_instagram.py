import copy
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'backend' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
LAB = load('instagram_lab', 'mygrain_videolab.py')
WORKER = load('instagram_worker', 'videolab_worker.py')
REEL = 'Chunk8-jurw'
URL = 'https://www.instagram.com/reel/' + REEL + '/'
def media(**overrides):
    return {'id': REEL, 'title': 'Public Reel fixture', 'duration': 5.016, 'protocol': 'https',
            'ext': 'mp4', 'url': 'https://scontent-lhr8-1.cdninstagram.com/video.mp4', **overrides}

class InstagramTests(unittest.TestCase):
    def test_source_url_canonicalizes_mobile_share_links_only(self):
        for url in (URL, URL + '?igsh=abc&utm_source=share', 'https://instagram.com/reels/' + REEL, 'https://m.instagram.com/reel/' + REEL + '/'):
            self.assertEqual(LAB.source_url(url, True), (URL, REEL, 0))
        for url in ('http://www.instagram.com/reel/' + REEL, 'https://instagram.com.evil/reel/' + REEL,
                    'https://www.instagram.com:443/reel/' + REEL, 'https://www.instagram.com/profile/',
                    'https://www.instagram.com/stories/person/123', URL + 'extra', URL + '#x',
                    'https://www.instagram.com/reel/' + 'a'*29, 'https://www.instagram.com/p/' + REEL):
            with self.subTest(url=url), self.assertRaises(ValueError): LAB.source_url(url, True)

    def test_instagram_cdn_has_strict_suffix_and_login_redirect_stops(self):
        for url in (URL, 'https://i.instagram.com/api/v1/foo', 'https://scontent-lhr8-1.cdninstagram.com/v.mp4', 'https://video.xx.fbcdn.net/v.mp4'):
            WORKER.checked_target(url)
        for url in ('https://evil.cdninstagram.com.attacker.test/x', 'https://fbcdn.net/x', 'https://127.0.0.1/x', 'http://video.xx.fbcdn.net/x'):
            with self.subTest(url=url), self.assertRaises(ValueError): WORKER.checked_target(url)
        with self.assertRaises(WORKER.AccessRequired): WORKER.checked_target('https://www.instagram.com/accounts/login/?next=secret')
        with self.assertRaises(WORKER.AccessRequired): WORKER.QuietLogger().warning('Main webpage is locked behind the login page')

    def test_muxed_reel_audio_and_audio_only_selection(self):
        muxed = media(format_id='mp4', vcodec='h264')
        audio = media(format_id='audio', vcodec='none', acodec='aac', ext='m4a')
        self.assertEqual(list(WORKER.instagram_audio_format({'formats': [muxed]})), [muxed])
        self.assertEqual(list(WORKER.instagram_audio_format({'formats': [muxed, audio]})), [audio])
        for bad in ({'acodec':'none'}, {'protocol':'m3u8_native'}, {'has_drm':True}, {'url':'https://rr1.googlevideo.com/v.mp4'}, {'filesize':WORKER.MAX_BYTES+1}, {'requested_formats':[{}]}, {'fragments':[{}]}):
            with self.subTest(bad=bad), self.assertRaises(ValueError): WORKER.checked_instagram_format(media(**bad))

    def test_silent_reels_have_distinct_no_soundtrack_error(self):
        with self.assertRaises(WORKER.NoSoundtrack):
            list(WORKER.instagram_audio_format({'formats': [media(acodec='none')]}))

    def test_no_private_live_playlist_or_invalid_metadata_download(self):
        self.assertEqual(WORKER.checked_instagram_metadata(media(), REEL, 0), 5.016)
        self.assertIsNone(WORKER.checked_instagram_metadata(media(duration=None), REEL, 0))
        for bad in ({'id':'other'}, {'availability':'private'}, {'availability':'needs_auth'}, {'age_limit':18}, {'_type':'playlist'}, {'is_live':True}, {'duration':float('nan')}, {'duration':False}):
            with self.subTest(bad=bad), self.assertRaises(ValueError): WORKER.checked_instagram_metadata(media(**bad), REEL, 0)
        with self.assertRaises(ValueError): WORKER.checked_instagram_metadata(media(), REEL, 6)

    def test_acquire_uses_public_reel_and_validates_before_download(self):
        extractor = Mock()
        extractor.extract_info.return_value = media()
        context = Mock(__enter__=Mock(return_value=extractor), __exit__=Mock(return_value=False))
        with tempfile.TemporaryDirectory() as temp:
            work = pathlib.Path(temp)
            extractor.process_info.side_effect = lambda info: (work / 'source.mp4').write_bytes(b'fixture media')
            with patch.object(WORKER, 'downloader_class', return_value=Mock(return_value=context)) as factory, patch.object(WORKER, 'decode') as decode:
                result = WORKER.acquire(work, REEL, 1, 10, 'instagram')
            self.assertEqual(result['videoId'], REEL)
            extractor.extract_info.assert_called_once_with(URL, download=False)
            decode.assert_called_once_with(work/'source.mp4', work/'audio.wav', 1, 4.016)
            options = factory.return_value.call_args.args[0]
            self.assertIs(options['format'], WORKER.instagram_audio_format)
            self.assertFalse(options.get('cookiefile'))
            self.assertFalse(options.get('username'))
        extractor.extract_info.return_value = media(availability='private')
        extractor.process_info.reset_mock()
        with patch.object(WORKER, 'downloader_class', return_value=Mock(return_value=context)), self.assertRaises(ValueError): WORKER.acquire(pathlib.Path('/unused'), REEL, 0, 10, 'instagram')
        extractor.process_info.assert_not_called()

    def test_real_installed_ytdlp_accepts_muxed_format_without_codec_metadata(self):
        with WORKER.downloader_class()({'format':WORKER.instagram_audio_format, 'quiet':True, 'cachedir':False}) as extractor:
            extractor.urlopen = Mock(side_effect=AssertionError('offline fixture only'))
            result = extractor.process_ie_result({'id':REEL,'title':'Reel fixture','duration':5.016,'formats':[media(format_id='mp4')]}, download=False)
            self.assertEqual(WORKER.checked_instagram_metadata(result, REEL, 0), 5.016)
            extractor.urlopen.assert_not_called()

if __name__ == '__main__': unittest.main()
