"""Kokoro edge trimming must not gate, stretch or normalise individual words."""
import pathlib
import sys
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
import mygrain_kokoro as K


class KokoroTrimTests(unittest.TestCase):
    rate = 24000

    def test_long_model_padding_is_removed_with_short_guards(self):
        speech = np.sin(np.arange(2400) * .2) * .5
        audio = np.r_[np.zeros(7200), speech, np.zeros(12000)]
        result = K.trim_word_edges(audio, self.rate)
        lead, tail = round(self.rate * .004), round(self.rate * .008)
        start = 7201 - int(np.flatnonzero(result)[0])
        # RMS windows can include up to 2ms additional quiet context.
        self.assertTrue(7200-lead-48 <= start <= 7200-lead)
        self.assertTrue(9600+tail <= start+len(result) <= 9600+tail+48)
        np.testing.assert_array_equal(result[7200-start:9600-start], speech)

    def test_quiet_consonants_and_complete_tail_survive(self):
        # Consonants 46 dB below the vowel; do not use a voice/energy gate.
        start = np.full(1200, .0025)
        vowel = np.full(2400, .5)
        tail = np.full(900, -.0025)
        speech = np.r_[start, vowel, tail]
        audio = np.r_[np.zeros(6000), speech, np.zeros(6000)]
        result = K.trim_word_edges(audio, self.rate)
        start = np.flatnonzero(result)[0]
        self.assertTrue(96 <= start <= 144)
        np.testing.assert_array_equal(result[start:start+len(speech)], speech)

    def test_internal_pauses_and_unpadded_boundaries_are_untouched(self):
        audio = np.r_[np.full(300, .1), np.zeros(7200), np.full(300, -.1)]
        np.testing.assert_array_equal(K.trim_word_edges(audio, self.rate), audio)

    def test_quiet_word_uses_its_own_relative_threshold_without_gain(self):
        audio = np.r_[np.zeros(240), np.full(120, .0001), np.zeros(480)]
        result = K.trim_word_edges(audio, self.rate)
        self.assertEqual(float(np.max(result)), .0001)
        self.assertTrue(96+120+192 <= len(result) <= 96+120+192+96)

    def test_isolated_subthreshold_noise_does_not_keep_model_padding(self):
        speech = np.full(2400, .5)
        noise = np.zeros(12000)
        noise[::120] = .002  # above the sample threshold, below 2ms speech energy
        result = K.trim_word_edges(np.r_[np.zeros(6000), speech, noise], self.rate)
        self.assertLess(len(result), len(speech)+400)

    def test_short_word_is_neither_padded_nor_lost(self):
        audio = np.full(24, .1)
        np.testing.assert_array_equal(K.trim_word_edges(audio, self.rate), audio)

    def test_silent_or_invalid_words_fail_instead_of_disappearing(self):
        for audio in (np.zeros(240), np.array([]), np.array([np.nan]), np.array([np.inf])):
            with self.subTest(audio=audio), self.assertRaises(ValueError):
                K.trim_word_edges(audio, self.rate)


if __name__ == '__main__':
    unittest.main()
