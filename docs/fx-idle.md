# Effect bypass and display lifecycle · FX-IDLE.1

- Shared card space settings add backward-compatible `reverbEnabled` and `delayEnabled` booleans. Missing flags preserve old patches. Off retains mix/decay/time settings. Zero mix also disconnects the branch.
- Bypass removes feeds, returns and feedback cycles; hall IR buffers and pending rebuilds are released. Card filter bypass removes migrated Q high-pass too, and an unused filter LFO is stopped. Filter coefficient calculations are unchanged.
- Final and drum sends disconnect returns and feedback as well as feeds. Reverb buffers are dropped when off. Vocal M/M+ legacy space/chorus branches are disconnected when inactive; redundant native Q space is disconnected behind the common card effects.
- Zero-amount final/vocal compression uses a disconnected compressor and a 6 ms delay bypass, preserving native lookahead alignment (measured in Chromium and WebKit). A stable output handoff keeps Wasp insertion independent of compressor bypass.
- Existing final/drum buttons retain their authoritative action/state but are presented through synchronized checkbox adapters. Every common card has independent reverb and delay checkboxes; K uses the selected track's settings.
- Wasp already disposes its processors when disabled; regression verifies zero processors after retirement. No DSP coefficient optimization was made.
- Source/K/cut/lab waveform drawing is deferred using viewport intersection and page visibility; reveal paints current state. Paint and playhead jobs have separate slots. Hidden VU reset writes are suppressed; existing VU taps disconnect when hidden. Audio clocks, modulation drivers, recording, export and artwork encoding are not stopped by display visibility.
- Display DOM/canvas elements are retained, not repeatedly destroyed/recreated. Pausing avoids CPU work; destruction primarily trades memory for rebuilding cost and risks stale interaction state.

## Verification

`tests/effect-idle.test.cjs` covers portable switch state and disabled memory estimates. `tests/effect-idle-browser.cjs` blocks API writes and covers desktop and iPhone-sized Chromium/WebKit: native PCM on/off, repeated bypass/re-enable reachability, all 28 card-space switches, final/drum/vocal bypass edges, native Q space, save/restore, Wasp disposal and hidden/revealed waveform painting. Existing focused DSP/state tests also pass.

Two older tests have pre-existing mismatches: the RadioLab HTML integration assertion expects a 20261016 Q cache marker; the older loop-card browser test expects all 14 lazy panels mounted immediately. Both failures were reproduced against the pre-change files; targeted regression mounts the panels explicitly. Evidence and exact before-edit snapshots are in workspace `output/fx-idle-20261027/`.

Physical iPhone performance and CPU savings are not measured. Supported live host is `/mygrain/` on openclaw.blackcarburning.com. The checkout had extensive unrelated tracked/untracked changes before this task; those were preserved and not committed/pushed together.

## Randomisation switch policy — 2026-10-27

Patch/Merge, Mega and Sparse randomisation now explicitly set every common
card delay switch false (including all five K tracks), and every reverb switch
false except V and L. V/L may receive the existing subtle hall amounts. Wet
parameter values remain available for later manual enabling; they do not mean
an effect is active. Independent drum delay/reverb sends are also disabled on
the shared patch randomisation path. Final/global space already resets off.
Manual re-enabling and existing saved patch recall remain unchanged.

Regression: `effect-idle.test.cjs`, `loop-card-fx.test.cjs`,
`randomise-manual-loops.test.js`, and `effect-idle-browser.cjs` (random switch
reset plus native graph disconnection, zero disabled impulse/tail, recall).
Backup: `backups/random-space-off-20261027T205835Z/`.

Final verification: 20 focused unit tests and six server-arm tests passed;
Chromium/WebKit desktop/phone graph/UI checks and real isolated server Song
jobs passed with disabled nonzero wet settings. Live HTML/JS bytes match disk;
inline JS syntax and diff whitespace checks pass. Extra legacy sidechain suite
has 12 failures reproduced unchanged on the before-edit backup (3/15 pass),
not caused by this change. Physical-phone performance savings are unmeasured.

## Reverted: explicit disabled-track shutdown — 2026-10-28 · track-idle-2

**Rolled back at Mark's request on 2026-10-28 after reported app regressions.**
`index.html`, `loop-card-fx-host.js` and `noise-card.js` were restored from
`backups/track-idle-20261028/`; HTML uses fresh `track-rollback-1` cache markers.
Earlier explicit effect bypass work remains in place. The description and tests
below document the reverted experiment, not the current runtime contract.
Pre-rollback files: `backups/track-shutdown-rollback-20261028T165606Z/`.
Rollback verification: `output/track-rollback-20261028/` (within the app checkout).

Layer Off now parks the common filter/LFO, reverb, delay and EQ routing rather
than leaving a zero-gain DSP graph running. Re-enabling rebuilds the graph from
unchanged settings. K tracks park independently; offline contexts use their own
snapshot and are not gated by the editor. Enabled lanes retain finite tails.
N releases its looping sources, envelope worklet and driver taps while off or
stopped; enable/start/manual Trigger can rebuild them. Disabled main granular
streams stop scheduling/retire queued voices without stopping Q's independent
grain instrument. Disabled drums stop voices/sends and skip scheduling while
retaining transport phase for re-entry. X's existing voice shutdown is retained.

The isolated render-deck teardown must never wake a parked bus after its proxy
AudioContext reports closed. `active(g)` checks context state before rebuilding;
otherwise the server renderer catches an uncaught Cancelled exception after a
successful capture. Do not suppress renderer page errors to hide this failure.

Verification: `tests/track-shutdown-browser.cjs` covers repeated switches,
settings preservation, all five K tracks, noise manual restart, drums, grains,
X voices and offline PCM, Chromium/WebKit at 390×844 and 844×390.
`tests/track-shutdown-song-browser.cjs` covers current/legacy X snapshots through
real isolated server jobs, warm reuse, phone playback/Audition, unchanged source
hashes/revision, zero phone source downloads and zero memory reservations.
Evidence: `output/track-shutdown-20261028/`. No physical iPhone CPU/stutter
measurement; stopping idle DSP is verified, complete resolution of X's reported
stutter is not yet established. Mixed pre-existing checkout work remains intact.
