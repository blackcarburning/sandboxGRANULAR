# R · Resonators — v2026.11.06.RESONATORS-R.1

Two independently configured audio-excited objects; separate from WASP and
Filter Playground. R is an additive return, not a source mute or an envelope
controller. It starts Off in legacy patches. No generators or old patches are
rewritten to include it.

## Models and controls

- Door: hollow timber, solid wood or metal; width, height, thickness, body/cavity
  depth, frame gap and hinge/latch looseness. Modal panel plus bounded moving
  mass and contact/rebound. Gap is a contact threshold, not a generic wet amount.
- Wall/panel: plasterboard, plywood or metal; dimensions, thickness, cavity and
  fixing looseness; a modal panel with fixing-contact slap.
- Pipe: metal, plastic or wood; length, diameter, both ends open or one closed.
  Fractional delay tube, lossy reflection, bore/material-dependent filtering;
  one closed end inverts the reflection and halves the ideal fundamental.
- Broken cone: paper, plastic or metal; radius, depth, suspension looseness,
  tear and coil rub. Modal cone plus asymmetric edge breakup and motion-driven
  rubbing. Roughness is deterministic, excitation-dependent, never free noise.

These are musical physical approximations, not finite-element simulations or
measured reproductions of a particular door/speaker. No assets/downloads required.

Shared: actual audio-source dropdown, Full/Bass/Mid/Treble excitation band,
0–36 dB drive, damping, level and constant-power pan. Each slot has its own
On switch. Master R Off retires its processor and removes all excitation links;
two disabled/zero-level slots do the same. Silence tails / Stop / Panic clear
stored mechanical energy. UI and settings remain editable while Off.

## Routing and lifecycle

`resonator-host.js` wraps EQ routing **before** `loop-card-fx-host.js` captures
it, so loop sources are tapped from their shared loop-FX bridge; individual drum
voices are tracked until ended. The explicit N→WASP route has its own N tap.
Drivers are mono sums of the copied stereo audio, returned with per-object pan.
No original routing or level is replaced. Source taps are independent of WASP's
processor graph, and connections are changed incrementally (no poll/animation).

`index.html` binds R after Turntable/compressor `recordOutput`, before the WASP
final-master/independent FP stage and `finalAmplifierNode`. Full mix reads the
**pre-R** recordOutput and returns to a separate sum, never to its own input.
This prevents self-feedback, including full-mix sources and both object slots.
All playback, recording and final-mix exports hear the same R return. WASP and
FP can be Off without bypassing R. R Off leaves their graphs unchanged.

One two-input AudioWorklet runs only while at least one object is audible.
Disabled slots do no per-sample work. Panel/cone models use eight bounded mono
modes per slot; tube storage is capped by 8 m length at the context sample rate.
Coefficients/drive/level/delay slew; object changes clear the old model.
Context release, account lock, pagehide and isolated-deck disposal remove graphs.
Errors disable only R and retain dry source audio.

## Saved data and Song renders

Canonical `modes.resonatorR` in state/Song snapshots, `preset.resonatorR` for
JSON presets. Version 1, two complete slots, legacy default Off. R controls are
excluded from generic slider/select/control inventories; canonical settings are
restored together. UI edits use draft history with captured input values and a
coalescing edit queue; rapid input cannot replay stale values after history prep.

Song adapter/deck preload the same DSP and await readiness before capture; R
storage counts toward the render estimate. The backend validates settings/ranges,
strips bypassed R from content hashes, ignores disabled/zero-level slots and adds
`resonatorEngineRevision: 1` only for active R. Existing source ZIPs/hashes and
Song revisions are never migrated. Old, unaffected renders remain reusable.
Normal final-mix WAV capture also awaits R readiness and clears previous tails.

## Verification

- `node --test tests/resonator.test.cjs`: real PCM, every object, changing
  dimensions/material/gap/damage, pipe pitch, decay/silence, hot edits/bounds.
- `PYTHONPATH=tests python3 -m unittest test_resonator -v`: real legacy ZIP
  validation, inactive cache compatibility, active hashes and strict ranges.
- `node tests/resonator-browser.cjs`: isolated-account Chromium/WebKit desktop
  and phone-mode controls, final-output PCM, source isolation/full mix/two slots,
  WASP independence, hard bypass, preset/ZIP/reload, Undo/Redo, layout/search.
- `node tests/resonator-song-browser.cjs`: isolated real server jobs for all four
  objects plus a legacy source; warm cache reuse, phone-protected PCM playback,
  source/revision preservation, cleanup and real final-mix WAV export.

Browser tests require a **disposable local** MYGRAIN server/account; do not point
these state-writing fixtures at production. They reject non-local URLs.
Physical iPhone CPU/speaker output is not measured by browser emulation.

## Olafs Resonator monitor solo

The card follows Filter Playground, including before and after lazy loading.
Solo mutes only the parallel dry feed, not the excitation taps or full-mix
input. The summed object return stays audible. Switching R off, disabling all
active objects, processor failure or context release restores dry audio.
Solo is a temporary live monitor control, not part of the patch schema; isolated
Song decks never enable it, so server render hashes and legacy exports remain
unchanged. Live output recordings hear the monitored mix.

Solo regression: `node tests/resonator-solo-browser.cjs` verifies mobile touch,
card order across lazy loading, source and full-mix solo PCM, dry recovery,
canonical preset compatibility and Chromium/WebKit runtime errors.

## Drawable excitation bands

Each object now has a 20 Hz–20 kHz logarithmic graph. Draw up to sixteen
frequency gain points (0 to -36 dB attenuation); the copper control line shows
the drawn band and blue shows the realised filter response. Changes commit
on pointer release as one draft-history edit; interrupted gestures discard the
draft. Keyboard left/right selects a point; up/down edits its gain (Shift: 6 dB).
The graph uses the existing display manager's canDraw/repaint lifecycle, with
no animation loop. Band presets and Reset band retain the original filters.

Optional slot.excitationCurve is canonical in saved state, JSON, patch ZIPs and
Song parts. Missing curves retain the exact original band processing. Custom
curves use a base gain and fifteen bounded high-shelf transitions; constant
curves are exact gain changes. Estimated render memory includes the new states.
Server validation bounds sixteen finite gains; only active custom curves use
resonatorEngineRevision 2. Legacy active/inactive content signatures are retained.

Graph Solo hears the selected object's mono excitation after its band filter and
before excitation drive, body, level or pan. Source Solo hears that same source
before the filter. These per-object monitors and the original resonator-output
Solo are mutually exclusive and transient. Neither mutes the excitation input;
full-mix monitoring remains before the return sum and cannot self-feed. Disabling
the monitored slot, zero level, R Off, processor failure and context disposal
clear monitoring and restore the dry mix. All audition modes are disabled in
isolated Song decks, so monitoring while saving never changes the exported part.
Live output recording still captures the monitored mix.

Verification: tests/resonator-graph-browser.cjs covers Chromium/WebKit, native
Chromium touch drawing, mouse/keyboard, pointer cancellation, Undo/Redo, JSON /
ZIP / reload, parked-canvas repaint, responsive layouts and final-output PCM
for filtered/unfiltered/other/full-mix sources. tests/resonator-song-browser.cjs
now renders drawn curves plus legacy active/absent R with live audition enabled
at snapshot time, warm reuse and unchanged source hashes/revisions.

## Door contact revision 3

The original door collision was a one-sample impulse sent directly to both the
modal bank and the output. This creates broadband clicks even when excitation
is bass-limited. Door collisions now pass through two contact-duration low-pass
states (cutoff depends on material and damping), then excite the panel and a
quiet, short three-mode hinge/latch ring with inharmonic ratios 1:1.73:2.61.
The metallic character is a damped midrange ring, not added broadband treble.
Contact geometry, rebound, gap and impact counts are unchanged. Other objects,
excitation filters and source/graph monitoring retain their existing PCM.

No saved schema change. Active doors alone use render revision 3; non-door
custom curves remain revision 2 and non-door legacy settings revision 1.
Existing source ZIPs/hashes and revisions are never rewritten; affected frozen
door renders regenerate through the normal preparation/cache boundary.

## Linked mixer return volume

The optional canonical outputLevel is a 0–1 aggregate gain on both objects'
summed wet return, with an 8 ms smoothing time. Unity is omitted from saved
settings so legacy patches and render hashes stay unchanged. A zero return
reuses the no-R render signature; non-unity active returns include the gain in
the render key. Object Levels, excitation and dry mix are not changed.

The mixer performanceResonatorLevel and card resonatorOutputLevel share this
canonical field and one draft-edit/history queue. The mixer proxy is excluded
from generic slider inventories and Song controls to avoid double persistence.
The new resonatorMasterVolume is a bidirectional link to existing Master Vol
(volume), not a second gain stage; normal input/change and the main control-sync
path update it after programmatic changes and recalls.

The mixer VU uses the existing visible-only, opt-in mygrainMeters subscriptions.
Worklet output 1 supplies the post-volume resonator-only return before temporary
Source/Graph auditions replace output 0. It never reaches the audible mix.
Turning meters off releases analyser taps; context release removes meter nodes.
The standard mixer Jump targets the resonator card, whose linked output controls
are immediately below its toolbar. Existing per-object and excitation settings
and all saved legacy fields are retained.

## Wet pre-delay (2026-11-07)

The global R delay is after summed physical-body returns, before outputLevel and
the wet meter and transient source/graph audition replacement. The dry branch
is untouched. Optional `resonatorR.delay` stores `{mode: 'ms'|'sync', ms: 0..2000,
division: 64|32|16|8|4|2}`; absent means exact legacy bypass. Synced milliseconds
are `min(2000, 240000 / BPM / division)` (whole-note fractions). Current tempo is
runtime-only, supplied at worklet construction and through applyGlobalBpm's
syncTempo hook, including isolated Song decks.

A bounded stereo float ring allocates only for positive delay, crossfades read
taps over 10 ms on edits/tempo changes, and releases after returning to zero.
Silence tails clears bodies and delay buffers. Off/context retirement disposes
the processor. Source/Graph Solo remains immediate; wet Solo and VU hear the
delayed return. Existing export durations are retained (no automatic tail padding).
Song validates delay and uses revision 4 only for active positive/synced delay;
absent/zero delay retains the old signature and source ZIPs are not rewritten.

Tests: resonator.test.cjs exact shifted stereo PCM at 44.1/48 kHz,
resonator-delay-browser.cjs native ms/sync controls, timing at final output,
undo/redo, JSON/ZIP/local storage; resonator-song-browser.cjs real isolated current
and legacy jobs, warm cache reuse, phone playback, unchanged sources, WAV.

## Display order (2026-11-09)

The final cards are Pan Lab → Turntable → Filter Playground → Wasp → Olafs
Resonator. R is the last card, immediately below Wasp. `resonator-ui.js` places
the existing card after Wasp when available; `demand-ui.js` preserves this at
placeholder creation, and `wasp-ui.js` repeats it when hydrating the controls.
Move the existing node, never clone it, so R controls/history remain attached.
This is display order only: the audio graph and saved patch/Song schema do not
change. Desktop Windows VST3 downloads include both Bridge and FX together in
the Bridge panel; the separate DAW Input panel retains its FX download.

Desktop visual-order fix: the `.synth-container` is a flex column. DOM ordering
is not sufficient: Turntable has CSS order 98, Wasp/Filter Playground 99, so R
must have order 100 in `resonator.css`. Verify computed order and rendered
`getBoundingClientRect()` positions, not only DOM adjacency/last-child. Test
cold placeholders and hydrated controls on desktop and phone.


## 2026-11-10: reload / Sparse / Mega policy

Saved controls and power survive reload. Sparse keeps Wasp, Mutilator, Filter
Playground, Turntable and Olaf’s Resonator off. Mega randomises their settings
and independently chooses each effect in or out; Mutilator may only run when
Loop D is active, loaded and audible. Bypassed Mutilator settings are randomised
too without changing the manual per-card random button’s readiness requirement.
The confirmation and completion dialogue describe this policy and history
captures the final effect choices. See `effect-reload-mega.md`.
