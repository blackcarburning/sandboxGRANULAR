# Global mix FX controls — 2026-10-25

Live build: `v2026.10.25.GLOBAL-FX.1`, `/mygrain/`.

- Full patch, Mega and Sparse randomise end with `finalDelayDepth=0`, `finalReverbMix=0`, and `finalReverbEnabled=false`. The full patch also clears sends before randomisation begins, and finalisation clears any global-send modulation routing even on failure. Do not add these resets to generic `applyFinalBusDefaults`: that helper also runs on startup/preset load and must preserve manually saved FX sends.
- Actions: **Delay Off** sets the global mix delay send to zero, smoothing the existing wet path to silence.
- Layers: **Delay On/Off** controls the same `finalDelayDepth` slider, remembers the last positive send during this page session, and uses 25% if there is no previous send (or after randomise).
- Layers: **Reverb On/Off** shares `finalReverbEnabled` with Actions. Turning it on from a zero send uses 25%; turning it off keeps the configured mix but bypasses reverb as before.
- Buttons follow slider changes and restored state. Their cached state avoids idle DOM mutations from repeated effects updates.
- Card-specific effects are not changed by the new controls. Randomise retains its existing per-card randomisation policy.
- No new persistence keys or import/export schemas. Delay Off persists through the existing zero-send slider; reverb uses its existing enabled flag. Older patch/Song values still use the same fields and are not forced dry on restore.

Backup: workspace `output/mygrain-global-fx-20261025/before-20261025T132708Z/` (exact deployed HTML and load notes).

Verification: disposable read-only Chromium/WebKit browser contexts, mocked identity/API reads, blocked server writes and off-origin requests. Actual randomisation/settings orchestration is exercised; only sample-generation/loading I/O and playback restarts are stubbed. Both sends stay zero for normal/Mega/Sparse and an injected internal-randomiser failure. Actual wet gains are positive on enable and zero after off; slider-driven labels, send restoration, both reverb surfaces, mobile portrait/landscape layout and saved-state reloads are checked. 125 unchanged button syncs produce zero mutations.

34 FX/sidechain/Pan Lab/manual-layer regression tests pass. One existing defaults test had a stale startup regex (baseline also failed because `warmKeyboardSound()` now sits between restore and defaults); the assertion now permits that existing call and requires the new Mega send reset. All 57 inline scripts and changed external JS parse; diff whitespace check passes; public HTML and load notes return HTTP 200 with exact bytes. Evidence: workspace `output/mygrain-global-fx-20261025/`.

Safari's reported crackle remains unresolved. These controls/defaults are not a claimed cure.

## Global filter routing repair — 2026-10-26

`rebuildFinalFxRouting` clears outgoing connections from **both** possible filter sources (`preFilterGainNode` and `finalFxOutput`) before wiring the selected placement. Previously only the active source was cleared by `rebuildFilterChain`: Post→Pre retained a parallel dry filter tap, and Pre→Post retained FX Out→filters, completing an unintended filter/FX feedback cycle. Gain boosts amplified the problem; no microphone route is required.

Mega/Sparse finish by calling `resetMegaRandomGlobalProcessing`: HP/LP bypassed, filter/trim modulation cleared, auto makeup off, input/output trims at 0 dB, filter envelope and legacy phaser/tremolo depth zero, Panlab reset, and shared delay/reverb sends disabled. The final state is saved after cleanup. Per-instrument filters and effects are preserved. Completion uses the existing non-interactive settle popup with a 4.5-second timeout.

Regression checks: `tests/global-filter-routing-browser.cjs` traces live connections across repeated pre/post switches and renders stereo PCM impulses through the production routing functions at 8× combined trim. `tests/global-filter-random-browser.cjs` runs real Mega/Sparse orchestration with sample I/O mocked, checks resets and the disappearing popup, and retains global delay/reverb control coverage. Network writes are blocked in both fixtures.
