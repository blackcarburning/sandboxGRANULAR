# Global additive Solo

Build: `v2026.11.11.SOLO.2`.

## Ownership and signal routing

`effect-output.js` owns the additive effect Set and queries the existing source
selection arrays through `hasAnyPerformanceLayerSoloSelection()`. The source
mask includes loop cards, keyboard/source instruments, grains, raw waveform
audition, legacy Sample Solo and drum lanes. `changedSources()` notifies every
effect host whenever that mask changes.

- Source-only Solo keeps the selected dry sources and silences all nine semantic
  effect returns. An unselected insert is effectively bypassed, including at 100%
  wet, rather than merely muting its return and removing the selected dry source.
- Effect-only Solo mutes dry and competing returns after excitation taps. Source
  drivers keep running so the selected effect can still be heard.
- Source + effect selections keep the selected sources and selected effects.
  Every target is added/removed independently across effect families.
- Native and reordered Pot stages use the same mask. Canonical powers, recipes,
  order and Through-main settings remain unchanged.
- Mutilator, Bass Face, Wasp and Turntable now have effect Solo buttons alongside
  the existing R, Wire World, Sonic Crystal, Bubble Chamber and Playground buttons.
- Drum-lane double-tap solos join the source mask. Their voice-level gates can
  silence already-held hits without changing scheduled envelopes. Selecting the
  whole drum card includes all lanes, even with individual lane selections retained.
- R Graph/Source audition remains exclusive within R, not across other effects.
  Q Solo Note remains its explicitly chord-local editor preview.

`clearAllPerformanceSoloStates()` clears source, lane and effect selections.
Powering/loading another loop no longer clears existing loop solos.

## Saved state and render compatibility

Effect Solo and R audition remain transient and are absent from patch state. Live
output recording intentionally captures the monitored mix. Offline/isolated Song
decks ignore the live effect Set but honor canonical saved source/lane selections.

The backend `effect_output_render_version()` and matching Song helper emit
`effectOutputVersion: 2` only for nonempty saved source/lane Solo selections.
Existing no-Solo patches retain their prior signatures and render identity.
Render submission accepts revisions 1 and 2; admission checks the required version.
Older v1 source-Solo renders receive one targeted refresh, without source ZIP
rewrites or unrelated render jobs. Warm playback remains metadata + rendered PCM.

## Verification

- `node --test tests/global-solo.test.cjs tests/mixer-layers-solo.test.js tests/drum-lane-solo.test.cjs`
  covers all 1,024 source/effect masks, additive removal, offline boundaries and
  source/mixer/button synchronization.
- `tests/global-solo-browser.cjs`: actual controls, all nine canonical effects On,
  D-only final PCM with injected competing semantic returns, max-wet insert bypass,
  card/grain/effect/lane unions and held drum-hit final PCM. Run Chromium/WebKit
  desktop and touch profiles against an isolated authenticated server.
- `tests/effect-solo-browser.cjs`: all nine selected effects, competing return
  rejection, native/Pot routing, R analytic audition, WAV monitoring and restart.
- `tests/global-solo-song-browser.cjs`: real worker renders for D and drum-lane
  Solo in native/Pot modes, legacy no-Solo identity, transient effect exclusion,
  selective stale-v1 refresh, warm reuse, phone playback and stable hashes/revision.
- `tests/test_global_solo.py`: backend revision selection and exact before/after
  identity for unaffected legacy and manually enabled effects. Set
  `MYGRAIN_BASELINE_BACKEND` to the pre-change backend for identity comparison.

Use only isolated account/Song stores for these tests. Do not mutate production
Song records to simulate old render metadata.
