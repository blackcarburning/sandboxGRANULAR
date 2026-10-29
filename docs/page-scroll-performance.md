# General page scrolling — PAGE-SCROLL.1

Live app: https://openclaw.blackcarburning.com/mygrain/?v=2026-10-29-page-scroll-1

Visible badge: `v2026.10.29.PAGE-SCROLL.1`. The previous drum and L/X editor
scrolling repairs remain in place.

## Submitted iPhone evidence

The two submissions received around 09:01 UTC on 2026-10-29 are not two
independent reproductions on the current build. One is an older saved capture
with playback stopped. The other, captured at 09:01:28 on LX-SCROLL.1, shows
foreground AudioContext progress falling to approximately 87–91% of wall time
outside any editor, while the JavaScript probe remains responsive and scheduled
steps report no skips. L was open earlier without this slow-clock behavior.
Repeated fixed-width viewport-height changes accompany the later slowdown.

Known decoded PCM remains 31,969,904 bytes in 27 buffers. Safari does not provide
total native memory or JS heap measurements here. This is evidence of slow
audio-clock progress, not proof of a memory leak or a unique hardware cause.
Private submitted logs are not copied into the app's static tree.

## Measured page-wide costs and changes

The same-source phone browser baseline found that 12 height-only resize
callbacks caused 4,020 keyboard attribute writes, 84 source-waveform calls,
12 keyboard geometry and label passes, and 12 instrument warm-up calls.
The hidden legacy sequencer also rewrote step styles repeatedly. The main
controls container, approximately 69,000 CSS pixels tall in portrait, had
12px backdrop blur applied to it.

- Ignore browser-bar height-only resize events for keyboard/waveform work.
  Width/DPR changes still redraw waveforms; actual keyboard-width changes still
  coalesce geometry updates and instrument warm-up. Note labels do not depend
  on viewport size and no longer rebuild on resize.
- Remove large scrolling-control backdrop blur on coarse-pointer devices.
  Use an opaque background on the main controls surface without adding clipping
  or containment that could break nested controls/popups.
- Track touch scrolling and fixed-width viewport-height changes with passive
  listeners and at most one settling timer. Pause optional meter sampling,
  painting and transitions during the burst; resume after 180ms without scroll.
  Existing per-element/slot drawing queues retain only the latest work.
- Replace the legacy sequencer's per-step all-cell style rewrite with one
  coalesced RAF touching only the previous/current cell when visible. Hidden,
  scrolling and server-render views do no visual work. Stop cancels pending RAF.
- Add bounded UI-activity metadata to existing diagnostic snapshots/history so
  subsequent physical-device logs can correlate scrolling and clock progress.

No AudioContext suspension, DSP bypass, muted-layer shutdown, note scheduling,
sample-buffer, patch-format or audible render-compatibility changes. The server
render deck explicitly opts out of scroll budgeting; no freeze invalidation or
source ZIP rewrite is needed.

## Verification

Evidence and exact before copies: `output/page-scroll-20261029/`.

- Chromium and Linux WebKit at 402×768 and 768×402: four mixed-audio page-scroll
  cases pass. Fixed-width resize-driven waveform, geometry, relabel and warm-up
  calls all fall to zero, keyboard writes fall from 4,020 to zero, hidden
  sequencer style writes fall to zero, and large-surface blur becomes `none`.
- Native Chromium touch scrolling moves the page. Optional displays settle,
  genuine width/orientation changes still produce keyboard geometry, real
  final-bus AudioWorklet PCM remains nonzero, scheduled skips remain zero and
  audio/wall progress remains approximately 1.0 in both desktop browser engines.
- Eight additional L/X editor regression cases pass across both engines and
  orientations: real mixed PCM, no skipped or late notes, indicator resumption,
  keyboard pans/taps, Accent controls, stop/restart and modal cleanup.
- 56 focused unit checks pass, including five new scroll-budget/queue tests.
  The wider selected suite has 30 stale fixture failures, identical to its
  exact pre-task baseline; these are not reported as passing. All 77 inline
  scripts and both modified external JavaScript files parse.
- Six real isolated Song jobs pass: current/legacy/refresh in both engines,
  warm-cache reuse, rendered phone playback and audition, unchanged source
  hashes/revisions, zero phone source downloads and zero reserved bytes.
  The existing accent comparison remains approximately 3.527dB.
- Public demand-UI and diagnostic scripts return HTTP 200 with exact checkout
  bytes under new cache keys. The public guest shell stays approximately 6.6KB.
  The live server reads this checkout directly. Authenticated browser checks
  use disposable localhost stores, not production account/session changes.

Neither the desktop baseline nor the fixed browser fixture reproduces the
physical iPhone's slow clock. These results establish removed UI cost and
regression coverage, not a confirmed physical-device cure.

The checkout already contains extensive unrelated edits, including overlapping
app files. No mixed commit/push is made. `task-only.patch` is built from exact
pre-task copies and can be reverse-checked without reverting other work.
