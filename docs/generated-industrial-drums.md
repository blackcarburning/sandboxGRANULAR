# Generated Sample/Loop industrial character

Build `v2026.11.12.PINKDRUMS.1` changes only newly synthesised Sample/Loop audio
in `index.html:generateRandomSourceSample`. Loaded WAVs and the sample-based Drum
Machine are unchanged. All generator entry points using this function share it.

The former down-pitched, extended sine bodies and continuous sub/noise bed are
replaced by short integrated-pitch kick transients, damped inharmonic impacts,
pink-noise-led snares/claps, restrained metallic accents and noise-led optional percussion.
The PINKDRUMS refinement reduces pitched/metallic body sharply, caps kick decay at
85 ms, impact decay at 65 ms and other hit decays at 45 ms (randomised shorter),
and truncates inaudible tails at seven decay constants. Kicks retain a brief low
punch. A deterministic seven-state pink filter replaces the high-passed white
noise; its pole time constants track sample rate. Low Noise mode reduces its gain.
Seeded per-hit circuits vary decay, pitch, FM depth, drive, gated noise, restrained
quantisation and transient modulation. Heavy hits retain narrow stereo placement.
Existing rhythm placement, sample-cut resolution, tonal-drums opt-in and Low Noise
mode are retained. Same seed/input/settings produces identical PCM; another seed
varies timbre even for an identical blueprint. Output keeps the existing DC blocker
and bounded peak normalisation.

## Persistence and server Song boundary

Generation runs once and `applyLoadedAudioBuffer` stores actual generated PCM.
The portable source inventory in `index.html` exports `generatedLoopBuffer` as
`audio/generated-source.wav`; restore and the offline loop scheduler replay that
stored buffer. Server Song preparation loads the source ZIP through the same
editor/render deck; it does not call this generator to reconstruct old loops.
Consequently no saved schema, backend generator, render signature or freeze
invalidation changes are required: existing PCM is unchanged; newly saved PCM is
covered by the normal source content hash. Never regenerate old loops on recall.

## Verification

- `tests/industrial-generated-drums.test.cjs`: actual extracted renderer, 44.1/48
  kHz, both noise modes, deterministic seeds, different-seed variation, finite
  bounded PCM and silence before the first hit. Optional MYGRAIN_BASELINE produces
  paired pre-change captures, MYGRAIN_CANDIDATE selects a staged index.
- `tests/industrial-generated-drums-browser.cjs`: actual app generation in
  phone-sized Chromium and WebKit; isolated localhost account only.
- `tests/industrial-generated-drums-song-browser.cjs`: legacy stored generated PCM
  and newly generated PCM through two actual isolated server jobs, warm reuse,
  phone playback, zero playback-memory reservation on stop, immutable source
  hashes and Song revision.

- `tests/pink-generated-drums.test.cjs`: paired isolated hits at 44.1/48 kHz;
  95%-energy duration is at least 25% shorter across kick, impact, snare, hats and
  opt-in percussion. Also captures the actual pre-envelope pink filter for analysis.

Current evidence and exact pre-change backup:
`output/mygrain-pink-drums-20261112/` (workspace root).
The raw pink filter measures -3.09/-3.13 dB per octave between 100 Hz and 8 kHz
at 44.1/48 kHz. Separate noise-disabled snare renders isolate the reduction in
pitched body; aggregate full-output spectral concentration is not a suitable
measure of tonality here, because pink noise intentionally concentrates energy
in lower-frequency bins. Measurements are not human-listening or physical-phone
verification. Earlier industrial implementation evidence remains in
`output/mygrain-industrial-drums-20261112/`.

## Random saw filter — SAWLOOP.1

Every new Sample/Loop generation now bakes a randomised filter into the generated
PCM, after synthesis and before source storage. This is intentional sample
processing, not another live card FX lane: the waveform, saved WAV, subsequent
source uses and offline/server Song playback all receive identical filtered audio.
Existing loaded samples, saved generated audio and old freezes are unchanged.

`buildGeneratedSourceFilterRecipe` uses a separate seed suffix so filter choices
do not disturb the drum/noise RNG. It chooses LP or HP, exactly 96 dB/oct, a saw
LFO, optional inverted saw direction, one of 1/16, 1/8, 1/4, 1/2 or one bar,
cutoff and 30–75% LFO depth. Resonance remains .707. No reverb or delay is added.
The source label includes `HP/LP 96 dB saw <rate>`.

`renderGeneratedSourceFilter` reuses the shared loop FX graph in an
OfflineAudioContext. The offline context retains all eight biquad stages even
when live low-power mode is enabled. It renders a whole-source-aligned warm-up
of at least one bar, crops exactly the original frame count and sample rate,
checks finite output and attenuates peaks only when they exceed .95. No new
source schema, render signature or server migration is needed: portable Songs
already store and replay the final PCM, rather than regenerating a source.
Changing transport tempo subsequently changes loop playback speed as before,
so the baked motion remains part of the loop; it is not an independently editable
live LFO. Regenerating chooses a fresh filter along with the new drum character.

Verification: `tests/generated-saw-filter-browser.cjs` measures actual low/high
frequency rejection and eight native stages, all five saw rates, both filter types
and 44.1/48 kHz output in Chromium/WebKit. Recipe seeds cover both modes and all
rates. Existing generated-loop browser and real server Song fixtures also pass,
including legacy source PCM, warm reuse, unchanged hashes/revision and phone
playback. The raw synthesis unit fixture stubs the separate filter helper;
actual filter audio is covered by the browser fixtures above.

Backup and evidence: `output/mygrain-generated-saw-20261112/` (workspace root).
