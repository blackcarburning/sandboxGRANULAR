# AUDIO-CLOCK.1 — native scheduler wake-ups

The existing silent AudioWorklet clock now wakes primary live-editor sequencer, arp, granular and shared L/X/drum schedulers in foreground as well as background. This is a wake-up source, **not** a full audio-thread sequencer or OS priority request: Web Audio nodes are still scheduled from the main thread against AudioContext time, using unchanged transport and grain lookahead. A prolonged main-thread stall can still exceed lookahead.

## Bounded work and fallback

- Native pulses are capped at approximately 50 Hz and at one unacknowledged message. A blocked GUI cannot accumulate a burst of clock messages. Disabling resets the pending state; acknowledgements happen even if a scheduler throws.
- Primary scheduling callbacks cancel and re-arm their existing timers. While a recent healthy native pulse owns scheduling, these timers become 60 ms watchdogs rather than 8/10/25 ms polling. If pulses cease, watchdogs keep scheduling; after 150 ms without a pulse they return to the original fast cadence. Missing APIs and processor errors retain ordinary timers.
- The shared clock does not accumulate future deadlines when pumped by the faster native cadence.
- Main modulation callbacks coalesce to their existing target cadence (33 ms normal / 66 ms Low Power) instead of independently doing the same work from the interval and hidden audio pulse.
- Simple native foreground playback without primary scheduling does not enable the pulse. Q and EQ keep their original foreground clocks without extra pulse-driven copies; hidden behavior remains supported.

## Preserved boundaries

Eight-second ownership-aware idle suspension, real device interruptions, recording/busy guards and existing graph reuse remain unchanged. Locked playback stays enabled. No sample, knob, envelope, voice-budget, effects quality or serialized-state changes. The change reduces scheduling/control overhead; native DSP CPU and iPhone thermal improvement remain unverified.

## Saved Songs

`configureBackgroundAudio()` still excludes `__mygrainSongRenderDeck`; it never instantiates this live clock for isolated renders. `song-beta.js`, `song-beta-clock.js`, `scripts/server-arm-worker.cjs` and the backend continue to use existing render and PCM scheduling. Watchdog selection falls back to original intervals without a live controller. No audible render compatibility bump or source ZIP invalidation is required.

## Verification

Focused clock/diagnostic tests cover acknowledgement/backpressure, missing/failed clocks, stale pulse ownership, simple playback gating, disposal, idle ownership and wake races. `tests/audio-clock-browser.cjs` exercises Chromium/WebKit portrait/landscape, real PCM from sample, grains and arp+drum sequencing with normal scheduling timeouts disabled in foreground and hidden states, real pulse delivery interruption/watchdog recovery, native Play wake, and timerless idle suspension. Real current/legacy/refresh server Song jobs verify audible output, warm reuse, sources/revisions unchanged and no phone source downloads/reservations.

Evidence and task-only rollback patch: `output/audio-clock-20261029/`. Browser synthetic visibility is not a physical iOS lock/thermal test.
