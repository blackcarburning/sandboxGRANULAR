# M / M+ capture, 2026-10-26

M and M+ now use the existing sample-frame AudioWorklet capture processor instead
of MediaRecorder and codec decoding. Capture starts at the count-in's audio-clock
frame and produces the requested number of frames; input gain is applied once.
This removes codec priming and wall-clock start/stop timing from the take.
The old completion path referenced an undefined `rendered` variable after FX
processing moved to playback; capture now uses the staged dry mono buffer.

M's Record into selector routes a new mic take directly to M or V. Copy M → V
copies an existing rendered M take without changing M. V's cuts/stretch mapping
resets through its normal load path. New M/M+ takes can rejoin an already-running
shared transport at its existing phase.

Stopping early pads the fixed loop remainder with silence. Cancelling during
count-in discards the take; worklet ports/nodes and microphone tracks are closed
on success, interruption, cancellation and account lock. Browser-based synthetic
microphone tests do not establish physical iPhone permission/device behavior or
hardware round-trip latency.

## Desktop metronome phase repair (DESKTOP-METRO.1)

On desktop only, recording over an existing transport waits for the next shared
bar boundary before its four-beat count-in. Previously it chose `currentTime +
80ms`, giving an arbitrary phase offset from an already-playing loop. A cold
Record+Loop session retains its own restart epoch.

Desktop M/M+ metronomes also retain the requested grid if preparation or a timer
is late: missed beats are skipped with the accent index advanced, rather than
clamping the first beat to now or emitting a burst of past clicks. Phone branches
retain their prior scheduling behavior, as explicitly requested by the owner.
Regression: `tests/desktop-metronome-phase-browser.cjs` compares baseline/current
M/M+ starts against a live impulse loop's transport origin and late-grid recovery
in Chromium/WebKit, with phone-path checks kept separate.
