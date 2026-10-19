import copy
import importlib.util
import math
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPECIFICATION = importlib.util.spec_from_file_location('videolab_original_audio_worker', ROOT / 'backend/videolab_worker.py')
WORKER = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(WORKER)
VIDEO = 'SK2MAymSeCY'
URL = 'https://www.youtube.com/watch?v=' + VIDEO
OLD_SELECTOR = 'worstaudio[protocol=https][vcodec=none][acodec!=none][abr>=32]/worstaudio[protocol=https][vcodec=none][acodec!=none]'


def audio(format_id, language=None, preference=-1, abr=64, **overrides):
    return {'format_id': format_id, 'language': language, 'language_preference': preference,
            'abr': abr, 'tbr': abr, 'protocol': 'https', 'vcodec': 'none', 'acodec': 'opus',
            'ext': 'webm', 'url': 'https://rr1.googlevideo.com/' + format_id,
            'filesize': 1024, 'filesize_approx': 1024, **overrides}


def metadata(formats, **overrides):
    return {'id': VIDEO, 'title': 'Original-language regression fixture', 'extractor': 'youtube',
            'extractor_key': 'Youtube', 'webpage_url': URL, 'availability': 'public', 'age_limit': 0,
            'live_status': 'not_live', 'duration': 600, 'formats': formats, **overrides}


def select(formats):
    selected = list(WORKER.original_audio_format({'formats': formats}))
    if len(selected) != 1:
        raise AssertionError('Exactly one direct audio format must be selected.')
    return selected[0]


class OriginalAudioSelectionTests(unittest.TestCase):
    def test_original_language_precedes_bitrate_in_either_language(self):
        for original_language, dubbed_language in (('en', 'de'), ('de', 'en'), ('ja', 'fr')):
            original = audio('251-original', original_language, 10, 128)
            dub = audio('249-dub', dubbed_language, 5, 40)
            for formats in ([dub, original], [original, dub]):
                with self.subTest(original=original_language, reversed=formats[0] is original):
                    self.assertIs(select(formats), original)

    def test_original_marker_works_without_language_preference(self):
        for note in ('English (original), medium', 'Deutsch ORIGINAL', '(Original)'):
            original = audio('original', 'de', None, 96, format_note=note)
            with self.subTest(note=note):
                self.assertIs(select([audio('default', 'en', 5, 32), original]), original)

    def test_original_language_is_discovered_across_formats_before_filtering(self):
        marked = audio('manifest-original', 'de', 10, 128, protocol='m3u8_native')
        eligible = audio('250-1', 'de', -1, 64)
        dub = audio('249-0', 'en', 5, 40)
        self.assertIs(select([dub, marked, eligible]), eligible)

    def test_original_language_can_be_discovered_on_a_muxed_format(self):
        marked = audio('18', 'ja', 10, 128, vcodec='avc1', ext='mp4')
        eligible = audio('140-1', 'ja', -1, 64, ext='m4a', acodec='mp4a.40.2')
        self.assertIs(select([marked, audio('dub', 'en', 5, 32), eligible]), eligible)

    def test_bitrate_floor_and_minimum_apply_only_within_original_language(self):
        low = audio('low', 'en', 10, 24)
        useful = audio('useful', 'en', 10, 48)
        high = audio('high', 'en', 10, 128)
        self.assertIs(select([high, audio('dub', 'de', 5, 32), low, useful]), useful)
        self.assertIs(select([audio('dub', 'de', 5, 32), low]), low)

    def test_unknown_bitrates_do_not_override_known_original_bitrates(self):
        for missing in (None, math.nan, math.inf, True, 0, -1):
            unknown = audio('unknown', 'de', 10, missing)
            known = audio('known', 'de', 10, 64)
            with self.subTest(missing=missing):
                self.assertIs(select([unknown, known]), known)
                self.assertIs(select([unknown]), unknown)

    def test_total_bitrate_is_a_fallback_for_audio_only_formats(self):
        original = audio('original', 'de', 10, None, tbr=48)
        self.assertIs(select([audio('high', 'de', 10, 96), original]), original)

    def test_same_itag_suffix_identifiers_preserve_exact_format_object(self):
        original = audio('249-1', 'en', 10, 48)
        self.assertIs(select([audio('249-0', 'de', 5, 32), original]), original)
        self.assertEqual(select([original])['url'], 'https://rr1.googlevideo.com/249-1')

    def test_no_eligible_original_fails_instead_of_falling_back_to_default_dub(self):
        invalid_formats = ({'protocol': 'm3u8_native'}, {'vcodec': 'avc1'}, {'ext': 'mp3'},
                           {'filesize': WORKER.MAX_BYTES + 1}, {'filesize_approx': WORKER.MAX_BYTES + 1},
                           {'filesize': math.nan}, {'filesize': True}, {'has_drm': True},
                           {'url': 'http://rr1.googlevideo.com/audio'}, {'url': 'https://www.youtube.com/audio'},
                           {'url': 'https://127.0.0.1/audio'}, {'url': 'https://rr1.googlevideo.com:bad/audio'},
                           {'fragments': [{'url': 'https://rr1.googlevideo.com/fragment'}]},
                           {'requested_formats': [{}]}, {'requested_downloads': [{}]})
        for overrides in invalid_formats:
            with self.subTest(overrides=overrides), self.assertRaises(WORKER.PolicyError):
                select([audio('dub', 'de', 5, 32), audio('original', 'en', 10, 96, **overrides)])

    def test_an_ineligible_original_can_use_another_eligible_format_of_its_language(self):
        original = audio('original-large', 'en', 10, 96, filesize=WORKER.MAX_BYTES + 1)
        eligible = audio('original-small', 'en', -1, 48)
        self.assertIs(select([audio('dub', 'de', 5, 32), original, eligible]), eligible)

    def test_default_preference_is_not_an_original_marker(self):
        for original_preference in (-1, None, 0):
            with self.subTest(preference=original_preference), self.assertRaises(WORKER.PolicyError):
                select([audio('possibly-original', 'en', original_preference, 96), audio('default-dub', 'de', 5, 32)])

    def test_missing_or_conflicting_original_language_fails_closed(self):
        cases = ([audio('first', 'en', 10), audio('second', 'de', 10)],
                 [audio('known', 'de', 5), audio('unknown', None)],
                 [audio('dub', 'de', 5, format_note='German dubbed')],
                 [audio('dub', None, format_note='Translated audio'), audio('unknown')])
        for formats in cases:
            with self.subTest(formats=formats), self.assertRaises(WORKER.PolicyError):
                select(formats)

    def test_an_unknown_language_original_is_usable_but_not_interchangeable_with_other_unknown_tracks(self):
        original = audio('marked-original', None, 10, 96)
        self.assertIs(select([audio('unknown', None, -1, 32), audio('dub', 'de', 5, 40), original]), original)

    def test_ineligible_unknown_original_does_not_fall_back_to_an_unknown_track(self):
        with self.assertRaises(WORKER.PolicyError):
            select([audio('marked', None, 10, protocol='m3u8_native'), audio('unknown', None, -1, 32)])

    def test_explicit_dub_is_not_selected_even_when_its_language_matches_original(self):
        original = audio('original', 'en', 10, 96)
        self.assertIs(select([audio('dub', 'en', 5, 32, format_note='English dubbed'), original]), original)

    def test_descriptive_track_does_not_replace_original_audio(self):
        original = audio('original', 'de', 10, 96)
        descriptions = [audio('description', 'de-desc', -10, 32),
                        audio('misleading', 'de', 10, 32, format_note='German original descriptive')]
        self.assertIs(select([*descriptions, original]), original)

    def test_legacy_monolingual_and_unlabelled_sources_still_work(self):
        for language in (None, 'und', 'en', 'de', 'ja'):
            low = audio('low', language, -1, 48)
            with self.subTest(language=language):
                self.assertIs(select([audio('high', language, -1, 96), low]), low)

    def test_empty_or_description_only_sources_fail(self):
        for formats in ([], [audio('description', 'en-desc', -10)]):
            with self.subTest(formats=formats), self.assertRaises(WORKER.PolicyError):
                select(formats)


try:
    import yt_dlp
except ImportError:
    yt_dlp = None


@unittest.skipUnless(yt_dlp is not None, 'Use the installed VideoLab runtime for real yt-dlp integration tests.')
class InstalledYoutubeDLIntegrationTests(unittest.TestCase):
    def extractor(self, selector=WORKER.original_audio_format):
        extractor = WORKER.downloader_class()({'format': selector, 'quiet': True, 'noprogress': True,
                                               'cachedir': False, 'logger': WORKER.QuietLogger()})
        extractor.urlopen = Mock(side_effect=AssertionError('Offline fixture must not access the network.'))
        return extractor

    def test_real_installed_selector_reproduces_old_dub_and_chooses_original(self):
        formats = [audio('249-0', 'de', 5, 40), audio('251-1', 'en', 10, 128)]
        with self.extractor(OLD_SELECTOR) as extractor:
            old = extractor.process_ie_result(metadata(copy.deepcopy(formats)), download=False)
        self.assertEqual(old['language'], 'de')
        with self.extractor() as extractor:
            selected = extractor.process_ie_result(metadata(copy.deepcopy(formats)), download=False)
            extractor.urlopen.assert_not_called()
        self.assertEqual(selected['format_id'], '251-1')
        self.assertEqual(WORKER.checked_metadata(selected, VIDEO, 0), 600)

    def test_real_installed_selector_does_not_hardcode_english(self):
        with self.extractor() as extractor:
            selected = extractor.process_ie_result(metadata([audio('249-0', 'en', 5, 40), audio('251-1', 'de', 10, 128)]), download=False)
        self.assertEqual(selected['language'], 'de')
        self.assertEqual(selected['format_id'], '251-1')

    def test_bbc_archive_metadata_same_itag_languages_reproduce_and_fix_german_selection(self):
        languages = ('de-DE', 'es-US', 'fr-FR', 'hi', 'it', 'pt-BR', 'en-US')
        formats = [audio('139', language, 10 if language == 'en-US' else -1, None,
                         tbr=48.784, ext='m4a', acodec='mp4a.40.5',
                         format_note='English (US) original (default), low' if language == 'en-US' else language + ', low')
                   for language in languages]
        for selector, expected_language, expected_id in ((OLD_SELECTOR, 'de-DE', '139-0'),
                                                         (WORKER.original_audio_format, 'en-US', '139-6')):
            with self.subTest(expected=expected_language), self.extractor(selector) as extractor:
                selected = extractor.process_ie_result(metadata(copy.deepcopy(formats)), download=False)
                self.assertEqual(selected['language'], expected_language)
                self.assertEqual(selected['format_id'], expected_id)
                self.assertEqual(selected['abr'], 48.784)
                WORKER.checked_metadata(selected, VIDEO, 0)
                extractor.urlopen.assert_not_called()

    def test_real_selector_preserves_original_language_across_format_variants(self):
        formats = [audio('original-hls', 'ja', 10, 128, protocol='m3u8_native'),
                   audio('249-0', 'en', 5, 40), audio('249-1', 'ja', -1, 48)]
        with self.extractor() as extractor:
            selected = extractor.process_ie_result(metadata(formats), download=False)
        self.assertEqual(selected['format_id'], '249-1')

    def test_real_selector_fails_when_original_is_ineligible_or_absent(self):
        for formats in ([audio('original', 'en', 10, protocol='m3u8_native'), audio('default', 'de', 5)],
                        [audio('unknown-original', 'en', -1), audio('default', 'de', 5)]):
            with self.subTest(formats=formats), self.extractor() as extractor, self.assertRaises(WORKER.PolicyError):
                extractor.process_ie_result(metadata(formats), download=False)

    def test_acquire_passes_exact_selected_format_to_process_info_after_access_gate(self):
        events = []
        with tempfile.TemporaryDirectory(prefix='videolab-original-audio-') as temporary:
            work = pathlib.Path(temporary)
            captured = {}

            def factory(options):
                self.assertIs(options['format'], WORKER.original_audio_format)
                self.assertEqual(options['max_filesize'], WORKER.MAX_BYTES)
                extractor = pinned_class(options)
                extractor.urlopen = Mock(side_effect=AssertionError('Offline fixture must not access the network.'))
                extractor.extract_info = Mock(side_effect=lambda *args, **kwargs: extractor.process_ie_result(
                    metadata([audio('249-0', 'de', 5, 32), audio('249-1', 'en', 10, 96)]), download=False))

                def process(info):
                    events.append('process_info')
                    captured['download'] = copy.deepcopy(info)
                    (work / ('source.' + info['ext'])).write_bytes(b'fixture')

                extractor.process_info = Mock(side_effect=process)
                captured['extractor'] = extractor
                return extractor

            pinned_class = WORKER.downloader_class()

            gate = WORKER.checked_metadata

            def checked(info, video, start):
                events.append('checked_metadata')
                return gate(info, video, start)

            with patch.object(WORKER, 'downloader_class', return_value=factory), patch.object(WORKER, 'checked_metadata', side_effect=checked), patch.object(WORKER, 'decode') as decode:
                result = WORKER.acquire(work, VIDEO, 0, 30)
            self.assertTrue(result['ok'])
            self.assertEqual(events, ['checked_metadata', 'process_info'])
            self.assertEqual(captured['download']['format_id'], '249-1')
            self.assertEqual(captured['download']['url'], 'https://rr1.googlevideo.com/249-1')
            self.assertFalse(captured['download'].get('requested_formats'))
            self.assertFalse(captured['download'].get('requested_downloads'))
            captured['extractor'].extract_info.assert_called_once_with(URL, download=False)
            captured['extractor'].process_info.assert_called_once()
            captured['extractor'].urlopen.assert_not_called()
            decode.assert_called_once_with(work / 'source.webm', work / 'audio.wav', 0, 30)


class AcquireAccessGateTests(unittest.TestCase):
    def test_access_and_direct_audio_gates_still_precede_process_info(self):
        valid = {**metadata([]), **audio('249-1', 'en', 10)}
        restrictions = ({'availability': 'private'}, {'availability': 'unlisted'}, {'availability': None},
                        {'age_limit': 18}, {'live_status': 'is_live'}, {'live_status': 'post_live'},
                        {'is_upcoming': True}, {'has_drm': True}, {'_type': 'playlist'}, {'duration': math.nan},
                        {'filesize': WORKER.MAX_BYTES + 1}, {'url': 'https://www.youtube.com/not-a-cdn'},
                        {'protocol': 'm3u8_native'}, {'requested_formats': [{}]}, {'requested_downloads': [{}]})
        for overrides in restrictions:
            extractor = Mock()
            extractor.extract_info.return_value = {**valid, **overrides}
            context = Mock(__enter__=Mock(return_value=extractor), __exit__=Mock(return_value=False))
            with self.subTest(overrides=overrides), patch.object(WORKER, 'downloader_class', return_value=Mock(return_value=context)), patch.object(WORKER, 'decode') as decode, self.assertRaises(WORKER.PolicyError):
                WORKER.acquire(pathlib.Path('/not-used'), VIDEO, 0, 30)
            extractor.process_info.assert_not_called()
            decode.assert_not_called()


if __name__ == '__main__':
    unittest.main()
