# Drum Machine lane layout

Build `v2026.11.13.DRUM-LAYOUT.1` fixes the zero-width desktop lane title
caused by the EQ/automation subtree sharing the loading action grid.

Every lane now has the following visual and DOM order:

1. Lane title and retained source filename
2. Loading/sample actions; pitch, level, envelope/filter or Roll controls
3. Full-width 4-band EQ, enable and automation controls
4. Normalize/Bypass, Snare drive response and normalization status, where applicable
5. Original Accent Amount and Copy Sec row
6. Existing step hints, active copy prompt and step grid

Roll continues to share Snare's sample and normalization; no duplicate source or
normalization controls are introduced. Cards align their own rows to the top
rather than stretching them to match a taller neighbour. All original IDs and
handlers are retained. Phone lane actions and EQ touch targets are at least
44px tall; the existing lane scroller owns overflow, including on rotation.

## Compatibility boundary

Only UI mounting and scoped styles change. No DSP, buffers, sample schemas,
preset collection/import, native project state or Song render identity changes.
The native plugin consumes the same hosted UI; no native rebuild or render cache
invalidation is needed for this layout change.

## Regression

`tests/drum-lane-layout-browser.cjs` uses a disposable localhost account store.
It checks all eight lanes for ordered, nonintersecting controls and nested width
containment across desktop, constrained/plugin-size and touch phone viewports in
Chromium and WebKit; it exercises actual controls and saved control reload.
The existing Copy Sec regression additionally covers all lanes, Undo/Redo,
ratchets/accents, cancellation and reload. Browser iPhone emulation is not a
physical-device check.

## DPAN.2 — 2026-11-24

The entire Drum Machine shell is now the sole vertical scroll owner, including
the toolbar and sequencer snapshots. Previously those siblings could consume
all available phone height and shrink the lane-only scroller to zero. Close
remains sticky; lane jumps target the shell, including Snare Roll.

Every lane (Kick, Snare, Hat, Perc, Clap, Crash/Cymbals, ETC and Roll) has an
independent saved Pan control. Roll still shares Snare's source, not its pan.
Hat Accent buttons additionally accept horizontal swipes with accent On or Off.
A vertical yellow line overlays the Accent label at the effective pan position;
solid green fills toward the left and red toward the right. Taps still toggle
accent. Double-tap resets that hit to the overall Hat lane pan; Reset hat step
pans clears all overrides. Arrow keys adjust a focused hit; Home/Delete resets
it. Vertical gestures remain available for native dialog scrolling.

`drum-pan.js` owns optional `modes.drumPan` (preset root `drumPan`):
`{version:1,lanes:{hat:0.5,...},hatSteps:[null,-1,0,1]}`. Lane and hit values
are -1..1. Null/missing hit means inherit; explicit zero overrides a nonzero
lane with centre. Accent power never gates pan. Neutral untouched patches omit
the field and bypass the panner node, retaining legacy graph/content identity.
Panning applies per voice before EQ/bus, so sampled/synth hats, ratchets, Roll,
Cooking Pot and isolated/native/offline render decks share the same policy.
Per-hit values persist with presets/device/native projects and Song source ZIPs;
drum sequencer snapshots and Copy Sec include them. Source PCM is unchanged.

Only enabled drums with nonzero saved pan require `drumPanVersion:1`. Song
validation strictly checks values, content identity includes the new recipe,
and render POST/GET reject missing/stale pan capability even if summary metadata
is absent. Existing no-pan content hashes and old prepared audio stay valid.
The generic server-arm worker executes the same updated app; no separate DSP
implementation or new worker pool is introduced. No native binary reinstall
is required. Tests: `drum-pan-browser.cjs`, `drum-pan-song.cjs`,
`drum-pan-state.cjs`, `test_drum_pan.py`, and the existing lane layout suite.

## DPAN.3 — persistent lane navigation

Keep the existing title/Close, solo hint and all eight original lane/solo buttons
in one opaque sticky frame at the top of the dialog, before the toolbar and
snapshots. The whole shell still scrolls, so snapshots cannot collapse a separate
lane-only scroller. The frame is measured with ResizeObserver; scroll padding
and all lane jumps (including Roll) account for its responsive height. The
existing double-tap solo handlers and buttons are moved, never cloned. Scroll
paint deferral follows the shell. Pan/audio/state contracts are unchanged.
`tests/drum-navigation-browser.cjs` checks buttons at the final lane, every jump,
trusted double-tap solo/unsolo stopped and solo while playing, snapshots scrolling
and Close in Chromium/WebKit phone, landscape and desktop contexts.
