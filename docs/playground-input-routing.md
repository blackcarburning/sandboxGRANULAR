# Filter Playground input routing (2026-11-11)

All effect excitation selectors are labelled **Input**. Existing state keys remain
unchanged (`route`, `source`, `input`) to retain old patches. Modulation source,
Destination, output routing and the drum kick bypass are separate concepts.

Playground stores optional `modes.wasp.playground.input`: missing/All retains the
exact legacy whole-mix graph and canonical content identity. Its input list uses
the existing card/track/drum groups plus VST3 FX host input. Presets, preset +/-
browsing, Mega and BIG STIR retain Input. Input does not alter preset matching.
Saved JSON, editable ZIP, browser restart, Undo/Redo, native project storage and
Song parts use the canonical Wasp settings, not a proxy control.

## Graph owners

- `wasp-dsp.js`: bounded input enum and normalization; omit default All.
- `wasp-host.js`: selected carrier uses master worklet input 4; inputs 1–3 remain
  independent modulation detectors. `acoustic-fx-host.js` source lifecycle events
  refresh those carrier connections, including new/ended notes and external input.
- `wasp-master-desktop.js` / `wasp-master-phone.js`: All branch is untouched.
  Selected carrier filters only the chosen stem, subtracting its dry contribution
  from main dry and assigning its wet portion to Playground's monitored return.
  Wasp itself is not repowered or rerouted by this selection.
- `cooking-pot.js`: a stage receives its selected original stems plus earlier wet
  carrier; passes resolved-input mode to the same engine. Per-frame coefficients
  attenuate earlier wet returns, but only selected original stems. A distinct dry
  correction retains unrelated main dry and later source-selected stage bases.
- `cooking-pot-worklet.js`: optional selective base and dry-correction port 13.
  Only active earlier stages affect the correction (an Off Turntable must not suppress it).
  All-input arithmetic/order is retained. Monitoring and Through main output still
  belong to `effect-output.js`; no fader/source ownership changes.
- `backend/mygrain_songs.py` / `song-beta.js`: validate input, advertise and require
  Playground render revision 3 for active selected-input settings. Missing/All and
  disabled Playground preserve old revision/hash behavior. No source migration.

## Verification

`tests/playground-input.test.cjs` and `tests/test_playground_input.py` cover
normalization, carrier isolation, unrelated dry preservation at 44.1/48 kHz,
phone/desktop DSP, per-frame Pot decomposition, input validation and targeted
render identities. Release evidence additionally covers real card controls,
Solo/Master-zero PCM, archive/restart recall, actual server jobs, legacy reuse,
WAV output, reordered chains and stale-marker rebuilds in an isolated account.
