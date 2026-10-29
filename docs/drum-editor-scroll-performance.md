# Drum-editor scrolling / audio — D29.1

Supported app: `https://openclaw.blackcarburning.com/mygrain/?v=2026-10-29-drum-scroll-1`.
The drum-editor title shows `D29.1`.

## Confirmed overhead and changes

- The global modal scroll guard observed every descendant class/style change.
  Sequencer highlights and Roll position text repeatedly caused document-wide
  modal queries and visibility/layout reads. Filter the observer to actual panel
  insertion/removal or visibility changes on panels and their ancestors.
- Replace the document-wide non-passive gesture guard with panel-owned fallback
  listeners. On browsers supporting CSS overscroll containment, both the drum
  overlay and its nested dialog shell use native scrolling without that guard.
  Other modal panels retain boundary protection and background scroll restoration.
- Remove the opaque drum editor's unnecessary full-screen backdrop blur and
  animated button shadows/transforms. Contain each lane's layout and painting.
- Audio scheduling queues bounded numeric visual events, not a timeout per step.
  One RAF consumes the latest due event and drops obsolete visual updates. Closed,
  hidden and server-rendered editors enqueue none. Stop/close cancels the frame.
- Suppress playhead painting during scrolling and for 160 ms after the last scroll
  event. Offscreen lanes, including Roll, do no per-step DOM work. Roll updates only
  its previous/current cells and changed position text; stopping clears its old
  highlight even when offscreen.

The audio scheduler, samples, DSP, envelopes, patch format and saved Song render
compatibility are unchanged. This does not reinstate disabled-layer DSP shutdown.

## Verification

Evidence and exact pre-edit copies: `output/drum-scroll-20261029/`.

- Before: 76–93 modal scans and 99–109 Roll mutations during each roughly
  three-to-four-second scrolling fixture, despite Roll being offscreen.
- After: zero sequencer-triggered modal scans and zero offscreen Roll mutations.
  Chromium's single remaining modal scan is the gesture-start synchronisation,
  not animation. Native touch scrolling succeeds in Chromium.
- Chromium and Linux WebKit: 390×844 portrait / 844×390 landscape, real final-bus
  AudioWorklet PCM, all drum lanes active, repeated scrolling, no skipped steps,
  zero measured late hit scheduling and no global control refresh per note.
  Visible Roll resumes, stop/close clears the bounded visual queue/frame, and
  dynamic/ancestor-hidden modals still lock and restore page scrolling.
- Existing accent-control browser checks: 390×844, 844×390, 320×640 in both engines;
  eight visible controls, gain change, Undo/Redo and save/reload pass.
- Six real isolated server Song jobs (both browser engines, current and legacy
  snapshots, refresh), warm reuse, playback and audition pass. Original source
  hashes/revisions stay unchanged, phone source downloads and memory reservations
  remain zero, current/legacy accent PCM ratio remains approximately 3.527 dB.
- 77 inline scripts and the changed external JS parse. The 41-test drum unit
  slice has 22 passes / 19 pre-existing stale-fixture failures, identical to the
  exact pre-edit baseline after adding the new visual-cleanup fixture stub.
- Live JS/CSS HTTP 200 bytes match the checkout exactly; guest login remains a
  small no-editor shell. The configured live server reads this checkout directly.
  Authenticated editor behavior was tested against the same source using the
  disposable localhost account store; no production account/session was created.

Physical iPhone CPU/memory behavior and the reported audible near-halt were not
reproduced on hardware. These results establish removal of UI overhead and clean
browser audio fixtures, not a confirmed hardware-level cure or a memory-leak cause.

## Scope and recovery

Changed app files: `index.html`, `drum-roll.js`, `drum-enhancements.css`.
The regression test is `tests/drum-scroll-audio-browser.cjs`; the existing Roll
unit fixture gains a stub for the new visual-cleanup helper.

No commit/push: the checkout already contains extensive unrelated, uncommitted
feature work in these same files. The exact before/after task patch is retained
in the evidence directory rather than committing other work. Any rollback must
apply only this task's patch, preserving subsequent edits and earlier repairs.
