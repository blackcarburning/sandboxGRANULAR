# L/X editor scrolling — LX-SCROLL.1

Supported app: https://openclaw.blackcarburning.com/mygrain/?v=2026-10-29-lx-scroll-1

Visible startup/performance badge: `v2026.10.29.LX-SCROLL.1`.
The previous drum-editor `D29.1` repair is retained.

## Submitted iPhone evidence

Two captures at 08:47:57 and 08:48:18 UTC on 2026-10-29 describe one
session, not independent reproductions. L opens at 08:47:04; the later
five-second windows show AudioContext time progressing at about 70–84% of
wall time. Main-thread 1 Hz callbacks remain responsive and scheduling reports
zero skipped steps. Known decoded PCM stays at 31,969,904 bytes (27 unique
buffers); Safari provides no JS heap or total native memory measurement.
This confirms slow audio-clock progress, not a memory leak, hardware underrun,
thermal cause, or proof that L alone causes it. Submitted-log analysis stays
outside the app's static serving tree.

The prior global W-CUT badge was stale even on the drum-scroll source; its value
alone cannot establish whether the iPhone had that repair. This update advances
both the global badge and diagnostic module URL.

## Changes

- Extend native CSS overscroll containment to L/X outer overlays and nested
  dialog shells. Supporting browsers no longer run non-passive JavaScript
  boundary/layout checks for every move. Older browsers retain the fallback.
- Remove L/X full-screen backdrop blur and animated step shadows. Keep a
  lightweight inset current-step indicator; contain the grid's paint/layout.
- Skip optional playhead DOM writes when its grid is offscreen, the document is
  hidden, or scrolling occurred within 160 ms. No new visual polling timer or
  backlog; the existing scheduler paints the latest step after scrolling settles.
  Stop/close cancels pending RAF work, and normal Stop clears the highlight.
- Add audio/wall-clock progress measurement over foreground windows of at least
  five seconds to the existing 1 Hz diagnostic probe. Record slow/recovery
  transitions and active editor/scroll metadata. Visibility, suspension and
  context replacement break the window. This never alters the audio engine.

No DSP, muted-layer shutdown, envelopes, note scheduling, sample buffers, saved
patch formats or audible render compatibility change. No Song invalidation is
needed. The server worker uses the same current engine; the isolated render deck
keeps editors closed and the visual paths inactive.

## Verification

Evidence: `output/lx-scroll-20261029/` (exact before copies and task-only patch).

- Chromium and Linux WebKit, 402×768 and 768×402, both L and X: eight cases,
  with simultaneous sample-mode L/X, W, all drum lanes and sequencer. Real
  final-bus AudioWorklet PCM stays nonzero, no missed steps or late notes, no
  per-note global control refresh, and audio/wall rate approximately 1.0.
- Baseline: 36 synchronous style reads for each 12-move gesture and 12–14
  offscreen grid mutations per second. After: both zero. Neither desktop
  baseline nor fixed run reproduces the physical iPhone's slow clock, so no
  desktop speedup is claimed from those audio ratios.
- Native Chromium touch gestures scroll the panel and the keybed in both
  orientations; no held keys remain. Browser key taps and Accent Amount input
  work; indicators resume after scrolling. Stop clears the highlight, restart
  works, close cancels a pending frame and restores background scrolling.
- 25 diagnostics unit tests pass, including a 70%-speed clock with timely JS,
  recovery, hidden/suspended windows and context replacement; 26 transport,
  touch-action and background-audio tests pass. All 77 inline scripts and the
  diagnostic JS parse. No page errors in either engine.
- Six real isolated server Song jobs pass (current/legacy/refresh in both
  engines), warm reuse, rendered phone playback and audition, unchanged source
  hashes/revisions, zero phone source downloads and zero reserved bytes. The
  existing accent PCM comparison stays approximately 3.527 dB.
- Public diagnostic module: HTTP 200, exact checkout bytes. Public guest shell
  remains approximately 6.6 KB. The configured live server reads this checkout
  directly. Authenticated behavior was checked with disposable localhost stores,
  not by creating or borrowing a production account session.

Physical iPhone confirmation remains outstanding; this removes measured UI cost
and improves diagnostic coverage, not proof of a hardware-level cure.

No commit/push: many unrelated uncommitted changes already occupy the same app
files. The task-only patch preserves those changes and the prior drum fix.
