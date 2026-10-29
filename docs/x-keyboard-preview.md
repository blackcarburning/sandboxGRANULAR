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

## Follow-up: X-KEYS.2 — transport restarts and quick sample taps

The owner subsequently confirmed silence with both samples and OSC3. A running
shared-transport fixture exposed a separate defect: recording called
`restartBastardLoopXPlaybackIfNeeded` after audition, and the restart stopped the
preview it had just started. Non-held sample/MIDI previews and synth previews
were affected; held sample voices were not in the sequencer voice set.

Note-entry restarts now explicitly preserve previews, using a preview marker on
sample voices and the existing dedicated synth role. Ordinary Stop and all other
restart callers retain their previous stop-all behavior. The transport handoff
path preserves the same distinction. Quick normal sample-key releases retain
120 ms of attack; cancellations (including scroll gestures) release immediately.
No settings or saved source formats change, and scheduled sample/OSC rendering
never requests this editor-only preservation. Server capture uses the same app
engine; Song compatibility is unchanged because scheduled DSP is unchanged.

`tests/x-record-preview-browser.cjs` exercises the actual MIDI message handler
and touchscreen taps, recording samples and OSC3 while the shared transport is
active but X is disabled (so sequence output cannot mask a silent preview).
Both Chromium and WebKit use a 390×844 touch viewport and final-output PCM
measurement. Each case also checks explicit Stop cleans up preview voices.
`tests/x-preview-lifecycle.test.cjs` covers ordinary and handoff stop behavior.
The original audible/muted server Song tests are rerun as well. Physical MIDI
hardware and a physical iPhone remain untested. Evidence:
`output/x-shared-keys/`. Current visible badge: `v2026.10.29.X-KEYS.2`.

## X-KEYS.3 — preview is not transport

Owner clarified that X previews must work stopped and must not restart the lane.
Reproduced: Stop X while shared Bastardloop transport is active, then record a
note; `shouldRestartBastardLoopXPlayback` returned true from the shared flag and
note entry restarted X. Remove the restart calls from note/rest entry entirely.
A running scheduler already reads edited cells on its next pass; no phase reset
is necessary. Other transport actions and source/tempo changes are unchanged.

`x-stopped-preview-browser.cjs` verifies sample and OSC3 through actual on-screen
keyboard taps, MIDI messages and grid button taps, both with X individually
stopped and with all playback stopped. Grid cases suspend the AudioContext before
tapping to verify gesture readiness. All cases require non-silent final PCM,
X transport remaining stopped and ordinary Stop cleaning up previews. Chromium
and WebKit, 390×844. The earlier baseline fails the no-restart assertion.
The clean stopped fixture already produced sound; a separate universal cause of
the owner's stopped-state silence was not reproduced. Do not describe the
transport restart fix as proof that every saved configuration is now audible.
Scheduled DSP and Song compatibility are unchanged; real audible/muted Song jobs
are rerun with unchanged source hashes/revisions. No physical iPhone test.
Current badge: `v2026.10.29.X-KEYS.3`.
