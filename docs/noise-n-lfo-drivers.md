# N level LFO and random-mix drivers — NOISE-LFO.1

N now uses the same `isNoiseOscillatorActive()` predicate as the rest of the
performance controls: non-None noise stays enabled when its base level is zero
and any N Level LFO route is selected. The previous positive-base-level checks
in noise-card settings and tick silenced this case. Existing LFO depth, global
modulation amount, inversion, scaling and independent filter-envelope settings
are unchanged. Above-zero level modulation was already functioning.

Sparse and Mega resolve N's filter-envelope driver after all layer gates and
the drum-machine gate have been set. Normal Randomise rechecks after source
and Weird W replacement, before saving/restarting. Standalone Randomise N also
uses the eligible pool. Muting tracks manually does not rewrite a chosen driver.

Eligibility is evaluated from final enabled/solo/level getters and loaded audio,
not currently connected taps (these can belong to the stopped arrangement).
L/X must have a playable sequence and source; individual drum lanes need loaded
samples, a nonzero effective level and at least one active step. The drum-group
driver needs at least one eligible drum lane. M, M+, Q and K are deliberately
excluded because all random mixes mute them. Moving L1–L3 are included, with
L1 as the no-track fallback without unmuting or changing any other lane.

Browser regression: `tests/noise-n-lfo-driver-browser.cjs`. Uses isolated mock
accounts/API lists; blocks non-read requests and never updates production
Songs or recordings. Chromium/WebKit verify actual PCM for both visible level
LFO routes at zero, inversion, silence with routing removed, independent filter
driver, muted/zero/empty-pattern exclusions, final-gate ordering in 40 controlled
arrangements per engine, LFO fallback and preset recall.

Backup: `backups/noise-n-lfo-driver-20261025T163902Z/`.
Evidence: workspace `output/mygrain-noise-lfo-driver-20261025/`.
