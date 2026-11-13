# F — The Wasp

Two editable stereo loop-to-loop modulation rows, with **at most one source row enabled**. All loop lanes, including N, are
selectable through the shared Wasp key inventory (28 total).
K and drums can be selected individually or as groups; All loops is supported for
sources and destinations. There are two modulation rows, not two available loops.

## Routing and methods

The host intercepts the existing loop connection boundary: after the shared loop
FX and before channel EQ / the existing destination bus. Signals keep their
original downstream routing. A second, stereo Wasp insert now sits between the
final bus compressor and final amplifier, after the combined music, Direct Out
drums, SC kick path and FX returns. It has no parallel dry cable. Melt controls
a saturation sting with unity small-signal gain on that complete mix. Thus even
parts without a selected modulation destination pass through the final sting;
the two rows select which individual lanes are cross-modulated. Source taps are
pre-Wasp, so mutual routes do not create audio feedback cycles. The N envelope
observer wraps the Wasp connector and therefore retains its original source tap.
Multiple groups sharing a loop key remain separate destination buses. The
worklet has 32 stereo bus slots, allowing the full loop inventory and extra
routing buses; allocation beyond that fails visibly instead of summing unrelated
buses or duplicating carriers.

Rows process destinations serially in displayed order:

- Amplitude: envelope gating or audio-rate AM.
- Ring: bipolar waveform / bipolar envelope multiplication.
- Duck: envelope-driven gain reduction, even with Audio-rate selected.
- Frequency: variable-delay vibrato/frequency modulation, not oscillator FM.
- Phase: variable-delay comb modulation.
- Low-pass, high-pass, band-pass, notch: driven, resonant state-variable filters.

Depth is signed and Melt scales it globally. Level scales the row's processed
contribution: 0 dB is unity, negative levels reduce its contribution. Filter base
and resonance apply to filter methods; attack/release apply to the envelope;
sensitivity applies to the driver. Each delayed route has independent stereo
memory so frequency/phase routing preserves the result of earlier rows.

Blend applies to the per-lane matrix and the full-mix sting. At 100% each
selected row is fully wet and the entire mix passes the final sting without a
parallel dry path. Output gain applies exactly once, at the final insert. A DC blocker operates on
processed carriers; a continuous soft ceiling above approximately -1 dBFS bounds
extreme per-carrier results. The app's downstream output protection remains in
place. This does not normalise source samples or guarantee identical musical
loudness between presets. Catastrophe and All→All rows are intentionally much
more expensive while enabled than a few targeted routes.

## Hard bypass contract

Page reload restores Wasp and Filter Playground power and all canonical settings.
Turning on either source row switches the other off; the alternate row’s settings
remain editable and saved. Presets, randomisation and legacy recall also enforce
the one-source limit. Explicit preset/patch/Song recall restores saved power.
Missing Wasp state in legacy imports restores six disabled rows and OFF power.
Presets configure routes without changing the current power switch.

When off, normal sources use the original EQ/direct connector. There is no Wasp
worklet, gain/output node, delay storage, analyser, animation loop, polling timer
or source tap attached to Wasp. Loading the UI/schema is one-time JS parsing,
not ongoing audio processing. On is lazy: fetch the worklet module, allocate one matrix processor plus one final stereo
processor per active context and connect the existing sources. Off ramps Blend
to dry and, after a single 25 ms teardown timer, disconnects and disposes the
processors and their output nodes. The module may remain browser-cached; a cached
module is not a running processor. Context closure, processor failure and render
deck disposal release the graph. Diagnostics: `mygrainWasp.diagnostics()`: `worklets` retains the original
matrix-context count; `masterInserts` counts final stereo inserts and `processors`
is the actual total (two per active audio context, zero when bypassed).

## Persistence and renders

- Presets: `wasp`; workspace and Song snapshots: `modes.wasp`.
- Version 1, exactly six bounded routes; server validates supplied state.
- Enabled Wasp render hashes include engine revision 3; bypassed legacy hashes
  remain unchanged. Existing saved source archives and user audio are untouched.
- Wasp inputs are excluded from generic slider/select/extra-control capture;
  one normalized state object is authoritative.
- UI edits use existing card Undo/Redo and state saving.
- Editable patch decode preloads worklet support when required; recall waits
  before reporting completion. Song render decks preload before recall and
  await graph activation before computing capture timing.
- Live WAV export captures the existing final output, including Wasp. Isolated
  Song rendering uses the same Wasp processor, with explicit disposal on exit.
- Bypassed Wasp settings are excluded from backend render-content hashing, as
  with bypassed EQ. The saved source archive still preserves all route edits.

## Verification

`node --test tests/wasp.test.cjs` covers default/schema, all presets/groups,
all nine methods in both driver modes at 44.1/48 kHz, exact zero-blend/depth and
unselected-carrier output, memory disposal, and a worst-case six-route matrix.
`python3 -m unittest discover -s tests -p test_wasp.py -v` validates server input.
`tests/wasp-browser.cjs` runs against an isolated test server in Chromium/WebKit:
no worklet request on startup, UI presets/power, Undo/Redo, state/preset/editable
ZIP recall, real worklet PCM, isolated Song renders, all-lane connections,
repeated on/off teardown, reload-off with retained rows, and responsive layouts.
Tests block account/repository writes and use in-browser synthetic audio.

The existing loop-FX browser suite should also pass. One current EQ unit test
expects 26 channels but the pre-Wasp app has 27; this is a baseline failure.

## Active-patch randomisation (revision 2)

“Randomise active patch” freezes six strong routes into the saved settings. It
never enables power. It chooses only loaded/playable, enabled, non-zero-level
parts permitted by current Solo. During playback stopped lanes are also excluded,
using transport flags rather than instantaneous drum voices. Zero-level and empty/muted lanes are excluded;
drum patterns, including the independent-length Roll, stay eligible during rests.
The hat's synthesised fallback counts as a playable source. While transport is
stopped it uses the playable patch configuration, so preconfiguring is possible.
With one eligible lane, self-modulation is allowed. With up to six, each eligible
destination occurs at least once; above six the chosen destinations are a random
subset, with the final sting still covering the entire mix. An empty patch gives
a visible message without changing settings. Randomisation sets Melt/Blend to
100%, output to -3 dB and strong depths/sensitivities; Undo/Redo uses card history.

Browser regression includes the real drum hit scheduler in normal, Direct Out
and kick-bypass routing. Disconnecting the final Wasp output must silence every
one of those paths. Off must report zero master inserts and matrix processors.

## Gain correction (revision 3)

The final sting previously divided its driven output by sqrt(drive), giving
quiet material up to +15 dB of automatic makeup at full Melt. It now divides by
drive (unity small-signal gain), with the drive range reduced from 1–32 to 1–8.
Melt smoothly introduces the saturation; zero Melt is uncoloured below the
protection threshold. This does not remove the six cross-modulation routes.
Explicit Wasp Output remains the only makeup-gain control for the final insert.
A transparent-below--1-dBFS soft ceiling now follows dry/wet blending, covering
hot dry contribution as well as wet audio. Exactly zero Blend and power-off retain
the original transparent bypass. The processor is identical at desktop/iPhone
sample rates; device volume/output processing can still differ.

## Final Sting filter (revision 4)

The optional master filter defaults off. In the wet branch its order is Melt saturation → resonant filter → low-cut/high-cut → Wasp Output → global Dry/Wasp mix → existing soft safety ceiling. It includes low-pass/high-pass/band-pass/notch, 12/24/48 dB section slopes (band-pass and notch shapes differ from a conventional LP roll-off), Q 0.5–4, low/high trims, bipolar envelope movement and free-running sine/triangle/saw/square LFO sweeps. Each stereo channel has independent TPT filter state but shared sweep/envelope modulation; renders use exactly the same DSP at their own sample rate. No tempo-sync or random DSP.

At 100% Wasp the full mix including Direct Out drums passes through the filter; below 100% the global dry branch remains unfiltered. Filter bypass ramps for 15 ms, releases its state, and skips filter calculations. Wasp power off still disposes both worklets and restores native direct wiring: no Wasp/filter processing or recurring UI meter work. Enabling a texture preset while Wasp is off only arms the filter. Legacy patches acquire a disabled filter, preserving their sound. Disabled-filter render hashes remain engine revision 3; active filters use revision 4.

## Private Wasp patch library

`/mygrain/api/wasp-patches` uses the normal account authentication, same-origin mutation checks and pinned account identity. Library JSON lives beneath `users_root/<stable-account-id>/wasp-patches/library.json`, including for admin (never the legacy shared admin repository). Writes are account-locked, atomic, fsynced and revision-checked. No account ID or path from a client is trusted. Up to 256 patches with 80-character names.

Save new/Replace stores all Wasp controls, six routes and the filter, but no loop audio and no auto-on power. Recall keeps the current master power state; explicit full MYGRAIN patch/Song imports still retain their existing Wasp power semantics. Rename/Delete require a selected private patch; destructive buttons confirm. Other-device conflicts require Refresh before retrying, never silent last-writer wins. Controls are escaped via DOM textContent. Account-lock events clear the visible library; the existing account-aware fetch guard prevents stale responses crossing logins.

## 2026-10-26: two lanes and demand-loaded phone filter

The current editor and DSP have **two** modulation lanes. The v1 archive retains
six wire slots solely for compatibility with existing server and saved patches;
slots 3–6 are reset to dormant defaults during normalization and have no DSP
arrays/program entries. Legacy archives remain readable.

The full final filter is in `wasp-master-desktop.js` and its GUI in
`wasp-filter-desktop.js`. iPhone/iPad load separate `*-phone.js` files and a
static phone worklet entrypoint; desktop final-filter DSP/UI are not requested.
The phone filter has bypass, low/high-pass selection and cutoff only. Manual
filter edits enable the filter; Wasp's master power remains authoritative.

`demand-ui.js` loads RadioLab, Video Lab and the Wasp GUI on approach/jump after
Start. Loop FX panels mount on approach; their shared audio host/state remain
available for transport, patch recall and isolated render decks. Core script
preloads overlap requests without changing execution order. Caddy compresses
`/mygrain/*` while preserving no-store and account protections.

## Power recovery and placement (WASP-RESTART.1)

The deferred placeholder and loaded Wasp card sit after Pan Lab, as the last
application card. Wasp's navigation option is last too. Each enable checks the
existing audio graph and resumes suspended/interrupted contexts from the user
action (or rebuilds a missing/closed graph), rather than assuming an existing
AudioContext is running. Failed edits stay visible in the Wasp status until
the next edit. Power off still retires all Wasp processors and delay memory;
patch schemas, audio sources and stored settings are unchanged.

### Visual ordering correction (WASP-LAST.2)

The app shell is a flex column whose other children have positive CSS order.
Wasp needs explicit order 99 as well as DOM placement after Pan Lab; otherwise
its default order 0 displays it first. This applies to the lazy placeholder
and hydrated card. Regression checks must compare rendered bounding boxes
against visible shell siblings, not just document order.

## iPhone filter poles (WASP-POLES.1)

Phone Final Sting offers low/high-pass with 12/24/36/48/60/72/84/96 dB/oct
(2–16 poles), implemented as 1–8 cascaded two-pole sections per channel.
No LFO, sweep, envelope or resonance controls are added; phone normalization
keeps modulation zero and fixed bounded resonance. Old missing slopes retain
the 12 dB phone default. Server validation and desktop/render DSP accept the
new slopes so saved phone patches remain loadable. Desktop controls unchanged.

## WASP-RESTART.2 (2026-10-26)
Mark reports iPhone re-enable fails with both modulation channels enabled, while
disabling the second channel lets it start. Native phone CPU/memory exhaustion
remains unconfirmed. Hardened worklet retirement and rapid bypass reactivation:
- Every off-to-on transition disposes the old graph before creating fresh nodes;
  a retiring or stopped processor is never reused.
- Disposal messages receive render-thread acknowledgement before the host closes
  ports (bounded fallback); both matrix and final insert release DSP state.
- Retired processor-error handlers are detached and stale errors cannot disable
  the new graph. Route-key/settings updates are coalesced once per microtask.
- No DSP algorithms, channel count, slopes, settings schema, or audio/history
  guard policies changed. Both modulation channels remain available.
Regression: tests/wasp-cold-restart-browser.cjs uses actual two-channel AM output,
injects a stopped retiring worklet and a delayed processor error, checks nonzero
wet PCM and dry bypass, fresh node identity, and acknowledged retirement.
The pre-change host failed the fresh-node assertion. WebKit/Chromium phone
viewports are browser simulation, not physical iPhone verification.
Backup: output/mygrain-wasp-restart2-20261026/.


## Filter Playground — PLAYGROUND.1 (2026-11-04)

Filter Playground is an independent instrument card with its own power, header,
Jump/search entry and layer/mixer shortcuts. Signal order:
Wasp Melt → optional Wasp LFO filter → Wasp Output → Dry/Wasp mix and ceiling
→ independent Playground → final output. WASP Off bypasses the Wasp stages only;
Playground still processes the complete mix, including the dry side of Dry/Wasp.
Playground Off preserves the previous Wasp path exactly.

The Playground supports low/high/band-pass, notch, positive/negative comb,
all-pass, resonant peak and low/high shelf; 12–96 dB/octave (2–16 poles) selects
one to eight two-pole sections. Roll-off wording applies to LP/HP; other modes
cascade their respective shapes. A separate resonator supplies an independent
resonant-frequency control; Q is inverse damping, bounded 0.2–24.

Cutoff, resonant frequency and Q each have independent source/amount controls.
Every Wasp track, D, individual K/drum tracks and useful groups can drive a
rectified attack/release follower. The source is tapped pre-Wasp and used only
for detection, never added to the mix. D retains its original direct audio route;
only its detection tap is added. Bipolar envelope amounts span ±10 octaves
for frequency and ±8 octaves for Q, with bounds and smoothing. Shared sensitivity,
attack/release and drawn-curve rate are saved explicitly.

Each control also accepts its own 64-point drawn periodic curve. Pointer drawing,
keyboard point editing and Sine/Ramp/Steps/Flat tools modify canonical settings;
no visual animation timer runs. Curve interpolation and clocking run in the same
DSP for live and server/offline output. Phone uses this same full Playground,
not its reduced legacy-filter implementation.

Off removes all native modulation-source connections immediately and disposes
all Playground filter, comb, follower and curve processing state. No Playground
instance or sample processing is retained in the already-existing master insert.
Wasp Off releases its cross-modulation graph but retains an active Playground.
With Playground alone there is one final insert and no 32-bus Wasp allocation.
Both Off restores hard bypass with no processing nodes. Parameter edits while
Off do not enable the Playground. Wasp presets and Wasp-only randomisation retain
Playground settings and power. Ordinary/Mega/Sparse whole-patch randomisation
sets Playground Off while retaining editable settings.
Explicit saved patch/Song recall preserves the requested saved power settings.

Settings are additive `modes.wasp.playground` / `preset.wasp.playground`, including
private Wasp libraries. Missing legacy state defaults Off. Bypassed Playground
settings are removed from audio-content hashing, preserving old caches; active
Playground uses audio-content engine revision 7 (including when Wasp is Off).
Wasp-only and fully bypassed legacy cache signatures are unchanged. Inactive
Wasp settings do not invalidate Playground-only renders. Sources/archives are never rewritten.
Tests: `tests/wasp-playground.test.cjs`, `tests/test_wasp_playground.py`,
`tests/wasp-playground-browser.cjs` and `tests/wasp-playground-song-browser.cjs`.

### Draw-curve discovery — DRAW.2 (2026-11-04)

An always-visible Draw Your Own Modulation panel offers direct Cutoff, Resonance
and Q editor buttons. Each source selector also has a dedicated Draw/Edit Curve
button. These select the existing `drawn` source, preserve its canonical points,
then reveal, scroll to and focus the authoritative editor. They never enable
Playground or WASP. Dropdowns and buttons stay synchronized; the existing
history, preset/Song formats, bypass behavior and audio engine are unchanged.
Phone actions and shape buttons have 44–48 px minimum touch heights.
Verification: `tests/wasp-draw-discovery-browser.cjs`.

## Independent drawn-curve clocks and musical grid (2026-11-04)

Cutoff, Resonance and Q retain independent 64-point curves and now each save
`clock` (`hz`, independent `bpm`, or main-tempo `sync`), `hz`, `bpm`, `beats`,
`multiplier`, `timing`, `snap` and `snapTiming`. Loop/grid lengths cover 1/32,
1/16, 1/8, 1/4, 1/2, one bar and two bars (4/4). Straight/triplet/dotted
factors are 1, 2/3 and 3/2. Multipliers run ÷8 through ×8. Hz remains free
running and legacy shared `rate` initializes missing per-lane Hz unchanged.
Changing tempo updates worklet increments without resetting phases. No new
animation/scheduler timer is used. Grid snapping constrains pointer and keyboard
horizontal edit locations; triplets map to nearest points in the retained
64-point format. It does not quantize amplitude or change existing curves.

`routeKick` defaults false (legacy normal routing). Selecting Through main
filter input overrides the SC kick bypass for subsequently scheduled kicks
while Wasp and Playground are enabled. It leaves Direct Out independent.
The old SC bypass and Direct Out already rejoin upstream of the final Playground
insert: this is an explicit main-input routing override, not a claim that legacy
kicks were omitted from the final insert. Wasp/Playground Off preserves the old
kick path. The routing option does not power either stage on.

Server validation accepts optional new fields; active audible clock/routing
extensions use Wasp revision 6, unchanged legacy active curves revision 5,
Playground Off retains old cache behavior. Test suites:
`wasp-curve-timing.test.cjs`, `wasp-curve-timing-browser.cjs`,
`wasp-curve-timing-song-browser.cjs`, `test_wasp_playground.py`.
Chromium and WebKit phone-view controls pass; a real kick-only server Song
render with independent sync/BPM/Hz lanes measures RMS 0.00282 versus dry
0.00942, with warm-cache reuse, unchanged source checksums/revision,
phone PCM playback and released rendering reservations. Physical phone untested.

### Snap-window repair (2026-11-04, CURVE-GRID.2)

One canvas width is one complete audible loop. `curveWindow` is the shared
source for seconds, beats and snap-to-phase conversion; independent BPM uses
its own tempo, sync/Hz grids use the main tempo. Loop length, multiplier and
triplet/dotted factors are reflected in the time axis and window description.
Playback rate is never changed merely to fit a drawing grid.

A snap interval longer than the loop previously rounded every edit to index
zero. Both canvas boundaries now remain valid edit positions, with a shortened
last cell when necessary; a grid at least as long as the loop is explicitly
labelled as boundary-only. UI coordinates and waveform drawing consistently
map 0–63 to the full visible width. Snap-drag retains the preceding distinct
anchor, ignores repeated writes away from its snapped location and rebuilds
the complete interpolated segment when the destination value changes. This
prevents wide-cell pointer motion from flattening or breaking the waveform.
No curve-array migration, audio-clock change, new timer or DSP revision is
needed: PlaygroundEngine is byte-for-byte unchanged. Existing source snapshots,
curves and rendered-audio compatibility are retained.

Regression: the prior module maps every input position to zero at a 1/32
loop ×8 with a 2-bar grid; the repair retains both boundaries. Unit tests cover
every grid/loop/multiplier and straight/triplet/dotted combination.
`tests/wasp-curve-grid-browser.cjs` exercises real full-width pointer strokes
on Cutoff, Resonance and Q at all seven grids and all three timing styles
in Chromium and WebKit phone viewports. Physical touch-device testing remains
separate from browser simulation.


## Independent Filter Playground verification

The settings remain in `modes.wasp.playground` and `preset.wasp.playground` for
backward compatibility; the UI is a sibling `#filterPlaygroundCard`, not nested
inside `#waspCard`. Explicit patch/Song recall restores each saved power state;
a fresh page keeps both effects Off until enabled. No curve/schema migration is
needed. Generic slider/preset collectors exclude both cards so canonical settings
remain authoritative. The lazy placeholder exposes Playground navigation before
opening WASP; opening either editor initializes the shared controls once.

The master processor applies Playground after the completed Wasp wet/dry mix.
Host preparation/attachment accepts either active power state; detection taps do
not depend on Wasp power. Toggling Wasp creates/retires only its cross-modulation
node and leaves the Playground master/curve phase alive. `dispose()` releases both.
Safety limiting follows an active Playground; fully bypassed hot legacy PCM is
not altered.

Tests: `playground-independent-browser.cjs` covers desktop/phone-mode Chromium
and WebKit, final-output PCM for independent/combined/zero-blend/bypass states,
source taps across Wasp toggles, standalone lazy navigation and search, block
editing, undo/redo, saved Song recall and phone layouts. Physical iPhone CPU has
not been measured. `playground-independent-song-browser.cjs` checks three real
server-rendered parts, old snapshots without Playground settings, warm-cache reuse,
phone-style PCM playback, unchanged source hashes/revision and released memory.
`test_wasp_playground.py` checks active/bypassed render signatures and validation;
existing Wasp/Playground DSP/timing tests retain finite-output and legacy checks.

## Phone matrix cold-start warmup (2026-11-10)

The phone-only matrix processor now starts with modulation routes temporarily
bypassed for its first 2048 audio frames (about 43 ms at 48 kHz), then applies
the latest selected routes automatically. This separates bus startup from
route-delay allocation and reproduces the successful manual bypass/enable
sequence without changing the saved route checkboxes. An edit during startup
wins; disposing during warmup cannot reactivate the processor.

There is no Wasp CPU/memory admission threshold to lower. Song preparation
budgets, desktop processing, the master/Playground processor and steady-state
DSP remain unchanged. Browser checks exercise a cold lazy editor and repeated
Layers power changes during uninterrupted playback, with source 1 selected,
actual final-output PCM, two-source settings and ZIP recall. Physical iPhone
resource behaviour remains unverified.


## 2026-11-10: reload and batch effect policy

Wasp and Filter Playground retain saved power, routes, curves, Rate Sculptor and
all controls on reload, before and after Start. Sparse leaves both off. Mega
randomises both independently, with one independent 50% in/out choice for each.
Wasp uses a playable concrete source when available (X is the deferred-load
fallback), never more than one enabled row. UI row switching is mutually
exclusive and history-backed. The v1 six-record archive stays readable; disabled
row settings remain intact. Active legacy two-source Song freezes get a selective
source-limit compatibility marker, while one-source and bypassed audio identities
stay unchanged. No source ZIP is rewritten. See `effect-reload-mega.md`.
