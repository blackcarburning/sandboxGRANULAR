# iPhone background playback — BGAUDIO.1

## User behavior

Start MYGRAIN and start the desired performance while the app is visible, then lock the phone. A visibility change no longer stops held notes, the arpeggiator, loops, drums or an already-playing Song. Normal Stop/Panic still stops playback; returning to the page does not restart a performance that was explicitly stopped. Actual page navigation (`pagehide`) retains the existing stop/save cleanup.

This is a request for background playback, not an OS-level guarantee. Phone calls, another app claiming audio focus, Safari/iOS defects, process suspension or termination can still interrupt audio. No automatic hidden resume loop fights those interruptions. A physical iPhone lock/unlock test remains necessary; emulated viewport and synthetic visibility tests cannot prove native lock-screen policy.

Recording to K, Song arming/rendering and media preparation retain their existing foreground/cancellation guards. There is no microphone keepalive, silent audio file, recording permission request or duplicate route of the audible mix.

## Implementation

`background-audio.js` requests `navigator.audioSession.type = 'playback'` before creating the main AudioContext, where supported. Active main/M/M+ microphone tracks instead use `play-and-record`; releasing them restores playback. Missing APIs or clock installation failure do not block ordinary playback. Media Session playback state mirrors actual transport/context state without inventing an always-playing session. Isolated Song render decks never create a controller or change the parent audio session.

A zero-input, silent-output AudioWorklet clock posts at most 50 wakeups per second while hidden. Its output connects only silence to the original destination; the mix routing is untouched. Each hidden wake cancels the corresponding existing UI-timer wake before invoking the existing sequencer, arp, grains and shared drums/L/X schedulers. Q uses its monotonic event cursor. This avoids duplicate scheduling chains and lets native-audio wakeups supplement timers that may be throttled. The original timers remain the foreground/fallback path; lookahead, source caps, note mapping and gain math are unchanged. Audio modulation continues while hidden; visual meters stay paused.

Each context replacement disconnects the previous clock/port, stale asynchronous installs cannot attach to the current context, Blob module URLs are revoked, and account lock disposes the controller. There is no forced context resume while hidden. Normal foreground recovery remains available after an OS interruption.

## Evidence and limitations

- `tests/background-audio.test.js`: session types, unsupported APIs, install failure, hidden-only pumping, interruption, disposal, replacement race and silent/bounded native-clock implementation.
- `tests/background-audio-browser.cjs`: isolated local accounts, real startup and Web Audio, portrait/landscape Chromium and WebKit. Synthetic hidden events with normal audio scheduler timeouts deliberately dropped; native PCM energy, progressing context time, held sample/grains, arp/sequencer/drums, no focus-resume flags, Stop persistence and no automatic hidden resume after suspension.
- Existing `tests/audio-deadline.test.js` has 12 mock-fixture failures on the exact before-edit HTML as well as after this change; the failure set is unchanged. Do not describe that legacy slice as fully passing.

Platform basis: [Audio Session specification](https://www.w3.org/TR/audio-session/) distinguishes playback from play-and-record. [WebKit issue 261554](https://bugs.webkit.org/show_bug.cgi?id=261554) records that background AudioContext playback has been affected by iOS-version-specific defects. Neither source guarantees continued JavaScript execution under every native screen-lock condition.
