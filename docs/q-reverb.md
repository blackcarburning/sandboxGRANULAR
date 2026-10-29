# Q stereo hall reverb

Q's existing `room` field remains the parallel wet send (0–1), retaining dry signal and old saved mix values. State version remains 1. New optional fields default in `q-theory.js`: `reverbDecay` (0.5–12 seconds), `reverbSize` (0–1), `reverbPredelay` (0–200 ms), `reverbDamping` (1000–18000 Hz), `reverbLowcut` (20–1500 Hz), `reverbWidth` (0–1). They pass through the existing Q state/JSON capture path, including song snapshots.

The wet path is pre-delay → high-pass → low-pass → two crossfading stereo convolution banks → mid/side width matrix → room send → existing level/pan/EQ. Early-reflection spacing and diffuse onset vary with Size. Decay is the approximate -60 dB envelope time; impulse duration includes that complete decay. Independent stereo tails collapse to mono at width 0. Dry and independent delay paths are unchanged. No reverb feedback loop is used.

Decay/size changes debounce for 180 ms and crossfade for 120 ms; repeated mix refreshes do not postpone an already pending rebuild. Stop/disposal cancels pending rebuilds. Voice activity includes the configured decay and pre-delay so an idle final bus does not clip long Q tails. Stop still stops Q explicitly.

Presets: Piano Hall (3.8 s), Lush Strings (6.5 s), Cathedral (10 s). Off sets the wet send to zero without deleting other settings. Presets do not change the instrument or unrelated randomisation rules.

Verification: `node --test tests/q-reverb.test.cjs tests/q-theory.test.js tests/q-length-decay.test.js`; `node tests/q-reverb-browser.cjs` with isolated test server (`python3 tests/song-beta-test-server.py 18949`). Browser test blocks external requests and production writes; tests Chromium/WebKit mobile controls and real OfflineAudioContext rendering, tail duration, pre-delay, stereo/mono width, finite output, presets and state round-trip. This is rendered-signal verification, not a subjective listening test.

Pre-change files: `backups/q-lush-reverb-20261024/{index.html,q-card.js,q-theory.js}`. Do not roll these entire files back over later/unrelated edits without reviewing the diff.
