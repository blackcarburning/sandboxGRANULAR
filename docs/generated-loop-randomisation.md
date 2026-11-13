# Generated Loop randomisation

Policy, 2026-11-10:

| Entry point | Generated dry-loop sound layer (`Loop On` / `Loop Off`) |
| --- | --- |
| Ordinary Randomise | Fresh independent 50% on/off choice, rather than retaining the old switch |
| Sparse | Eligible in the existing three-layer lottery, alongside fixed X and drums |
| Mega | Eligible in the existing five-to-nine-layer lottery, alongside fixed X and drums |
| Manual / saved ZIP / reload | Preserve the chosen saved switch; do not rerandomise |

The separate shared transport clock remains available. `Loop Enabled` is not
the sound-layer switch, and Q's unrelated `Loop On` range control is unchanged.
Generated source synthesis and its parameter randomisation still run when this
sound layer is Off. Sparse/Mega apply their final lottery after sample loading
and before the history snapshot, so source generation cannot force the layer On.
Confirmation text describes eligibility, and completion reports the actual gate.
The five-effect reload/Sparse/Mega policy and single-source Wasp cap are unchanged.

## Saved parts and server rendering

The existing `modes.generatedDryLoopEnabled` field remains authoritative.
`saveState` / `restoreState`, Song's snapshot adapter, `song-beta-clock.js`'s
isolated deck and `scripts/server-arm-worker.cjs` already preserve and render this
flag. This change chooses a new value during generation only; it does not change
DSP, source identity, ZIP format or the meaning of existing saved values. No
render-compatibility bump, source rewrite or cache invalidation is needed.

## Verification

Run against an isolated loopback fixture with its own account store only:

```sh
MYGRAIN_TEST_URL=http://127.0.0.1:19271/mygrain/ MYGRAIN_TEST_OUTPUT=/path/to/evidence node tests/generated-loop-random-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:19271/mygrain/ MYGRAIN_TEST_OUTPUT=/path/to/evidence node tests/generated-loop-random-server.cjs
```

The fixture uses dedicated `isolated-vst3-test` credentials, never production
accounts. Browser checks retain actual source synthesis, buffer application,
transport, history and ZIP paths while stubbing unrelated sample acquisition.
They cover both gate outcomes in all three modes, fresh finite/nonzero PCM,
canonical state, button state, muted gain, Undo/Redo, ZIP and reload after Start
(main source controls hydrate at Start). Deterministic draws exercise the
ordinary 50% coin; batch tests search seeds through the real layer lottery.
Server checks render saved On/Off to audible/silent PCM, retain source
hashes/revision, reuse warm renders and exercise phone-style PCM playback.
Physical phone listening remains untested.
