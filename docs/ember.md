# E · Ember

> Archived Ember 1 documentation. The new instrument is documented in [Ember 2](ember2.md). Ember 1 remains solely for saved-sound compatibility.

Build `v2026.11.16.EMBER.12`. Original digital patch instrument inspired by SOMA's
[ENNER signal map](https://somasynths.com/enner_specs/) and
[description](https://somasynths.com/enner/), not a circuit-accurate emulation.
The source has five oscillators, six independently tunable pulse outputs with optional binary clock linking, three AND outputs,
ring modulation, stereo filter inputs and a modulated delay. Ember replaces
bodily conductive bridges with explicit bounded-strength patch cables. Ember 11
removes NOISE and noise-based TOUCH entirely; only oscillator/pulse generators
and their derived signals remain. Pulses have individual Width controls with
µs/ms readouts and C switches for cross modulation.

## Access and controls

Jump → **E · Ember**, or the E row in Layers. Cream card immediately after C, also C → E in Layers and Jump.
Dfeeder retains final-card/final-Jump ownership. The Layers row has power, Jump
and additive Solo, mirroring the instrument’s canonical controls. Five independent
frequency knobs spanning .01–1200 Hz (including 100-second sub-Hz cycles), master pitch, waveform, tone, modulation depth, volume, delay
time, bounded feedback and Bizarre delay modulation. Native accessible rotary
sliders support pointer drag, arrows, Home/End and double-click reset.

Circular copper output / blue filter-or-delay input / violet pitch input pads.
Drag or tap output then input (either order). Drag an occupied input to move its
selected/last cable's destination. Tap a cable to select strength; double-tap it
to delete. Cable selector + Remove and keyboard Delete/Backspace are alternatives.
Pointer cancellation abandons a cable gesture; a cancelled knob restores its
previous value. Presets are explicit deterministic starting points, not randomizers.

Tempo `null` means follow song BPM. A local override never writes the global BPM.
Within ±max(2 BPM, 2.5%) of the song clock it snaps back to follow. Explicit Use
song BPM also relinks. In Clock mode P1 = one cycle per beat; P2–P6 divide by powers of two.
The multiplier spans ÷4–×128 and affects only linked lanes. Each pulse now has
its own logarithmic knob, exact numeric Hz entry and Free Hz / Clock toggle.
Free Hz spans **0.01–2560 Hz** (100 seconds per cycle at the bottom) and ignores
both BPM and multiplier. Editing a linked knob/value detaches just that lane;
its Clock button relinks it, or Link all to clock restores the complete divider.
SOMA documents six divider outputs and one source TEMPO control, not six
independent hardware frequency knobs; independent Free Hz is an Ember extension.
The published spec gives no numerical minimum, so 0.01 Hz is an explicit digital
design range, not a claimed hardware measurement.

## Canonical state, audio and compatibility

**Current render revision:** Ember 12 requires `emberVersion:8` for every audible
Ember state because this is an intentional synthesis/timbre redesign. Missing,
Off, zero-volume without active Volume modulation and unpatched Ember retain
existing identities. Original saved source ZIPs and Song revisions are unchanged.
Earlier capability numbers below document historical releases.

`modes.ember` (and preset `ember`) is the sole recipe: version/enabled/level,
frequencies, waveform, pitch, tone, modulation, nullable tempo, pulse multiplier,
delay settings and up to 64 unique output/input cables with normalized strengths.
Generic slider/select inventories deliberately exclude the Ember subtree. Missing
legacy state defaults Off. Ordinary/Mega/Sparse randomisation switches E Off and
preserves its recipe; it never generates an Ember patch.

`MygrainEmber.prepare(context)` first loads the native pulse/LFO clock worklet
once per context; shared editor and Song context creation awaits it. Then
`ember-dsp.js` constructs the native Web Audio graph without UI timing, microphone
or external samples. The same graph is created in the borrowed-context Song
render deck. All scheduled
sources and connections are released on Stop, context disposal and account lock.
Repatching releases old gain nodes rather than retaining them in the owner list.
Delay feedback is bounded before both the internal feedback and patchable returns.
An output DC filter and saturator bound the final stereo signal.

Live source key `E` joins the existing CharacterFx → downstream source-owned
router (Whole mix / explicit E inserts) and main/DAW layer-input policy. It has
no invented standalone EQ state; the base EQ connector permits E solely as a
new dry routing key after input-EQ routing is installed. Existing EQ keys and
schema are unchanged. Saved/global additive Solo uses `bastarde`; client and
backend source membership map it to E. No other Solo ownership is changed.

Backend strict validation constrains every control, waveform, clock and endpoint.
Legacy audible Ember retains `emberVersion:1` plus content engine revision 1.
The optional six-element `pulseFrequencies` array holds per-lane Hz or null for
Clock. Absent/all-null retains the exact v1 oscillator branch, PCM and content
identity. Any audible non-null pulse override or main-voice frequency below the legacy
20 Hz floor requires `emberVersion:2` and content
engine revision 2; the same frequency resolution drives live updates and Song phase
alignment. Strict backend validation accepts only six null/finite .01–2560 pulse values and five finite .01–8000 voice values. Off/missing/
zero-level or unpatched Ember is stripped from render identity, preserving old
freezes. Render GET refuses missing capability for an active source; POST requires
`ember=1` for old divided clocks and `ember=2` for independent rates. The client sends and retains the flag, including retained renders.
Old source ZIPs and Song revisions are never rewritten. Native installers unchanged;
no claim of physical iPhone/DAW/CEF audio verification.

## Regression commands

Use an isolated account/store + staged loopback server; never production test Songs.

```
BASE=http://127.0.0.1:19415/mygrain/ OUT=/private/evidence node tests/ember-browser.cjs
BASE=http://127.0.0.1:19415/mygrain/ OUT=/private/evidence node tests/ember-song.cjs
node --test tests/global-solo.test.cjs
BASE=http://127.0.0.1:19415/mygrain/ OUT=/private/evidence node tests/source-solo-isolation-browser.cjs
```

Browser test: Chromium/WebKit, 360/390/430/844/1440 widths, zero port intersections,
tap/drag/repatch/double-delete, tempo and state recall, generic-inventory exclusion,
main output PCM, stop/restart, native offline preset audio, silence, gain and
high-feedback bounds, fixed node count across modulation/repatch updates.
Server test: actual legacy/on/off preparation, immutable source hashes and revision,
unchanged legacy content identity when Off, channel-specific Ember spectrum, capability
admission rejection, warm server reuse and phone-context playback.

## Stereo texture bank (EMBER.2)

200 explicit full-control recipes, twenty each: Cracked contacts, Binary
splinters, Dust relays, Shattered copper, Shortwave sparks, Broken ceramic,
Delay debris, Wire rain, Fault lines and Ghost embers. Distinct stereo patch
maps, noisy/cross pitch modulation, binary-rate contrasts, filter splits and
short/cross-fed delay networks emphasize electrical grit and fractured textures.
Previous/select/next navigates the displayed groups; Custom is skipped and ends
wrap. EMBER.3 revises all 200 recipes with six non-octave-locked free rates: fast
fractures coexist with independent sub-Hz drift. Every texture also retunes one
main voice below 20 Hz for slow pitch modulation or ring-gated carriers, retaining
the remaining audible carriers and stereo paths. All four studies exploit slow
main-voice tuning too. The four starter choices are now
explicit full recipes too: Hearth Murmur, Bronze Drizzle, Carbon Stutter and
Vacuum Stillness. Selecting any factory choice keeps power/local tempo; loading
an old saved recipe never silently migrates it.

The new naming scheme is **material + event**. Ten materials (Solder, Logic,
Mica, Copper, Radio, Porcelain, Echo, Wire, Basalt, Cinder) combine with twenty
events to give 200 globally unique titles, even without the bank or number. All
204 displayed factory/study titles are case-insensitively distinct. Factory patches preserve power and the local/song
clock choice; tempo follows the current song when there is no override.

`ember-dsp.js` owns `PRESETS`; these are editor-only data. No factory ID or bank
selector enters saved state. Canonical controls including optional independent pulse Hz fully describe
playback; no selector ID is saved. The selectively versioned server path renders
the same graph. No installer change is needed.
The generic inventory continues to exclude the whole Ember subtree. Normal
Undo/Redo, portable capture/recall, account restore and randomisation-Off apply.

Ordering owners: `ember.js` inserts the existing card after C and its Layers row
after C’s row. `navigation-palette.js` reapplies card adjacency on lazy effect
insertion/replacement and explicitly places E after C in both Jump layouts.
It no longer adds Ember to the effect tail. No saved audio order is changed.

Regression additions: `node --test tests/ember-bank.test.cjs`,
`python3 -m unittest discover -s tests -p test_ember_bank.py`, and isolated
`BASE=http://127.0.0.1:19416/mygrain/ OUT=<evidence> node tests/ember-bank-browser.cjs`.
The browser regression renders every recipe at 44.1/48 kHz, checks true stereo
energy and bounded finite PCM, plus 320/390/1440 UI fit, history/codec/reload,
additive Layers Solo, cold/lazy order and real navigation.

The Ember card uses block layout explicitly: inherited control-group flex sizing
can stretch its aspect-ratio wheel in WebKit after a desktop-to-phone resize.
The cable regression asserts equal wheel width/height at every tested viewport.

## Independent-pulse verification (EMBER.3)

`tests/ember-pulses.test.cjs`, `tests/test_ember_pulses.py`,
`tests/ember-pulses-pcm.cjs` and `tests/ember-pulses-browser.cjs` cover strict
new schema, six independent minimum/maximum rates and mixed clock lanes,
110-second raw pulse capture, legacy-bank PCM against the pre-task engine (exact on deterministic paths;
native modulated-delay repeat-run float variation is recorded separately),
phone/desktop controls, drag/keyboard/numeric/history and portable reload.
`tests/ember-bank-pcm.cjs` renders all 200 revised textures at both sample rates
in Chromium/WebKit. `tests/ember-bank-song.cjs` exercises actual isolated legacy
v1 and new v2 server jobs, immutable sources, producer-v1 rejection for v2 parts,
warm cache and phone playback.

Keep legacy PCM comparisons in small closed-page batches (twelve patches). Native
OfflineAudioContext allocations are not promptly collected by WebKit; a single
huge comparison page can consume gigabytes and interfere with server-job startup.
Run heavy PCM batches and real server Song jobs sequentially.

`tests/ember-voices-song.cjs` additionally checks real server sub-Hz voice
modulation with no independent rhythm-pulse overrides, selective capability 2,
immutable sources, warm reuse and phone playback.

Raw eleven-generator timing check: `SKIP_LEGACY=1 OUT=<evidence> node
tests/ember-pulses-pcm.cjs`. Omit SKIP_LEGACY and set TASK to the pre-change
backup directory (before/ember-dsp.js plus evidence/legacy-bank.json) to compare
the original full recipes and deterministic non-delay paths too.


## EMBER.4 — shared modulation and fresh patches

The Ember-only **Random patch** action generates fresh stereo wiring, five voice
rates, six free pulse rates and colour/echo settings. It does not select a factory
preset. Power and the nullable local clock are retained. EMBER.6 supersedes the original
LFO-retention policy: card patch generation now generates fresh modulation too. It is
one Undo/Redo step and updates a playing graph in place. The 200 factory recipes
and four study recipes are unchanged. Ordinary/Mega/Sparse app randomisation
still switches E off without erasing its recipe.

One optional `modes.ember.lfo` contains `enabled`, `wave`, `rate` (.01–20 Hz),
`depth` (0–1), `inverse` and unlimited unique `targets:[{key,inverse}]`. Its six
shapes are sine, triangle, ramp up, ramp down, square and deterministic eight-step
random. The shared native looping control source runs on audio time, aligned to
the shared transport origin, with no JavaScript timer or worklet dependency.
Each assigned destination maps the shared bipolar signal into its own bounded
normalized range around its saved base; frequency/rate mappings are logarithmic.
Full depth reaches both ends. Per-target Inverse XOR master Inverse reverses the
wave. Assignments do not turn on the LFO automatically. Saved knobs always show
base values, never effective transient offsets.

All 21 targets are available: `freq0..4`, `pulse0..5`, `level`, `pitch`, `tone`,
`modDepth`, `delayTime`, `feedback`, `bizarre`, `balance`, `tempo`, `pulseRate`.
Frequency and pitch combine before the existing sample-rate cap. Global tempo
and pulse multiplier modulation affect only clock-linked pulses, not free Hz;
a linked pulse's own assignment combines with that global clock motion.
The nullable saved tempo continues following/snapping to song BPM unchanged.
LFO depth/rate are not self-modulation targets.

Optional `balance` is 0–1: 0 = oscillator/ring audio only; 1 = pulse/AND audio
only; .5 = both at their original unity gain. It changes audio/delay excitation
cable gains, not modulation cables, noise, touch or already-ringing echo returns.
Missing/neutral balance retains the exact previous graph and PCM. LFO Off,
zero depth and no targets instantiate no modulation nodes. Graph updates and
Solo changes release owned LFO sources/control curves; stopping releases them.

Active audible LFO or nonneutral balance requires `emberVersion:3` on both
client and server GET/POST. Disabled/zero-depth/unassigned LFO and neutral
balance are removed only from content hashing, not the original source ZIP.
Legacy v1/v2 cache identities, sources and Song revisions remain unchanged.
Volume modulation can make an enabled, patched zero-base-volume Ember audible
and therefore must require v3. Server rendering uses the exact same native DSP.

Verification: `node --test tests/ember-lfo.test.cjs`; `python3 -m unittest discover
-s tests -p 'test_ember*.py'`; isolated `tests/ember-lfo-browser.cjs` and
`tests/ember-lfo-song.cjs`; `TASK=<backup> OUT=<evidence> node
tests/ember-lfo-pcm.cjs` for both native browser engines. Keep native offline
contexts in bounded closed-page batches and run PCM/server suites sequentially.


## EMBER.5 — BPM LFO with independent ratios

The LFO now offers **Free · Hz** or **BPM sync**. Hz retains its existing
.01–20 range and saved value. BPM uses `(tempo ?? songBpm) / 60 * multiply /
divide`; ×1/÷1 is one cycle per quarter-note beat. The original independent selectors offered
1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48 and 64, including triplet/dotted ratios;
EMBER.6 presents these as one ×/÷ menu, retaining saved compound pairs exactly.
The status names Song or Local Ember BPM and the resulting effective Hz.
The LFO follows Ember's nullable local clock, not the separate pulse multiplier.
Tempo modulation uses the saved base tempo for its own clock, avoiding recursive
self-modulation. BPM/ratio updates retain integrated audio-clock phase while the
graph exists. Wave, depth and all master/per-target inverses remain shared.

Optional `lfo.sync = {enabled, divide, multiply}` is saved semantically alongside
the original `rate`. An absent object leaves the old LFO shape and sound exact.
Switching to Hz retains selected BPM ratios but ignores them for processing and
content identity. Manual mode switching retains both choices. Mode and ratio edits
are individual Undo/Redo actions and survive portable ZIPs and reload.

Only an audible active BPM LFO needs `emberVersion:4`; free-Hz active LFO still
needs 3, older sources retain 1/2 and inactive/off Ember retains prior identities.
Client/server capability checks read the original source ZIP, including stale GET
admission. Sync-disabled state is removed only from render hashing, never source
archives, and rendering does not rewrite a Song revision or original ZIP.

New focused tests: `node --test tests/ember-lfo-sync.test.cjs`, backend discovery
above, `TASK=<backup> OUT=<evidence> node tests/ember-lfo-sync-pcm.cjs`, and isolated
`BASE=http://127.0.0.1:19417/mygrain/ OUT=<evidence> node
tests/ember-lfo-sync-browser.cjs` / `tests/ember-lfo-sync-song.cjs`. Native timing
includes a 32-second cycle, 1280 Hz extreme, global/local tempo transitions at
44.1/48 kHz and bit-exact six-wave Hz comparisons against Ember 4. UI checks
exercise real mode/ratio edits, history, inverses, song/local clock, portable
recall, reload and 320/360/390/430/1440 layouts in Chromium and WebKit. Actual
isolated server Song jobs check divided global and multiplied local rhythmic
PCM, retained Hz, legacy v1/v2, capability 4, immutable originals and warm reuse.


## EMBER.6 — full Hz/BPM randomisation and one ratio menu

**Randomise Hz** and **Randomise BPM** are full Ember patch generators, not
LFO-only actions. Both regenerate stereo wiring, tunings, colour/echo controls,
balance and the single LFO: enabled, waveform, rate, depth, master inverse and
2–6 unique assignments with per-target inverse. At least one frequency is
assigned; all 21 targets are eligible. Generated depth is .15–.55, free rate
.01–20 Hz; the factory level floor stays above the generated level-depth range,
avoiding whole-cycle volume silence. Power and nullable local tempo are retained.
Each button is one history edit and updates a playing graph in place; Off stays
Off without creating a graph. The existing seed API accepts an optional third
`'hz' | 'bpm'` argument; omitted mode follows the current LFO mode. Explicit UI
buttons always select their named mode. These generation-only changes never
alter saved recipes on recall, whole-app randomisation or AI generation.

Hz generates six independent pulse rates plus free-Hz modulation. BPM links all
six pulse lanes to the existing divided clock, randomises the clock multiplier,
and selects a BPM-synchronised LFO ratio. In both modes the unused free Hz and
ratio settings remain valid saved controls. Whole-app Ordinary/Mega/Sparse still
switch Ember Off and retain its recipe. All 204 factory/study recipes are exact.

The LFO now has one **Rate · × / ÷** dropdown, ÷64 through ×64 including 3, 6,
12, 24 and 48. ×1 is one beat. The saved `lfo.sync` object and strict backend
validation are unchanged. Each earlier compound pair (such as ×3/÷8, including
equivalent unreduced pairs) appears as a **Saved** option without mutating its
canonical settings, rate or render identity. Selecting a standard option writes
only that selected pair, as one Undo/Redo step. The temporary Saved choice is
editor-only and never enters generic control inventories or source metadata.

No graph, timing, schema, render-version or backend processing change is needed:
new Hz patches use existing capability 3, new BPM patches existing capability 4.
Old hashes/ZIPs/revisions remain unchanged. Server workers render the actual saved
recipe with the same existing graph; they do not rerun the patch generator.

Regression commands: `node --test tests/ember-*.test.cjs`, backend Ember discovery,
and isolated `tests/ember-random-browser.cjs` / `tests/ember-random-song.cjs`.
`OUT=<evidence> node tests/ember-random-pcm.cjs` checks 240 dispersed-seed native
stereo renders (both modes, 44.1/48 kHz, Chromium/WebKit) in closed-page batches.
The browser test covers both real actions On/Off, graph ownership, exact one-step
Undo/Redo, all 144 prior sync pairs, both rate-mode layouts at phone/desktop widths,
and compound-ratio portable recall/reload. Run heavy native PCM and server jobs
sequentially. The new generator regression must fail against the exact pre-task
module (`EMBER_MODULE=<before/ember-dsp.js>`), with no live-file swapping.


## EMBER.7 — armed Ember follows Loop Play

The main **Loop Play** and sequencer **Play** now start Ember when its saved E
power is On, at the sequencer's shared audio-clock deadline. Off stays Off; an
already-running Ember is not retriggered. Turning E On during a live loop joins
that clock. Loop Stop/Reset releases a loop-started E without changing its recipe
or saved power. If the independent Bastardloop group is also playing, stopping
only the sequencer leaves E playing; the group Stop and Stop All still release it.

Enabled E also satisfies the sample-free **Start Bastardloops** UI/readiness gates;
no placeholder sample or separate Ember Play tap is needed. Power changes refresh
those gates immediately. No other source is started by the new sequencer trigger.

This is editor transport integration only. Saved Song render decks retain their
existing full-source start/stop ownership, graph, PCM and capability requirements;
no saved-state/hash migration, DSP, presets or server changes. Run isolated
`tests/ember-loop-start-browser.cjs` for actual main/sequencer/shared controls,
phone/desktop Chromium/WebKit stereo PCM, shared deadlines, On/Off, independent
transport and LFO disposal, plus the real server Song regression.

## Visible volume controls (EMBER.8)

Ember volume is directly below the card toolbar. EMBER.10 removes the Jump slider and its wrapper/style/ordering/search hooks, retaining the Jump button and the card slider. The card slider and existing Level dial edit the same `modes.ember.level` (0–1) through normal draft history. Ember is registered with the existing Layers swipe-to-level and VU host using `emberVolume`, `emberLayerPower` and `graph.output`; no second gain or serialized proxy slider is added. Random patches, restore and Undo/Redo synchronize all views.


## Audio-rate oscillator cross modulation (EMBER.9)

Tick **C** below any frequency knob to send that oscillator's audio signal into
all four other oscillators' frequency inputs, never its own. Multiple C sources
can interact reciprocally. **Cross mod depth** is independent of patch-cable Mod
depth; its Mod/Inverse buttons also assign it to the shared LFO. At full depth,
the summed FM budget is 2000 Hz, divided across the selected source oscillators.
Each selected source uses one native 128-sample DelayNode and one native GainNode;
the delay makes reciprocal AudioParam feedback causal in both supported engines.
This remains audio-rate processing, not UI-timer modulation. Changing C/depth
updates the existing running graph; Undo/recall may rebuild it normally. Zero
depth with no active depth LFO, or all C switches clear, allocates no FM nodes.

Optional `crossMod` is exactly five boolean source flags; `crossModDepth` is 0–1,
default .5. Missing fields retain the original graph and defaults. Only audible
active cross modulation requires selective `emberVersion:5`, on GET/POST as well
as native server rendering. Inactive cross fields are excluded from content
identity, without modifying original ZIPs/revisions. Existing v1–v4 recipes and
all 204 factory/starter definitions remain unchanged. Cross modulation is the
22nd shared-LFO destination; master and target inversions retain their meaning.

Both Ember Randomise buttons generate C assignments. **Randomise BPM** sets both
LFO and cross-mod depths to exactly **100%**; Hz randomises both depths. Every
manual factory/starter selection and either card randomisation preserves the
exact current `level`, power and nullable local tempo. Random generation never
assigns Volume to the LFO; manual Volume Mod/Inverse remains available. Preset matching ignores
level, so manual volume doesn't obscure the selected patch. Whole-app generation
continues to turn E Off and keep its recipe/level. Project/ZIP restore, Undo/Redo
and Song snapshots still restore their actual saved level; this is deliberately
an editor patch-selection/generation policy, not a saved-state migration.

Focused verification:

```
node --test tests/ember-cross-mod.test.cjs tests/ember-random.test.cjs
TASK=/private/evidence python3 -m unittest discover -s tests -p 'test_ember*.py'
TASK=/private/evidence OUT=/private/evidence node tests/ember-cross-mod-pcm.cjs
BASE=http://127.0.0.1:19422/mygrain/ OUT=/private/evidence node tests/ember-cross-mod-browser.cjs
BASE=http://127.0.0.1:19422/mygrain/ OUT=/private/evidence node tests/ember-cross-mod-song.cjs
```

Use isolated stores, never production test Songs. PCM checks cover every directed
source/target pair and self-exclusion, native FM sidebands, all 32 C combinations
at both sample rates and all four waveforms, node updates/disposal, both stereo
channels and unchanged original non-feedback PCM. Native recurrent-delay graphs
can differ by a few Float32 accumulation bits even between two separately loaded
copies of the identical pre-change module; exact legacy comparisons therefore
isolate non-feedback paths, while full feedback recipes receive finite/bounded
stereo checks. Runtime controls exercise all 204 actual menu selections, 320–1440
widths, live edits, history, portable ZIP and reload in Chromium and WebKit.

The server dry-versus-single-C fixture explicitly disables the default drum
machine in addition to the sparse source list. That list does not own Drums;
leaving the default hat pattern active adds independently generated high-band
noise to both channels. The original failed full-output comparison and corrected
fixture are retained separately in release evidence. Assert self-excluded left
output against a small absolute noise floor, and modulated right change relative
to the dry final-output RMS (not the much louder pre-mixer native graph).


## Gain staging and Jump simplification (EMBER.10)

The former graph applied `.26 × cable.amount` to audio bridges and then another
`.24` to the stereo sum. A full-volume, full-strength single sine per side
measured approximately .044 RMS: unnecessary sum attenuation compounded the
per-cable headroom. The sum is now unity; cable levels, modulation routes,
balance, delay feedback, DC filter and the existing tanh saturator are unchanged.
Gain is corrected **before** the saturator, not by boosting its protected output.
Small signals rise by up to 12.40 dB (1/.24); denser signals compress naturally
within the existing output ceiling. The same sine fixture measures about .179
RMS at 48 kHz. This is measured PCM, not a subjective listening assessment.

`modes.ember.level` remains exactly the saved 0–1 value. Card volume, the rotary
dial and Layers gain still control one post-saturator output gain; half volume
is half the PCM amplitude and zero remains silent. Factory/starter and random
patches retain current volume exactly. No recipe or state-schema changes.

Live and borrowed-context/server render decks use this same native graph.
Every audible source now needs capability/content engine revision **6**; the
backend GET validates against the immutable source manifest even if part metadata
is old, and POST rejects producers 1–5. The UI derives the requirement from the
decoded snapshot. Old source ZIPs, account ownership and revisions are untouched;
only affected rendered audio is refreshed. Off/missing/unpatched/muted content
keeps its previous hash and cached PCM. All-null pulse overrides normalize away
for content identity regardless of the now-shared gain version.

Tests: `ember-gain-pcm.cjs` uses paired baseline/current native stereo renders
for all 200 factory textures in Chromium/WebKit at 44.1/48 kHz, plus exact inactive
PCM, sine levels/half scaling, zero-base Volume LFO, noise/TOUCH/pulses, dense
64-cable maximum-feedback/FM and seeded random extremes.
`solo-tracker-browser.cjs` checks Jump-only removal, normal navigation, retained
card/Layers/rotary gestures, history, final-output stereo volume, ZIP and reload.
`ember-gain-song.cjs` has before/after phases against the same **isolated** store:
actual old-engine dry/FM/independent-pulse/BPM-modulated parts are refreshed with
version 6, preserving source bytes/revision, unchanged Off render and warm phone
playback. No native installer update; physical iPhone/DAW remains unverified.

For the paired Song regression, launch `tests/song-beta-test-server.py` with
`PYTHONPATH` set to its sibling `fs7300-documenter` directory and one explicit
`MYGRAIN_TEST_ROOT` beneath `/tmp`. Baseline/current static top-level files must
be physical copies inside their own authenticated app roots; outbound symlinks
are rejected by the route checker. Stop the baseline server before starting
the current server on the same port/store. Run `PHASE=before` then `PHASE=after`
with the same OUT; `RESUME_SONG=<original id>` resumes baseline verification
without duplicating sources. Inactive Ember requires no capability, but the
existing renderer still advertises producer flag 1 on its Off render; preserve
that cache rather than asserting a nonexistent zero producer flag.


## Ember 11 — pulse-only texture sources and audio-clock width (2026-11-16)

- Ember has no NOISE or noise-based TOUCH source, node, pad or Strike action. Factory IDs/names/tunings remain; their retired noise cables are removed from generated/normalised recipes. Accept original legacy endpoints at the archive validator, then ignore them at runtime; never rewrite stored source ZIPs.
- Randomise Hz/BPM retain exact canonical power, volume, local tempo **and Osc ↔ Pulse balance**. Exclude both Volume and Balance from newly drawn LFO assignments. Existing manually assigned Balance/Volume modulation still restores normally. Whole-app generation continues to power Ember Off without changing its recipe.
- Six native AudioWorklet pulse clocks produce single-sample hard edges. Optional `pulseWidths` is six high times in seconds, each 0.00001–1 (absent = 0.005 s). Per-pulse Width knobs and numeric millisecond entries show µs below 1 ms; actual high time has a one-sample floor and leaves at least one low sample each cycle. Requested base values, not moving LFO values, are saved/displayed. Ordinary stereo tone filters/DC protection remain intentional.
- Optional six-boolean `pulseCrossMod` adds C below each pulse. Oscillator C and Pulse C both feed native audio-rate FM to all other ten generators, never themselves. Keep the shared cross-depth budget (2000 Hz divided among selected sources), with one render-quantum causal delay per source. Optional `width0`–`width5` and `lfoRate` are added to the shared LFO target registry.
- Rate Mod/Inverse applies the same LFO to its own rate in either Hz or BPM mode. The native rate clock integrates its own waveform each sample; rate, waveform and inverse use deterministic AudioParams (not asynchronous first-render messages). Keep phase during live self-rate edits and release clocks/routes on Off/disposal. Other destinations retain per-target/master inversion.
- `MygrainEmber.prepare(context)` loads `ember-clock-worklet.js` once per native context, awaited by shared context creation before editor or Song capture. The static asset is explicitly public-allowlisted. Pure oscillator audio without changed sources keeps capability/content revision 6 and exact PCM. Audible pulse/AND/noise/TOUCH cable snapshots, active Pulse C or self-rate modulation need capability 7; raw retired noise-only snapshots also need 7 so old noise PCM cannot survive cache refresh. Missing/Off remains legacy. Enforce capability on original-snapshot GET/POST and accept old source archives without changing their revision or bytes.
- Regressions: `tests/ember-pulse-engine.test.cjs`, `test_ember_pulse_engine.py`, `ember-pulse-pcm.cjs`, `ember-pulse-browser.cjs`, `ember-pulse-song.cjs`. Native fixtures isolate both channels, verify requested widths/one-sample edges and full 0.01 Hz cycles at 44.1/48 kHz; the Song fixture pairs isolated Ember 10/current roots on one disposable account store.

Pulse FM uses signed through-zero phase increments (matching native oscillator FM), not a zero-frequency clamp; negative excursions reverse phase instead of latching mutually modulating pulses silent. Width is evaluated against absolute instantaneous rate.


## Ember 12 — clear low/mid circuits, not a pressure-cooker bed (2026-11-16)

This is Mark's explicit redesign, not a hardware emulation or a claim that the
real ENNER is always clean. Research completed before implementation: SOMA's
[official description](https://somasynths.com/enner/) separates five tuned voices,
ring/FM patching and binary-divider click/bass synthesis from its noise, piezo
and optional feedback delay. [FAZEmag's hands-on review](https://www.fazemag.de/soma-laboratories-enner-musik-zum-anfassen/)
distinguishes harmonic/noisy drones, rhythmic percussion, stereo filters and
deliberate feedback escalation. [Sonicstate's hands-on](https://sonicstate.com/news/2024/01/30/baf2024-soma-enner/)
describes melodic and noise applications and aggressive Bizarre-delay modulation.
The [Audioreakt owner-review introduction](https://audioreakt.com/blogs/all-you-need-is-live/this-is-so-good-for-techno-soma-enner-review)
emphasises an expressive, unconventional workflow; its embedded video was not
auditioned. The design inference is to retain identifiable pitched and rhythmic
anchors, with deep modulation and delay as deliberate choices.

### Shared source core

`mygrain-ember-clean-v1` in `ember-clock-worklet.js` generates all eleven sources
in one 2x oversampled clock. Sine is analytic; saw/pulse edges use polynomial
BLEP correction. Through-zero phase is continuous. Internal C feedback uses the
previous oversampled tick, not a 128-frame block network. No random audio source
or noise excitation is present. C source flags route to every other generator,
never self. Full-depth summed excursion is carrier-relative:
`min(900, max(2, baseHz*6)) * depth^2`, divided among selected sources. The pulse
contribution subtracts its analytical duty-cycle DC offset before FM, preventing
a narrow pulse from behaving like almost full-scale negative DC. Manual MOD
cables now use relative linear FM through a causal native input delay; ring and
AND outputs remain available.

Pulse high time is calculated from its base clock rather than instantaneous FM
velocity, avoiding threshold chatter during strong modulation. Maximum duty is
95%, also reserving two output samples low per cycle, with one oversampled-tick
high-time minimum. Requested times remain canonical seconds
and are shown as µs/ms; rates still span .01–2560 Hz. Sharp means anti-aliased
clock edges, not deliberately broadband single-sample noise.

### Pitch/modulation and recipes

Voice controls span .01–1200 Hz; old explicit >1200 Hz values fold down by
octaves in the editor/runtime. Backend archive acceptance remains .01–8000 Hz,
so old sources are accepted without rewriting. Pitch/LFO base parameters cap at
1200 Hz; FM sidebands and pulse harmonics can naturally extend above the carrier.
There is no blanket final treble-cut hiding the sources. At 100% shared-LFO depth,
frequency assignments move +/-2 octaves, pulse/width/self-rate +/-3 octaves and
Pitch +/-12 semitones. Other targets retain full-range motion and per-target/
master inverse. Base settings never serialize instantaneous motion.

All 200 factory recipes are intentionally replaced, with stable IDs and globally
unique Material + Motion names. Ten banks range from clean sub foundations to
deep reciprocal FM and coupled pulses. Only Stereo motion uses a small echo
feedback amount; Bizarre is 0 throughout. Both randomisers retain exact Volume,
Balance, power and nullable local tempo; generate low/mid sine/triangle anchors,
sparse deliberate modulation and no automatic delay feedback. BPM still sets
both modulation depths to 100%, now using the controlled relative ranges.

**Clean start** clears FM/LFO and echoes in one undoable edit while keeping Volume,
Balance, power and local BPM. It produces two dry low/mid sine voices plus clock
pulses. Reload then use Clean start or reselect a redesigned factory patch: an
existing saved custom recipe is not silently replaced. All existing C, Width,
Mod/Inverse, Solo, card/Layers volume, history and portable patch paths remain.

### Rendering and checks

Audible Ember requires capability/content revision 8, including old raw retired
noise snapshots so old noise caches cannot survive. Missing/Off/zero-level
without Volume LFO/unpatched identities remain unchanged. GET and upload checks
inspect the original source snapshot, not optional stale metadata. Accept
explicit producer v8; retain original ZIP bytes/revisions and unaffected Off
caches. Shared context preparation awaits the new worklet before editor/export/
server capture. Previous worklet processor names remain for already-loaded old
clients; no native installer rebuild is required.

Regressions: `ember-clean-engine.test.cjs`, `test_ember_clean.py`,
`ember-clean-pcm.cjs`, `ember-clean-core.cjs`, `ember-clean-browser.cjs` and
`ember-clean-song.cjs`. Keep paired normalized spectral energy and low/mid level
measurements separate from subjective listening. Physical devices require their
own listening/latency verification.


## Ember 13 — high-depth performances (2026-11-16)

Mark requested a stronger C circuit before a complete factory-bank rewrite.
The previous depth-squared, source-count-divided coupling could soften 70% depth
and dilute additional selected modulators. C now applies linear depth and
power-normalizes only the other selected sources. Oscillator deviation scales
with 18 times the receiving base, capped at1500 Hz; pulse deviation scales with
24 times its base, capped at1800 Hz (minimum4 Hz). Both retain signed through-zero
phase, one oversampled-tick causality and no self-coupling. Pulse modulation is
analytically DC-centred and energy-compensated with a bounded4x maximum. The
normalized source mixture is bounded to +/-1.5 before frequency scaling: rare
narrow-pulse peaks otherwise produce short high-frequency FM spikes. Selected
pulse-C sources in the bank use40% reference duty (at120 BPM for clock mode),
not narrow trigger widths; audible pulse receivers retain crisp variable widths. This is
not a gain boost or a new noise source. Manual MOD mapping, anti-aliased sources,
stereo output gain/saturation and native divided clocks are unchanged.

The 300 factory patches are explicit, independent recipes with unique catalogue
names: B001–B200 across ten BPM groups, H001–H100 across five Hz laboratory groups.
Every recipe has LFO and C enabled, both depths70–100%, and opposing stereo pitch
motion. BPM recipes clock-link all six pulse bases and synchronize their LFO,
without LFO self-rate modulation defeating the rhythmic base. Hz recipes have
six independent rates and a free-Hz LFO, with self-rate and width experiments.
Base oscillators remain low/mid sine/triangle carriers; high pulse rates and
sharp edges are available. No factory modulates Volume or Balance. Factory
selection retains current volume, power and nullable local Ember tempo; local
BPM or Song BPM remains the shared clock. Randomisers retain their prior control
retention/depth contracts but use the stronger C engine. Clean start and four
reference studies remain separate from the 300 performance recipes.

Selecting a new factory is the explicit recipe replacement. Saved recipe values
are never overwritten on load. Existing active C recipes use the stronger C
engine and refresh only their render capability/content revision to9. Dry/no-C
recipes retain revision8 and exact PCM; Off retains its old identity. Backend
GET/POST checks inspect original snapshots, preserve immutable source archives
and Song revisions, and accept explicit9 producer uploads. No plugin reinstall.

Verification evidence lives in the timestamped mygrain-ember-strong task output.
Native PCM/spectrum checks are technical measurements, not subjective listening
or physical iPhone/DAW verification.

Measured bank acceptance: all300 recipes at120 BPM, 44.1/48 kHz and
Chromium/WebKit, with one second of stereo base PCM and separate500 ms C-Off /
LFO-Off counterfactuals (3600 renders). Every capture fingerprints its actual
settings against the frozen final bank. At fixed Ember level.7, the minimum
per-channel RMS was.0493 and maximum peak.3252; the largest normalized energy
fraction above3 kHz was.2439 and minimum30–1500 Hz body fraction.4614. Both
modulators contribute on each stereo channel. These short counterfactuals are
not full-cycle LFO tests: a separate48-case native control capture checks all
six waves at85% depth through2.2 complete cycles in BPM/free-Hz modes, both
sample rates and engines, including destination inversion. The shared core also
passes100-second pulse-cycle, fastest-rate low-interval, source-purity, full-FM,
volume, inverse/self-rate and disposal checks. Five paired dry stereo captures
are byte-exact against Ember12; ten paired C captures change with stronger FM.
Real paired Song tests validate7 baseline +7 current old-source +6 new-source
parts, selective v9 refresh, immutable ZIP/revision checks and warm phone playback.
These are technical PCM/control checks, not subjective listening or physical
phone/DAW validation.


## EMBER.14 — your patches and automated four-band EQ

**Your Ember patches** sits below the factory bank. Enter a name and **Save as
new**; choose an entry and **Load selected**. Replace, Rename, Delete and Refresh
manage only your private account library, shared across your signed-in devices.
Replace/Delete require confirmation. Duplicate names and stale revisions never
overwrite a different patch silently. Current power, volume and local tempo are
retained on recall; balance and all other recipe settings recall exactly.

Saved circuits include five oscillator tunings, six pulses and widths, wiring,
C/depth, LFO assignments/inverses/rate/sync, colour/echo settings and E's four-band
EQ plus completed automation (including Read-off curves and explicit bypass).
Only completed automation is saved; Write and a take in progress remain transient.
The library is not part of individual project ZIPs; the *loaded sound* and E EQ
are included in normal local, preset JSON and portable Song/patch state.

**4-band EQ / EQ On / R / W / Delete automation** uses the existing popup. W arms
for the next Ember sequence start, records one current-pattern cycle and switches
to Read. Play starts Ember; its local BPM controls that EQ cycle when set, otherwise
it follows Song BPM. Each channel retains its independent automation. Explicit
EQ Off pauses Read without deleting curves; On resumes at current phase.

E EQ is pre-effects, shared by source/destination, not duplicated after the effect
chain. Bypass preserves exact dry audio and removes filters/analysers. Server Song
uses the same EQ and clock; only audible active E EQ needs capability4. Old dry/C
Song archives and revisions stay immutable and retain compatible cached audio.
No synthesis, factory recipe, oscillator, pulse, LFO or installer changes.

Verification: focused browser/backend unit suites; Chromium/WebKit visible library
CRUD, conflicts, history, W/R/Delete/bypass, ZIP/reload and responsive phone/desktop
layouts; two-channel native shape/rate and live post-EQ PCM; paired real server Song
legacy/current renders, EQ/Read/bypass levels, capability rejection, warm cache and
phone metadata/PCM-only playback. Physical iPhone/DAW testing remains separate.

## Ember 15 — all-cable strength bypass (2026-11-17)

The **All cables at 100%** switch above the cable selector overrides every cable’s
individual bridge strength, including modulation and echo wiring and cables added
while enabled. Off restores the exact stored amounts; editing a strength is
disabled during bypass. Volume, Osc/Pulse balance, Mod depth, C depth and LFO
remain independent. This does not remove per-cable headroom or output limiting.

Optional `modes.ember.cableStrengthBypass:true` is canonical patch content, saved
by account Ember patches, project/JSON/ZIP, history and native snapshots. Absent
or false retains previous normalisation, PCM and render identity. Factory/random
recipe selection uses its own settings as before, so new selections start without
this override; saved recipe recall restores it. No factory recipes are changed.

Live and isolated Song graphs share the effective cable gain, including LFO
modulation of Mod depth and balance. Audible bypass needs `emberVersion:10`;
inactive Ember retains zero and non-bypass dry/C remains 8/9. Both producer POST
and raw-source GET enforce capability 10 even with stale metadata. Hashes ignore
bypassed stored amounts without rewriting original ZIPs or Song revisions.

## Ember 16 — note and octave tuning (2026-11-17)

Each of the five main oscillator frequency knobs now has Note and Octave menus.
The twelve chromatic notes use sharps and scientific pitch notation: A4 = 440 Hz,
C4 = middle C. Choose either menu to set the corresponding exact equal-tempered
base frequency. The Hz knob remains continuously tunable; off-note frequencies
show **Free Hz**, with the nearest note in the tooltip, without snapping saved
patches or factory recipes. Changing octave from Free Hz tunes its nearest note
exactly in the chosen octave. Notes outside .01–1200 Hz are disabled: available
octaves span -11 through 6 with partial boundary octaves.

These are mirror controls only: `modes.ember.frequencies` remains the sole saved
tuning. There are no new patch fields, note locks or audio/DSP changes. Menus track
knob edits, clean start, random/factory choices, account-library recall, Undo/Redo,
JSON/ZIP restore and reload. Mod/C, global Pitch, EQ and bridge bypass are retained.
Pitch, LFO and C may shift the actual sound away from the selected base note.

Server Song and native snapshots already use those exact frequencies; render
versions, original source archives, content identities and unaffected cached PCM
remain unchanged. Test tuned saved parts through real server preparation plus
warm metadata/PCM-only phone playback, not just an editor control-state check.


## Ember 17 — random C and Mod/Inverse selection (2026-11-17)

Both card Randomise Hz and Randomise BPM now flip all eleven C switches
independently, with a random fallback only if none were selected. Oscillator 5
is no longer forced on, and the other oscillators/pulses are no longer fixed off.
Each recipe selects 2–6 distinct LFO Mod targets, including one randomly chosen
oscillator frequency; the remaining slots sample all other eligible targets.
Every selected target gets an independent random Inverse state. All 27 targets
other than Volume and Osc ↔ Pulse balance are eligible, including widths,
LFO self-rate, cross-mod depth and global controls.

Existing generation policies remain: retain power, volume, balance and nullable
local BPM; BPM mode uses both depths at 100%, linked pulse bases and BPM LFO;
Hz mode frees pulse bases/LFO. Factory recipes, saved/manual settings, EQ and
whole-app/AI generation exclusions are untouched. This is generator-only:
normalization, shared audio processing, schemas, render capabilities and saved
Song content identities are unchanged. Old source ZIPs/renders stay reusable.

Verification: focused seeded regression must fail on the pre-change generator
(fixed C flags and only five reachable LFO targets), then pass across both modes;
actual card buttons, history, visible C/Mod/Inverse synchronization, account and
portable recall, blocked edits, live graph continuity, stereo PCM and paired real
server Song/warm playback are covered by the task evidence.

## Ember 18 — shared output frequency dividers

`oscDivider` and `pulseDivider` are optional canonical Ember recipe fields. Off
(1) is omitted; accepted ratios are 2,4,6,8,10,12,14,16. Each group shares a menu
but all eleven generators have independent signed cycle counters after C/manual
FM. Active division emits a bipolar 50%-duty square subharmonic to audio cables,
AND/RING/manual MOD and internal C; waveform and width remain raw generator
settings. Base Hz/note tuning, LFO and transport are unchanged. Through-zero FM
unwinds the counter on negative cycles. Changing one group resets only its
divider counters; it does not replace the graph or reset generator phases.

Both Ember randomisers independently select both ratios including Off. Factory
patches, starters and existing recipes omit the fields and bypass bit-exactly.
Account patches, Undo/Redo, JSON and ZIP retain them. Active audible divider
recipes require render capability11; dry/C/bridge legacy recipes stay8/9/10 and
inactive Ember stays0. Explicit Off has the same content identity as omission.
Server raw-ZIP freshness checks and current render deck enforce11 without
rewriting original ZIPs or changing Song revision; warm phones reuse PCM only.

Division is an experimental timbral tool, not a noise-removal filter: divided
square outputs introduce harmonics and deep mutual FM can remain complex.

## Ember 19 — random patches start with every cable at 100%

Both card Randomise Hz and Randomise BPM now set `cableStrengthBypass:true`,
which ticks **All cables at 100%** through the existing state synchronizer.
Individual stored strengths are retained, so manually unticking restores them.
This is a generator default only: existing/saved/factory recipes, clean start,
power/volume/balance/local tempo, the seeded random stream, output dividers,
DSP and Song capabilities remain unchanged. New random recipes naturally use
capability10 (bypass alone) or11 (with an active divider). Saved parts retain
the flag and use the same shared server-rendered signal path.

## Ember 20 — C randomisation exclusion and all-C action

Two toolbar buttons follow Randomise Hz/BPM. **Exclude C: On** is the default
for the editor; it is stored locally per account, outside saved audio/history
and render identity. It preserves the exact optional C/pulse-C arrays, shared
C depth and crossModDepth LFO target/inverse. Other generated LFO settings may
still change. Both shared oscillator/pulse output dividers randomise regardless.
It does not silently disable existing C sources. Preference changes require edit
readiness and lock on account change until reload; denied storage is harmless.

**All C** toggles all eleven existing canonical C switches, retaining depth.
Partial selection is shown as a count; clicking a partial state switches all on,
then the next click switches all off. Edits are one history step, keep the graph
running and persist in ordinary account patches, JSON/ZIP and saved Song parts.
If C depth is zero, switches can be on without producing modulation.

The pure generator accepts a fourth options argument `{excludeCrossMod:true}`.
Its omitted option retains the established full-generation API for existing
callers; both UI actions explicitly use the persisted editor preference. C
restoration occurs after generation, retaining the seeded stream and divider
ratios. In excluded mode the target count can differ from the usual 2–6 because
the prior cross-depth assignment is retained, rather than newly selected.
Legacy schemas, normalization, DSP/worklet and render capabilities unchanged;
source archives/revisions immutable and old audio reusable. Factory recipes,
clean start and whole-app/AI exclusions remain unchanged.

### Ember 20 cable randomisation correction

Both Randomise buttons now generate fresh endpoint routing, rather than copying
factory layouts (the majority share the same four leads). Each action creates
6–10 unique leads, with direct oscillator and pulse routes to both stereo sides,
plus 2–6 additional routes across audio/filter and MOD inputs. If a generated
layout exactly matches the current one, remove its last optional lead so even a
repeated seed changes the wiring (minimum five leads in that case). Delay-return
sources and delay inputs are not chosen, avoiding undriven echoes/feedback loops.
The change runs after existing seeded controls: other generated controls keep
those values. C exclusion does not exclude cable routing. All cables at 100%
remains on by default. Existing manually saved/factory wiring is never migrated;
normalization, worklet, graph, render capabilities and saved PCM are unchanged.
Browser regressions check canonical endpoints, every visible SVG path endpoint,
patched socket marks and cable menu after actual Hz/BPM clicks on phone/desktop.


## Ember 21 — Space & rhythm trial

This supersedes Ember 20 generation only for the new rhythm mode. New editor
sessions, **Space start**, factory selection and both **Randomise** buttons use
an explicit optional `rhythm:{version:1,density,decay,swing,spread,seed}` recipe.
Old saved recipes are not migrated: they retain the old engine and modulation
controls. **Use space & rhythm** explicitly converts one, with Undo support;
Randomise and Space start are also explicit conversion actions. Recall keeps
current power, volume and local tempo as before. Factory constants and the
legacy pure `randomPatch` API are unchanged; new UI generation calls the
separate deterministic `randomRhythmPatch` API. Factory labels select seeded
rhythm variants, not the old cross-modulated sound.

### Audible architecture

The separate `mygrain-ember-rhythm-v1` worklet/graph has no C/FM, LFO, violet MOD
inputs, ring/AND processing or internal delay feedback. The old worklet remains
an exact prefix for legacy render compatibility. The new graph emits one
connected source at a time on a 16-sixteenth, BPM-locked pattern. Euclidean
selection distributes 0–8 hits per bar (Density zero is silent). Each sound has
a smooth attack and finite decay, capped at 68% of its swung step; this leaves
real gaps rather than continuously running every audible source. Pulses use
shorter envelopes. User/global EQ and effects remain separate: a wet delay or
reverb elsewhere can still fill gaps.

**Density** changes hit count; **Decay** requests 15–800 ms (the gap-preserving
cap still applies); **Swing** offsets alternate sixteenths up to 45%; **Stereo**
sets pan extent, with zero exactly mono. Sources alternate across the stereo
field after each pass through connected sources. **New rhythm** changes only
the saved rhythm seed: pitches, waveform, dividers and audio cables stay put.
The transport phase is shared; BPM changes integrate the phase continuously.
Oscillator Hz/note/octave and six independent pulse tuning/width controls remain.
In this mode output dividers lower frequency without forcing every waveform to
square; the legacy divider algorithm is untouched for old saved audio.

Randomise creates only 2–3 distinct-source audio cables, with at least one
oscillator and one pulse and stereo destinations. It chooses direct/warm/low
routes, no internal modulation, wide stereo, 2–5 hits/bar, short decays and
varied swing. Both group dividers still randomise; all-cables-at-100% remains
on. A repeated seed still changes a matching cable topology. Manual audio
patching and strength controls remain available, while unsupported ports and
inactive legacy controls are hidden. No new global/other-channel changes.

### Persistence and server rendering

The optional rhythm schema is bounded/validated by the canonical Ember backend
validator, including private account patches and Song source ZIPs. JSON/ZIP,
account recall, reload and Undo/Redo retain it. Active new recipes require
Ember render capability **12**; silent/disabled recipes require none. Legacy
capabilities 8/9/10/11 and their normalized content identities remain unchanged.
Raw immutable Song source is still authoritative for GET freshness and POST
producer checks. Original source ZIPs/revisions are never rewritten; warm
phone playback stays metadata/PCM-only. Deploy requires the backend service
restart as well as new keys for DSP, worklet, controls and CSS.

### Verification

`ember-rhythm.test.cjs`, `test_ember_rhythm.py`, `ember-rhythm-pcm.cjs`,
`ember-rhythm-browser.cjs` and `ember-rhythm-song.cjs` cover the new contracts.
Native Chromium and WebKit PCM checks use 44.1/48 kHz, both randomisation modes,
measured 10 ms quiet windows, stereo/mono, boundary settings and exact old PCM
comparisons. UI checks cover actual visible wiring, controls, history,
account/JSON/ZIP/reload and 320/390/1440 layouts. Actual old/new Song workers
verify server capability, EQ, full-bar PCM gaps (including at least 25% exact-zero
10 ms windows in the exported 16-bit WAV), immutable archives and warm playback.
These are measured DSP/browser checks, not physical iPhone/DAW listening.
Historical broad backend discovery has eight inherited failures from older
capability/random-generation assertions; see the dated release evidence.
Unsupported-producer assertions in bridge/divider tests move from 12 to 13
because 12 is now an intentionally supported producer capability.


## Ember 20R1 — rhythm trial rolled back, MOD cables removed

The user reported no audible output from Ember 21 and requested the pre-trial
engine with only purple MOD cables removed. This supersedes the Ember 21 trial:
restore exact Ember 20 DSP/worklet/control/CSS, including the continuous audio
engine, C cross modulators, LFO and assignment buttons, pulse/oscillator dividers,
300 factory settings, saved account patches, EQ/automation, C exclusion and All C.
The rhythm engine and all new rhythm controls are removed. No attempt is made to
retune, gate or sparsify the previous engine.

Only purple `mod1`–`mod5`/`mod5neg` INPUTS are removed. Normalization removes those
leads when loading legacy settings; manual patching and the existing 6–10-lead
random generator can only choose the remaining audio/filter/echo inputs. C flags,
C depth and every non-cable seeded random setting retain the Ember 20 behaviour.
Old saved files/account records are not rewritten; explicit saves capture the
loaded recipe without MOD leads. Audio cable colours no longer cycle through
violet. C checkboxes, Exclude C/All C and the LFO remain live and visible.

Raw old sources containing removed MOD leads, and any saved rhythm-trial source,
require producer capability13 so cached rejected audio cannot survive. Rhythm
fields remain accepted for archive validation only: runtime normalization drops
them and uses the restored continuous engine. Existing non-MOD/non-rhythm
capabilities8/9/10/11, PCM and source identities remain unchanged. Raw-source GET
and POST checks remain authoritative; source ZIPs and revisions stay immutable.
The backend retains producer12 acceptance for older declared uploads but rejects
it for changed sources requiring13. The original worklet is restored byte-exact.
