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
