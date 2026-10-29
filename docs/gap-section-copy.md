# Gap section copy and repeated-waveform previews — GAP-COPY.1

Shared cut editor: A, B, C, V, W, P and O.

## Controls

With Gap On, choose **Copy** (one paste) or **Copy Sec** (fill/repeat to the
loop end), then tap the first source grid cell, last source grid cell and first
destination cell. Endpoints are inclusive; reverse-order selection is accepted.
Yellow outlines show the selected source section. Selecting it does not edit
any gaps. The paste is one normal draft-edit/Undo operation.

Both muted and audible intervals are copied, replacing only the destination
range. Overlapping copies use the captured source, not progressively modified
gaps. Copy Sec clips its last repetition at the loop end; it never lengthens,
shifts or wraps the audio. Fine fractional gap edges remain intact.

Tap the active copy button again to cancel. Closing, account changes/lock, Gap
Off, Clear Gaps and changing the grid/timing cancel the pending selection.
No system clipboard access or persistent clipboard state is used.

## Waveform

Section Repeat with Cut enabled now shows the section at each output position,
including its From Start / original placement and a partial final repeat.
Gap On also uses this output preview, including non-repeated placement/silence.
Dashed lines mark repeat boundaries. Existing red gaps overlay that output
waveform. The audition playhead follows output time, not a source cursor that
jumps back at each repetition. The trim handles still edit the original source
window or stretch destination, as the visible description explains.

This is a peak-envelope preview, including a scaled source envelope when
stretched, not a new audio render or a sample-exact representation of the
pitch-preserving DSP. It does not allocate a full-size rendered audio buffer.

## Persistence and server compatibility

No DSP, source asset, schema or saved-part compatibility revision changes.
Copy writes the existing normalized `gapEnabled`/`gaps` fields through the same
per-lane setter/history/Amend guards. Song capture/recall, server Song preparation,
DAW stems and audition all continue using the existing shared gap gate. Existing
prepared Song audio remains valid; saving changed gaps follows the existing
part revision/cache invalidation behaviour. Original source archives are intact.

## Checks

- `node --test tests/gap-section-copy.test.cjs tests/loop-gaps.test.cjs tests/vocal-loop-cut.test.js tests/loop-cut-audition.test.cjs`
- `tests/gap-section-copy-browser.cjs`: Chromium/WebKit, seven lanes, one-shot
  copy/repeat-fill, no selection-time edits, Undo/Redo, cancel/grid reset,
  375/390 portrait, 844 landscape and 1440 desktop containment, editable archive
  roundtrip and Chromium seven-lane saved Song amendment/save/recall.
- Existing `tests/loop-gap-render-browser.cjs` and
  `tests/loop-gap-amend-browser.cjs` cover real isolated Song rendering and
  stopped/running Amend controls. All stores are disposable localhost fixtures.

Rollback and evidence: `output/gap-section-copy-20261027/`. Extensive unrelated
working-tree changes remain untouched; no mixed-baseline commit/push or backend
restart is needed for these statically served UI files. Physical iPhone untested.
