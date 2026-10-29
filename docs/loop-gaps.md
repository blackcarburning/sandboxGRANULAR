# Loop Cut A/B/C and non-destructive grid gaps

Build: `v2026.10.26.LOOP-GAPS.2`.
Live app: https://openclaw.blackcarburning.com/mygrain/

## Use

A/B/C now have Loop Cut beside Re-cut Loaded Sample. Their editor uses the same
trim, repeat, From Start, pitch-preserving stretch, snapping and auditions as V/W.
All five editors provide Gap On/Off and Clear Gaps. With Gap On, tap numbered
cells or the waveform to toggle multiple muted sections. Red marks show silence.
Gap Off bypasses without deleting the pattern. Clear Gaps erases only gaps;
Full Loop / Reset resets both the cut and gaps. The grid selector controls cell
size. Changing grid size retains existing absolute loop-relative mute ranges.
A partly muted cell is shown red; tapping it restores its overlapping region.

## Audio and storage

Cuts and gaps operate on derived playback buffers. Source PCM, duration and files
are not rewritten. Gap ranges use normalized output-timeline positions, applied
AFTER cut/stretch/repeat; mono/stereo use identical positions and short edge fades.
Gap enable is independent of cut enable. Source playheads hide during gaps.
Each A/B/C lane has independent cut state/audition lifecycle. Shared transport
stop, compressor-idle and running-status paths include their auditions.

New settings `bastardLoopCut`, `bastardLoop2Cut`, `bastardLoop3Cut` use the existing
preset/state modes, patch ZIP and Song snapshot paths. All five settings gain
`gapEnabled` (strict boolean, default false) and bounded, normalized/merged `gaps`
arrays (default empty). Legacy states default to no cuts/gaps. Existing format
versions and source asset schemas are unchanged. Gap/trim/stretch edits use the
existing draft-edit history, with Undo/Redo guards and open-editor refresh. Song
Amend is supported under its normal verified editing lease. Account lock closes
the body-mounted modal and stops its audition.

## Verification

- 54 focused gate/editor/audition tests pass:
  `node --test tests/loop-gaps.test.cjs tests/vocal-loop-cut.test.js tests/loop-cut-audition.test.cjs` (from repository, adjust test fixture cwd as needed).
- `tests/loop-gaps-browser.cjs`: Chromium + WebKit, all five lanes. Real muted PCM,
  stereo/full source duration, bypass, Undo/Redo, audible metronome and whole-loop
  auditions; 375 portrait, 844 landscape and 1440 desktop overlay containment;
  presets, legacy defaults, saved Song part and five source assets/recall.
- `tests/loop-gap-render-browser.cjs`: actual isolated Song AudioWorklet renderer,
  Chromium, all five lanes: 2s output with audible before/after and gap RMS around
  4e-9 versus around .02 audible RMS. Source assets remain 2s.
- `tests/loop-gap-amend-browser.cjs`: all five trim/stretch/gap controls during
  Song Amend, running edits, real Save Amendment and recall pass in Chromium.
- All inline scripts parse, diff whitespace check passes, and public index, cut
  JS/CSS and Song adapter return HTTP 200 with exact expected bytes. Both visible
  build badges and cache markers updated. No backend/service restart required.
- Physical iPhone testing remains unverified. Browser/song writes used only the
  isolated localhost server and temporary stores, never production accounts.

Backup/evidence: `output/mygrain-loop-gaps-20261026/` (original index, cut JS/CSS,
Song adapter, unit/browser/render/amend logs and phone screenshots). Existing
unrelated working-tree changes were preserved; no repository-wide reset or commit.
One supplementary pre-existing random-cut test fails with missing mock
`resetRandomizeGlobalMixSends`; the same failure was reproduced against the exact
pre-change index in the backup. Its other two tests pass; no randomizer was edited.
