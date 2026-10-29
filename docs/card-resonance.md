# Card filter resonance — RESONANCE.1

## Finding and fix

Every filtered loop lane reached the shared card FX graph, but the 0.1–4 resonance slider was passed as a linear number into native low/high-pass BiquadFilterNode.Q. Those node types interpret Q in decibels, unlike band-pass/all-pass. Thus the entire slider only changed the cutoff response by ~3.9 dB. Independent EQ uses explicit IIR coefficients and Wasp uses its own SVF; neither shares this error.

The card DSP now converts linear Q to native dB (`20 * log10(Q)`). Pole-pair Q values follow the selected Butterworth order, rather than cascading identical stages with unintended ripple. Only the highest-Q pair receives the resonance multiplier; default Q ≈0.707 gives a -3 dB corner at every slope, and Q=4 gives about +12 dB at the corner. This avoids multiplying resonance boosts across all poles. Values, saved state format, per-track independence, LFO clock, note envelopes, cutoff, bypass, reverb and delay controls are retained. The resonance label states Q and a short hint explains cutoff placement and Filter on.

Affected: A/B/C/V/W/P/O/L/X/M/M+/K1–K5/Q (17 lanes). N deliberately has no duplicate card filter. Production routing is exercised before the UI/node checks. No source assets or production songs were changed, and no unrelated dirty files were committed/pushed.

## Verification

- `tests/card-resonance-browser.cjs`: real production source starts establish all 17 routes; every visible resonance panel (including selected K tracks) updates its active audio graph. A low-level probe keeps otherwise idle graphs processing during AudioParam smoothing. Low/high-pass, all five slopes, real OfflineAudioContext PCM, preset and Song-state recall. Baseline old DSP intercepted from the before-edit backup: full sweep ~3.9 dB. Corrected DSP: ~32.04 dB low-to-high sweep, max corner +12.04 dB.
- WebKit + Chromium, native desktop 1440x1000 and iPhone-sized touch context 390x844: all four runs pass, all 17 lanes each.
- `tests/card-resonance-response-browser.cjs`: 30 full-band response curves per engine (both types, five slopes, three cutoff positions); maximum measured peak 12.125 dB. Bypass PCM identical with resonance/LFO changed.
- `tests/filter-lfo-clock-browser.cjs`: both engines, 20 native clock cases each pass; resonance edits preserve phase.
- 66 focused unit tests pass (card effects + note/sampler/solo). Syntax checks pass for both FX modules and all inline scripts.
- Additional unchanged EQ/Wasp tests have one pre-existing stale assertion: EQ expects 26 channels but now has 27. The exact isolated unchanged EQ module/test reproduces it; both files predate this task. HEAD archive was unavailable because those files are untracked. No unrelated assertion/code modified.
- Physical iPhone listening remains unverified.

## Delivery / rollback

Build `v2026.10.26.RESONANCE.1` in both badges; cache versions for `loop-card-fx.js` and `loop-card-fx-host.js` bumped in preloads and loaders. Supported live URL: https://openclaw.blackcarburning.com/mygrain/ . Verify all three served files match local bytes.

Before-edit copies: `backups/card-resonance-20261026/`. Task-only diffs and JSON test evidence live there.

Native API units: https://www.w3.org/TR/webaudio-1.0/#dom-biquadfilternode-q
