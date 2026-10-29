# N filter-envelope threshold

Build v2026.10.25.N-THRESHOLD.1 fixes threshold being bypassed in Amplitude Follower mode.

- Detection measures absolute L/R independently, then applies Driver sensitivity and detector smoothing. Threshold is on this normalized 0–1 signal, not the raw track level.
- Triggered ADSR fires at full envelope strength on an upward crossing; Envelope Depth controls the sweep, independently of threshold. Rearming requires falling below half threshold.
- Amplitude Follower opens its gate at threshold and closes below half threshold, with existing attack/release smoothing and amplitude-sensitive depth. This is gating, not subtracting the threshold from the amplitude.
- Editing threshold or sensitivity rearms detection and reevaluates the follower gate. Active ADSR tails are preserved.
- Manual trigger bypasses threshold; the threshold slider is disabled for the Manual driver. Invert applies after gating. N Level and its LFO remain separate from this filter envelope.
- With high sensitivity, drivers can reach full scale and exceed every threshold setting; reduce sensitivity to discriminate quieter/louder hits. Existing patch schema and threshold ranges remain unchanged.

Verification: `node --test tests/noise-n.test.cjs tests/noise-n-threshold.test.cjs`, `node tests/noise-n-threshold-browser.cjs`, `node tests/noise-n-browser.cjs`. Native Chromium/WebKit tests compare anti-phase sidechain pulses against two threshold settings and verify both modulation rejection and audible filter-output energy changes.
