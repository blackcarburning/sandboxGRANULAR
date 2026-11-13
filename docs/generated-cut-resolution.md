# Generated sample-cut policy — 2026-11-03

Mark's rule: every randomisation and AI generator may generate sample cuts only
at `2` or `1` resolution: two bars or one bar. No fractional or finer fallback.

Coverage:
- Ordinary/Mega/Sparse generated sample requests, plus A/B/C/V/W/P/O selectors.
- Per-card cut randomisation: shared `randomize`/`randomizeV` choose widths and
  stretch targets only from two/one bars, ignoring a previous fine manual grid.
- Local A/B/C re-cutting uses the same allowed divisions.
- D random gaps are whole-/double-bar gaps, not single sequencer cells.
- AI server/client schema admits only `2` and `1`; the execution adapter clamps
  direct/legacy recipe input too, including reloads without explicit divisions.
- Backend sample generator normalizes again so stale clients cannot request fine
  cuts. Short/partial-bar patterns remain a single intact event.
- InstaReel A/B/C/W and optional V variations share the coarse randomiser; D
  uses the same coarse gap helper. One-bar loops need not change every repeat.

Manual cut editing and old saved cut settings remain valid. Saved audio is not
rewritten, no source ZIP migration is performed, and unchanged render freezes
are not invalidated. Song preparation uses the same shared engine; the existing
server/isolated render deck therefore retains current and legacy cut metadata.

Verification: 33 JS randomisation/reel tests, 22 AI backend tests, 2 server
scheduler/schema tests pass. `v-random-divisions-browser.cjs` passes Chromium
and WebKit: native random button, source/output widths, all seven Mega division
selectors, AI adapter, Undo/Redo and original buffer identity. Its Chromium Song
branch renders current, legacy fine-cut and pre-cut source snapshots through real
isolated server jobs; nonzero PCM, unchanged source hashes and warm-cache reuse
pass. Live vocal-loop-cut.js, loop-d.js and AI schema match exact deployed bytes.

Before-edit backup: `output/mygrain-coarse-cuts-20261103T121032Z/` in the parent
workspace. The live documenter service was restarted for backend/schema changes.
