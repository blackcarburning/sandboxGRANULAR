# MYGRAIN maintenance requirements

## Randomisation isolation and four-level history (Mark, 2026-11-23)

Only accepted Mega/Sparse generation may apply cross-card effect shutdown,
Cooking Pot Off, EQ resets or unrelated source muting. All local random sample,
pattern, sound/patch, source loading and ordinary patch randomisation preserve
other cards, effect powers/recipes/routing, Master Baker, EQ and Pot group memory.
Local N sound randomisation retains its own source/filter power. Explicit manual
Off/Clear/record-to-K and requested AI recipe changes remain deliberate actions.
Stir/BIG STIR retain already-powered effects and Master Baker; newly selected
effects may join them. This supersedes older all-randomisation shutdown rules below.
The shared account/device Undo/Redo journal now retains four levels, not two;
keep lazy lossless PCM, atomic reference cleanup, tab ownership and legacy journals.


## Snapshot and local-randomisation preservation (Mark, 2026-11-24)

Only accepted Mega/Sparse randomisation automatically clears sequencer snapshot
lists. Local sound/sample/pattern/patch actions, individual drum lanes and ordinary
whole-patch randomisation preserve all lists, including their sound references.
Explicit Delete/Clear Patch, replacement patch recall and account lock retain
their intentional lifecycle behavior. Keep this inside shared Undo/Redo.
Local sound/pattern actions must not reset mixer levels, sends, powers, effects or
other unrelated settings. This supersedes the older local drum volume defaults.
Restructure local Generate patch and legacy local sample-random aliases retain
power/output level and skip whole-generation loudness balancing; that balancing
policy remains for whole-patch/new-loop generation only.

## Drum generation volumes (Mark, 2026-11-13; local scope corrected 2026-11-24)

Whole-patch generation sets individual lane volumes to 80%, except
Crash/Cymbals at exactly 40% (not a ceiling). Include Kick, Snare/shared Snare
Roll, Hat, Perc, Clap and ETC; apply consistently to normal/Mega/Sparse generation,
never local drum sound/sample/pattern randomisation. Preserve the separate drum-bus policy,
manual edits, saved patch recall and existing Song audio. This is a generation
default, not a saved-state migration or render-time override.

## Standard sample chooser (Mark, 2026-11-13)

Use the shared compact rainbow sample grid for future sample-chooser work.
One shuffled full-folder array per visit, 200/page, five columns on phone and
ten on desktop; numbered play cells, sparse sticky filename/heart/load/page/close
controls and easy ± audition steps. Tap auditions; double tap or Load commits
without closing. Keep live playback and transport phase running. Resolve each
lane/instrument's assigned folders and retain canonical PCM/provenance, hearts,
Undo/Redo and saved Song compatibility. See docs/sample-grid-browser.md and
sample-grid-browser.js. Initial rollout: every drum lane, including shared Snare
Roll. Extended to D, L, X, Dropbox, Grain A/B and Keys; A/B/C/W/V/P/O use
multi-source mode: double tap toggles a source in the top list (Add stays add-only), green marks picked
cells, manual divisions + Recut populate canonical card audio, and Play loop
previews it in the open browser. See docs/sample-grid-browser.md. Main/Mic and Q
retain their existing browsers until explicitly requested.

## Server Song processing (Mark's explicit requirement, 2026-10-27)

Whenever audio/DSP, sequencing, effects, samples, or saved-part compatibility
changes, update the server Song preparation/rendering path wherever applicable
in the same task. Do not leave recent features or fixes only in the live editor.

- Trace `song-beta.js`, `song-beta-clock.js`, the isolated render deck, and
  `scripts/server-arm-worker.cjs` / `backend/mygrain_songs.py` as applicable.
- Preload asynchronous DSP before capture; render using the current app engine.
- Version audible render compatibility when an old freeze must be regenerated.
  Do not invalidate unchanged legacy audio unnecessarily or rewrite source ZIPs.
- Keep phone work to metadata and rendered PCM where possible; preserve bounded
  preparation/playback memory, original sources, account isolation and revisions.
- Verify an older source snapshot and current features through real server jobs
  in an isolated test store, then warm-cache reuse and phone playback. A passing
  live-editor test alone is insufficient for an audio change.

## Generated sample-cut resolution (Mark, 2026-11-03)

All randomisations and AI generators must create sample cuts only at `2` or `1`
resolution (two bars or one bar), never fractional/finer values. This includes
per-card cuts, ordinary/Mega/Sparse generation, D gaps and InstaReel variations.
Do not introduce fine-resolution fallbacks when a source/pattern is too short;
leave it intact. Apply the rule both client-side and at the backend generation
boundary. Preserve existing saved/manual cuts without migrating their audio.
Exception (Mark, 2026-11-13): the sample browser's explicit manual Recut has the
full standard divisions (4 bars through 1/32 and Uncut). Only that browser adapter
sets options.manualCuts and sends manualCuts:true to the backend. Ordinary,
per-card random, Mega/Sparse and AI generation still normalize to 2/1. This is not
a default change or a saved-audio/render migration.

## L/X envelope and volume defaults (Mark, corrected 2026-11-03)

Only Sparse and Mega force L/X Length to 100%, Decay to 80%, and X Volume to
80%. Keep L volume independent. Ordinary and per-card randomisation must not
apply these fixed defaults. AI generation, genre generation, refinement and
regeneration must apply their recipe values without these overrides (and retain
omitted controls). Preserve manual controls and legacy saved settings on recall.

## Effect randomisation and Stir policy (Mark, updated 2026-11-14)

Bubble Chamber is eligible for ordinary/effect/Mega recipe randomisation again,
including its per-card Randomise control. Both Stir actions choose a random count
from five to all eligible reorderable effects (up to eleven), including Bubble.
Normal Stir retains recipes. BIG STIR uses the complete semantic control inventory
in cooking-pot-model.js, including seven insert balances, all eleven overall
volumes and all six Heavy tabs. Its saved cookingPot.stirAmount (default 1)
selects round(eligible controls × amount) distinct controls; it does not scale
movement distance. 0% preserves all recipes, sources, balances and volumes;
power/order still follow the separate 5–11 policy. LFO objects, global/master
controls and Through Main/main mute stay protected. Curves/sample choices and
valid coupled model selectors are semantic controls. Keep this preference out
of render content identity. See docs/big-stir-controls.md.
Keep zero-drive/Mix Mutilator and invalid BIG STIR Wasp routes ineligible.
Retain LFO state and Master Baker power during recipe randomisation.
Mega/Sparse still finish with all Cooking Pot processors Off and main unmuted;
Mega remembers its generated selection for explicit group On. Sparse keeps
recipes intact. Never enforce generation policies on manual/saved recall or
server rendering. AI's separate supported-effect contract remains unchanged.

## Global additive Solo (Mark, 2026-11-11)

Treat card/source, A/B grain, drum-lane and effect Solo selections as one additive
mask. Selecting or removing one target must not clear another. Any active Solo
silences unselected sources and all unselected independent effect returns in both
native and Cooking pot routing. Bypass unselected insert dry attenuation without
rewriting canonical power, routing or recipe controls; retain excitation for an
effect-only Solo. Power/loading another card must not clear existing selections.

Keep manual effect/audition selections transient; retain the existing saved source
and drum-lane Solo schema. A source Solo automatically includes active effects
whose configured inputs match it (including Whole mix, grouped drums/K and Wasp
source/destination routes). Recompute from canonical settings on route, power,
randomise and recall changes; retain manual effect selections and other source
owners when a source Solo is removed. Never serialize the derived effect set.
Saved source/lane Solo states with matching effects require effect-output render
revision 5; unmatched masks retain revision 2, and unaffected patches retain their
prior render identity. Inspect original manifest metadata before trusting stale
v2-v4 markers, and enforce current requirements on both render GET and POST.
Check stale render admission as well as fresh renders, source hashes and warm reuse.
The Q chord editor's explicitly chord-local Solo Note remains a local preview.

D mini-mixer lane Solo is also explicitly **card-local** (Mark, 2026-11-15):
it auditions selected D samples only and must never join/clear the global mask
or mute another card. Multiple local buttons combine; none restores all D lanes.
Keep D master/lane On and levels authoritative. It is transient monitor state,
not a patch/history/ZIP/IDB/Song setting, and is ignored by offline/borrowed/server
render decks. Recall/account change clears it. Preserve shared transport phase,
source PCM and legacy render identity. Do not confuse these four buttons with
D's existing main/global Solo. See docs/loop-d.md and d-local-solo regressions.

## Master Baker final-stage policy (Mark, 2026-11-12; randomisation updated 2026-11-13)

The Master Baker is a final post-main/post-independent-return mastering stage,
not a reorderable insert or independent return. Its tenth Cooking Pot row stays
pinned last even with the Pot Off. Main mute must not bypass mastering of
independent returns. Only Mega/Sparse randomisation leaves it Off while preserving its recipe.
Ordinary/local randomisation, sample loading and both Stir actions retain its power. Keep the power change inside
the accepted Undo/Redo transaction; cancelled/rejected edits change nothing. Never
apply this generation rule on saved patch recall or server rendering. Keep the
WAV browser route, private patch library and explicit confirmed original-WAV
replacement. Console mirror controls are excluded from generic saved-control
inventories; modes.masterBaker is canonical. See docs/mastering.md for routing,
latency, tape, compatibility and isolated checks.

## Cooking Pot remembered group power (Mark, 2026-11-13)

The visible Cooking Pot On/Off switch is group effect power, NOT serial/native
routing. Off remembers all twelve powers (including Master Baker), then sets their
canonical switches Off; On restores exactly that selection. Keep rack/card/Layers
buttons physically synchronized, recipes/order/input/output routes unchanged and
live transport running. As requested on 2026-11-14, routing is always source-owned
serial inserts; legacy modes.cookingPot.enabled is retained only as metadata.
Optional power metadata stores group memory
and must not affect render identity or auto-enable saved effects. Preserve the
memory through Undo/Redo, portable/local/project saves and Song amendments.
Stir/new patch generation clears stale memory and retains Master Baker
randomisation exclusion. Native Pot action 6 follows the same group power rule.
See docs/cooking-pot.md and tests/cooking-pot-power-browser.cjs.

## App card placement (Mark, 2026-11-12)

Keep Top (the performance toolbar) first. Add new app cards/sections at the
bottom, never above Top or prepended among existing cards unless Mark asks.
Standalone effect cards belong together after the existing app sections;
Cooking Pot introduces the group and Master Baker is last. Retain all target IDs.

Desktop Jump ordering is separate (Mark, 2026-11-12): fixed Jump/Find header,
one scrolling list. Clear Patch, then wide Top / AI Patch / Cooking Pot / The Parts Bin / Master
Baker / Song; paired Layers+Mix, Mega+Sparse, Export Mix+WAV Browser, Loop Store
Add+Browser (renderers left, browsers right; orange render, darker orange browser),
Keys+Actions, Drums+GENREator; loops/other areas; effects last.
Reuse original nodes/listeners and restore mobile shortcut homes on resize.
Do not use parked card DOM geometry to sort loops. In-app HTML dialogs own
WAV/Loop Store naming and editable-ZIP choice; Cancel/Escape/account change
means no render/upload. See docs/export-dialogs-navigation.md.

`navigation-palette.js` owns display-only ordering of existing effect nodes
and observes initial insertion/lazy replacement. `demand-ui.js` creates Wasp
and Filter Playground placeholders; `wasp-ui.js` replaces their cards on real
navigation while reusing their Jump button nodes (IDs sectionJumpWaspBtn and
sectionJumpPlaygroundBtn), and `acoustic-fx-ui.js` restores acoustic adjacency after loading.
Check DOM AND computed flex order before/after that lifecycle. During the
lazy handover, duplicate placeholder/final jump targets coexist briefly;
wait for cleanup before sorting (otherwise moving the first match can
alternate forever). Mutilator is
standalone: query its rhythm control under `#loopDMutilator`, not Loop D; its
CSS is rooted there. Do not change the saved Cooking Pot audio order to match
visual card order. Per-source inline FX remain attached to their sources.

## The Parts Bin (Mark, 2026-11-12)

Jade library for browser staging and plugin sessions (FX, CEF and Bridge).
Browsers may upload/drop complete patch ZIPs or Add current patch; staging is
RAM-only for that tab until explicit “Make available universally”. Those snapshots
are account-private server copies available to every plugin instance for the
same account, not cross-account public sharing. Preserve local DAW copies on
server rename/delete. Uploaded ZIPs retain exact bytes, validate through the
ordinary source adapter, and render previews in an isolated current-engine deck
without recalling/replacing the live editor. Stage a whole upload batch before
committing it; failures/account/context switches retain existing parts.
The parent audio-idle policy must honor the transient Parts Bin `rendering` hold
only during preview decode/render; release it in finally, including cancellation.
Keep the bin out of ordinary source patch/JSON/ZIP
and Song capture; nested bins must never be captured into parts. Each part has
an immutable editable source ZIP plus rendered preview WAV, held in this plugin’s
DAW snapshot. Load uses canonical source recall, keeps the bin and stops playback;
Rendered Bridge switches to Live. Keep one preview widget. Show completed native
store versus unsaved changes honestly, and always explain normal DAW Save for
disk persistence. See docs/parts-bin.md.


## Sample-cut de-click and shared Jump (Mark, 2026-11-13)

Use the shared 3 ms sample join/edge helpers for derived cuts, repeats and wraps;
never destructively fade stored originals or shorten loop timing by overlap.
Keep muted gaps exactly zero, bound fades to available audio, and fit sample-voice
end guards to actual pitch/slide-adjusted EOF. Preserve existing grain/K envelopes.
Affected sample renders require sampleCutVersion 1 (including legacy metadata),
with selective content invalidation and server GET/POST admission checks. Arm
refreshes stale PCM only; original ZIPs, Song revisions and warm reuse stay intact.
Desktop and iPhone Jump share one ordered panel and original action nodes; fixed
Jump/search sit above its scroll area. Do not restore old mobile hidden AI/Pot
rules or move Pot/Baker menu nodes into the history edge. See
`docs/export-dialogs-navigation.md` for the ordering, audio and test contract.


## Reversible browser in-track Preview (Mark, 2026-11-13)

All 22 shared browser entry points have a transient Preview checkbox, OFF each
open. Audition is an audio-read overlay, NOT a canonical buffer/metadata/control
swap. Original PCM, cuts, pending versus committed divisions, Undo/Redo journals,
ZIP/IDB sources and native project captures stay unchanged during Preview.
Switching Preview off, closing, account changes, source recall and history travel
remove the overlay. Newer selections cancel stale fetch/decode/recut completions.
Multisample double-click toggles the source pool; Recut prepares a candidate only.
Pending divisions and sources are not written into the card. Add is the sole
replacement transaction, through an awaited app-owned confirmation: “Are you
sure? This will replace the current loop”. Cancel/Escape/closure never commit.
Single-source double-click auditions, never silently replaces. One confirmed Add
is one history edit; native/plugin Live output hears the same projected audio.
Prepared Rendered playback remains an immutable snapshot (use Live for editing).
Do not add browser-only controls to saved patch schemas or invalidate Song renders
for this UI/audio-read projection. See docs/sample-grid-browser.md and
`tests/source-grid-track-preview.cjs` for regression coverage.


## Drum Machine lane layout (Mark, 2026-11-13)

Keep every lane in normal document flow: title/source name, loading actions and
sample/tone controls, a dedicated full-width 4-band EQ row, normalization,
Accent/Copy Sec, then the step grid (with its existing hints/copy prompt).
The title must have its own full-width row on desktop as well as phone. Never
mount EQ inside the loading action grid: its auto-sized parent can collapse the
title to zero width. Reuse the original controls, IDs and handlers; Roll shares
Snare audio/normalization and retains its own EQ, roll controls, Accent and Copy.
See `docs/drum-machine-layout.md` and `tests/drum-lane-layout-browser.cjs`.


## Henry’s Hose additive effect (Mark, 2026-11-13)

Henry’s Hose is a red final app card, after Master Baker in display order;
Master Baker remains the final AUDIO stage. Hose has mono/independent stereo
receivers, canonical `modes.henrysHose` and acoustic render capability 3.
It shares AcousticFx source/solo/output routing and Cooking Pot/Stir behaviour.
Hose originally introduced the tenth reorderable effect; Heavy Lifter now brings
the total to eleven, all randomisation-eligible, with twelve remembered powers
including Baker.
Accept old nine-stage/ten-power snapshots. Missing/off/zero/external-only Hose
must preserve legacy audio and content identity, including EQ and Pot cases.
Do not shift existing Pot worklet ports 1–13; Hose wet input is 14/output 10.
The existing native companion has nine fixed legacy panel rows/bit positions;
filter Hose from that protocol and preserve its position on native reorders.
Native group power still includes Hose. See `docs/henrys-hose.md` for the
physical-model limits, primary references and live/server compatibility tests.


### Henry’s Hose Doppler revision (Mark, 2026-11-13)

Doppler pitch sweep is the defining effect. New Hose defaults/presets are version 2,
with a 0–4× Doppler depth control (normalized .25 = physical 1×), stronger rotation
and independent retarded mic paths. Version-1 snapshots retain byte-identical PCM
and hashes. A manual depth edit upgrades the existing geometry; choosing a new
preset uses new defaults. Only audible non-DAW v2 Hose requires acoustic capability
4; v1 remains 3. Keep JS/Python canonicalization, render GET/POST admission,
worklet cache keys and version-aware propagation-buffer memory accounting aligned.
See docs/henrys-hose.md for the limits and measured pitch verification.

## Heavy Lifter additive effect (Mark, 2026-11-14)

Grey crane card at the end, after Henry's Hose; Baker remains final audio stage.
Six named modes and 100 presets each use the immutable 716-recording industrial
corpus v1 as model/modulation/kernel material, never an autonomous loop layer.
Canonical `modes.heavyLifter` has per-mode recipes/seeds/cuts; load/verify/prepare
active samples before worklet creation and server Song capture. Audible non-DAW
Heavy requires acoustic capability 6 in Mechanical Motion/Spectral Imprint and
5 in the other four modes; missing/off/zero/DAW cases preserve legacy
hashes/PCM including Pot and Through Main. Eleven reorderable Pot effects,
twelve remembered powers with Baker. Keep old ports unchanged: Heavy wet input
15/output11. Keep native fixed nine-row protocol unchanged by filtering both
Hose and Heavy and retaining their positions on legacy reorders. Both Stirs
include Heavy; Bubble randomisation eligibility/Baker generation-Off rules apply.
Do not replace corpus v1 or its deterministic selection algorithm in place.
See docs/heavy-lifter.md for primary research, adaptations, limits and tests.

Heavy Lifter Motion/Imprint are pure independent wet returns: do not reintroduce
internal dry blends or a delayed unity STFT path. Imprint uses Worker-prepared
minimum-phase-derived FIRs; zero depth is wet silence. Keep research links at
the top of every mode tab. Main compressor lookahead is unrelated and unchanged.


Heavy Lifter's optional single card LFO is control-only, clocked by the existing
transport history (including processorOptions clocks), with unrestricted assignments
to the 38 supported numeric targets. The shared controls and global Clear modulators
button are available on all six tabs; clearing removes assignments across all modes. Preserve all unmodulated PCM/recipes, source
cuts, routing and latency. Keep kernel trajectory preparation in the Worker,
never per-cycle host messages or realtime kernel design. Only audible effective
full-range LFO configurations require acoustic capability 8; disabled/inactive LFOs retain
previous versions/hashes. The zero-base-level return can become audible when
level is an active target; keep audibility, selective Pot routing, Song admission
and memory accounting consistent. Depth 100% spans the full normalized range
(base + depth × waveform, clamped 0–1); scalar and prepared kernel paths must agree.
Do not restore an expanding assignment list under Clear modulators; use per-control
Mod toggles and the compact count. See docs/heavy-lifter.md for schema and limits.

## Card LFOs / Liquidizer (Mark, 2026-11-14)

Five additional LFOs follow their preset selectors; Heavy retains its panel under
Samples used. Manual targets are unlimited. Liquidizer is an LFO-only Cooking
Pot action: 1–3 targets per card, active Heavy tab/common controls only, hidden
Heavy assignments retained. Never alter power, base recipes, routes, Master
Baker or order. Big Stir preserves all LFO objects. See docs/effect-card-lfo.md
for 40 target ranges, native graph compatibility, capability 9 and verification.

## Source-owned effect inserts (Mark, 2026-11-14)

A selected source leaves its original dry path completely and cascades through
powered effects in Cooking Pot order. Each stage blends its incoming signal
(previous stage output) with its processed result; Dry is left, 100% Wet is right.
Off releases DSP/LFO processors and bypasses unchanged, without level loss.
Share processors only for identical complete source paths; never unmix a summed
nonlinear return. Preserve source EQ/local FX before the tap. The final stage's
existing Through main output switch owns terminal main-volume policy. Unaffected
sources retain the original path; Master Baker remains final post-sum mastering.
Keep native canonical Mutilator/BassFace/Wasp/Playground mixes and sparse seven
new cookingPot.mixes values. Active saved effects require cookingpot=4, including
powered zero-return stages and legacy Pot-disabled patches. Preserve original
ZIPs, hashes and Song revisions during selective stale-render refresh.
See docs/cooking-pot.md and tests/insert-routing*.

## Mega/Sparse Cooking Pot generation power (Mark, 2026-11-14)

Both Mega and Sparse must finish with Cooking Pot and all twelve canonical
effect powers Off, including Master Baker, so the new patch plays normally.
Mega still generates recipes and independent choices, then uses real group
setPower(false) to remember that selection; do not use legacy enabled alone.
Await graph readiness before saving/history completion. Sparse retains its
existing all-Off choice. Preserve Stir/BIG STIR/Liquidizer, per-card actions,
ordinary randomisation, manual controls and saved patch/server recall. This is
a generation-only boundary, not a render-time or saved-state migration.

## Randomizer main output / Liquidizer depth (Mark, 2026-11-14)

Ordinary/Mega/Sparse patch randomization must unmute effectOutput.mainMuted via
the semantic output setter inside history. Mega/Sparse still finish with real
Cooking Pot power Off. Retain Through Main flags and output levels. Liquidizer
generates depth 80–100% on all six card LFOs; keep 1–3 targets, active Heavy tab
policy, other recipes/powers and manual/saved depth ranges unchanged. These
are generation defaults only, never import or server-render overrides.

## Effect overall volume (Mark, 2026-11-14)

Eleven Dry/Wet effect cards have a green-boxed Effect overall volume immediately
below Dry/Wet. Canonical effectOutput.volumes is sparse 0–1 (missing/unity = 1).
Apply at the terminal chain output only, never to processor inputs or intermediate
stages. The final powered effect's volume owns each source chain; previous faders
do not alter drive into later nonlinear effects. Keep source, dry/wet, recipe,
LFO and master faders independent. Only effective nonunity terminal volumes need
effect-output render capability 6; Off, external-only, nonterminal and unity
settings retain legacy identities. Save/Undo/JSON/ZIP/reload and server admission
must share this policy. See docs/effect-overall-volume.md.


## Source Solo is an end-to-end isolation contract (Mark, 2026-11-15)

Soloing a source must isolate that source AND its existing processing, whether
Cooking Pot group power is On or Off. Never implement source Solo solely by
allowing an effect output: the same effect may be fed by other non-soloed layers.
Apply the canonical source mask before insert inputs are summed, including
Whole mix, all independent/main-following returns, split serial paths, K tracks,
drum lanes and residual granular/raw sources. A source-derived effect selection
permits only that source's contribution; it is not an independent effect Solo.

Preserve additive layer Solo and explicitly selected manual effect Solos. Manual
effect Solo may intentionally add its contributors to live monitoring; it must
never enter saved Song/offline rendering. Keep source recipes, powers, routing,
levels, LFOs, sample identity and transport state unchanged by Solo. Fully dry
powered stages remain transparent; a full-wet zero-level stage stays silent.

Shared nonlinear/delay/reverb state must not reintroduce excluded contributors
after a Solo change. Share processors only for identical complete effect paths
AND the same permitted semantic source membership. Voice arrivals within that
membership must not allocate new processors. Clearing Solo restores the mix.

Source-Solo snapshots with powered matching inserts require effectOutputVersion
7 in client metadata checks, backend GET/POST admission and server rendering;
no-Solo, Off, unrelated and DAW-only cases retain their prior identities. Do not
rewrite original ZIPs, Song revisions or unaffected freezes to enforce this.

Before changing Solo, input taps, shared branch grouping, effect-output routing
or saved-Song compatibility, run the source-Solo regressions as well as the
existing global Solo suite. Required coverage: actual PCM with at least two
distinct sources, shared Whole mix and split/nonlinear chains, repeated live
A/B/A+B toggles, explicit manual effect ownership, canonical layer controls,
zero-return ownership, server stale-v6 rejection/selective refresh and warm
phone playback. Tests: tests/source-solo-isolation-browser.cjs,
tests/source-solo-live.cjs, tests/source-solo-song.cjs and
tests/test_source_solo_isolation.py. See docs/cooking-pot.md.


## Low Power is live-only (Mark, 2026-11-15)

Keep the remembered account/device preference independent of patches and renders.
Use `mygrainPower.isLive(context)` / `divisor(context)`, never `active` alone, for
DSP quality. Offline contexts, borrowed-context render decks and server Songs
ALWAYS use full-quality processing. Retain legacy PCM/cache identities; no render
version bump for live-only quality changes. Never serialize reduced-quality knobs.

Half-rate worklets retain physical/clock seconds and filter before decimating.
Prepare Heavy Lifter kernels for the effective rate outside the audio callback;
full-rate assets stay separate. Preserve Solo source ownership, canonical settings,
transport intent, branch sharing and acknowledgement-based retirement while
switching quality. Run native audio, render parity, Solo and saved-Song regressions.

Phone Jump: lightning Low Power control directly under Top; green ON reminder,
amber OFF reminder. Drums and GENREator above Keys and Actions on phone; preserve
desktop ordering. See docs/low-power.md and its regression commands.

## Dfeeder generation and review (Mark, 2026-11-15)

Keep Dfeeder as the final app card and Jump entry. Generate server-side in a
fresh isolated context using only Drums plus A/B/C/D/W/Dropbox and permitted
effects; never call an unrestricted patch randomizer. Keep Master Baker Off,
2/1 generated cuts, drum lane defaults, full-quality renders regardless of
Low Power, four-bar exact cuts and the existing stereo-linked peak normaliser.
Never mutate the user's working patch, source buffers, transport or preferences.
Publish complete verified PCM24 into SAMPLES_DFEEDER; retain completed files
on job failure. Approve moves original bytes to SAMPLES_LOOPSTORE; Reject
removes the active candidate with private recovery. Keep contributor/admin
management, authenticated range playback, account-lock cleanup and atomic
cross-account review. Do not invalidate existing Song/audio identities for this
new destination. See docs/dfeeder.md and tests/test_dfeeder.py /
tests/dfeeder-browser.cjs; exercise actual server generation as well as UI tests.


## On Demand generator profiles (Mark, 2026-11-20)

The shared Dfeeder backend/worker also serves the separate ten-loop shop. Keep
its default `native` profile above unchanged. Explicit shop profiles are `loop`
(native layered loops + Ember at 65%, no Enemy Drone, cymbals at zero), `ember`
(Ember only, 65%), and `drone` (native random Enemy Drone only). Require numeric
BPM68–178 or explicit Random in the shop. Optional Drone key is Random or one
pitch class across **all eight voices**, random octaves, fine/transpose zero;
never reinterpret it as a scale/chord. Use native engine generation and transport,
exact canonical recording/normalisation, actual source-audio audibility checks,
and preserve existing candidates, account-private basket and simulated checkout.
See docs/dfeeder.md; no synthesis/Song migration is involved.

## D four-lane contract (Mark, 2026-11-15)

D has four independent original sample buffers, standard browsers/reversible
Preview/randomisation, pitch-preserving speed, level/pan and four-band automated
EQ per lane. D master level, On/Off and source Solo remain whole-card. EQ keys
D2/D3/D4 alias semantic source D only AFTER their independent EQ; sum into the
ONE shared D filter/LFO/reverb/delay chain before source-owned inserts. Never
apply the primary D EQ to the summed lanes or create per-lane local effects.
New lanes default empty/Off, primary neutral mixer is exact legacy bypass.
Append history audio slots; retain JSON/ZIP/IDB/native source provenance and
old content hashes. Audible additions need loopDVersion 3, aligned client /
server GET/POST, and all enabled fits are prepared before full-quality capture.
VU is optional post-EQ view-only work, zero analysers/tasks when inactive or
not visible. Keep the end-to-end Solo and Low Power contracts above intact.
See docs/loop-d.md and tests/d-four-lanes* / test_d_four_lanes.py.

## Uniform D lane controls (Mark, 2026-11-15)

All four sample lanes must have the same control groups in the same order:
load actions, source library, fit, speed, maximiser, duration-preserving pitch,
reverse/step shift, Loop Cut/Randomise Gaps/shared Start, four-band EQ, status.
Keep markup, spacing and responsive layout identical. Lane 1 retains legacy IDs;
lanes 2–4 own optional canonical settings inside modes.loopD.lanes, not duplicate
generic saved controls. Every transform/cut changes only its lane, refits from
its unchanged original PCM and survives history/ZIP/reload/server Song renders.
Neutral additions stay omitted to preserve legacy hashes. Audible nonneutral
extra-lane transforms require selective loopDVersion 4 in client and server
GET/POST; unchanged legacy/four-lane versions remain reusable. Local lane Solo
stays transient and card-local; filter/LFO/reverb/delay remain shared whole D.
See tests/d-lane-controls* and test_d_lane_controls.py.


## E · Ember (Mark, 2026-11-15)

Cream circular patch instrument, canonical `modes.ember`, source E / Solo
`bastarde`, immediately after C (main card, Layers and Jump). Five oscillator frequency knobs,
binary pulses/AND/ring/noise, stereo filters and delay. Drag/tap bridges;
double-tap wire deletes; nullable local tempo follows/snaps to current song BPM.
Off by default and excluded from ordinary/Mega/Sparse generation; keep recipes
and saved manual power on recall. Native Web Audio graph is shared with server
Song render decks. Off/missing Ember preserves legacy render identities; active
audio needs `emberVersion:1` for legacy divided clocks and `emberVersion:2`
when any optional pulseFrequencies lane is free Hz or any main voice is below
the legacy 20 Hz floor, on client/server GET/POST. No plugin installer edits.
See docs/ember.md and tests/ember-browser.cjs / ember-song.cjs.

Ember’s manual factory bank contains 200 stereo glitch/crackle textures plus the
four explicitly revised Hearth studies. EMBER.3 adds six .01–2560 Hz pulse
controls with per-lane clock relinking, and extends all five voice knobs down
to .01 Hz (.01–8000 Hz). Preserve exact absent/all-null v1 PCM and
hashes; never migrate saved recipes. All 204 factory/study titles are distinct,
with material + event names across the 200 textures. Keep the bank editor-only: save actual controls,
not preset identity or selector state. Applying a factory patch retains canonical
power and the nullable local-tempo override. Layer-row Solo is a mirror of the
existing additive `bastarde` target, never a separate mask. See docs/ember.md.


EMBER.4 adds an Ember-only undoable Random patch action; preserve canonical
power and nullable tempo. EMBER.6 supersedes LFO retention during card-only
patch generation; keep whole-app random exclusion. Keep all 204 existing factory/study recipes exact. One optional shared
native audio-clock LFO exposes all 21 frequency/pulse/global destinations with
per-target and master inversion. Optional balance 0=oscillator/ring,
1=pulse/AND,.5=legacy unity; do not attenuate modulation cables/noise/echo returns.
Off/zero-depth/no-target LFO and neutral balance preserve legacy PCM/hashes;
only audible active extension needs emberVersion 3. Zero-base Volume + active
Volume LFO can be audible. Preserve original ZIPs/revisions and stale GET/POST
checks; release LFO sources/curves on updates/Off/disposal. See docs/ember.md
and tests/ember-lfo*.cjs / test_ember_lfo.py.


EMBER.5 adds optional `lfo.sync:{enabled,divide,multiply}`. BPM mode follows
Ember's saved local/song base BPM (not pulse multiplier or modulated tempo),
with independent ratios 1/2/3/4/6/8/12/16/24/32/48/64. Preserve saved free-Hz rate
and phase across live BPM/ratio changes; no JS clock. Active audible BPM LFO
requires selective emberVersion 4, free Hz retains 3. Strip disabled sync only
from content identity; keep original ZIP/settings exact. Mode/ratio edits must
survive history, portable recall and reload. See EMBER.6 below for card randomisation, docs/ember.md
and tests/ember-lfo-sync* / test_ember_lfo_sync.py.


EMBER.6: Ember card Randomise Hz/BPM both generate full recipes including active
LFO assignments, wave, rate, depth and inverses. Hz frees six pulse lanes and LFO;
BPM links pulses and LFO to Ember/song BPM. Preserve Ember power/local tempo,
not prior modulation, within one undoable live update. Whole-app generation still
powers E Off and retains its recipe; AI and Liquidizer policies are unchanged.
One LFO ×/÷ menu replaces the pair of selectors. Keep all prior multiply/divide
pairs exact on recall, displaying nonstandard pairs as a temporary Saved choice.
No schema/DSP/version/backend changes or factory edits. See docs/ember.md and
tests/ember-random* / test_ember_random.py.


EMBER.9 (2026-11-16): five optional `crossMod` boolean flags route each selected
oscillator's native audio-rate FM to the other four, never itself. Optional
`crossModDepth` defaults .5; max summed 2000 Hz shared across selected sources.
One native render-quantum delay plus gain per selected source makes reciprocal
FM causal. No active FM means no added nodes; keep exact legacy branches and
selective v5 capability/hash/admission on live/offline/server paths. C/depth and
22nd LFO destination (with Mod/Inverse) persist through native history/ZIP/recall.
Randomise BPM sets BOTH LFO depth and cross-mod depth to 1. Both card randomisers
and every manual factory/starter selection retain exact current volume, power,
and nullable local tempo. Exclude Volume from new random LFO assignments; retain
manual Volume Mod/Inverse and whole-app exclusion. Saved project
restore/Undo must still restore saved volume; never force current volume in the
normalizer. Do not modify existing factory recipe definitions to implement this
editor-only level-retention policy. See docs/ember.md and tests/ember-cross-mod*.


EMBER.10 (2026-11-16): Jump contains only the Ember navigation button, not a
volume row. Keep the card slider, rotary level and Layers control on the same
canonical `modes.ember.level`. Gain staging retains .26 per-cable headroom but
uses a unity stereo sum (formerly .24), upstream of the unchanged DC filter
and output saturator. Do not add post-saturator makeup gain or change saved
levels/factory recipes. Every audible Ember state now requires capability and
content engine revision 6, superseding 1–5 for dry, pulse, LFO and FM states.
Missing/Off/unpatched/zero-level without active Volume LFO retains legacy hash
and cache. Server GET/POST must enforce 6 against original snapshots even if
stored metadata is old; do not rewrite original ZIPs or Song revisions. Normalize
all-null pulse overrides away in content identity independent of engine revision.
See docs/ember.md and tests/ember-gain-{pcm,song}.cjs; the Song regression uses
paired old/current servers on one isolated store, never production accounts.


EMBER.11 (2026-11-16): no Ember NOISE/TOUCH generator, pad or Strike action.
Accept legacy source endpoints for immutable ZIP compatibility but remove them
from runtime/factory wiring. Card randomisers retain exact balance as well as
volume/power/tempo, and exclude Balance/Volume from new LFO targets. Six sample-
clock pulses have optional `pulseWidths` (seconds, .00001–1, absent .005) with
µs/ms display, one-sample minimum and one low sample per cycle. Optional six
`pulseCrossMod` flags and five oscillator C switches feed all other generators,
never self, with the existing causal shared 2000 Hz budget. Width0–5 and lfoRate
are optional shared-LFO destinations; self-rate Mod/Inverse works in Hz/BPM.
Await MygrainEmber.prepare(context) before graph/capture; explicitly serve the
clock worklet. Changed audible pulse/AND/retired-noise/Pulse-C/self-rate states
require selective capability/content revision 7, including raw noise-only old
snapshots so stale noise cannot remain cached. Unaffected oscillator-only audio
keeps v6 and exact PCM; inactive identity/source ZIPs/revisions stay unchanged.
See docs/ember.md and ember-pulse-* / test_ember_pulse_engine.py regressions.

Pulse FM uses signed through-zero phase increments (matching native oscillator FM), not a zero-frequency clamp; negative excursions reverse phase instead of latching mutually modulating pulses silent. Width is evaluated against absolute instantaneous rate.


EMBER.12 (Mark, 2026-11-16): explicit timbre redesign supersedes earlier
requirements to keep factory tunings/recipes, full-range pitch-LFO travel and
the fixed 2000 Hz/block-delay FM model. Mark rejects pressure-cooker noise and
high tonal registers: clean low/mid oscillators, extreme mutual FM, sharp clean
pulses (high pulse rates allowed), no noise source. See docs/ember.md.
- Shared 2x audio-clock core for five oscillators + six pulse generators;
  anti-aliased saw/pulse edges, internal C coupling with one oversampled-tick
  causality and no self-route. Carrier-relative summed FM budget at full depth
  min(900 Hz, max(2 Hz, 6*baseHz)); depth squared. Pulse modulation is analytically
  DC-centered. Manual MOD wiring uses carrier-relative linear FM rather than
  exponential detune and retains a causal native-block input delay.
- Normalise old >1200 Hz base tunings down by octaves, preserving immutable ZIPs
  and strict backend acceptance of old .01–8000 values. UI base maximum 1200 Hz,
  pitched parameters cap at 1200; pulse rates retain .01–2560 and all saved ratios.
  Frequency LFO spans +/-2 octaves; pulse/width/self-rate +/-3, pitch +/-12 st;
  no whole-log-range pitch sweeps. All 29 targets/inverses remain.
- All 200 factories intentionally redesigned with stable IDs and distinct names;
  low/mid anchors, clean pulse rhythms, varied FM depth and dry paths. Feedback
  only in the dedicated stereo-motion bank; Bizarre 0. Both randomisers favour
  low/mid sine/triangle sources and sparse C/LFO, feedback/Bizarre 0, retain exact
  volume/balance/power/local tempo. BPM depths remain 100% with new relative ranges.
- Clean start is one undoable reset to dry sine/clock sources, preserving power,
  volume/balance/local tempo. No automatic overwrite of users' saved recipes.
- All audible Ember now requires capability/content revision 8; inactive identity
  stays exact. Enforce original-snapshot GET/POST and explicit v8 producer upload;
  no source ZIP/revision rewriting, no native-installer changes.
- Verify native source purity, C/width/LFO/inverses, slow/fast pulse timing, actual
  normalized spectra/body level (not only peaks), all bank recipes at both sample
  rates, history/ZIP/reload/phone layouts, paired old/current real Song jobs and
  warm reuse. Tests: ember-clean-* and test_ember_clean.py.


EMBER.13 (Mark, 2026-11-16): supersedes EMBER.12 factory modulation policy and
C sensitivity; all original 200 bank recipes are intentionally replaced, plus
100 experimental Hz recipes. Keep all 200 established factory IDs, new globally
unique B001–B200 / H001–H100 names, fifteen twenty-recipe groups. All 300 have
LFO enabled and C selected with both depths .70–1.00, no Volume/Balance/depth
LFO assignments. The first 200 have BPM LFO sync and all pulse bases clock-linked;
100 Hz experiments have sync disabled and all six pulse overrides explicit.
Factory selection still retains power, volume and nullable local Ember BPM.
- C uses linear depth, oscillator carrier-relative 18*base (max1500 Hz), pulse
  24*base (max1800 Hz), min4 Hz; normalize contributing source power by sqrt(N)
  excluding self, not old depth-squared/N. Bound the normalized mixture to +/-1.5
  before applying the carrier budget so rare narrow-pulse peaks cannot launch
  low carriers into high-frequency FM spikes. Pulse C is DC-centred then compensated
  by min(4,1/sqrt(4*duty*(1-duty))) so narrow pulses no longer vanish as modulators.
  Factory selected pulse-C sources use 40% reference duty (at120 BPM in clock
  mode), with no width-LFO on that source. Keep manual MOD mapping, source waveforms, output gain, Width, LFO and clocks
  unchanged. Preserve the final-output two-sample low interval at maximum pulse Hz.
- Only audible active C (including zero depth driven by a depth LFO) needs
  emberVersion/content revision9; unchanged active non-C remains8, inactive0.
  Enforce original-snapshot GET/POST and explicit9 producer upload, not metadata
  alone. No source ZIP/revision rewrite or native-installer edits.
- Tests: ember-strong-* plus existing clean-core; per-recipe C-Off and LFO-Off
  stereo counterfactual renders at both sample rates in Chromium/WebKit, native
  isolated before/after C comparisons and exact dry/pulse/LFO PCM retention,
  actual all300 UI selections, Undo/ZIP/reload and paired real Song jobs/cache.


## Ember saved circuits and EQ (EMBER.14, 2026-11-16)

Ember has an account-backed private library at `/api/ember-patches`, stored under
the authenticated stable user ID in `ember-patches/library.json`. Preserve revision
conflicts, unique names, atomic writes, account locks and failure-without-overwrite.
Save `{version:1,ember,eq}`; `eq` is the canonical E channel including completed
automation, never an effective playback override or an armed/incomplete take.
Recall is one Card History edit and keeps current power, volume and nullable
local tempo. Other channels' EQ and user library entries must not be changed.
The full private library is account data, not part of a single portable patch.

E is a normal `MygrainChannelEq.KEYS` entry and uses the existing source-owned
pre-effects EQ bridge exactly once. Shared R/W/Delete use Ember's actual running
state/origin and local BPM (otherwise Song BPM), over the current pattern steps.
Keep explicit manual Off ahead of Read, preserving curves and no bypassed DSP.
Missing E EQ defaults bypassed. Active audible E EQ needs `eqVersion:4` /
`channelEqVersion:4`; raw snapshot GET/POST checks reject older capabilities
even when part metadata predates E. Inactive/bypassed E retains old identity and
compatible dry/C renders. Synthesis DSP and all 300 factory recipes are unchanged.

See docs/ember.md, tests/ember-save-eq-{browser,pcm,song}.cjs and
tests/test_ember_save_eq.py.

## Ember 2 clean-room replacement (Mark, 2026-11-17)

Supersedes the Ember 1 design, old factory/random/tuning policies and patch-cable
interface for NEW sounds. Ember 2 has a new engine, UI, icon and bank; reuse only
the existing private patch manager. Keep the unchanged old engine solely for
explicit archived v1 patches/Songs, never as a source of v2 synthesis. Preserve
old source ZIPs, accounts, valid cached audio and render identities.

New `modes.ember.version:2`: four stereo variable-PW voices, directed adjustable
cross modulation, complex stereo filters, individual modulated reverb feeding
cross sends, 16-step rhythmic gates/ratchets and per-voice stereo LFOs. All new
patches/oscillator ratios/LFOs/room timing are BPM driven; no free-Hz generator
mode or noise source. Keep cream/copper. Off by default and excluded from whole-
app generation. E / bastarde / patch manager + EQ contracts remain. Audible v2
needs capability20 in live/offline/server paths. See docs/ember2.md and tests/
ember2-{pcm,browser,song}.cjs plus test_ember2.py. Archived v1 must stay labelled;
new-sound action is explicit, not a destructive migration.


## Ember 2 industry sample source (Mark, 2026-11-17)

NEW Ember sounds use four distinct short normalised SAMPLES_INDUSTRY recordings,
not oscillator pulses. Keep the card/layout, auto level and existing downstream
controls; width/body now mean sample offset/original-shifted blend. Fresh factory,
Generate patch and Clean start reroll sources/start points; saved recall/history/
Song retains deterministic source seed/corpus v1. Optional sampleSource version1
needs audible capability23; absent means original v2 pulse/cap22 (do not migrate).
Keep224 studies: original24 plus200 genuinely different multi-parameter/sample
recipes, not pitch-only variants. See docs/ember2.md. Server preloads verified
sample Worker output before capture; no oscillator fallback for failed samples.


## Ember 2 effective filters and shared sequencer clock (Mark, 2026-11-17)

Interactive v2 now upgrades to optional engineRevision2: straight timing (no
swing control),96dB/oct low/high filter edges with serial notch, RMS-normalised
signed speed+phase cross coupling, global four-pattern clockDivider1/2/3/4/6/8/12/16.
Divider randomise changes only that value; sample speed/LFO/reverb remain onmain
BPM. Protected sampleSource.frames16..384000 (24kHz) NEVER changes on random or
factory actions; shorter chunks clamp. Library/project/history/Song restore it.
Audible revision2 needs24. Preserve original v1 and v2 sample23/pulse22 DSP,
source ZIPs/hashes/revisions/caches by not upgrading in__mygrainSongRenderDeck.
New interactive sounds/save content use revised engine; originals remain archived.
See docs/ember2.md and filter-clock/core/PCM, expanded bank/browser/backend/Song
checks. Do not describe a state-only control test as proof of audible change.


## Ember 2 damping and grid-synced sample loops (Mark, 2026-11-17)

Current interactive v2 uses engineRevision3/capability25: damped96dB/oct edges,
low-resonance future recipes; source cycles snap to power-of-two main-beat spans,
with per-hit/ratchet retrigger anchors on the divided shared sequencer clock.
Stereo drift/cross are bounded phase modulation, never source-clock speed drift.
Keep the explicit protected frame width and four selected industry cuts unchanged
by randomisation/timing. Show each voice's recording, actual original start/cut
width and prepared waveform, with demand-display repaint after canvas parking.
Cold stopped recall may show identity before PCM loads, labelled truthfully.
Keep archived engine2/cap24, original sample23/pulse22 andv1 DSP unchanged at the
same runtime inputs; never upgrade original source snapshots in render decks.
Use real server25 plus archived24/23Song jobs and warm PCM-only phone checks.
See docs/ember2.md and timing core/native PCM/browser tests.


## Ember 2.7 dynamic resync / trim / K export (Mark, 2026-11-17)

Live patch/random/timing changes must restart E on the next shared-grid four-beat
bar with a fresh graph and origin, not merely mutate a phase-continuous sequencer.
Use native scheduled time, preserve other cards, and keep Stop authoritative over
cold preparation and future starts. Render-deck restores remain immutable.
New `sampleSource.version:2` trims leading/trailing silence at max(-48dBFS, .02peak),
quiet-source cap .25peak, min16 frames, then DC/fade/peak-normalise. Protected
`sampleSource.frames` remains the requested maximum; actual prepared bounds and
trim metadata are shown. Never alter source-v1 preparation or the frozen corpus.
New v2 source requires selective cap26; archived rev3/source1 cap25, rev2 cap24,
sample23/pulse22/v1 remain exact. Existing worklet DSP is unchanged.
Export to K reuses Keys' exact recording/count-in/frame-window/length/history/
persistence/cancel path with only an E-owned source adapter. Capture Ember only,
then hand off to K and E Off in the history transaction; cancelled/failed capture
must preserve the old K take and cannot restart after Stop. See docs/ember2.md and
tests/ember2-{resync-k,trim,samples-loading,song}.cjs.


## Explicit On Demand steering / browser Cooking Pot (2026-11-20)

Keep native generator defaults `mode:native,tone:minimal,pot:legacy` unchanged.
Shop-only Tonal adds L/X plus exactly one P/O, with native Mega sounds/sequences
and 64-step patterns established before randomising. Minimal excludes P/O/L/X.
Shop explicit pot off/random uses zero or 1–3 whole-mix effects; full native old
routing remains legacy. Publish validates actual mode/source/recipe agreement.
Meter modern L/X group bridges rather than retired null delay-input globals.
The separate shop Cooking Pot frame reuses all eleven native DSP processors and
UI via disposable storage/contexts; no creative FX backend render on live edits.
Never expose the full app backend/account state with those static assets. Source
PCM stays immutable; browser editions, basket/publication and purchased PCM use
account-private public-service state. Preserve original full-app/Song behaviour.
See docs/dfeeder.md and ../mygrain_public/README.md.

## Sparse/Mega drum reference and tonal consent (Mark, 2026-11-20)

Sparse and Mega alone start the drum bus at 100% and D at 100% when selected.
After native effect preparation (Cooking Pot remains Off), warm one complete
pattern so late drum routes exist, then measure a complete post-FX cycle using
the shared Master Baker K-weighting / dfeeder D policy in loop-balance.js.
Commit only a fixed, attenuation-only D level to canonical D state. No permanent
AGC, hidden render gain or saved-audio migration. Stop/account lock cancels
analysis. No unmeasured D fallback at full volume. Ordinary randomisation and
individual drum lane defaults (80%, cymbals 40%) are unchanged. Ember and Enemy
remain excluded from native Sparse/Mega. Tonal chooses L + X + exactly one P/O;
Non-tonal excludes all four, retaining total source counts and other exclusions.
Consent precedes history/mix resets; cancellation changes nothing. Verify Undo,
ZIP recall and real server Song rendering when changing this path.

## On Demand checkout GPU handoff (Mark, 2026-11-20)

Checkout uses existing native dry-stem rendering (all audible drum lanes separate,
stereo 48 kHz PCM24) with at most two isolated decks below decoded-PCM budgets.
Manual/native DAW export remains serial by default. Instruments/effects are Web
Audio, not CUDA: never label browser audio DSP GPU-accelerated. The checkout
assembler uses the same native assemble routine with an explicit CuPy backend on
the RTX 3070; no silent CPU fallback. Publish only after confirmed CUDA metadata.
A bounded checkout FIFO serializes users and waits behind an existing generation;
queued exports block new generation admission via the native lock. Original and
processed purchased PCM are retained unchanged. Do not share the phase worker's
lifetime .gpu-phase.lock for checkout: its 60-second idle lease adds needless
latency. Assembly has a separate UID-scoped lease and 128 MiB CuPy pool. Verify
actual CUDA PCM parity and service-user/mount permissions, not Chromium GPU flags.

## Shared ten-worker server rendering

The native app and isolated On Demand deployment now share one ten-slot SQLite admission budget, with each generation using up to ten concurrent workers when idle capacity is available, private `/scratch/mygrain/{app,on-demand}` intermediates, and a combined `mygrain-render.slice` 24 GiB soft / 27 GiB hard memory budget. Read `docs/render-workers.md` before changing server generation, Song preparation, DAW admission or resource/storage limits. A checkout reserves both possible stem decks; never create independent render pools that bypass this shared budget. Keep saved WAV/Song/source/purchase paths and browser URLs unchanged, use destination-local fsync/atomic publication across filesystems, and keep cookies out of queue metadata. The ten-minute cooldown starts at admission for new pooled batches, not while queued. Service-start scratch cleanup is safe only after that service's previous cgroup is stopped. Hourly Spectrum Protect configuration and recovery contracts are documented there.

## Protected playback clocks (Mark, 2026-11-21)

Top whole-loop and Drum Machine dividers default ×1, accept 1/2/3/4/6/8/12/16,
and must never be randomised. Keep optional modes.clockDividers out of generic
select journals. Preserve old ×1 identity/cache; divided source snapshots require
clockDividerVersion 1 in server Song renders. See docs/clock-dividers.md.
CEF instrument 0.1.5 downloads directly to OS Downloads with numbered duplicates;
WAV Browser/FTP/Parts Bin use the common download path. Keep preview bytes immutable.

## Restructure source card (Mark, 2026-11-21)

The historical Dropbox card is Restructure: new generations use only
`samples_public`, selected standard musical slice divisions (default1/16) per
4/4 bar with 2–6 random silent sixteenth-note slots. New v4 uses an independent native
Cooking Pot effect per grain (all eleven eligible), then stereo-linked equal-RMS
gain matching before assembly. Native Pot DSP is CPU, never labelled CUDA;
CUDA gathers, gain-matches, splices and applies envelopes/gaps/peak protection.
Use shared worker admission and production scratch; keep Heavy Lifter analysis
public-grain-derived, not an extra corpus fetch. Apply gaps after FX to retain exact silence.
Keep legacy `dropboxSample` PCM/modes/metadata/DOM IDs and the aria navigation
target unchanged; never regenerate or clamp old patch recall. New generation
levels cap at70%, bar fit/keep-duration On; fail/stale results retain old audio.
Archived 1/256-note Restructure patches retain their stored audio and v1 recipe.
The card's `<` / `>` shifts use the existing sixteenth-cycle offset contract,
stored as optional `dropboxSampleLayerShiftSteps` (omit at zero, legacy default0).
Keep raw PCM/recipe unchanged, history transactional and live/future/Song starts
phase-consistent. See tests/restructure-shift-browser.cjs.
Read docs/sample-repositories.md and tests/test_restructure.py before changing.
Restructure is an explicit exception to the general 2/1 generation-only cut
restriction: its nine-option division grid controls newly generated slices,
including mixed sizes down to1/32. Output remains one bar; 4/2/1/Uncut fill it.
Card Randomise chooses1–3 divisions (always1/16, optionally1/8 and1/32) and regenerates; normal Randomise changes
the next-generation preference; Mega/Sparse change it once before their existing
Restructure generation task. Other cards and AI cut policies are unchanged.
Keep optional `restructureDivisions` saved/history-aware, default1/16 for legacy
recall, out of stored-PCM render identity, and guarded against stale responses.

## Shared Loop Cut reset / Restructure editor (Mark, 2026-11-22)

Restructure uses the same complete Loop Cut editor as W, with optional
`restructureCut` mode omitted at neutral. Gate only derived playback; preserve
raw PCM, metadata, old ZIP/default identity and shared shift timing. Preset,
history and Song use the same setting. Global Randomise/Mega/Sparse and Reset
Patch clear all sample-card loop cuts (including D1–4); successful Restructure
generation clears its cut, but failed/stale generations retain the old state.
Explicit Randomise Loop Cut inside the editor still creates a cut. Desktop cut
panel shells/backdrops are translucent; phone styling remains legible. Verify
actual saved/offloaded PCM and stopped muted-card audition, not controls alone.
See `tests/restructure-cut-browser.cjs`, `tests/restructure-pot-cut-browser.cjs`.

## Restructure 8 replaces new grain generation (Mark, 2026-11-22)

NEW Restructure is exactly the current Ember-style sample instrument with eight
lanes/patterns/tabs, an 8x8 cross matrix, only `samples_public`, and ONE shared
spring tank instead of individual lane reverbs. See docs/restructure-eight.md.
Keep Ember's four-lane files/sounds and old Restructure raw-PCM/archive controls
unchanged. Absent optional modes.restructure is an archive, never a migration.
Only an explicit new instrument edit/generation takes ownership of R playback.
New random levels <=70%; protected sample frames stay fixed; lane Regen retains
other seven PCM identities. Global random/Reset clear loop edits. New sources use
the immutable checksum-verified public corpus v1; never replace its files or use
industry recordings as fallback. Runtime is native AudioWorklet like Ember, not
CUDA; old CUDA/scratch grain machinery remains archive-only. Shared transport,
Stop/cancellation, next-bar resync, private library, K capture, mixer/solo, EQ,
Undo/Redo, ZIP, native/DAW stems and server Songs must follow the owning path.
Audible new R requires instrument capability emberVersion31. Use the Ember-only
helper for Ember content normalization/E-EQ, not the combined instrument helper;
missing/off R must leave existing render identities exact. Verify real server
render + warm playback and Chromium/WebKit native audio before claiming complete.

## Restructure drum-reference generation balance (Mark, 2026-11-22)

When new loop generation or ordinary/Mega/Sparse randomisation uses Restructure
alongside drums, compare actual source audio after its spring, EQ, local effects
and source-owned Cooking Pot inserts against the post-effects drum reference.
Use integrated K-weighted loudness plus sample peaks; trim downward only, retaining
the 70% random-level cap. Server workers apply fixed post-insert trims and audit
the recorded cycle; include optional Restructure metadata and publication checks.
Native randomisation commits canonical levels and remeasures the post-effects
result (nonlinear processors prevent assuming a fader ratio). Fail closed on
missing/silent analysis, never retain an unmeasured loud Restructure. Generation
only: do not rebalance manual edits, patch recall, Undo or saved Song rendering.
Keep native and private On Demand worker deployments in parity, including the
private engine's legacy PCM Restructure source.

Generation worker transports now reuse Chromium only after an explicit zero-context idle acknowledgement; every loop keeps a fresh account context and unchanged full-quality DSP/capture. Retire idle transports before their exit deadline and preserve per-loop FIFO admission. See docs/render-workers.md.


## Standard card insert reverb / randomisation Off (Mark, 2026-11-22)

Only Mega and Sparse randomisations end with standard card filter, reverb and delay
switches Off on all 22 loopFx channels (including five K tracks, Noise, sample,
Robot and GlassHaus). Local card sound/pattern/patch randomisations and ordinary
patch randomisation retain these effects, including all power flags and recipes.
Keep generated recipes/amounts and Undo; do not apply this generation policy to
manual settings or patch/Song recall. Noise's independent source filter also
finishes Off. This supersedes retaining useful active-card filters on generation.

Standard reverb edits opt the channel into `reverbInsert:true`: equal-power
0–100% dry/wet, with no dry or unprocessed delay leakage at 100%. Delay is before
this insert. Missing flag preserves old parallel PCM. Only powered nonzero
insert hall needs loopFxVersion 2; preserve archived source ZIPs and legacy
render identities. See docs/loop-card-fx.md and card-reverb-insert-browser.cjs.


## GlassHaus instrument (Mark, 2026-11-22)

Three-object modal source; see docs/glasshaus.md for primary research and DSP
limits. Natural decay is central: per-object 0.2–120 seconds; repeated same-note
strikes reinforce the existing modal bank. Keep its power, level, objects and
sequencer OUT of ordinary/Mega/Sparse global randomisation and shutdown hooks.
Its own dice change pattern/sound/both and retain all standard card FX channels;
only Mega/Sparse finish with those effects Off per the policy above. Main transport starts/stops it; local Off never stops peers.
All three slots, tonal/chord state and BPM/free vibrato use one optional canonical
`modes.glasshaus` recipe. Untouched is absent; absent/off content identities must
stay byte-exact. Audible recipes require renderer 37; no new worker pool. Preserve
native, offline, server Song and autonomous DAW stem parity. Changes to worklet
registry imports must bump the worklet URL in its host AND the host URL in index.

## Persistent WAV identity and recoverable notes (2026-11-23)

Do not treat st_dev as persistent file identity. Host/container remounts can
change device IDs with unchanged inode, size, mtime and content. Account WAV
provenance and paired patch sidecars retain their legacy four-field formats,
but comparisons ignore only the device field. Keep real replacement detection
(inode/size/mtime) and private account/shared-note boundaries intact. Never
rewrite old WAVs/ZIPs just to repair display metadata. Repository feedback
writes retain immutable private pre-write versions in each account's data
`.repository-feedback-history`; reads must not write or create these snapshots.
See docs/wav-metadata-recovery.md and the remount regression tests.


## Universal Parts Bin editing (2026-11-23)

Named open-bin identity/revision is RAM-only; keep native/source formats unchanged.
Save supports update-open, append-existing or create-new, including after uploads.
Keep other destination parts and exact nested ZIP/preview bytes. Server replace
requires If-Match; moves verify original bytes/revision and commit destination
and source together. Empty bins are valid. Never remove local move sources on a
failed server operation. Account lock clears even a connected native view's bin
association. See docs/parts-bin.md and parts-bin-workflow-browser.cjs.


## CEF Web MIDI permission (2026-11-23)

Instrument 0.1.6 adds CEF_PERMISSION_TYPE_MIDI_SYSEX to the exact trusted-origin
permission mask, retaining loopback only otherwise. Pinned CEF 156 exposes this
permission group even for app sysex:false; Alloy has no Chrome permission UI.
Do not grant all origins or microphone/camera to fix MIDI. Native tests resolve
real Web MIDI on fresh/restored helpers, no CDP permission injection; empty CI
ports do not verify hardware. Native helper changes need full reinstall. Release
source/CI/coverage and archive hashes: vst3/cef/RELEASE-0.1.6.md. CEF FX 0.1.1
was not rebuilt in that release; preserve its version when syncing instrument.


## Parts Bin size policy (Mark, 2026-11-24)

No independent 96 MiB bin cap. Universal data shares the existing 512 MiB
account quota; retain 32 parts/16 bins and strict archive validation. Installed
native binaries still enforce 128 MiB for current patch + bin + metadata together.
Never claim unlimited DAW storage from a hosted-app edit. On failed native Store,
keep working parts and the previous valid snapshot, and permit explicit universal
save. No format or audio changes; see docs/parts-bin.md.


## Robot follows the shared card transport (Mark, 2026-11-24)

Robot has On/Off only, with no independent Play/Stop button or local handler
that starts the shared loop. Enabled Robot uses the existing main-loop and
sequencer start deadline; On while stopped only arms it. On/first audible event
while playing joins the existing phase without restarting peers. Off stops only
Robot. Keep internal graph start/stop hooks for global transport, recall and
cleanup; preserve phrase PCM, timing, saved state and server render identities.

## Fresh AI patch unsupported cards (Mark, 2026-11-24)

Successful fresh AI Generate/Regenerate and GENREator patches switch Off Robot,
GlassHaus, Enemy Drone, Ember, both current/archived Restructure, Heavy Lifter,
Bubble Chamber and Master Baker because they are outside the current AI contract.
Keep all recipes, levels, source/word PCM and banks. Do this only at successful
recipe commit inside shared history, before save/resume; failure/cancel/stale/no-op
restores or retains the original patch. Undo/Redo includes these powers.
Refine, section development, manual/local actions, INSTAREEL and saved/Song recall
keep their existing behavior. This narrow fresh-AI policy supersedes older
Mega/Sparse-only cross-card/mastering shutdown wording for these cards only.
Do not copy On Demand's separate Ember/profile choices into the full-app AI path.
No automatic migrations, DSP changes or legacy render invalidation.


## Drum Machine pan and scroll ownership (Mark, 2026-11-24)

The entire dialog shell, including snapshots, is the vertical scroll owner.
Never restore a lane-only scroller beneath fixed-height snapshot/header siblings.
Keep Close reachable and update all lane jump targets with the scroll owner.
All eight lanes have independent optional drumPan state; Roll shares Snare PCM,
not its pan. Hat Accent horizontal swipes set per-hit pan regardless of accent
power. Null inherits lane pan; explicit zero centres and overrides it. Yellow
position line overlays Accent, solid green left/red right fill. Taps still toggle
accent; vertical gestures scroll. Preserve recipes/source PCM and shared history,
Copy Sec, drum snapshots, all saved formats and native/server/offline playback.
No-pan legacy content identity stays exact; audible saved pan requires selective
drumPanVersion 1 on Song render GET/POST. See docs/drum-machine-layout.md.
