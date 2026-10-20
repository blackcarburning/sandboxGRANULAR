# SAMPLES_ALTBASS — clean analogue Juno basses

63 prepared one-shot WAVs from Richard Taylor / Modular Samples' **Roland Juno-6** library:

- Pulse Bass: 25 notes × two original velocity tones (50 files).
- Saw Bass split: 13 low-register notes (13 files).
- No arpeggios, riffs, loops, noise/experimental patches, distortion or added effects.
- 44.1 kHz, mono, 16-bit PCM WAV; approximately 9.5 MB total. Only the chosen sample is decoded on the phone.

Original repository: <https://github.com/publicsamples/Roland-Juno-6>

The upstream `LICENSE` dedicates **content** to the public domain and explicitly permits copying, modifying and redistribution, including commercial use. Its full text is retained in [LICENSE.txt](LICENSE.txt).

## Preparation and tuning

[manifest.json](manifest.json) records the pinned upstream revision, release archive URL/member, original SHA-256, SFZ region start/end frames, upstream keyboard key, actual playback root, centre-tuning correction and prepared WAV SHA-256 for every sample.

These Pulse/Saw patches sound **one octave below** their SFZ keyboard keys. Prepared filenames and roots use the sounding note instead. We measured a stable portion of each recording and applied a small centre-tuning correction (maximum 33.85 cents), leaving normal analogue movement. All 63 prepared recordings were rechecked against their playback roots (maximum centre estimate deviation 2.16 cents). This is not an assertion of perfectly constant analogue pitch.

The bass-only selection excludes the upper Saw split, which changes register, and the very quiet multi-octave Short Bass patch. There is no EQ, compression, saturation, reverb or peak normalisation. Original SFZ start/end markers remove recording lead-in. PCM conversion and modest pitch resampling are the only other preparation.

Rebuild with Python 3.12 plus requests/numpy/scipy:

```sh
../sample-catalogue/.venv/bin/python scripts/prepare-altbass.py
```

The script downloads only the selected archive members using HTTP ranges, rather than the whole 960 MB archive. Run it from the MYGRAIN repository root; the interpreter path above is relative to that root.
