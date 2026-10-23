# Sample keyboard — SAMPLE.2

## Play and record

Select **Sample** in the keyboard or K sound switch. With no sample loaded, this opens the shared browser; otherwise use **Choose Keyboard Sample** above the keybed to replace it. The folder selector offers all 13 configured `SAMPLES_*` libraries and the existing Sampledrop / Splice sources. Preview and choose **Load into Keyboard**.

**Random Sample** above the keybed loads a new keyboard sample and selects Sample playback. Grain A and Grain B each have their own **Random Sample** button beside their source controls, reachable in both Mic and Sample modes. Each button replaces only its own source; grain size/envelope settings and the other two samples stay unchanged.

These three random buttons only use `SAMPLES_VOCAL`, `SAMPLES_PIANO`, `SAMPLES_ORCH`, `SAMPLEDROP`, `SAMPLEDROP_2` and `SPLICE_CLAW`. Drum/bass subfolders are excluded too; manual browser choices and the existing loop/drum randomizers are unchanged. The `sampledrop2` API key represents `SAMPLEDROP_2`. Empty/unavailable folders are skipped within this fixed allowlist; exhaustion fails without replacing the current sample. The current file is excluded from its own next selection. There is no broader-library fallback.

- C4 (middle C / MIDI 60) plays the sample at its original rate, regardless of its filename.
- Semitone playback rates are `2 ** ((MIDI - 60) / 12)`; C5 is twice the rate, C3 half. Pitch shifting changes duration.
- Notes play once, with short click-guard attack/release. Releasing a key fades its remaining audio; Hold does not invent a loop in the source. Arp retriggers it.
- Existing octave, velocity, Hold, Arp, Panic, keyboard capture VU, per-instrument recording gain, Record to K, Clear K and K processing remain shared. K recording uses the existing pattern-default or custom step count.
- Sample Volume is also represented in the mixer, with its own `keyboardsample` solo key, separate from the pre-existing generated-sample layer.
- As for other manually loaded source samples, downloads are limited to 32 MiB and decoded duration to 180 seconds. Source libraries may take time to fetch; failed/cancelled loads keep the previous sample. Audio/account/Song changes invalidate late loads.

## Persistence and compatibility

The waveform uses its own account-scoped browser audio key, not K's recorded buffer. Sample identity and selected folder are retained with device state. Songs / editable patterns include the actual sample WAV as the appended `keyboardSample` audio slot; recall and isolated frozen renders use embedded audio without contacting the library. Appending preserves existing persisted history slot indices. The normal patch ZIP exporter also includes the sample and sound selection. A plain settings-only JSON preset is not an audio backup.

Sample replacement is one Undo/Redo action and is allowed during a verified Song amendment. It is rejected during unrelated asynchronous history or recording/Song operations. Existing lease/account guards remain active. Older portable Songs gain an explicitly empty sample slot and default volume; an archive that mentions Sample but omits its slot fails instead of borrowing device audio.

The saved-part start action explicitly authorizes its held/Arp keyboard notes. This matters in a fresh isolated renderer, which has no prior physical keyboard gesture; merely recalling settings must still not start playback.

## Verification

`tests/q-keyboard-player.test.js` exercises middle-C rates, sample release/replacement, isolated capture routing and silent empty/suspended states alongside the existing Q instruments. `tests/song-beta-compatibility.test.js` covers absent-slot migration and strict failures.

`tests/keyboard-sample-browser.cjs` only accepts a localhost test server with disposable accounts. It serves actual PCM WAV bytes through the existing source API path, decodes them with Web Audio, checks all folders, C4/C5/C3 rates, a physical-pointer Hold note and a non-silent exact-length K worklet take. It checks failed/late-load preservation, actual Song amendment/save/recall, source Undo/Redo, a non-silent frozen Song render, reload without re-fetch, Arp to K, and phone layout. Chromium and WebKit desktop / 390px phone emulation are supported. This is not a physical-phone test.

`tests/random-performance-samples.test.js` verifies the six-root allowlist, path/subfolder filtering, empty/offline fallback, current-file exclusion, and context/authentication cancellation. `tests/random-performance-samples-browser.cjs` uses disposable localhost accounts, real decoded PCM, native phone taps in Chromium/WebKit, all six libraries for all three targets, protected grain settings, Undo/Redo, failures and delayed-load cancellation, Song amendment/save/recall, and reload without downloading audio again.
