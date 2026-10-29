# N · independent noise — NOISE-N.1

Noise now lives in its own N card, after drums, with a navigation jump. This is
separate from OSC3's instrument noise oscillator. The old granular Noise tab's
controls and IDs (`noiseType`, `noiseMix`) move into N; the mixer Noise slider
and action button remain linked. N is an independent white/pink generator,
not a sample/noise crossfade: changing N no longer attenuates granular samples.
No recorded audio files or X sample amplitude envelopes are changed.

## Audio and control

- Stereo white and Kellet-style pink noise; independent level, Play/Stop and
  On/Off. N enters the shared master/final-output path, bypassing the granular
  filter. The mixer Noise meter reads N's actual output. Global transport,
  Stop, Panic, background-playing state and engine reset include N.
- Filter bypass, low-pass, high-pass, band-pass and notch; 2/4/6/8/12/16 poles,
  resonance, cutoff and 0–24 dB noise drive. Low/high-pass sections use
  Butterworth Q distribution, converting Q to native Web Audio's dB convention.
  Type/pole/bypass changes crossfade; parameter and volume changes smooth.
- Filter-envelope depth −8 to +8 octaves. Triggered ADSR has Attack, Decay,
  Sustain, Hold and Release; amplitude-follow mode uses Attack and Release.
  Driver sensitivity, threshold/hysteresis and inversion are independent.
  The Trigger button works even from stopped playback.
- Drivers: global L1/L2/L3; A/B/C/V/W/P/O/L/X/Q/M/M+; generated and Dropbox
  sample loops; K1–K5 individually or combined; Kick, Snare, Hat, Perc, Clap,
  Cymbals, ETC and Snare Roll individually or combined.
- Taps are parallel, detection-only copies of channel-EQ input audio (post
  common loop FX for loop lanes). They never disconnect, replace or modify a
  source's audible route. Only the selected driver is connected to the detector.
  L/R detection uses the greater absolute amplitude, preserving anti-phase
  stereo activity. The worklet emits only modulation cents to **N's detune
  AudioParams**; no driver audio has a return to the mix.
- LFOs are evaluated on the audio clock using existing global rate, waveform,
  depth, pulse-width, phase and cross-modulation settings. Per-sample evaluation
  avoids temporary arrays. Start/Stop gating uses a native AudioParam: asynchronous
  start messages can miss WebKit offline renders. Both channel count and output
  control count are explicit.
- Dispose disconnects taps, stops noise sources, retires branches and terminates
  the worklet via acknowledged disposal. Render-deck cleanup explicitly owns N;
  its buffer/worklet allowance is included in Song memory planning.

## Randomisation and saved data

N is an equally weighted optional layer in both Sparse and Mega, with no change
to their fixed Bass X / random layer counts, drums or manual-loop mute policy.
Full-patch randomisation randomises N's filter, driver, envelope, type and a
bounded 6–22% level. Layer selection then enables N only when selected.

Canonical settings are `state.modes.noiseN` version 1; preset export uses
`preset.noiseN`. Native N controls are excluded from generic DOM snapshots;
legacy level/type controls remain for backward compatibility. Missing N data
uses explicit legacy `noiseType`/`noiseMix`, with fresh filter/envelope defaults,
never the current patch's N settings. Songs capture, render and recall N without
additional source assets or source WAV rewriting. Old cached Song renders are
not rewritten by this deployment.

## Verification

- `node tests/noise-n.test.cjs`
- `node tests/noise-n-browser.cjs` (Chromium/WebKit, read-only production-static
  fixture; all non-GET and API writes blocked)
- `node tests/noise-n-song-browser.cjs` against the isolated localhost test server
  with disposable stores only; captures N, Arms/renders and recalls settings.
- Existing Song/FX compatibility and drum/randomisation tests.

Native browser checks cover all 24 filter mode/pole combinations; zero PCM
change in tapped source audio; changed N response with anti-phase driver input;
manual trigger, LFO phase equivalence, standalone master output and silence
on Stop; patch/preset/legacy restore; Sparse/Mega participation; phone,
landscape and desktop layouts. Physical Safari/device listening is not verified.

Backup: `backups/noise-n-20261025T155111Z/`. Evidence:
`output/mygrain-noise-n-20261025/`. Preserve unrelated working-tree changes on rollback.

## NOISE-N.2 — shared mixer and layer controls

- Layers: N Noise On/Off, Jump to N, and additive Solo, using the existing
  layer-switch row styling. The Granular status remains next to its own row.
- Mix: the existing slider is labelled N · Noise Level, retains the N output
  VU meter, and now has shared Solo and a corrected direct Jump to N.
- N's own card has Solo. All three solo buttons synchronize, use the common
  isolation/clear-solos path, and preserve N selection in patch/preset recall.
  Solo changes immediately refresh N's gain, including when modulation is idle.
- On/off and level remain linked across N, Layers, Mix and Actions; no saved
  schema, source audio, EQ or Song data migration is required.
- `tests/noise-n-controls-browser.cjs`: read-only API fixture, Chromium/WebKit,
  reciprocal controls, all solo buttons, actual audio silence under another
  layer's solo, audible own solo and clear, patch/preset restore, both jumps,
  phone/landscape/desktop overflow checks.
- Keyboard-solo fixture maintenance: include the existing W gain-refresh stub;
  validate matching build badges/versioned Q script without pinning an old build.

Backup: `backups/noise-n-controls-20261025T160331Z/`. Evidence:
`output/mygrain-noise-n-controls-20261025/`. Physical-device listening unverified.

## Startup preset — 2026-10-25

Every normal app startup resets N off, amplitude follower driven by Drums All,
+8 octave depth, 50 ms decay/release, sustain 0, filter on low-pass 16 poles
(96 dB/oct), cutoff 80 Hz. Other settings retain their stored values. Explicit
patch/Song/Undo restores retain saved N settings. Randomisation always disables N;
AI can explicitly enable it using noiseMix. Follower uses attack/release rather
than ADSR decay/sustain.
