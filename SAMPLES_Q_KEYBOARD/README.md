# Standalone keyboard piano startup bank

Salamander Grand Piano V3 by **Alexander Holm**, licensed under **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**.

- Original instrument: https://github.com/sfzinstruments/SalamanderGrandPiano
- Source revision: `3382bf9496bba2486f5ab0de55a264d1dfc38404`
- License: https://creativecommons.org/licenses/by/3.0/
- Local source, license and attribution: `../SAMPLES_Q/`.

These 120 keyboard-only derivatives retain every source frame, both stereo channels, the four velocity layers, original sample pitch mapping and complete natural piano tails. They use **lossy MP3, libmp3lame VBR quality 2**, not synthetic piano, a looped sustain, a shortened PCM bank, or a bit-identical archival format. Encoding preserves Xing/LAME gapless metadata so the browser removes encoder priming/padding. Five assets decode with 24–41 extra trailing source-rate frames (under 1 ms); none lose source frames. There is no trimming, normalization or resampling. No endorsement by the original author is implied.

## Runtime boundaries

Only the standalone `MygrainQ.createKeyboardPlayer()` piano sampler uses this directory. It first validates the original Q catalog, then validates `catalog.json` against its exact sample identities, frame counts, rate, channel count and source SHA-256 values. Each encoded asset is SHA-256-checked before decoding. Decoded audio must be stereo and match the full original duration within the existing 1 ms tolerance.

The main Q `Piano`/`Controller`, original `SAMPLES_Q` and strings repositories, saved Q/Song banks and archive capture remain on their original WAVs. Keyboard K capture still taps the same live gain node, and scheduled arp duration, piano release, fractional tuning, cancellation, priority loading and the K.8 three-worker warmup are unchanged. Full tails also mean the decoded PCM cache still has its existing 96 MB budget; the reduction is in transfer bytes, not decoded audio duration or memory.

If a browser cannot decode a valid, integrity-checked MP3 with the correct dimensions, it falls back to that same authentic full WAV, validates its hash/dimensions and caches it. Such a browser loses the bandwidth improvement, not piano authenticity or sustain. Missing/corrupt assets or an invalid catalog fail visibly rather than silently starting huge WAV downloads. No synthetic fallback is provided.

No `index.html` warmup change is needed. Ship `q-card.js` **and this entire directory**, including `catalog.json` and `samples/`, together; deployment/cache-busting of the page remains with the entrypoint owner. An older cached `q-card.js` still uses the old WAV bank. Actual iPhone/Safari QA remains required; automated codec checks here use Chromium.

## Rebuild and verify

Run from the repository root with a libmp3lame-enabled FFmpeg executable available. No package installation, service, config or production song changes are part of the build. `FFMPEG` may name an isolated executable outside this repository.

```sh
FFMPEG=/path/to/ffmpeg python3 scripts/prepare-k-piano.py | apply_patch
python3 scripts/prepare-k-piano.py --check
FFMPEG=/path/to/ffmpeg python3 scripts/prepare-k-piano.py --check --decode-check
node scripts/verify-k-piano-browser.js
node --test tests/q-keyboard-player.test.js tests/k-keyboard-readiness.test.js tests/k-keyboard-routing.test.js tests/k-piano-startup.test.js
```

The builder checks each original WAV's SHA-256 and PCM dimensions before encoding. It writes only new derivative binaries and emits the catalog as an `apply_patch` patch. `--check` is read-only; `--decode-check` also verifies that FFmpeg decodes every derivative without removing source frames and with less than 1 ms extra trailing padding. The Chromium verifier decodes all 120 derivatives at both 44.1 and 48 kHz, checks stereo/full duration within that same tolerance (allowing one resampled frame of rounding), and compares onset alignment/correlation and final-second tail energy against six representative originals.

Verified: **240 successful Chromium decodes**, maximum deviation 44 frames at 48 kHz; minimum zero-lag first-second waveform correlation **0.999724**, with final-second energy ratios **0.9937–1.0034** for the representative samples. FFmpeg independently confirms **no removed source frames in all 120 assets**. The focused keyboard/readiness/routing/startup tests pass, as does the wider Q theory/strings/length/arp slice: **155 tests, including 21 new startup tests**.

## Measured reduction (2026-10-16)

All sample bytes below are actual file/Resource Timing payload bytes, without HTTP headers. The first row is the requested MIDI 47–60, velocity 127 span; the other rows use the current entrypoint's visible-key geometry at each viewport.

| Sample set | Original WAV bytes | Keyboard MP3 bytes | Reduction |
| --- | ---: | ---: | ---: |
| MIDI 47–60: five roots | 13,973,824 | 1,110,453 | 92.05% / 12.58x |
| Portrait 390×844: ten roots | 32,476,272 | 2,659,516 | 91.81% / 12.21x |
| Landscape 844×390: seventeen roots | 55,413,492 | 4,378,578 | 92.10% / 12.66x |
| Entire 120-sample bank | 294,712,500 | 22,407,880 | 92.40% / 13.15x |

`scripts/measure-k-piano-startup.js` serves a read-only local checkout, reads actual visible pitches from `index.html` at each phone viewport, then measures the isolated real `KeyboardPlayer.prepare()` path with three concurrent workers and a fresh cache. It never starts app audio or writes production Song data. External requests and non-GET/HEAD requests from the layout page are blocked.

```sh
node scripts/measure-k-piano-startup.js --runs=3
node scripts/measure-k-piano-startup.js --runs=1 --kbps=10000
node scripts/measure-k-piano-startup.js --runs=1 --kbps=10000 --source=backups/k-piano-startup-20261016T111731Z/q-card.js
```

At **10 Mbps aggregate download / 40 ms emulated latency**, cold visible-key readiness improved from **26.823 s to 3.148 s portrait** and **46.338 s to 5.441 s landscape**. The MP3 runs made **zero full piano WAV requests**. Unthrottled local three-run median readiness changed from **741 ms to 604 ms portrait**, and **1,421 ms to 1,156 ms landscape**. These are isolated loader measurements, not a substitute for the parent task's end-to-end selection/Ready, arp, four-source K capture or real-device QA.

The wide 48-key landscape span can still exceed the unchanged decoded-cache budget and evict older warmed samples, as it did before this change; MP3 reduces network transfer, not that separate cache constraint. For parent QA, count/delay `.mp3` requests as well as `.wav`: the existing readiness-browser fixture's WAV-only network matcher does not observe this new bank. Evidence is in `/tmp/k-piano-startup-before.json`, `/tmp/k-piano-startup-after.json`, the corresponding `-10mbps.json` reports, `/tmp/k-piano-startup-codec-verification.json`, `/tmp/k-piano-startup-full-frame-check.log` and `/tmp/k-piano-startup-regression-tests.log`.
