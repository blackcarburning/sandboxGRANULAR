# Idle audio suspension — IDLE-SLEEP.1

The live editor suspends its existing AudioContext after eight seconds of
continuous genuine audio inactivity. This freezes graph DSP and the silent
background worklet rather than merely setting gain to zero. The modulation
interval is cleared. Sounds, settings, undo, graph and buffers are retained.

Activity includes independent loop sources, L/X/Q, keyboard/release voices,
grains, drums, source/keyboard/K/Loop Cut auditions and Song playback. Microphone
streams/requests, recording/arming/processing, loading/generation, history/AI
work and Song preparation protect the context. A stopped Song amendment alone
does not prevent sleeping. Playback mutes are not treated as transport Stop.

The existing background controller owns only suspensions it requested. Its
500 ms bookkeeping interval measures a monotonic idle grace period; the
background scheduler worklet sends pulses while hidden AND playing, plus the
bounded idle grace so suspension still happens when iOS throttles UI timers.
During that grace it checks the sleep deadline without pumping idle schedulers.
Normal bookkeeping/diagnostics remain bounded, not completely absent.

- Pointer/key interaction or a playback operation wakes idle-owned sleep.
- Explicit Start/direct recording resume clears ownership on the next sync.
- Wake reuses the same graph/context, restarts modulation, and immediately
  re-enables hidden scheduler pulses when playing.
- Visibility/focus alone does not wake an idle editor or restart stopped music.
- Device interruption is not claimed as idle sleep or automatically resumed by
  the idle controller. Existing explicit recovery remains authoritative.
- Suspend/resume calls are ordered synchronously to handle a gesture arriving
  while suspension is pending. Context replacement/disposal invalidate callbacks.
- `capturePhoneDiagnosticState().idleAudio` exposes sleep/pending/clock state;
  the visible status says `Audio sleeping · resumes on interaction`.

Screen lock with active playback remains supported: no idle suspension, and
normal hidden scheduling keeps running. Physical iPhone thermal and lock/unlock
behavior must still be checked on the device; synthetic visibility is separate.

## Server Song compatibility

`configureBackgroundAudio()` excludes `__mygrainSongRenderDeck`. Real editor
Song operations are protected by the busy/playing guards. `song-beta.js`,
`song-beta-clock.js`, the isolated render deck and `server-arm-worker.cjs` keep
using the current engine. No audible algorithm/source/schema change or render
version bump is needed. Validate current + legacy renders, warm reuse and phone
rendered playback in disposable stores, never production accounts.

## Verification

- `tests/background-audio.test.js`: fake-clock eight-second timing, playback,
  mic/job guards, interruption ownership, pending-suspend gesture ordering,
  repeated cycles and direct-resume handling.
- `tests/idle-suspend-browser.cjs`: isolated admin fixture with password
  `isolated-page-scroll`; Chromium/WebKit portrait 390×844 and landscape 844×390.
  Real sample/grain/arp+drum PCM while hidden with UI scheduling timers disabled;
  playback beyond the sleep grace; Stop → frozen audio time, cleared modulation
  timer, disabled background clock; focus stays asleep; interaction wakes the
  same context with non-silent audio using a native Play tap. The idle phase
  disables the controller bookkeeping interval to verify native deadline wakes
  even without UI polling. This does not emulate physical screen lock.
- Evidence: `output/idle-suspend-20261029/` including real server Song jobs,
  task-only patch and verified live assets/build.
