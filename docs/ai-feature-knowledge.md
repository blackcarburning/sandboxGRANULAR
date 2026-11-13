# MYGRAIN feature knowledge — 2026-11-12

This is application context for AI Patch Direction, including Generate, Regenerate,
Refine and Song section requests. It describes the UI, not additional recipe fields.
The supplied allowed controls, loopCapabilities and effectCapabilities remain the sole writable contract.
Do not invent control IDs, automate UI actions, or claim an unsupported effect/card
was changed. For an unsupported request, say briefly in the recipe description what
requires manual adjustment; retain unrelated audio/settings. Do not substitute main
granular filters for a requested loop filter or N filter and claim equivalence.

Legacy loop `*FilterCutoff` IDs are read-only compatibility values, NOT writable
recipe parameters. Shared loop effects own the real cutoff now; never output a
retired filter ID or replace it with a main granular filter. Use cardEffects for actual shared filter/space changes; omit unrelated settings to preserve them.

## Cards and layers

- Bastardloop A/B/C are sample-backed loop layers; V is vocal, P piano, O orchestral,
  L lead sequencer, X bass sequencer, and Q the piano/strings chord instrument.
  X can retain either samples_bass or the clean Juno samples_altbass library.
- W (Weird) generates modular audio, offers Re-cut Same Samples and Loop Cut,
  reverse, pitch, level and shared effects. W is now an allowed AI loop backed by samples_modular: enabled, reload and divisions.
  Use its existing generator; never invent new W DSP controls. L supports a
  repository choice of samples_leads or samples_terra with reload:true.
- MAIN VOCAL M, BACKING VOCAL M+, and K five-track recordings are user audio;
  preserve recordings. K1–K5 have individual processing. AI's K inventory is aggregate,
  not permission to invent individual track recipe keys.
- N is independent white/pink noise, with level, Solo, Jump and shared Mix/Layers
  integration. It has its own driven/triggered filter (below); it is not a recorded loop.
- Grain A and Grain B are independent granular source slots. Sparse/Mega randomisation
  includes new samples for both; normal Randomise does not. Do not confuse these
  grain slots with Bastardloop A/B. Existing AI source reloads target only allowed loops.
- RADIOLAB listens to live stations and manually records server-decoded audio until
  Stop. There is no rewind/pre-roll, tempo sync, automatic capture or microphone.
  Video Lab retrieves a finite audio take from a chosen video. Both support trimming,
  audition, normalisation and saving samples; neither is an AI recipe operation.

## Shared loop effects and filter clock

- Shared effects cover A/B/C/D/V/W/P/O/L/X/M/M+, K1–K5, Q and N. The shared loopFx
  state is version 1. Use the bounded cardEffects field contract, not arbitrary scalar parameters.
- Standard loop filters support bypass, low-pass or high-pass, slopes of
  12/24/36/48/96 dB per octave, cutoff and resonance. LFO shapes are sine, triangle,
  sawtooth, ramp and square, with tempo division, depth and inversion.
- FILTER-CLOCK.1: shared filter LFOs use the sequencer transport origin, including L
  and X and graphs created after playback starts. Saw closes across the FULL chosen
  cycle; ramp opens across the FULL cycle; reset is at the cycle boundary, not halfway.
  Inversion reverses the sweep. Cutoff/depth edits do not restart phase. A selected
  cycle can span multiple steps: do not equate every LFO division with one step.
- Original L/X accent envelopes still combine with the LFO; hearing a filter open is
  not automatically a clock fault. Distinguish accent envelopes and LFO modulation.
- Stereo hall reverb has mix, decay, size, pre-delay, damping, low-cut and width.
  Tempo delay has mix, division, feedback, tone cutoff and optional ping-pong.
- N bypasses the shared filter/LFO because it owns a separate filter; shared reverb
  and delay still apply. Do not recommend enabling a second shared N filter.

## N filter envelope

- N's own filter supports low-pass, high-pass, band-pass and notch, selectable poles,
  cutoff, resonance and drive, plus signed Envelope depth and inversion.
- Drivers are amplitude copies of other layers/drum tracks/K tracks or global L1–L3;
  they do not reroute, mute or change the driver's audio. Manual trigger is available.
- Amplitude follower now gates above threshold and closes below half threshold,
  with attack/release smoothing. Driver sensitivity is applied BEFORE threshold;
  reduce sensitivity if every hit crosses it.
- Triggered ADSR fires a full-depth envelope on a crossing; Envelope depth sets
  the sweep independently of threshold, with attack/decay/sustain/hold/release.
  Manual triggers bypass threshold. Do not describe threshold as envelope depth.

## Persistence and exports

- Patches and Songs preserve supported audio/settings; do not edit Song arrangements
  or recording data from a patch recipe. Q's dry/warm/spacious styles are still valid
  bounded recipe operations, not access to every shared effect parameter.
- Generated Bastardloops now return audio without retaining a server repository WAV.
  The old collection is archived and all seven Bastardloop Browser buttons removed.
  Source-sample browsers, current patch audio, Songs and intentional WAV exports remain.
  Do not recommend the removed generated-loop browser or promise an automatic archive.
- Uploaded/rendered WAV cards support Upload Art beside Download/Share WAV, an
  aspect-preserving title thumbnail and enlarged click view. Compressed artwork is
  at most 128 KB, thumbnails 8 KB, with the large image at most 768 px. Artwork follows
  renames and new shares. Artwork operations are not patch recipe parameters.

## N noise AI control

- Randomise, Mega, Sparse and Randomise N always leave N disabled. This is not a
  restriction on explicit AI edits: use parameters.noiseMix (0–100 percent) to
  turn N on at a positive level or off at 0. Prefer modest levels when adding noise.
- The current noiseMix value is 0 when N is disabled, otherwise its effective base
  level. Preserve it unless the direction calls for noise. Enabling retains N's
  existing white/pink type and filter/envelope settings; those are still manual.

- On normal app startup N is off, Drums All amplitude follower, +8 octave envelope,
  50 ms decay/release, sustain 0, 96 dB/oct low-pass at 80 Hz. Explicit patch/Song
  recalls retain saved N settings. AI enabling uses these current settings.

## D Mutilator
Loop D has a native, non-destructive Mutilator: Gnaw resonant fuzz, Melt sine-fold acid, Rupture fractured grit. AI no longer randomises Mutilator when D is reloaded/enabled. Choose its power, input, strain, damage, tone and mix explicitly through effects.mutilator. Legacy scalar loopDMutilatorAmount/Tone/Mix remain compatible; effects.mutilator fields apply last when both are supplied. Mix 0 bypasses. Omitted effect fields retain existing settings. Sparse/Mega randomise only eligible audible D. Disabled or generation-muted D explicitly switches Mutilator Off; manual re-enable never silently rearms it.

Mutilator also offers Scab (lo-fi steps), Venom (biased valve), Hollow (octave rectifier), and Splinter (jagged wavefold). All seven strains participate in D's existing AI/Sparse/Mega mutation selection. The Dropbox Sample card now shares the standard LFO filter, stereo hall reverb and tempo delay under loopFx.channels.sample. Legacy Dropbox sources remain dry; its existing pan is authoritative.

Loop D defaults to SAMPLES_LOOPSTORE. Its remembered repository may be SAMPLES_LOOPSTORE or SAMPLES_LOOPS (see loopInventory.D.repository). A D reload uses that selected library; recipes must not change it. D loads one original loop, not a generated chopped composite. Reels retain that original source.

## AI effects contract (AIFX.1)

Recipes may include `effects` for the eight allowed specialised effects and
`cardEffects` for bounded per-channel filter/LFO/room/delay fields. Read the
injected effectCapabilities; do not invent field names. The genre memory gives
style-specific suggestions. Bubble Chamber stays manual-only. Existing effect
DSP, saved-state fields and server rendering are reused, not replaced.
Current effectState is supplied for targeted refinements; omitted fields remain
unchanged. Prefer explicit unused-effects Off in new genre recipes, but targeted
refinement/sections must not erase unrelated effects. No Solo/main routing edits.
