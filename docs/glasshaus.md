# GlassHaus · glass and singing bowls (main app)

White source card with original inline bowl/mallet vector art. The current editor
has three drawable strength-over-time lanes, one per object (wineglass, shallow
crystal bowl, deep singing bowl), over 1/2/4/8 bars. Each lane keeps one fixed
note with its own Tune − / + (±24 semitones, optional fractional numeric entry).
The former 16-step numeric editor is removed. Legacy recipes retain their old
notes/chords and exact sound until an explicit curve edit; no migration on load.

## Decay is the instrument

Each object has a natural decay control up to **120 seconds**. Empty-card defaults
are 8s / 35s / 75s; only object one is initially enabled. This is resonator energy,
not a reverb send. The lowest mode's undamped envelope reaches -60 dB at the
selected time; Touch damping shortens it, higher modes decay faster. This is not
a measured claim that a particular diameter of real crystal rings for 120s.
Keyboard mode keeps exact equal-tempered centre fundamentals, Physical mode
uses the size/thickness macro. Mode splitting creates close partials, so an
individual split pair is deliberately a few cents either side of the note.

Repeated same-object/same-pitch hits reinforce the existing modal bank rather
than replacing its tail. Modal voices run until 1.5 times their chosen decay
(approximately -90 dB for the undamped lowest mode), plus excitation gate.
At most 48 active modal voices; extreme new-note density retires the quietest
with a 15ms fade, never a hard oldest-note cut. Object Off fades only that object over 15ms. Main transport Stop /
Clear tails release the graph, as requested for a loop source. Changing a model
while running allows the previous resonator's tail to decay; its next hit uses
the new recipe. There is no multi-minute convolution impulse, audio asset,
remote model download or additional worker pool.

## Research used, and what is actually implemented

1. **Serafin, Wilkerson & Smith (2002), Modeling Bowl Resonators Using Circular
   Waveguide Networks**, DAFx. [Primary paper](https://www.dafx.de/paper-archive/2002/DAFX02_Serafin_Wilkerson_Smith_bowl_resonators.pdf).
   Shared struck/rubbed resonator; long decaying partials; close modes and beating;
   different excitation spectra. GlassHaus uses modal resonators, **not their
   circular waveguide topology** or copied measured data.
2. **Inácio, Henrique & Antunes (2003), The Physics of Tibetan Singing Bowls,
   Part 2: Numerical Simulations**, Tecniacústica.
   [Primary paper](https://documentacion.sea-acustica.es/storage/publicaciones/Bilbao03_ams004b.pdf).
   Contact stiffness changes strike spectra; rubbing depends jointly on pressure
   and velocity. GlassHaus exposes hardness, pressure, speed and contact position;
   smooth energy-bounded frictional lock-in drives its modal pairs. It does
   not solve their full puja contact dynamics or rotating radiation field. Circular
   contact is projected onto paired standing modes (see the contact revision below).
3. **Inácio, Henrique & Antunes (2006), The Dynamics of Tibetan Singing Bowls**,
   Acta Acustica 92, 637–653. [University author record and abstract](https://eprints.soton.ac.uk/43451/).
   This confirms the modal/contact approach and warns that merely splitting
   modes does not explain all audible beating in a moving real bowl. Full paper
   is not supplied by that repository; do not claim its entire method reproduced.
4. **Terwagne & Bush (2011), Tibetan singing bowls**, Nonlinearity 24 R51–R66,
   doi:10.1088/0951-7715/24/8/R01.
   [Primary institutional PDF](https://orbi.uliege.be/bitstream/2268/94996/1/2011-Nolinearity-Terwagne.pdf).
   Equations (3)/(5) motivate thickness/radius-squared physical pitch and the
   inharmonic circumferential shell ratios. Six paired orders n=2..7 are used,
   with small explicit artistic shape corrections and cent splitting. No Faraday
   water waves, droplet effects, fluid solver or radiation simulation is claimed.
5. **Thoret et al. (2013), Controlling a Non Linear Friction Model for Evocative
   Sound Synthesis Applications**, DAFx.
   [Primary paper](https://dafx.de/paper-archive/2013/papers/35.dafx2013_submission_44.pdf).
   Motivates a playable action/object control layer rather than mislabelling a
   generic oscillator or noise sample as an exact physical model. Our bounded
   regenerative component is an intentional numerical/musical approximation,
   not the paper's calibrated source model or an exact stick-slip solver.
6. **Jundt et al. (2006), Vibrational modes of partly filled wine glasses**,
   JASA 119, 3793–3798, doi:10.1121/1.2198183.
   [Primary author-hosted paper](https://phys.unsw.edu.au/music/people/publications/Jundtetal2006.pdf).
   Reviewed the distinction between structural modes and fluid loading. No water
   macro is included: retuning a dry mode bank alone would not reproduce all the
   observed two-mode/loaded-glass behaviour.
7. **Lendermann et al. (2019), Comprehensive vibrational dynamics of half-open
   fluid-filled shells**, Proc. R. Soc. A 475:20190207.
   [Primary open-access article](https://pmc.ncbi.nlm.nih.gov/articles/PMC6694316/).
   Reviewed geometry-dependent structural/viscous losses. GlassHaus intentionally
   uses user-controlled decay with frequency-dependent damping, not their full
   arbitrary-shell or fluid-damping theory. The three shapes are creative
   families, not finite-element reconstructions of measured vessels.

No healing, historical-origin, or material-specific precision claims are made.
No copyrighted recordings, datasets or paper implementations are bundled.

## DSP and integration contract

`glasshaus-dsp.js` normalizes optional `modes.glasshaus`; `glasshaus-worklet.js`
imports the same model. Twelve complex damped rotations per voice at most;
above-0.42-Nyquist modes are omitted. Instantaneous pitch vibrato can be free Hz
or BPM-locked 1/16 through ×16 **cycles per beat**. The phase follows the shared
beat clock and remains continuous across live BPM edits. Output has DC rejection,
finite modal state bounds and a soft ceiling; this is not a calibrated acoustic
loudness or true-peak limiter model. Strike is a hardness-weighted modal initial
velocity, not a contact-force differential-equation solver. Rub uses bounded
moving paired-mode coupling and smooth energy-bounded negative damping for
frictional lock-in, not another unrelated sample or external sine excitation.

Shared transport plans source start, and main Stop releases its graph without
changing saved power. A local power Off never stops the rest of the loop. Standard
Filter & space is source-owned; new GlassHaus FX starts Off. `GlassHaus` is in
EffectInputs, Channel EQ, Cooking Pot leaves, Wasp modulation/destination and
all registry-driven effect selectors. Solo ID is `glasshaus`. Jump navigation,
Mix slider / Solo / optional VU / Jump and Layers power / Solo / Jump / swipe
level / visibility-owned meter use the same canonical state and output.

**Whole-loop randomisation never edits GlassHaus power, objects, notes or volume.**
It is deliberately absent from generation inventories and shutdown heuristics.
The app-wide standing rule still turns standard filter/reverb/delay power Off
for every source, including GlassHaus. Its own three dice retain power, volume,
root/scale/chord, tuning and slot activation; randomise sequence, sound, or both.
These are ordinary history transactions; manual playback/recall is not generation.

Controls are excluded from generic slider/select and Song form-control replay;
canonical state is authoritative for local save, private preset, portable ZIP,
Undo/Redo and isolated render deck. Untouched GlassHaus is absent in main state.
Server validates every field and exact 3-object/16-step shape. Audible GlassHaus
alone requires capability 38 in the existing autonomous-instrument `ember`
render capability family and adds `glasshausEngineRevision:2`; absent/off content
and the neutral extra FX channel are removed only from the copied identity
projection. Old ZIPs are never rewritten and their stored content hashes remain
unchanged. Independent loop lengths join the existing Song LCM cycle calculation.
Native audio, isolated/offline Song, server worker and autonomous stem use the
same worklet. Server rendering reuses the existing admitted ten-worker budget.

## Verification

- `node --test tests/glasshaus-dsp.test.cjs`: modes/chords/geometry, finite output,
  actual 20s single-strike tail, resonator reinforcement, 1–4 even ratchets,
  free/BPM vibrato PCM equality, source-local seeded randomisation/nonmutation.
- `PYTHONPATH=tests python3 -m unittest test_glasshaus test_robot_alignment test_robot_timing`:
  strict schema, immutable source, absent/off legacy identities, LCM cycles,
  capability37 admission and older Robot identities/capabilities.
- `tests/glasshaus-browser.cjs`: Chromium/WebKit phone controls, 3 objects/chords,
  actual offline/native PCM, source-only transport, tempo graph continuity,
  additive Solo, history, portable patch recall and reload.
- Nine DSP checks and ten backend/legacy checks pass. Object Off fades only its
  own voices, leaving other enabled objects ringing.
- `tests/glasshaus-integration-browser.cjs`: 23 effects source menus, Layers
  source ordering, canonical 42% Mix proxy, full global randomisation transaction
  preserves exact GlassHaus state and retains all 22 standard FX channels.
  Only Mega/Sparse apply the standard FX Off reset.
  Unrelated sample acquisition/cut-generation is explicitly stubbed in that test.
- `tests/glasshaus-continuity-stem-browser.cjs`: local GlassHaus Off keeps the
  other looping source identity/shared origin exact and audible (RMS .05657);
  actual autonomous dry stem renders finite stereo audio (RMS .04113).
- `tests/glasshaus-song-browser.cjs`: six actual admitted server renders:
  exact archived pre-GlassHaus Robot ZIP (capability 34), dry GlassHaus, three
  rubbed bowls with split minor chord/BPM vibrato, 100Hz/48dB standard source
  filter, Cooking Pot Mutilator source and Wasp source/destination (capability37).
  RMS respectively .013607, .017028, .019759, .0001404, .419777, .057666.
  Warm re-arm creates no jobs; phone cached playback works; source hashes and
  Song revision unchanged, render memory released.
- Initial Song fixture attempts exposed fixture-only prerequisites: the old
  source-grid fixture lacks required D2 inventory, and a second Robot fixture
  intentionally has every source Off. The passing test uploads the verified
  archived Robot-enabled ZIP byte-for-byte, without decode/rewrite. No broad-suite
  failure was dismissed as pre-existing by count.
- Authenticated live-site evidence is recorded separately under this backup's
  `live/` directory; its browser check blocks all non-GET/HEAD network writes.

Backup/evidence: `output/mygrain-glasshaus-20261122T230637Z/` (workspace-relative).
Separate On Demand and admin WAV/comment stores are untouched.

Final production verification: authenticated Chromium and WebKit at 390×844 both
pass trusted source power, audible native worklet capture, three objects at 120s,
minor chords/BPM vibrato, loop Stop preserving armed power, all 23 effect menus,
no page errors and no body horizontal overflow. All 29 changed/new served assets
were compared byte-for-byte in each engine. The live check blocks network writes.
Main service restarted only after the shared queue was idle; On Demand unchanged.

## Circular rim contact / crackle correction · 2026-11-22

The original rub force had a sharply peaked `velocity/(epsilon+velocity²)`
regenerative term with gain per sample rather than per second. A 48 kHz,
three-object minor-chord reproduction reached the independent modal coordinate
clamps repeatedly (88 block/modal observations in rub, 96 in strike+rub over
three seconds). This is a reproducible DSP roughness source, not proof that every
physical-device underrun has the same cause. The attempted diagnostic upload at
23:32:13 was incomplete (HTTP400 and disconnected client); no full report existed.

Current rubbing uses continuously rotating contact projected onto each paired
circumferential standing mode. `speed` is now explicitly turns per second. One
integrated angular clock maintains the contact position across notes, chords,
repeated contacts and speed edits. Repeated rubs retain their modal displacement,
rotation and pressure envelope instead of restarting contact. `position` sets
its starting rim position. This is an efficient musical approximation of
frictional lock-in, not a calibrated differential contact-force solver.

Optional `contact: auto|finger|mallet` is portable, history-aware and strictly
validated on the server. Missing contact defaults to Auto: wet finger for
wineglass, leather mallet for either bowl. Finger concentrates excitation into
the lowest mode; mallet has a broader modal spectrum. A shared smooth,
sample-rate-scaled negative-damping law regulates each mode's energy against a
pressure/velocity/tool-dependent target modulated by angular coupling. Contact
attack is 35ms, release 60ms; zero-pressure pure rubbing is silent. Rub gates use
beats (strike timing is unchanged), allowing an actual rim gesture to develop.
Modal tails still use the object's own natural decay, not reverb. Repeated
strikes add bounded velocity without changing displacement; an emergency radial
ceiling preserves phase. Output level edits slew over 8ms.

The sample loop no longer allocates temporary stereo arrays or evaluates the old
nonlinear friction exponential/tanh for every voice/sample. Rim rotors advance
by recurrence; speed coefficients are updated per quantum. Existing 48-active-
voice quietest-first, 15ms retirement and source-local Stop contracts remain.

Audible GlassHaus requires capability38 / `glasshausEngineRevision:2`, including
previous GlassHaus recipes whose rub audio needs refreshing. Backend GET/POST
capability checks read the immutable raw source manifest; old source ZIPs and
Song revisions are not rewritten. Absent/off GlassHaus and other source render
identities are unchanged. Native/offline/DAW/server use the same worklet; no new
worker pool or On Demand changes. All three cache edges are versioned: index →
DSP/host, DSP → worklet, and worklet → DSP import, plus the startup registry.

Backup/evidence: `output/mygrain-glasshaus-contact-20261122T233411Z/`.

Final contact verification: 13 DSP tests and 68 backend tests pass. Chromium and
WebKit both pass actual 44.1/48kHz native PCM for circular finger/mallet (eight
render combinations), phone-sized trusted controls, long decay/chords, shared
transport, Undo/Redo and portable ZIP/reload retaining the selected tool. An
initial 0.4s realtime test capture was nondeterministically silent; it now captures
a complete 2s cycle and retains the nonzero-PCM assertion (both engines pass).
Eight actual isolated server jobs pass: unchanged archived Robot source, dry,
three rubbed split-chord objects/BPM vibrato, source filter, Cooking Pot, Wasp,
explicit finger, explicit mallet. Warm re-arm submits zero new jobs; phone-style
cached playback works, memory reservations clear, source hashes/revision remain.
Authenticated production Chromium/WebKit both verify exact bytes of four served
assets, audible circular-rub stereo capture, 120s settings, transport Stop,
23 effect menus and zero body horizontal overflow/page errors. Live network
writes were blocked. Backend restarted after the shared queue was idle; only
temporary test servers were stopped. Physical-phone acoustic listening is not
claimed. Source-local peer continuity and actual isolated stem regression pass.


## Sequencer access and exact CPU optimization — 2026-11-23

The sequencer previously began about 3,133px below the card top on a 390px-wide
phone viewport. It now precedes the three object panels, and a header Sequencer
button reveals/centres the grid and focuses step 1. Existing step nodes, numeric
controls, horizontal grid scrolling, history and portable schema remain intact.

Dense, long-tail CPU use was reproduced, not inferred from an empty editor.
The processor now renders event-bounded chunks in mode-major order, retaining
oscillator locals, persistent Float64 scratch buffers and the original sample
mix order. A 949-byte strict Float64 SIMD WebAssembly kernel runs each pair of
independent split modes together. It is compiled once asynchronously on the
host before node construction, passed as a compiled module, and instantiated
with private fixed 64KiB memory per graph. The numeric kernel has no imports,
allocations, memory growth or inter-thread messages; note-trigger voice allocation
remains bounded and unchanged. Fetch/compilation stays outside processing.

The kernel is embedded in glasshaus-dsp.js to keep its loader cache dependency
atomic and avoid a new asset/public route. Source: dsp/glasshaus-kernel.wat;
reproducible build/check: scripts/build-glasshaus-kernel.cjs (wabt 1.0.39,
build-only; instructions in that script). Direct scalar VM harnesses retain the
same JS reference. Production graph construction requires completed preparation.
All index startup/actual host keys and host/worklet/import edges use
`20261123-glasshaus-cpu-3`; CSS is untouched.

No reduced mode count, shorter natural decay, lower polyphony, contact-model
change, sample-rate change or subnormal flush is shipped. Renderer capability38 /
GlassHaus engine revision2 and existing cached Song PCM remain valid. Native,
offline, isolated DAW and server paths all await the same prepare/createGraph API.

Six-second dense tests use all three objects at 120s decay, major-7 chords,
all sixteen steps, changing degrees, double ratchets, BPM240, and vibrato off or
25cents. Sixteen full stereo comparisons (Chromium/WebKit × 44.1/48kHz ×
strike/rub × vibrato off/on) have exactly zero Float32 sample difference.
Observed render-time reductions on this host: minimum29.1%, median51.7%,
maximum67.3%. Timings are not physical-phone measurements, and PCM checks are
not a claim of acoustic listening or hardware underrun verification.

Backup and detailed evidence:
`output/mygrain-glasshaus-cpu-20261122T235907Z/`.

Final verification: 13 DSP tests and 68 backend tests pass. One initial backend
run hit the existing part_zip() wall-clock ZIP timestamp comparison boundary;
an unchanged rerun passes all68. Chromium/WebKit phone + desktop access, trusted
step/numeric edits and last-step horizontal scroll, Undo/Redo, ZIP and reload pass.
All8 real isolated server jobs pass with unchanged archive source hashes and Song
revision; warm re-arm makes zero new jobs and cached phone playback releases its
memory reservations. Actual isolated DAW stem and audible peer/clock continuity
pass. Authenticated production Chromium/WebKit verify exact deployed assets,
observed Worklet.addModule CPU-3 URL, trusted sequencer navigation, nonzero finite
stereo source capture,120s decay settings and no page errors/root overflow.
Playwright page request events did not expose AudioWorklet module fetches; the
initial network-observer assertion was replaced by observing addModule itself,
not by dropping dependency verification. Production browser writes were blocked,
temporary sessions revoked and the owned19047 server/worker stopped. No main
service restart, production saved content mutation or On Demand change.

## Three drawn object lanes — 2026-11-23

Optional `lanes` contains exactly three arrays of 128 finite strength values
in [0,1]. Fresh interactive state uses smooth rub curves. Missing lanes retains
the archived 16-step engine, cap38/revision2, source ZIP and cache identity. Only
audible drawn recipes require cap39 / `glasshausEngineRevision:3`; missing, Off,
empty or disabled-object-only curves do not invalidate older identities.

Each lane excites only its own fixed-note object, independently of archived
chord/split settings. Rub interpolates pressure continuously (35ms contact attack,
60ms release); zero releases contact, not the resonator tail. Strike excites local
curve peaks; Strike + sing combines both. Same-note activity reuses at most three
fixed banks for an unchanged model. Tune/geometry changes let the previous bank
ring naturally; legacy bounded48-voice retirement remains. The strict Float64
SIMD modal kernel, natural decay ranges and shared transport are unchanged.

SVG drawing has no bitmap allocation or animation loop. Touch/mouse capture
interpolates skipped points into a draft; pointerup commits one canonical history
transaction, while cancellation, lost capture, Escape, account or stale edits
abort. Drawing never enables a source/object. Lane Clear and Clear all are
explicit history-aware edits. Tune uses each existing object tune field. Canonical
ZIP/preset/history/reload, offline/DAW and admitted server paths share the model.
Only the drawing surface prevents page gestures; surrounding page still scrolls.
Sequencer navigation focuses the first lane without the old wide step spreadsheet.

All index startup/loader, host/worklet and worklet/model cache edges use
`20261123-glasshaus-drawn-3`; CSS is versioned too. Backup/evidence:
`output/mygrain-glasshaus-drawn-20261123T002310Z/`.

Drawn-lane verification: 17 DSP and 71 backend checks pass. The independent-lane
regression also retains an archived Split assignment to prove it cannot silence
lanes two/three. Chromium/WebKit verify the new editor at portrait, landscape and
desktop widths; trusted Chromium touch drag, WebKit touch tap and both mouse
paths, cancellation, single Undo/Redo, Tune ±, ZIP and reload. An enabled empty
source joins the already-running shared transport when drawing makes it audible.
Twelve actual native stereo renders cover44.1/48kHz × rub/strike/both × both engines.
Sixteen dense legacy stereo comparisons with the pre-task worklet remain exactly
sample-identical; the949-byte kernel reproduces from WAT unchanged. Ten real
isolated server renders cover archived Robot34, seven legacy GlassHaus38 and two
drawn39 finger/mallet recipes, plus warm reuse/cached phone playback, unchanged
source hashes/Song revision and released PCM reservations. Drawn autonomous DAW
stem and source-local Off/peer source/origin continuity pass. Backend was restarted
only with the production shared admission queue idle; On Demand is unchanged.

Final authenticated HTTPS Chromium/WebKit checks pass at390×844: exact bytes of
index/model/worklet/UI/CSS, observed Worklet.addModule drawn-3 dependency, three
SVG lanes, actual drawing/numeric tune, trusted power, finite nonzero native
stereo PCM,120s objects,23 effect menus, Stop retaining armed power, no page
errors or root overflow. Live requests allow only same-origin GET/HEAD; temporary
sessions are revoked in finally. The initial WebKit probe tapped power while its
numeric input was still focused: touchstart/end arrived but no click. Explicit
keyboard Tab commit before the tap produces the normal trusted click and passes;
no product workaround or weakened audio assertion was shipped. This is browser
verification, not physical-phone acoustic listening. Owned isolated19048 server
and its worker are stopped; production service remains active.

## Explicit Strike grid / scrolling load — 2026-11-23

Current UI offers only Strike (mallet) and Slide (circular rim); own randomisation
never produces the combined mode. Canonical legacy `both` remains solely for old
saved recipes/render decks, not as a selectable new mode. Explicit editing opts
into the new representation rather than rewriting archived sources on load.

Optional `hits` is3×128 strict booleans alongside the existing3×128 volume curves.
Only the first `bars*16` slots are active. Sixteenths follow the shared beat clock,
with velocity sampled from the curve at that exact slot; curve peaks never create
extra hits. Tap adds the selected slot and writes its clicked height at that
slot's curve sample; double-tap removes just that hit. Drag still interpolates the
volume curve, with a6px threshold separating a Strike tap from a stroke. Immediate
first taps and double-tap deletion serialize through history (360ms same-cell
identity), and cancellation/unrelated edits/restores/account/view changes clear
gesture ownership. Slide retains its continuous curve, ignores all hit markers
and never excites mallet impulses. Object power/tuning remain independent.

Strike shows16grid cells per displayed bar; the bar selector accesses all128slots
at8bars without making phone targets eight times narrower. Hit stems/dots show
exact onset and volume; Slide hides this grid and bar control. One stroke remains
one history edit; tap/double-tap edits, Clear, dice, ZIP/reload and Undo/Redo retain
both arrays. GlassHaus now joins the existing leaf-card visibility manager; no
new timer, canvas bitmap, animation loop or audio lifecycle owner is introduced.

Audible recipes with `hits` need cap40 / `glasshausEngineRevision:4`; optional
`lanes` without hits retains39/revision3, old steps retain38/revision2. Empty or
Off recipes preserve absent-source identity. Strict server validation/admission,
LCM, raw snapshots, offline/DAW and shared admitted worker rendering use the same
canonical data. Original ZIPs/revisions/valid old PCM are not rewritten.

The reproducible scroll fault was MAIN-THREAD styling, not GlassHaus graph/state
churn. `html[data-mygrain-scrolling] *` and pseudo-element selectors invalidated
the whole large document on every scroll burst; a display-eligibility geometry
read forced the recalculation. The display-only budget now temporarily pauses
only actual running animation targets and restores only its owned inline styles
when settled/hidden/destroyed. It still has one existing settle timer; never
suspends audio, resets clocks or removes the UI budget/parking. Tests cover style
ownership, duplicate targets, external edits and cleanup. No SIMD/kernel, decay,
polyphony or sample-rate reduction was made.

Matched8s native-source capture /40scroll inputs on this host: RecalcStyleDuration
6.181078s before versus0.673008s final (89.1% lower); TaskDuration7.063077s versus
0.979373s. Long tasks83versus1. Both runs retain exact source graph/origin with
zero worklet state posts; captured8s/352800frames have zero zero-valued samples,
no zero runs, and the same maximum adjacent delta. This establishes reduced UI
contention, NOT an acoustic or hardware-underrun result on Mark's physical phone.
The intermediate CSS-only measurement0.671060s independently locates the cause.

Verification:19DSP,73backend and7UI-budget tests; trusted Chromium/WebKit tap,
double-tap, mouse double-click, independent cells/heights, cancelled gestures,
final128th slot, Slide hiding, portrait/landscape/desktop, Undo and ZIP/reload.
Existing freehand browser checks also pass (12native44.1/48kHz renders). Twenty
paired native stereo comparisons use the SAME compiled949-byte SIMD module in
both frozen/current graphs, covering legacy38, drawn39 and unchanged new Slide
at44.1/48kHz in both engines; every Float32 sample is identical. Twelve real
server jobs cover archived Robot34, seven legacy38, two drawn39 and explicit
Strike/Slide40; warm re-arm makes zero jobs, cached phone playback works, source
hashes/revision stay exact and PCM reservations release. New Strike's actual
isolated DAW stem and audible peer/clock continuity pass.

Authenticated production Chromium/WebKit pass exact bytes for six assets,
observed hits-1 worklet dispatch, trusted hit add/delete and numeric tune,
nonzero finite capture while scrolling,120s objects,23 effect menus, Stop and
no page errors/root overflow. Chromium uses wheel input; mobile WebKit uses
programmatic document scrolling because its mobile wheel path is unsupported.
Live writes are blocked and temporary sessions revoked. Backend restarted with
the shared production admission queue idle; On Demand is unchanged. All graph
cache edges use20261123-glasshaus-hits-1; demand-ui uses20261123-scroll-budget-1.
Backup/evidence: `output/mygrain-glasshaus-strike-scroll-20261123T084448Z/`.


## Layers volume / remaining scroll invalidation · 2026-11-23

GlassHaus uses canonical `level` 0–1, unlike most 0–100 Layers controls.
The shared Layers label rounded the raw value, so 0.65 displayed as 1%.
Its fill was updated only when that label changed, which also made the fill
appear stuck during most of a drag. The GlassHaus registry now supplies
`displayScale:100`; only display/help/fill synchronization changes. The actual
canonical volume, gesture range, history, proxy controls and saved recipes remain
unchanged. The layer-controls loader and preload registry share the new
`20261123-glasshaus-percent-1` key.

The preceding demand-ui repair removed universal scroll descendant rules, but
inline index CSS still selected every `.performance-btn`, `.performance-vu-fill`
and `.performance-vu-peak` through `html[data-mygrain-scrolling]`. The remaining
root-dependent rule was confirmed expensive and removed. The existing bounded
actual-animation pause/restore and visibility-owned meters remain intact.

Matched 40-wheel / 8-second Chromium phone-sized profiles:

| Scene | Before style time | After style time | Before task time | After task time |
| --- | ---: | ---: | ---: | ---: |
| Three-object Slide + source Solo | 690 ms | 3 ms | 1031 ms | 296 ms |
| Slide + Solo + Wasp/Bass Face | 709 ms | 3 ms | 1067 ms | 311 ms |

Captured source/final PCM remained nonzero with zero exact-silence runs, unchanged
source graph and transport origin, and no GlassHaus state messages during
scrolling. These are browser measurements, not a physical iPhone underrun test.
No DSP, modal kernel, host/worklet dependency, backend preparation, render
capability, source ZIP or cached Song identity changes were needed.

`tests/glasshaus-layers-browser.cjs` exercises the actual Layers rail, three
consecutive cold/return Jumps, volume drag/keyboard/card controls, percentage and
fill, Solo retention, one journal entry, Undo/Redo and ZIP recall across Chromium
and WebKit phone/desktop. The reported Jump failure was not reproduced; existing
shared reveal/transition navigation is retained rather than adding a competing
scroll handler. The authenticated live check additionally covers Mix Jump and
final-output capture with actual Wasp/Bass Face processors active. It blocks all
remote writes and revokes its temporary authentication sessions.

Capture probes must start after the buffered shared transport origin: arming at
`currentTime + .1` here preceded the scheduled source by about 32 ms and correctly
captured leading silence. The aligned probe uses `max(currentTime + .1, origin
+ .25)` and records four complete two-second phrases.

Backup and receipts: `output/mygrain-glasshaus-layers-crackle-20261123T093223Z/`.
Main static deployment only; no service restart or On Demand changes.

## Slide-only output headroom · 2026-11-23

Mark clarified that Slide, not Strike, was too quiet. Optional `slideGain` (1–16,
absent = unity) scales the Slide output target before the existing 8 ms gain
smoothing and bounded tanh output. It does not alter modal excitation, decay,
polyphony, strike timing or the SIMD resonator. The calculation is once per block.
Strike and archived combined excitation ignore it entirely.

New fresh Slide sounds use ×8 (approximately +18 dB). **Slide output boost** offers
Original / +6 / +12 / +18 / +24 dB; it is disabled in Strike. Existing saved recipes
retain Original until explicitly edited; switching excitation to Slide explicitly
opts into ×8 when no boost is stored. Undo, ZIP and persisted recall retain it.
No account/saved patch/Song contents are migrated automatically.

Only audible Slide with non-unity gain needs renderer capability 41 / GlassHaus
content engine revision 5. Neutral or Strike gain fields are omitted from render
identity, preserving original cache identities and source archives. Offline,
live, isolated Song and DAW graphs share the same processor. New host/worklet/model
URLs use `20261123-glasshaus-slide-gain-1`; Layers retains its independent percent
fix cache key. This audio adjustment is separate from the preceding UI-only repair.

Regression coverage: `glasshaus-slide-gain-browser.cjs`, scalar DSP gain/Strike
counterfactuals, strict backend validation/admission, twenty frozen native stereo
comparisons, real server Songs including paired original/boosted Slide and an
actual isolated Slide DAW stem. Evidence is stored with the Layers repair.

Measured native gain counterfactual at 44.1/48 kHz: quiet three-object Slide RMS
increased almost exactly ×8; Strike maximum sample difference remained zero.
Authenticated live Chromium/WebKit, 8-second post-effects capture during scroll:
RMS 0.00223975 → 0.01781814, zero exact-silence runs, no graph/origin replacement
or scroll-induced state messages, Wasp and Bass Face active. Browser evidence is
not a claim of an audible test on Mark's physical iPhone.

Final validation: 20 scalar DSP, 75 backend and 7 UI-activity checks pass; twenty
frozen native comparisons remain exact. Four Layers phone/desktop cases and both
phone Slide persistence/native-audio cases pass. Thirteen actual isolated server
Song renders pass, including warm-cache PCM-only phone playback, immutable
source hashes/revision and paired Slide RMS 0.000648934 → 0.00526156. Actual DAW
Slide stem is audible; local Off preserves the peer source and shared clock.
Backend restarted only after the shared queue was idle; production service active.
