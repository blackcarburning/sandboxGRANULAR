# VU visibility and card jumps — VU-VISIBLE.1

Live marker: `v2026.10.29.VU-VISIBLE.1`.
Launch: https://openclaw.blackcarburning.com/mygrain/?v=2026-10-29-vu-visible-1

## Scope

Follow-up to PAGE-SCROLL.1 after Mark reported renewed slowdown on reaching VUs.
This removes display work; it does not establish the physical iPhone's native
slow-clock cause or change audible DSP, transport, source audio or Song freezes.

Inventory in the current shell: **41 VUs** — 30 mixer channels (including
Piano/Strings/keyboard sample and Noise), one output, one keyboard recording
input, two microphone inputs, five K playback tracks, and M/M+ playback.
The old optional second master-shell reference is harmless when absent.

## Display lifecycle

- A shared IntersectionObserver-driven scheduler serves mixer/output/recording
  inputs at 125ms (8Hz). No visible registered meter means **no meter timer**.
  Intersection changes restart it; there is no offscreen polling clock.
- K and M/M+ stereo playback taps also run at 8Hz, down from 20Hz. They retain
  stereo energy measurement (no opposite-phase cancellation), clipping/peak
  hold, and existing capture/audible connections.
- Every path pauses on touch scrolling, viewport-height settling, jumping, hidden
  documents and page hide. Only display branches detach, never audible routes.
  Context suspension stops inputs; account lock removes subscriptions.
- IO can lag layout shifts. Immediately before each active read, check only
  that tiny active set's actual viewport bounds, not the full mixer list.
  Painting rechecks visibility too. A preceding label cannot cause a later
  newly offscreen meter to paint. Observer visibility alone is insufficient.
- Use 512-sample display windows where separate taps permit it; leave the
  shared final-pan analysis and microphone recording streams unchanged.
- Quantise bars, cache unchanged values, update numeric/ARIA text at most 2Hz,
  keep labels from wrapping/changing width, use transform-based fill changes,
  and remove interpolated width/left animation and dynamic glow. Small bar
  containment limits local layout/paint work. No permanent will-change layers.
- Adjacent M/M+ waveform/cursor clocks pause too, so they do not defeat VU
  scroll/jump suspension. Existing waveform queues coalesce and redraw after
  the jump/scroll budget clears.
- Existing bounded diagnostic audio sampling remains available independently
  of VU visibility; it is not GUI rendering. Tests distinguish those reads.
  Diagnostic snapshots now include VU active/timer counts for later phone logs.

## Jumps

The existing transition API now applies to touch/phone as well as desktop:
opaque **black**, plain **jumping**, then the destination's top (respecting its
scroll margin). No logo decode or blur. Cover the first frame before changing
scroll position; await lazy controls/readiness, resolve replaced lazy cards,
settle layout, correct top alignment, then reveal. Mixer shortcuts and gain-stage
jumps target the relevant card header instead of centring the slider.

Granular Ready starts its existing gesture-sensitive audio-readiness call in the
original click before handing its asynchronous arrival to the curtain. This
preserves activation authority. Transport is not a Jump. Escape, replacement
jumps, page visibility and errors retain cancellation cleanup.

## Verification and delivery

Evidence: `output/vu-visible-20261029/`. Browser fixtures use disposable
localhost account stores and synthetic real Web Audio signals, never production
account/session mutation. See `browser.json`, `focused-unit.log`, `mic-unit.log`,
`desktop.log`, `server-song.log`, and live asset hashes for the final outcomes.
Final core checks:

- 31 meter/keyboard/visibility/jump unit checks plus two focused microphone checks pass.
- Chromium and WebKit, 402×768 and 768×402: 41-meter inventory, all seven
  playback VUs, no offscreen VU sampling/paint or active polling clock,
  scroll pause/resumption, native phone drawer tap, black mask and card tops.
  Chromium pass receipts are in `chromium-and-initial-webkit.log`; the old
  WebKit fixture needed to wait for that specific meter's first paint instead
  of another meter's sample. The final WebKit cases and per-case JSON pass.
- Both engines at desktop 1024×768: 44 main destinations each, 19 matching
  card colours, zero bad curtain frames/errors, mixer/gain shortcuts, modal
  navigation, delayed readiness, superseding, Escape and transport checks.
  The legacy fixture was adapted to real isolated auth/current startup,
  overlay click guards, pure black, and intentionally non-blocking bookmarks.
- Six real isolated current/legacy/refresh Song jobs pass, warm reuse, phone
  rendered playback/audition, unchanged source hashes/revisions, no phone
  source downloads and no outstanding reservations.
- Mixed L/X/drum/loop page-scroll regression covers both phone orientations
  and engines: real PCM, no skipped steps and no height-only resize work.
- Granular Ready + Jump also masks and arrives at the keyboard card top in all
  four mixed-audio cases, while retaining its original gesture-sensitive call.
- All 79 inline scripts and four changed external scripts parse. Four live
  scripts return HTTP 200 with exact checkout bytes; guest shell is HTTP 200.

The earlier two unrelated iphone-efficiency fixture errors (missing globals)
reproduce against the exact pre-task HTML; they are not claimed as passing.

The server reads this checkout directly. Extensive overlapping edits predate
this task, so no mixed commit/push is made. Exact before copies and a reversible
task-only patch preserve those edits. Physical iPhone confirmation remains
necessary; desktop Chromium/WebKit emulation is not native-device proof.
