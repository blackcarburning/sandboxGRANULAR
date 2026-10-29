# X keyboard audition — X-KEYS.1

Reproduced on Chromium/WebKit: X in OSC3 mode with its sequence level fader at
zero recorded a keyboard note but produced silence. L's synth preview and both
sample preview paths still produced sound. X reused its sequence velocity's
zero floor, unlike L's minimum preview velocity.

The editor's `bastardloopx-preview` call now explicitly opts into a minimum
velocity of 0.06, matching the existing L synth floor. Normal preview levels are
unchanged. This flag is never supplied by the sequencer or server render path:
a zero-level X sequence remains silent. No settings/fader values are rewritten,
source mode changed, fallback tone substituted or saved source upgraded.

This fixes the reproducible **OSC3/zero-level** condition. Loaded-sample keyboard
playback was audible in the synthetic fixture; that does not establish the cause
of every possible silent imported sample or user configuration.

Verification:

- `node --test tests/x-synth-audition.test.cjs tests/song-server-arm.test.js`
- `MYGRAIN_TEST_URL=http://127.0.0.1:18965/mygrain/ MYGRAIN_TEST_ADMIN_PASSWORD=... X_KEY_ASSERT=1 node tests/x-keyboard-audibility-browser.cjs`
- Browser fixture is loopback-only and requires an isolated test account store.
  It checks L/X sample, synth and zero-level synth keyboard entry on a 390×844
  touch/mobile viewport in Chromium and WebKit, with real output PCM analysers.
  It then saves audible and muted X parts and runs both through real server jobs.
  The muted render must remain exactly silent; source hashes/revision unchanged.
- Two failures in the broader `song-beta-keyboard.test.js` slice
  (`getConcurrentGrainSourceCount` absent from its VM fixture) were reproduced
  unchanged against pre-edit HEAD; no grain/scheduler changes were made.
- No Song render-compatibility bump: the scheduled DSP/output is unchanged.
  No physical iPhone test. Local evidence is ignored under
  `output/x-keyboard-20261029/`.

The visible Start/performance build badge is `v2026.10.29.X-KEYS.1`.
