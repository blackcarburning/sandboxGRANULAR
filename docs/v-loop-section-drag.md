# Loop V: move a source cut

With Stretch Off, drag the highlighted waveform body (labelled “↔ Drag section”) left/right to choose a different source window without changing its length. Start/End still trim. Snap follows the existing grid; Snap Off moves continuously. The window clamps to the original source bounds. Gap-edit mode retains its tap-to-mute gesture and hides the source drag target.

The drag commits through the existing card-history draft edit as one Undo/Redo step. Existing cut start/end fields provide preset/state/reload compatibility; no new persisted fields or sample rewriting. Active audition updates on release using the established phase-preserving source restart. Stretch mode keeps its existing destination-moving/stretching behavior and hides the source drag button. Arrow keys move the focused section; Home/End align it to source edges.

Verification: `MYGRAIN_TEST_ADMIN_PASSWORD=isolated-vdrag python3 tests/song-beta-test-server.py 18926`, then `node tests/v-loop-section-drag-browser.cjs` (isolated localhost storage only). Runs Chromium/WebKit, native Chromium touch, snap/free movement, bounds/length, grouped Undo/Redo, active audition restart/origin, unchanged source, legacy preset/state fields and reload.
