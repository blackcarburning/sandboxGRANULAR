# Enemy Drone — first draft (2026-11-18)

A black eight-oscillator drone card with a code-native angry quadcopter icon.
Independent On, quantised MIDI note C2–C7 (61 inclusive notes spanning five
octaves), fine tuning ±50 cents, level and equal-power pan per voice. Global
Output, Tone, Detune spread 0–50 cents, slow drift and cross-mod depth. Four
pairs, an eight-voice ring or a two-neighbour swarm couple the voices. This is
an original digital instrument inspired by interacting drone synths, not an
analogue LYRA circuit emulation. Cross-modulation can produce inharmonic
sidebands although the base pitches are quantised.

## Stereo and feedback

Each voice is modulated before its independent equal-power stereo pan. The
output position never changes its modulation-network membership. Stereo
ping-pong delay and a four-line damped orthogonal feedback reverb feed the
output independently. Delay → swarm and Reverb → swarm send a bounded mid
signal into oscillator phase coupling and cross-feed the other effect. The
output wet controls do not disable those internal returns.

Sub-unity own-feedback ceilings (.88 delay/.92 room), headroom-scaled cross
returns, bounded delay writes, damped room mixing, 18 Hz output DC removal and
a ±.85 soft ceiling contain the network. Maximum coupled-return regression
checks finite PCM and eventual decay after all oscillator excitation is removed.
Panic resets both effect memories while keeping canonical controls. No external
input enters the instrument's internal feedback network.

## Host integration

Canonical source key: `Enemy`; global Solo key: `enemy`; state: optional
`modes.enemyDrone` in full state/Song, root `enemyDrone` in old-style presets.
Card controls are mirrors excluded from generic slider/select persistence.
Source-owned routing goes through Character FX/EQ and existing downstream taps;
Enemy is in Jump, Layers, Cooking Pot inputs, effect inputs and Wasp/Playground
modulation source/destination choices. Main On starts the shared transport.
Global Stop, source Solo, history, account/context release, ZIP and reload work
through the existing host paths. Normal/Mega randomisation turns Enemy Off,
retaining its recipe; its own Randomise notes keeps timbre, pans and effect
controls. That action leaves Master Baker Off.

`enemy-drone-dsp.js` owns canonical normalization, deterministic sample engine,
worklet preload, graph and memory estimate. Same worklet runs live and in
isolated Song decks. No DSP is instantiated when Off. Startup registers the
module once per context; Song decode/render preloads before capture.

Selective `enemyDroneVersion:1` applies only when powered and an audible voice
has nonzero output. Off/missing/inaudible Enemy content is omitted from render
identity. Existing source ZIPs are not migrated. Backend strict settings/range
validation, source hashing and render GET/POST capability gates prevent stale
Enemy-less freezes being accepted. Warm phone Song playback stays metadata +
rendered PCM, without recalling or synthesizing sources.

Cooking Pot's Wasp detector inventory now has an additional Enemy slot. Its
cross worklet accepts the requested slot count; ordinary Wasp buses retain
their previous 32-slot allocation. Both desktop and phone worklets are aligned.
No existing source/effect recipe or audible engine revision was changed.

## Verification

- `tests/enemy-drone-core.cjs`: all routing/tone endpoints with maximum feedback,
  deterministic repeat, 44.1/48 kHz pitch, Off silence and unexcited tail decay.
- `tests/enemy-drone-browser.cjs`: Chromium/WebKit phone/desktop controls, native
  finite output PCM, source inventories, Undo/Redo, Solo, Pot route, Panic, ZIP
  and reload. Isolated account store only.
- `tests/test_enemy_drone.py`: legacy/Off identity, strict invalid-data rejection,
  render admission and stale GET rejection without rewriting original ZIPs.
- Task evidence also contains native phone Jump/header checks, actual Wasp/Pot
  chain diagnostics, three server Song jobs (legacy D, hard-left clean Enemy,
  stereo feedback through selected Pot insert), warm PCM-only playback and
  byte-for-byte immutable source checks. Physical iPhone not tested.

## Revision 2 — feedback, gain and distortion (2026-11-18)

Mark requested more feedback, a full randomisation button, more gain and a
stereo distortion effect. Optional `engineRevision:2` adds a strict canonical
`distortion:{drive,mix}` object (both 0–1). The default new recipe has clean
Distortion Mix 0, Delay feedback .65/return .28, Room decay .86/return .30.
First-draft normalization and PCM remain exact when this revision is absent.
Editing a sound/power control adopts revision 2 in one normal history edit;
Randomise notes deliberately preserves the current revision and every non-note
setting. Merely restoring a first-draft snapshot does not migrate its sound.

Revision 2 allows Delay repeats up to .985 and Room decay .995. Return-to-phase
influence rises from .85 to 3, with effect-to-effect cross returns changing from
.25 to .65 times remaining own-feedback headroom. This retains a contractive
unexcited loop rather than clipping an unbounded linear feedback path. Stereo
saturation (Drive 1+31*d², normalized by sqrt(Drive), dry/wet Mix) follows the
voice pans and precedes both delay/reverb inputs. Distortion is therefore heard
in their repeats and returns; Mix 0 retains the clean voice path. The revised
mix gets 1.6× gain (about +4 dB) before the unchanged .85 soft ceiling, never
post-ceiling makeup gain.

Randomise all settings is separate from Randomise notes. It changes all sound
controls, eight notes/fine/levels/pans/voice switches, route, delay, room and
distortion; voice 1 stays On to avoid an empty recipe. Main On/Off is retained.
Master Baker is turned Off within the same accepted history transaction.
Global/Mega/Sparse/AI generation policies remain unchanged.

Audible revised sounds require `enemyDroneVersion:2` and content engine revision
2. First-draft sounds retain capability/hash 1; absent/Off/inaudible states retain
legacy identity. Existing numeric client capability handling already carries 2
through cache checks and uploads; strict backend schema plus original-snapshot
GET/POST gates now enforce 2. Original source ZIPs and Song revisions stay exact.

Focused regressions: enemy-drone-2-core.cjs (three exact legacy PCM comparisons,
1.6× gain, distortion and return counterfactuals, six max-feedback extremes and
long unexcited tail); enemy-drone-2-browser.cjs (Chromium/WebKit native output,
new controls/random actions/history, portable ZIP/reload and responsive layout);
test_enemy_drone_2.py (strict optional schema, selective identity, stale v1
upload/GET rejection); enemy-drone-2-song.cjs (real legacy D, first-draft Enemy,
revised distortion/max-feedback + Pot server jobs, warm PCM-only phone reuse).

## Shared Jump and button-volume integration (ENEMY.3)

Enemy's Jump SVG must have explicit 28×28 dimensions and a fixed flex basis;
otherwise the intrinsic SVG expands the phone tile above standard neighbours.
The shared layer gesture owner is configured in the final inline block of
index.html, not by navigation-palette.js or the card's power/Jump markup alone.
Register enemyLayerPower → enemyVolume, use the existing [data-enemy=level] range
as that ID (not an additional slider), route host.set to canonical Enemy.level,
and include the graph.output node and enemy Solo gate in meter/audibility maps.
Map the enemy navigation section to enemyLayerPower for grey/muted state.
Card sync refreshes the shared layer owner; the setter's save option participates
in existing gesture/history persistence. The range stays a mirror excluded from
generic saved controls. No source recipe, synthesis, render revision or schema
changes are involved.

Focused tests/enemy-drone-controls.cjs reproduces the actual phone drawer and
standard Ember neighbour geometry at portrait/landscape/desktop widths, native
Chromium touch + WebKit mouse level gestures, arrow keys, one Undo/Redo edit,
canonical/card/button linkage, actual final-output full/half/zero PCM, tap mute,
normal Jump navigation, ZIP and reload without a duplicate saved slider. Task
evidence also has two real server Song jobs (legacy D + existing Enemy engine
with canonical button volume37%), warm PCM-only phone reuse and unchanged source
ZIPs/hashes/revisions. Physical iPhone remains untested.


## Factory bank — ENEMY.4 (2026-11-18)

`enemy-drone-presets.js` is an editor-only, immutable bank of **200 complete
revision-2 recipes**, 20 in each of ten families. Stable IDs are
`enemy-<family-slug>-01` through `-20`; names and descriptions are unique.
It is loaded after the DSP normalizer and before the card and registered in the
account static allowlist. There was no earlier Enemy factory bank to migrate.

| Family | Compositional role |
| --- | --- |
| Still air | Dry exposed voices, sparse masks, beating and empty intervals |
| Substructures | Low fundamentals, hollow voicings, bass-weighted gain structures |
| Suspended choirs | Broad tonal beds, suspended extensions and detuned doubles |
| Glass and wire | High clusters, irregular partial relationships and bright cross-modulation |
| Enemy pairs | Ordered two-voice relationships, asymmetry and opposed stereo roles |
| Broken circuits | Dense ring/swarm modulation, dissonance, large drift and detune |
| Echo machines | Sparse excitation, 50–2000 ms free-time echoes and oscillator returns |
| Rooms without walls | Chamber size, diffuse wet fields and room-to-swarm return |
| Rust and voltage | Deliberate drive/Mix contrasts, low warmth through metallic clipping |
| Border signals | Register collisions, sparse/dense extremes and coupled effect returns |

The composition notebook in the task evidence records 200 authored names,
voicings and briefs, a vocabulary of 20 circuit studies, family-specific control
ranges, and independently arranged stereo, tuning, gain, delay and room roles.
The shipped asset contains the final explicit settings, **not a runtime random
or transpose generator**. Oscillator order is intentional because the coupling
network follows voice positions. Inactive positions have Off and zero level.
The studies deliberately include one to eight active voices, disconnected nodes,
unisons, seconds, fourths, tritones, fifths, extended chords and irregular interval
chains. Delay times are seconds, not claimed to follow BPM.

### Recall and editor ownership

The card menu is grouped by family, numbered 001–200, with previous/next actions
that cross group boundaries and wrap. From Custom, Next chooses the first recipe
and Previous the last. Selection makes one existing card-history transaction,
replaces the **whole** normalized sound, and reapplies only canonical power and
Output level. It never starts transport, clears Solo or changes another card.
The existing busy/Song/recording/account edit gates still apply.

Menu identity is derived by matching normalized controls while ignoring power
and Output. Sound edits show Custom; Undo restores the matching name. No factory
ID, family, description or selector state is saved. `modes.enemyDrone` remains the
only audio recipe; the card is already excluded from generic sliders/selects.
Legacy v1 recall still stays v1; selecting a factory is an explicit v2 sound edit.
There are no DSP, saved-schema, capability, content-identity or server-render
algorithm changes and no invalidation of old renders.

### Verification

- `tests/enemy-drone-presets-core.cjs`: all 200 complete canonical recipes,
  unique IDs/names, frozen rows and detached clones, 400 actual stereo renders
  at 44.1/48 kHz, finite internal delay/room/oscillator state, nonzero bounded
  output, plus exact old-v1/v2 PCM comparisons.
- An additional 200 renders use a common C2 lowest note and common Output while
  retaining each interval/network structure. Short-time spectrum, stereo and
  level-normalized envelope features check for near-duplicates independently
  of root pitch and gain. All 19,900 pairs differ in at least three non-pitch
  mechanisms at a normalized control-change threshold of 0.06. Minimum measured
  audio-feature distance was 0.152 (conservative duplicate alarm 0.12).
  These measurements are not a claim of subjective listening.
- `tests/enemy-drone-presets-browser.cjs`: actual grouped selection and native
  final-output PCM from ten families in Chromium/WebKit, full-replacement
  v1-to-factory history, current-power/Output retention, Custom matching,
  group/wrap navigation, phone/landscape/desktop layout and ZIP/reload.
- `tests/enemy-drone-presets-song.cjs`: real isolated server jobs for old D,
  old-v1 Enemy, sparse dry factory and dense dual-feedback factory via Pot;
  warm PCM-only phone reuse and unchanged original ZIP bytes/hashes/revision.
- All 200 recipes pass strict server schema validation; existing focused Enemy
  backend rejection/content-identity tests are retained. Physical iPhone is not
  asserted tested.


## Global transpose / wider tuning / output hall — ENEMY.5

- `transpose` is optional, integer -24..24 semitones. It shifts all eight
  oscillator frequencies without changing the quantized voice-note controls.
  Detune spread is now 0..100 cents and each voice Fine is -100..100 cents.
  Existing explicit values retain their exact tuning; no defaults or factory
  voice recipes are rescaled.
- Optional `finalReverb:{mix,size,decay,tone,predelay}` is output-only, after
  the oscillator/internal delay/feedback room and Tone stage, **before the
  canonical Output level and final soft ceiling**. Mix/size/tone are 0..1,
  decay .5..12 seconds and predelay 0..0.15 seconds. Absent fields display
  neutral defaults (Mix0, Size.75, Decay5s, Tone.55, Pre-delay22ms) but are not
  added to old state just by viewing the card.
- The hall has independent stereo predelay, four allpass input diffusers on
  each side, eight unequal fractionally read delay lines with slow independent
  sub-millisecond modulation, an orthonormal Walsh-Hadamard feedback matrix,
  per-line RT60 gains, high-frequency damping and DC rejection. Stereo input/
  output vectors and line modulation decorrelate the tails. There is no new
  hall-to-oscillator/internal-effects feedback route. No per-sample allocations.
- Equal-power Mix gains, predelay and size changes are smoothed. DSP buffers
  are lazy: an absent/zero Mix hall starts in exact dry bypass; active Mix
  fading to zero releases the buffers. Enemy Off clears/releases the hall and
  the host disposes/disconnects its worklet immediately. Panic also clears it.
  Output level is **post-hall**, so both button/range mute silence its tails.
- Factory selection retains optional global transpose and final-reverb controls
  as well as power/Output. The unchanged 200 sound recipes continue to match by
  their synth settings; these global finishing/performance fields do not make
  the factory label Custom. A complete saved patch/ZIP restore still replaces
  everything: loading an old patch clears both optional controls. Randomise
  notes retains all controls; Randomise all includes the new fields and full
  tuning ranges, within the existing Master Baker Off/history policy.

### Compatibility and Song preparation

Base `version:1` and optional `engineRevision:2` keep their original meanings.
Audible nonzero transpose, spread above50, an active voice Fine outside +/-50,
or Final reverb Mix above0 needs **enemyDroneVersion3**. Neutral/absent controls
keep capability1/2; Off/missing sources stay0. Neutral optional fields are removed
only from render content identity, not from immutable source ZIPs. Existing
settings and 200 factory rows remain exact. The untouched old DSP branch and a
neutral-control branch have bit-exact baseline PCM at both sample rates.

Strict backend validation allows only these optional objects/fields and their
finite bounds. Render GET and POST inspect the original source manifest;
undeclared/v1/v2 producer audio cannot certify a v3 source, including when part
metadata has been downgraded. Client numerical version handling was already
compatible. The shared worklet powers live and server/offline rendering; its
cache key and import, main DSP/UI/bank and adapter references are invalidated.
The adapter reserves eight sample-seconds of float storage for the active hall,
five otherwise; existing preparation/cancellation and phone PCM reuse remain.

Focused tests: `enemy-drone-output-core.cjs` (12 baseline/neutral comparisons,
20 measured tuning cases at44.1/48k, four16-second hall impulse responses,
100% late echo density, independent stereo tails, exact100ms pre-delay,
four maximum-endpoint renders, Off/level0 and all200 frozen factory rows);
`test_enemy_drone_output.py` plus the existing Enemy suites (strict rejection,
neutral/legacy content identity, capability3 upload/stale GET/original sources);
`enemy-drone-output-browser.cjs` (actual controls/history, native post-output
left-only dry vs stereo wet, post-hall level0 and card Off cuts, globals through
factory selection, ZIP/reload and old full replacement, responsive layouts);
`enemy-drone-output-song.cjs` (four real isolated server jobs: oldv1, untouched
factoryv2, transpose/wide tuningv3, final-hallv3; warm PCM-only playback and
byte-identical original ZIPs/hashes/revisions). Physical iPhone/listening are not
claimed. PCM/spectral evidence supports the technical checks, not subjective taste.


## Transpose step buttons — ENEMY.6

Global transpose retains its slider and adds −/+ buttons, one semitone per
activation. Both use the existing `edit('transpose', ...)` history/save/worklet
update path and canonical optional `transpose` field. Values clamp at -24/+24
and the corresponding endpoint button disables. State restoration, slider edits,
preset retention and Undo/Redo resynchronize both buttons. Buttons are native,
keyboard accessible, labelled and at least44px square on phone. No DSP, preset,
saved schema, producer capability or Song-render identity change.


## Living drift / source waveforms — ENEMY.7

### Controls and recall

Each voice optionally stores `waveform` (`original`, `sine`, `triangle`, `saw`,
`square`, `pulse`) and `width` (.1–.9). Absent waveform means the exact original
sine + Tone-scaled third/fifth partial branch. Pure Sine stays sinusoidal before
PM/feedback; the other explicit shapes do not inherit the original added partials.
Tone still controls downstream low-pass brightness and feedback damping for all
shapes. Square is fixed50% duty; Pulse has independent width. There is no noise
waveform or stochastic excitation. Pulse width is disabled unless Pulse is selected.

Optional `drift:{enabled,amount,speed,breath,pan}` uses Amount0–50 cents,
Speed .01–.5Hz (nominal), Level breathing0–.3 and Stereo sway0–.5. Three
incommensurate continuous sinusoidal phases per voice combine with different
voice rates/phases: smooth quasiperiodic movement rather than noise or stepped
random values. Pitch is bounded by Amount; breathing attenuates by at most the
selected fraction and never boosts canonical level; pan offsets clamp to -1..1.
Independent rate multipliers are .71+.097*voiceIndex, with component ratios
1/.371/1.713. Speed changes preserve phase. Amount/level/pan/power transitions
smooth over150ms; no per-sample allocations. Unsaved phase clocks are deterministic
from source start for offline/native reproducibility.

Absent/disabled Living drift preserves the exact original `motion` branch. The
Living switch defaults Off for old/factory sounds; its neutral display recipe is
15c/.08Hz/6%breathing/10%sway. Moving a Living control explicitly enables it.
While On it replaces (rather than stacks on) the old drift; Legacy slow drift
remains in a disclosure and is disabled while Living is On. Off fades back to the
saved legacy motion and releases its extra phase work after convergence.

Randomise waveforms replaces only the eight waveform/width choices, preserving
notes, pans, levels, drift and every effect/global. Randomise notes retains the
waveform/drift recipe. Randomise all settings includes non-noise waveforms and
active musical-range drift. Each randomiser keeps Master Baker Off inside the
existing accepted history transaction. All200 original factory rows are unchanged;
manual factory selection replaces rich waveform/drift state with the selected
legacy recipe, retaining only the existing power/Output/transpose/final-hall
exceptions. Full patch/ZIP recall is replacement, not a merge.

### Source synthesis and compatibility

Saw/triangle use shared4096-point harmonic mipmaps (1..256 partials), linear
phase interpolation and continuous adjacent-bank blending. Square and Pulse
use a width-shifted saw difference with DC-balanced, bounded-peak normalization,
not narrow-pulse RMS makeup gain. Harmonics are limited conservatively below
Nyquist for the source frequency; PM and nonlinear feedback can still generate
sidebands. Waveform and width edits dezipper over25ms without resetting phase;
returning to Original releases the extra source-shape work.

Only audible non-original active voices or enabled Living drift need producer
`enemyDroneVersion4`; unaffected capabilities1/2/3 and Off identity remain.
Disabled drift, explicit Original and inactive pulse-width fields are excluded
from render-content identity/factory matching, not from immutable saved ZIPs.
The server strictly validates enum/full drift inventory/finite bounds, checks
original source manifests on render GET/POST, and admits, persists and returns
producer4 before allowing immediate GET. A forged v3 marker cannot certify new
audio. The same worklet drives live and isolated Song renders; its module import
and UI/DSP/preset/CSS loader keys are invalidated. Extra shaped-source table
memory reserves two sample-seconds beyond the existing5/8-second estimate.

### Focused evidence

- `enemy-drone-living-core.cjs`:18 exact old/neutral PCM pairs covering three
  routes and capabilities1/2/3 at44.1/48k; all200 frozen rows; five independently
  checked source spectra and native-rate shapes; high-frequency harmonic guard;
  actual PCM zero-crossing pitch within .3c of independently derived motion;
  breathing/sway measurements; six full-feedback maxima; 400-second slow-endpoint
  control-rate coverage and transition cleanup.
- `test_enemy_drone_living.py` with original suites: strict no-noise rejection,
  neutral/old identity and selective versions, producer4 persistence/immediateGET,
  original-source stale GET/POST enforcement and unchanged source ZIP/revision.
- `enemy-drone-living-browser.cjs`: actual controls/history, native harmonic and
  pitch/stereo changes, waveform-only and notes-only retention, Master Baker
  transaction, factory rich-to-old replacement, ZIP/reload, canonical-only saved
  inventory and phone/landscape/desktop geometry in Chromium/WebKit.
- `enemy-drone-living-song.cjs`: four actual isolated server jobs (legacyv1,
  legacyextendedv3, measured variable Pulsev4, measured Living driftv4), warm
  PCM-only phone playback and immutable original ZIP bytes/hashes/revision.

Automated PCM measurements are technical evidence, not subjective listening or a
claim of physical iPhone testing.


## Per-oscillator phase sliders — ENEMY.8 (2026-11-18)

Each voice has an optional canonical `phase` in degrees0–360 (native range,
step1, default display0). Absent,0 and360 are the exact old DSP branch. The
engine reads each source with its own phase offset before cross/return feedback;
carrier phase, tuning and drift clocks are never reset by a phase edit. Changes
slew along the shortest circular arc at25ms, snapping neutral after convergence.
It is a fixed waveform offset, not a new LFO or continuous movement generator.

Waveforms / phase randomisation sets all eight phases to integer0–359, along
with waveform and width, retaining the rest of the recipe. All-settings includes
phase; notes-only preserves it. Master Baker Off remains within accepted history.
No factory row is modified; preset/full old recall removes stale phases, retaining
only the existing power/Output/transpose/final-hall exceptions.0/full-turn phases
are excluded from factory/render-content fingerprints but retained in source ZIPs.

Only audible active nonzero-level voices with a non-neutral phase require
`enemyDroneVersion:5`; inactive phases, Off and zero/full-turn retain prior
capabilities1–4/identities. Strict server schema bounds phase, admits and persists
producer5 and checks the immutable original snapshot on render GET and POST.
Existing generic client/worker capability propagation uses the same worklet DSP.

Focused tests: phase-core checks24 old cases plus zero/full-turn exact PCM, all200
frozen recipes,36 independently measured source phase angles/gain, unchanged
carrier clocks, shortest-arc edits, zero convergence, block determinism and six
max-feedback bounds at44.1/48k. Backend tests enforce identity, strict schema and
positive producer5 storage/immediateGET plus stale original-source rejection.
Phase-browser tests native Chromium touch and WebKit mouse sliders, keyboard
and history, plus actual final-output quadrature/cancellation/full-turn behaviour,
randomisation, ZIP/reload and three layouts in both browser engines. Phase-song uses three actual isolated server jobs
(v1, unshiftedv4, counterphasev5 with an A3 witness), warm PCM-only playback and
immutable source ZIP bytes/hashes/revision. No subjective or physical-iPhone
audition is implied by these automated measurements.


## Record to K — ENEMY.9 (2026-11-18)

The card mirrors the existing shared K1–K5 selected destination and recording
steps/pattern-following state; no duplicate saved controls. Record to K uses the
Keys/Ember four-beat count-in, exact audio-frame window, backing restart,
selected-track replacement, cancellation, Undo/Redo and IndexedDB persistence.
Source adapter ENEMY captures only this engine's stereo native node (including
its own feedback/delay/room/final hall), before shared channel/mixer/Cooking Pot
processing and transient Solo gain. Completed handover switches Enemy Off inside
the K history transaction, avoiding double playback. Stop/recall/account or
context changes cancel pending/active takes and preserve the old K buffer.
Selectors mirror across Keys/Ember/Enemy/K and lock during preparation/takes.
No oscillator DSP, schema, existing factory recipe or render capability changes;
Song stores the K PCM through its unchanged portable/server path. Focused tests
cover K3/K5 captures, exact frames/PCM vs fresh engine, unaffected tracks,
cancellation/Stop/cold-prepare, history/reload and real old/new Song jobs.

Capture-test timing: compute independent reference PCM before arming the native
count-in, never synchronously in a createGraph hook. WebKit can correctly reject
the transport deadline if a test inserts that extra CPU work. Read busy controls
atomically, and leave a real count-in window for native phone cancellation taps.
Song continuity measurements exclude the intentional final 3ms K de-click edge;
16-bit rendered samples may quantise to zero at that fade's end, not a dropout.

## Generation pitch choices (2026-11-22)

The card's **Randomise pitch** panel steers both Randomise notes and Randomise
all settings: Original random / Single note / Chord, twelve roots, 23 chord
qualities and a one-to-four-octave spread. `enemy-drone-harmony.js` owns the
vocabulary and voicer, shared verbatim with On Demand's `drone-harmony.js`.
Constrained generation uses eight enabled voices, covers every chord degree,
then shuffles degree/octave assignments. Notes stay within C2–B6; extended chord
degrees fold into pitch classes before octave distribution. It resets transpose
and per-voice fine offsets to zero; the instrument's detune, drift and effects
retain their normal character. Original random behaviour remains the default.

These are **next-action UI preferences**, not loaded sound controls: choosing a
root/chord does not retune audio, enter history, or change ZIP/Song render
identity. Loading an old patch restores its arbitrary pitches exactly even while
a next-generation chord remains selected. No DSP, factory recipes, capabilities
or saved schema changed. Successful randomisation remains one history edit.

Preview tone uses separate short-lived native Web Audio sine oscillators and a
quiet attack/release envelope, with no Drone or Cooking Pot processing. A new
preview, selection change, hidden page, account lock or page unload stops it;
the context closes after the tone. It never starts the transport or changes the
loaded sound. The preview presents the chord in a readable reference register,
not a random spread of its eight future oscillator voices.

On Demand accepts optional `chord` (default `single`) and `octaves` (default 4)
only as Drone steering. Random root + Single note keeps the previous random
pitch generator; selecting a fixed root or chord constrains the new recipe.
Random-root chords retain the actual root in generated metadata. Native/private
workers share the helper, and publication checks exact pitch-class membership,
audible coverage, zero transpose/fine and octave bounds. Existing requests and
saved purchases are unchanged. Public frontend controls, private engine adapter,
worker and backend validation must remain aligned; do not replace the frozen
engine/editor wholesale to propagate this feature.

Navigation: Ember's Jump text is **Ember** (including its layer power label).
Restructure keeps jade navigation with an ordinary one-pixel outline; the shared
`card-splashes.css` destination override must not add a scarlet inset stripe.
The Restructure instrument card itself retains its requested scarlet accents.

Focused checks: `enemy-drone-harmony-core.cjs`, `enemy-drone-harmony-browser.cjs`,
`enemy-drone-harmony-song.cjs`, plus the chord guards in `test_dfeeder.py` and
public forwarding in `mygrain_public/tests/test_loop_shop.py`. Browser tests use
isolated accounts, actual preview/native PCM and 44.1/48 kHz preview spectra,
Undo/Redo, legacy ZIPs and 320–1440px controls. Song tests prepare real old/new
server audio and assert warm PCM reuse with unchanged source ZIPs and identity.

## Shared pitch LFO

Optional `modes.enemyDrone.pitchLfo` / preset `enemyDrone.pitchLfo` stores
`{enabled, depth, rate, shape, range}`. Missing remains missing, with UI defaults
Off, depth25%, rate0.125Hz, Ramp, Above zero. This independent global modulator
survives factory presets, note/wave randomisation and Randomise all settings.
LFO-only edits never upgrade the legacy oscillator/feedback engine.

Depth is logarithmic pitch: `octaves = depth / 25`, or0.48 semitones per percent;
25/50/75/100% marks have exact click targets and native datalist ticks, while
the slider remains editable in0.1% steps. Bipolar means this depth on EACH side
of the original pitch. Rate0.01–8Hz is free-running audio time, not a UI timer.
For phase `p` in[0,1), Ramp is `p`, Rectified sine is `sin(pi*p)` (one positive
half-sine each cycle), and Saw is `1-p`. Above zero uses `u`, Above/below uses
`2u-1`, and Peak at zero uses `u-1`. Thus Saw/Peak at zero starts on the original
note and falls negative; Ramp/Above zero starts on the original note and rises.
The static curve and help text display the start offset/range without a timer.

`PitchLfo` in the shared DSP engine starts at phase0 with Enemy playback. Parameter
updates keep phase; depth/rate slew over25ms. Bypass fades to no pitch shift then
releases the modulator; replay/Off→On after settling restarts phase0. All eight
voices share the pitch ratio before existing drift/pan. Active modulation bounds
carrier increments below0.45 cycles/sample; existing original-wave harmonic
guards follow effective frequency. Absent/Off/zero-depth uses the byte-exact
legacy branch. No new audio nodes, buffers, schedulers or polling.

Active, audible pitch modulation requires `enemyDroneVersion:6` live/server.
Inactive LFO configuration remains in original ZIPs but is omitted from render
content identity; disabled Enemy remains omitted entirely. Backend strict
inventory/ranges and both GET/POST capability admission inspect original source
metadata rather than trusting stale cached version markers. The same native
worklet is preloaded by the isolated Song render deck.

Regression checks: `tests/enemy-drone-pitch-lfo-core.cjs` (set ENEMY_BASELINE_DSP
and OUT), `tests/test_enemy_drone_pitch_lfo.py` (set ENEMY_BASELINE),
`tests/enemy-drone-pitch-lfo-browser.cjs` and `tests/enemy-drone-pitch-lfo-song.cjs`.
Browser/Song tests require the dedicated localhost test server, disposable stores
and OUT; Song also requires ENEMY_ARCHIVE pointing to an immutable older source
ZIP. Physical iPhone is a separate check from Chromium touch/WebKit coverage.


### Pitch LFO BPM sync (2026-11-22)

Clock chooses retained Free · Hz or BPM sync. BPM rate ratios are 1/16, 1/8,
1/4, 1/2, ×1, ×2, ×4, ×8 and ×16 **cycles per beat** of the shared effective
transport clock: 1/16 is sixteen beats per cycle, ×1 one beat per cycle, ×16
sixteen cycles per beat. Cycle duration is shown in seconds. The inactive Hz
rate is retained when switching clocks. Global BPM/loop-clock-divider changes
update the existing worklet without restarting voices, delays, room or LFO phase.

Optional pitchLfo.sync/ratio fields do not upgrade old engines. Free-Hz recipes,
including explicit sync:false and a remembered ratio, retain their previous PCM
and render identity. Only audible, enabled, nonzero-depth synced modulation needs
Enemy render capability 7; free-Hz modulation remains 6. BPM travels in initial
processorOptions and update messages, independently of saved instrument state,
so native/offline/server worklets start with the correct tempo before rendering.

Tests: enemy-drone-pitch-sync-{core,browser,song}.cjs and
 test_enemy_drone_pitch_sync.py. The Song suite includes original v1, unchanged
free-Hz, four sync combinations including both extremes, and the immutable
November 18 pulse ZIP, then verifies warm PCM-only playback and source hashes.
