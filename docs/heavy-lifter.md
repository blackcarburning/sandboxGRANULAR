# Heavy Lifter

Added 2026-11-14. `modes.heavyLifter`, settings version 1, acoustic render
capability **5** (or **6** for corrected Mechanical Motion/Spectral Imprint), immutable industrial corpus **v1**. This is an input-driven
**effect**, not a seventh loop player. Exactly one of six engines runs at once.
No recording is added directly to the output. Existing source audio is untouched.

## Playing it

Heavy Lifter is the grey crane card **at the end of the app**, after Henry's Hose.
Choose an input, switch it On, then choose a mode. There are 100 presets in each
mode (600 total), Prev/Next wrap within that mode. Mode-specific recipes and
identified cuts survive switching away and back. Presets preserve power/input.

- **Randomise:** mode, recipe, seed and new recording cuts.
- **New samples:** new cuts/seed, keeping the current mode and controls.
- **Samples used:** active-mode filenames, exact absolute cut times, division/BPM,
  category, original creator/source link and reproducible seed. Short recordings
  are retained intact and identified as short, not silently time-stretched.
- **Silence tails:** clear the effect's stored energy without changing its recipe.
- Return level, stereo width, input, additive Solo and Through Main use the same
  routing ownership as WireWorld. At zero level or Off, its worklet is retired.

Cooking Pot can reorder it alongside the other effects. Ordinary Stir retains
recipes and includes it among eligible selections; BIG STIR also picks a new
600-bank recipe and cuts. Both enable a random five to all eligible effects (up to eleven), including
Bubble Chamber; Master Baker stays Off during generation and remains the final
**audio** stage, independent of app-card display order. Group power remembers
Heavy Lifter with the other powers. Mega includes it; Sparse leaves it Off.

## Research and deliberate adaptations

These are implementations informed by the following primary papers, not claims
of exact replication or physically identified material properties. A general
field recording does not uniquely reveal an object's geometry, stiffness, strike
position or true impulse response. Names describe the musical transformations.
Full PDFs were read locally during development; do not redistribute them as part
of the application.

### 1. Material Body — measured modal filtering

Primary: Tiraboschi, Avanzini & Ntalampiras (2020),
[*Spectral Analysis for Modal Parameters Linear Estimate*](https://avanzini.di.unimi.it/downloads/publications/tiraboschi_smc20.pdf).
The paper tracks time-varying partials and estimates modal frequency, amplitude
and decay, including techniques to avoid noise-floor bias. The useful principle
is to estimate a resonant model from an example rather than hand-invent its bank.

Our bounded worker uses 2048-point windowed FFTs at 24 kHz, up to 256 analysis
frames, separated spectral maxima and log-parabolic frequency refinement.
A linear regression of log magnitude after the partial's strongest frame estimates
its decay. With slope `b < 0`, `T60 = -ln(1000)/b`; low-amplitude frames are excluded.
Stationary/non-decaying recordings receive a bounded duration-based decay, not a
falsely claimed physical estimate. We do not implement the paper's complete
sinusoidal tracking, reverse-time analysis or semi-linear optimization.

The input excites 8–32 damped complex resonators. Resizing scales their measured
frequencies; decay/damping set positive modal loss. The second recording supplies
a second frequency/decay/amplitude bank for body blending. Modes are matched by
amplitude rank, not an inferred shared physical mode identity. Stereo detuning,
excitation drive and bounded output provide playable variations. A synthetic
1 kHz decaying sinusoid verifies frequency and T60 estimation numerically.

### 2. Mechanical Motion — correlated envelope transfer

Primary: McDermott & Simoncelli (2011),
[*Sound Texture Perception via Statistics of the Auditory Periphery: Evidence from Sound Synthesis*](https://mcdermottlab.mit.edu/papers/McDermott_Simoncelli_2011_sound_texture_synthesis.pdf).
The research demonstrates the perceptual importance of subband envelopes,
cross-band dependencies and modulation statistics. It is not simply a request to
multiply the input by the raw sample waveform.

Here, eight log-spaced analysis bands yield **correlated traces within each
recorded cut**. Each trace is centred and variance-normalized (bounded gain),
then shaped with `tanh(trace * (0.7 + 4.3 * depth)) * sqrt(depth)`.
Two recorded trace banks modulate complementary input bands; irregularity blends
and warps their movements. This deliberately returns **movement only**, not
`dry + movement`. A constant unit trace produces silence. Movement return
(the existing serialized `blend` field) scales only this wet signal.

Flutter reads one fractional-delay path, with no parallel undelayed wet branch.
At zero flutter the added delay is zero; maximum excursion is 2.125 ms, not the
previous 1–12.6 ms dry/warped mixture. This is direct recorded-trace transfer,
not the paper's complete statistical texture resynthesis or auditory filterbank.

### 3. Spectral Imprint — recorded spectral-envelope transfer

Primary context: Roma, Green & Tremblay (2020),
[*Audio Morphing Using Matrix Decomposition and Optimal Transport*](https://dafx.de/paper-archive/2020/proceedings/papers/DAFx2020_paper_42.pdf).
Their work separates and factors components before controlled timbral morphing.
We deliberately expose envelope transfer separately from displacement morphing:
the original input frequencies/phase remain the carrier in this mode.

The original release used 1024-point STFT envelope transfer, including a unity
component and attack-protection dry preservation inside a **1024-sample delay**.
That was unsuitable for this independent parallel return: it duplicated dry
transients roughly 21–23 ms behind the main signal.

The correction uses two **256-tap minimum-phase-derived FIRs**. The selected
recordings' smoothed magnitude spectra, shift, detail, contrast and imprint depth
set log-magnitude curves. A 2048-point real-cepstrum construction doubles positive
quefrencies and removes negative quefrencies, exponentiates the transformed
cepstrum, then returns to a causal impulse response. The last quarter of the
256-tap truncation is tapered and kernel energy is normalized. Log-magnitude
contrast is bounded to -30/+15 dB before normalization; a 30 ms input/output
energy follower supplies bounded (0.25–12x) wet-only level matching, so a strong
colour does not disappear merely because it rejects input frequencies. FIR truncation
makes this a bounded approximation, not a claim that every resulting polynomial
has exclusively minimum-phase zeros. See Julius O. Smith,
[*Creating Minimum Phase Filters and Signals*](https://www.dsprelated.com/freebooks/filters/Creating_Minimum_Phase_Filters.html).

Kernel design happens in the Worker; the real-time callback runs a bounded direct
FIR with **no FFT block delay**. Recorded motion smoothly blends the two kernels.
Imprint depth is not a dry/wet crossfade: zero depth produces a silent return.
Attack protection attenuates the processed onset rather than restoring dry audio.
There is no separately mixed unity path. Filter phase/ringing remains physically
causal; zero block delay does **not** mean zero group delay at every frequency.
The FIR history is 5.33 ms at 48 kHz / 5.80 ms at 44.1 kHz, instead of a delayed
unity impulse at 1024 samples. No delay was added to the app's main dry path.
The other four modes and all factory recipes are byte-for-byte unchanged.

### 4. Living Convolution — changing recorded kernels, shared history

Primary: Abate & Hansen (2026),
[*A Unified Framework for Real-Time Concatenation-Driven Convolution*](https://dafx.de/paper-archive/2026/papers/DAFx26_paper_01.pdf).
Their important engineering contribution is FFT-domain kernel interpolation in a
single convolution engine, preserving its input history while navigating the
corpus. Merely crossfading two newly started convolvers loses prior excitation.

Two saved one-/two-bar random cuts supply the kernels. Impulse length selects a
**25–1000 ms shaped excerpt** around each cut's strongest transient; the entire bar-length recording is
not necessarily used as the IR. Reverse (Off/On) reads from the cut's end; short cuts wrap if the selected IR
length exceeds their available PCM. Positive decay,
brightness filtering, non-overlapping 3 ms edges and energy normalization prepare
the impulses in the analysis worker. The sources are creative convolution
kernels, **not measured room/device impulse responses**. Prepared kernel window times also appear in
Samples used. Strongest-transient placement prevents short kernels from selecting
only leading silence inside an otherwise active bar-length cut.

Uniform 512-sample partitions / 1024 FFTs share one stereo input-history ring.
Kernel position and motion interpolate the two FFT banks against that history.
There is no IR restart during continuous morphing. Manual source/kernel edits
prepare a new bank and briefly crossfade engines; this is distinct from the
continuous shared-history morph. The paper's SOM navigation and non-uniform
partition optimizer are not implemented. Wet latency: **512 samples** (10.67 ms
at 48 kHz). Numerical impulse tests compare against direct convolution.

### 5. Spectral Alloy — displacement instead of magnitude crossfade

Primary: Henderson & Solomon (2019),
[*Audio Transport: A Generalized Portamento via Optimal Transport*](https://arxiv.org/abs/1906.06763);
also Roma et al. above for separation/factorization extensions.
The key distinction is moving spectral mass **between frequencies**, rather than
fading one fixed set of frequency bins into another.

The same STFT normalizes live spectral power and the industrial target into
one-dimensional mass distributions. A monotone two-pointer transport couples
source/target bins; interpolated destinations redistribute power. The measured
second spectrum and trace animate the target. Instantaneous-frequency estimates
and wrapped phase accumulation provide reconstruction; attack protection can
reset towards the incoming phase. Pitch anchor restrains displacement and
inharmonic bend scales it.

This is a bounded, direct **power-bin** adaptation, not the full paper's spectral
peak grouping/phase locking or Roma's NMF + harmonic/percussive separation. Dense
signals can smear or sound phasey at extreme displacement; that is an audible
tradeoff, not a promise of transparent pitch shifting. Wet delay: 1024 samples.

### 6. Stressed Metal — audio-rate modulation of a lossy body

Primary: Berdahl (2014),
[*Audio-Rate Modulation of Physical Model Parameters*](https://cct.lsu.edu/~eberdahl/Papers/2014ICMCAudioRateModulation.pdf).
The paper explores rich spectra from changing resonant physical-model parameters
at audio rate and distinguishes passive/conservative constructions from energy-
injecting ones. Arbitrary coefficient interpolation is not automatically stable.

Twenty-four measured resonators are frequency-modulated by a second recording's
PCM, with controllable reading speed/stress depth and additional positive loss.
Each state update is a bounded rotation multiplied by a radius below one;
modulation cannot amplify unforced stored-state norm. Only the input excitation
injects energy. This is a creative modal/FM hybrid, not FEM, measured stress/strain
or a calibrated mechanical solver. Frequency clamping prevents unstable parameter
excursions. It is not oversampled; strong audio-rate modulation/nonlinearity can
produce aliasing. Do not describe it as alias-free or physically exact.

## Corpus, reproducibility and preparation

`SAMPLES_INDUSTRY/CATALOGUE.json` contains 716 unique ready recordings, all marked
CC0-1.0. Their filenames, creators, original SHA-256 and source URLs are retained.
`prepare-heavy-lifter.py` leaves originals untouched, sums to mono (first-channel
fallback for complete antiphase cancellation), anti-alias resamples with scipy
polyphase conversion to **24 kHz**, quantizes PCM16LE and creates **1,519 <=16 s
chunks**. The derived corpus is about 773 MB, not an initial browser download.

Half-second activity metadata guides deterministic random cut locations and
excludes a completely silent chunk. This avoids silent regions without inventing
new sound or trimming the originals. The default two-second cut equals one bar
at 120 BPM. New random cuts choose only one/two bars at the current 40–300 BPM,
retain short sources intact and never introduce fractional random divisions.
Explicit cuts store `{id,chunk,start,duration,bars,bpm}`; every mode has its own
seed, controls and selections. Empty cuts derive deterministic picks from that
seed and the **immutable v1 catalogue/selection algorithm**. Freeze both together:
a future corpus or cut algorithm needs a new version, never silently replace v1.

Only the active mode's two chunks are fetched. Every fetch verifies frame count
and SHA-256, then makes a bounded cut, removes DC, applies bounded RMS gain and
3 ms non-overlapping edge fades. Analysis and convolution-kernel FFT preparation
run in a dedicated Worker, not the real-time callback. Prepared and analysis
caches each retain at most six entries. Conservative render admission includes
those caches plus short edit crossfades (`32 MiB + 512 × host sample rate`).
They are bounded caches, not zero heap
when Off. Account lock terminates the worker, rejects tasks and invalidates stale
loads/caches. Async loading failures roll back canonical settings, not silently
accept an enabled dry effect.

The 24 kHz analysis corpus cannot identify source content above 12 kHz. Rendering
still runs at the host rate; no claim is made that it restores discarded source
ultrasonics. Modal/stress rotations, convolution and trace reading all use the
actual host sample rate. Preset IDs are factory UI metadata, not saved modes.

## Routing, state and backward compatibility

- Canonical `modes.heavyLifter`: version, enabled, source, mode, level, width,
  six nested recipes/seeds and six source-cut arrays. JS/Python normalization is
  shared through `backend/heavy-lifter-schema.json`; strict server validation
  rejects non-finite values, malformed controls, unknown recordings/cuts and
  out-of-range cut positions. Do not serialize prepared PCM/FFT data or UI proxies.
- Existing generic acoustic keys integrate JSON, editable ZIP, browser storage,
  Undo/Redo, Layers, mixer, clear/reset, native project snapshots and generation.
- Pot has eleven reorderable effects and twelve remembered powers including
  Baker. Preserve ports 1–13 and Hose input 14; Heavy wet input is **15**, output
  **11**. Nine-/ten-stage legacy snapshots and their power inventories still load.
- The native companion's fixed **nine** legacy panel rows/mask are unchanged;
  filter both optional new effects from that wire protocol and preserve their
  positions when a native legacy reorder is applied. New HTML controls are in
  the embedded web editor; no replacement native binary was built here.
- Audible non-DAW Heavy requires acoustic capability **5** (or **6** for corrected Mechanical Motion/Spectral Imprint). Missing, Off, zero-
  level or DAW-only Heavy is pruned from render content identity, including its
  optional Pot/order/Through Main fields. Existing effects keep prior capability
  numbers and actual PCM; disabled additions do not stale old Songs.
- Real server Arm uses the same app/analysis/worklet implementation, preloaded
  before capture. GET and POST inspect source metadata for stale capabilities;
  refreshing renders must not rewrite source ZIPs or increment Song revisions.
- STFT/convolution delays are **wet-only**; original dry timing is unchanged.
  No global latency compensation is introduced for existing effects.

## Verification and evidence

Evidence is kept outside the deployment under
`output/mygrain-heavy-lifter-20261114T083015Z/evidence`, with a pre-task dirty-tree
backup at `output/mygrain-heavy-lifter-20261114T083015Z/before`.

- `tests/heavy-lifter.test.cjs`: modal fit/FFT identity, 600 presets at 44.1/48 kHz,
  every mode control, stereo/silence/reset/disposal, deterministic block sizes,
  96 kHz extremes, direct convolution, zero-imprint wet silence and original PCM.
- `tests/heavy-lifter-corpus.cjs`: **1,200** real source-derived preset renders,
  527 distinct recordings, nonzero/finite/bounded output; no silent selected cuts.
  Separately, all 1,519 chunks passed byte-length/SHA-256 verification.
- Combined acoustic/Pot/Hose/new DSP suites: **48 passing tests**, including
  4,096 Pot active/bypass/order combinations and retained legacy preset recipes.
- `tests/test_heavy_lifter.py`: all 600 JS/Python preset settings, strict malformed
  input rejection, selective identity, legacy Pot inventories, every recipe/seed.
- `tests/heavy-lifter-browser.cjs`: authenticated desktop Chromium and phone-size
  WebKit; six modes/600 options, actual random cuts, controls/history, JSON/ZIP,
  linked Layers/Pot power, 320/390/844/960/961/1440 px geometry and >=44 px actions.
- `tests/heavy-lifter-live-browser.cjs`: actual **final-output** PCM for six wet
  returns, selected versus unrelated input, All, Solo, zero/Off, additive Solo,
  ordinary Stir/BIG STIR and retirement. No upstream-meter-only audio claim.
- `tests/heavy-lifter-song-browser.cjs`: 16 real saved-source server fixtures,
  all six modes, native/Pot/order/independent-return/mute/zero/DAW/legacy, stale
  capability GET/POST rejection, selective refresh, unchanged ZIP hashes/Song
  revisions, warm reuse and zero reserved source-preparation memory afterwards.
- Phone WebKit also plays the warm server cache without creating a render iframe
  or reserving source-preparation PCM. Four navigation entry points remain valid
  before/after lazy Wasp hydration. Deliberate network failures roll back settings;
  a stale load cannot resurrect an effect switched Off during loading.
- Broader backend discovery is **not all green**. Its failing modules were run
  against the untouched pre-task backup and staged code with matching fixtures:
  255 checks each, identical 15 failures/21 errors, no added failing check. These
  pre-existing/harness-dependent failures were not repaired in unrelated code.

Browser WebKit emulation is not a physical iPhone test; Chromium AudioWorklets
are not a test in a real DAW host. There is no claim of physical-device or native
plugin certification. Keep timing comparisons separate from loaded-host capture
artifacts: shared-context real-time Song capture is not an offline sample oracle.
A stale-cache recheck intermittently captured a 256-frame discontinuity in one
Material Body take. A repeat with unchanged settings matched the Pot reference
exactly; the shared Song recorder was not modified. The raw failed and repeated
logs are retained as `heavy-song-kernel-final.log` and
`heavy-song-repeat-final.log` in the staging evidence. Its cause is not established.

## Wet-return correction (2026-11-14)

- Internal dry terms removed from Mechanical Motion and Spectral Imprint only.
- Saved recipes/cuts/seeds remain unchanged; the correction intentionally changes
  these two modes on recall. Capability 6 selectively regenerates their audible
  server caches. Off, zero-level, DAW-only and the other four modes retain prior
  content identity; original source ZIPs/revisions are never rewritten.
- Each mode tab now links its primary research at the top. Imprint additionally
  links the minimum-phase construction; Alloy links both transport/morphing papers.
- Before/after impulse, constant-trace, zero-depth, direct-FIR and exact unchanged-
  mode regressions are in `tests/heavy-lifter-wet.test.cjs`.

The final-output timing probe records source reference and final output on the
same clock. The existing main compressor/bypass path contributes 6 ms; this is
retained, not mistaken for new effect latency. Selected-source independent wet
returns bypass that main path. New Motion with flutter zero and Imprint start
without block buffering; minimum-phase filter phase and optional flutter remain.
No global path, compressor delay, other effect or main dry timing was changed.

Wet-correction evidence and its exact deployed-source backup are retained at
`output/mygrain-heavy-wet-20261114T095159Z/evidence` and
`output/mygrain-heavy-wet-20261114T095159Z/before`. The correction verification
includes 48 DSP/routing tests, 24 focused backend tests, 1,200 real-source preset
renders, desktop Chromium/phone-size WebKit UI, and simultaneous reference/final
output timing. See `wet-timing.json` and `heavy-wet-final-output-timing.json`.


## Shared card LFO — build HEAVYLIFTER.5

Optional `modes.heavyLifter.lfo` is additive; missing LFO state leaves the original
normalization, presets and PCM unchanged. Fields: `wave` (sine, triangle, sawUp,
sawDown, square, pulse, sampleHold, randomSmooth), `beats` (.125, .25, .5, 1, 2,
4, 8 quarter-note beats), `timing` (straight, dotted ×1.5, triplet ×2/3),
`pulseWidth` (.01–.99), `depth` (0–1), and unique `targets` (all 38 supported controls may be assigned).
Targets are `level`, `width`, or `<mode>.<numeric recipe parameter>`; seed,
source, presets, power and mode selection are not modulation destinations.
Assignments on other tabs are retained but pause until that mode is selected.
The same shared LFO controls are present in every mode tab. There is no assignment
count restriction; the backend still rejects malformed, duplicate or unknown targets.
Clear modulators removes all assignments across every tab in one undoable edit,
without changing waveform/rate/depth, saved base controls, samples or power.
Pulse width is enabled only for Pulse.

A single oscillator uses the existing AudioContext transport clock history and
scheduled BPM/origin changes. Phase is `(time-origin)*bpm/(60*periodBeats)`,
not a UI timer or a voice-construction clock. Random waves are deterministic
hashes of the shared cycle, so recall and server renders reproduce the motion.
Control evaluation is every 32 frames with a 1 ms control slew, not audio delay.
One common waveform moves every assigned base value by `depth * waveform`,
clamped to 0–1. Full depth therefore reaches both range endpoints from every saved
base value; the old half-range scaling is removed. The same scaler feeds scalar
controls, modal coefficients and Worker-prepared kernel trajectories. Reverse is binary: the positive half-cycle flips its saved state;
zero depth disables all modulation. Base sliders, recipes, samples and source
cuts are never rewritten by oscillator updates. Return level uses the existing
host level smoother; it can rise from a zero base while assigned to an active
LFO. Power Off still disposes processing. Clearing tails keeps transport phase.

The effect algorithms, wet routing and existing latencies remain unchanged.
Modal coefficients use the original setter equations without per-tick array
allocation; inactive modal voices retain the original frozen-state behavior.
Scalar controls are updated directly. Kernel-changing controls are prepared in
the analysis Worker along the one-dimensional shared LFO trajectory: 65 FIR
states for Imprint or 9 convolution states for Living Convolution. Existing
kernel coefficients interpolate between these states at their existing update
boundaries. This is a bounded control interpolation approximation, not repeated
sample loading, realtime FFT filter design, additional audio buffering or a
second effect. Existing Imprint coefficient smoothing and convolution FFT
partition/hop remain in place; fast kernel modulation is limited by those
existing update rates. Convolution history is allocated to the largest required
kernel once, preserving it while parameters move. Prepared convolution LFO
banks have a bounded aggregate cache and explicit render-memory accounting.

One UI panel appears immediately below Samples used (and below its expanded
provenance). The eight numeric destinations visible on each mode have adjacent
Mod toggles. The expanding assignment list is removed; remove a single assignment
with its Mod toggle or clear all tabs with Clear modulators. The compact count is
retained. All new
styles are scoped to Heavy Lifter. JSON, local recall, history, ZIP and Song keep
LFO configuration. Only an audible current-mode LFO needs acoustic renderer
capability **8** (full-range scaling); zero depth, empty assignments, assignments only on other tabs,
Off and external-only sources keep previous capabilities. Inactive LFO metadata
is omitted from the render content projection, not from the original archive.
The existing four-mode capability 5 / Motion+Imprint capability 6 distinction
therefore remains valid for all unmodulated audio. Old capability-7 LFO freezes
are selectively refreshed without rewriting source ZIPs; inactive LFOs and other
effects retain their cached audio and render identity.

Regression commands and release evidence are recorded under
`output/mygrain-heavy-lfo-20261114T102233Z`. Production is verified by exact
HTTPS asset hashes; authenticated UI/audio tests use the identical isolated
staging server with disposable account storage, not production-account writes.

For the current LFO regression suite, use `MYGRAIN_LFO_BEFORE_ROOT=<this-task-before>`
when running the combined DSP tests. The older wet-return timing oracle's
`MYGRAIN_BEFORE_ROOT` refers to its historical pre-wet-fix baseline, not this
release; keep these two baselines separate. `tests/heavy-lifter-lfo-song-bpm.py`
checks the actual saved PCM rate after the isolated Song test (OUT and STORE).

## Robot input validation / paired WAV save · 2026-11-23

The browser's unified effect-input inventory included Robot, but the backend
acoustic SOURCES tuple omitted it. An off Heavy Lifter retaining source Robot
therefore caused the paired final-mix WAV+editable ZIP save to return HTTP400
`Invalid acoustic source: heavyLifter`. All five acoustic effects share this
validator, as do WAV source snapshots and server Songs. Added Robot to the
backend tuple in the same order as effect-inputs.js; no DSP, patch migration,
render identity or capability change. Existing source selections are retained.

Tests now compare the actual JS inventory to both CHARACTER_INPUTS and acoustic
SOURCES and exercise all allowed inputs for acoustic effects powered both ways.
Real authenticated HTTP tests save/retrieve exact WAV+ZIP bytes for every
acoustic effect using Robot, on and off. Four actual phone-sized UI save cases
(Chromium/WebKit, Heavy on/off) retain settings and produce audible PCM and
restorable snapshots. Two real server Song jobs preserve archives/revision,
process Robot through Heavy and reuse warm PCM-only playback.

82 focused backend/HTTP checks pass. Broader pre-existing acoustic compatibility
failures (`test_exact_legacy_and_disabled_cache_identity` and
`test_sources_and_active_defaults`) are identical before/after this one-entry
fix; the older unified-input capability expectation also fails before the fix.
Do not describe those broader suites as passing.

Production verification uses a deliberately invalid second patch sentinel: the
first valid Robot/Heavy patch is checked first, then the sentinel guarantees
rejection before any repository write. Before restart: Invalid acoustic source.
After idle-queue restart: Unsupported song-part format (the intentional sentinel).
Exact WAV listing bytes remain unchanged by both probes.
Evidence/rollback: output/mygrain-wav-acoustic-source-20261123T105040Z/.


## Spectral Alloy computation cache (2026-11-24)

The Spectral Alloy STFT mass-transport step caches each source bin's power,
target power and instantaneous frequency in three preallocated Float64 arrays.
A source bin can feed several destination bins; its unchanged spectral values
are calculated once per channel/frame, not once per transport fragment. The
transport traversal, accumulation order, FFT, window, overlap, phase equations,
modulation, stereo processing and output limits remain unchanged. There is no
quality reduction or allocation in the audio callback. Other five modes retain
their existing processing.

This implementation-only change retains all recipes, corpus cuts, source ZIPs,
acoustic capabilities and render identities. Live, offline and server Song use
the same DSP via the acoustic host/worklet. Existing valid freezes need no
regeneration. Browser-native bit-exact comparison and isolated server-job
evidence are kept in `output/mygrain-heavy-opt-20261124T190346Z/` in the private
workspace; this is not a guarantee that combined-rack real-time underruns are
resolved on a particular DAW/CPU.
