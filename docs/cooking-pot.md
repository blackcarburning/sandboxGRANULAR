# The cooking pot · source-owned inserts · 2026-11-14

Eleven reorderable stages: Mutilator, Bass Face, Turntable, Olaf’s Resonator,
WireWorld, Sonic Crystal, Bubble Chamber, The Wasp, Filter Playground,
Henry’s Hose and Heavy Lifter. Master Baker remains pinned after the final sum.

## Signal ownership

Every powered stage owns its selected sources, even if its wet level is zero.
A named source’s physical dry gate closes before its original normal destination.
Its post-EQ/local-card-FX signal enters exactly one complete ordered path. The
last stage alone is audible; intermediate outputs feed the next stage only.
Off removes the stage, retires DSP/LFO/delay storage and restores unity bypass.
No compensating subtraction, parallel raw copies or new audio delay is used.

Each stage computes `(1 - mix) * incoming + mix * processed(incoming)`.
Dry is left; 100% Wet is right. The incoming signal at stage two is stage one’s
output, including stage one’s balance. Existing Mutilator/Bass mix, Wasp blend
and Playground mix remain their canonical controls, including existing LFOs.
The seven formerly wet-return effects use sparse `cookingPot.mixes` values,
defaulting to 1. Card output level controls still scale their wet processing.
At full wet a powered zero-level effect intentionally silences its source.

An On stage set fully Dry stays in its chain and uses that chain’s output-volume
policy; it does not reconnect the source’s old global-FX/main-volume path. Off
restores that original path unchanged. The final stage’s Through main output
switch decides whether the chain follows Master Vol/mute; otherwise its output
is independent. Unrouted sources retain their original main path and fader.

Sources share DSP only when their entire ordered paths match, including Resonator
slot and Wasp destination route identity. Whole mix → A-only therefore duplicates
the earlier nonlinear body for A and for the other sources, rather than attempting
to unmix a combined return. Pre-chain copies drive Wasp/Playground detectors only.
Unregistered raw/grain audio enters via the residual main bus after all named dry
gates. Whole mix owns that residual too. Context-owned groups survive voice
handoffs; maximum topology is bounded by the canonical source registry.

## State, power and generation

`modes.cookingPot = {version:1, enabled:boolean, order:[11 keys], mixes?:{key:0..1}}`.
The old `enabled` routing flag is retained as metadata, not a second audio mode.
Optional `power:{enabled,remembered}` retains the group switch’s exact card flags,
including Master Baker. Card powers remain canonical. Stir shuffles order and
switches a random five to all eligible effects On (up to eleven); BIG STIR
additionally changes recipes. Bubble Chamber is included and Master Baker stays Off after either Stir. Liquidizer
changes LFOs only. All these policies are retained. Mixes survive generation.
JSON, source ZIP, local restart, Undo and native snapshots retain the same state.
New balance inputs have no IDs and are excluded from generic saved controls.

## Render compatibility

Live, WAV and isolated server Song rendering use the same graph. Prepare modules
before capture; source arrivals wire synchronously. All-Off/DAW-only snapshots
retain their previous content identities. Powered saved effects require explicit
producer `cookingpot=4` and a selective v4 content signature, regardless of old
Pot routing enable. Stale GETs and uploads are rejected using the actual saved
snapshot, not just possibly old part metadata. Arm refreshes affected freezes,
leaves current neighbours and original ZIP/SHA/revisions unchanged, then reuses
warm PCM on phones. Memory admission counts complete-path processor instances.

## Verification

See `tests/insert-routing.test.cjs`, `tests/test_insert_routing.py`,
`tests/insert-routing-pcm.cjs`, `tests/insert-routing-controls.cjs` and
`tests/insert-routing-song.cjs`. Evidence includes Chromium and iPhone-style
WebKit PCM, full source registry, two-source/nonlinear isolation, EQ retention,
power-down/LFO release, balanced endpoints, saved controls and server freezes.
Source Solo retains powered insert ownership even at a dry endpoint or with a
zero wet-return level; manual effect Solo remains available for transparent stages.
`tests/insert-routing-solo-song.cjs` verifies these saved source-Solo cases.
The legacy sum/coefficient worklets remain for older diagnostic tests only and
are not loaded by the insert engine.

## Mega / Sparse completion

Both patch randomizers finish with real group power Off so only normal output
is heard. Mega keeps generated recipes and its random selected powers in the
group's remembered state, restored only by an explicit Cooking Pot On. Sparse
keeps its all-Off selection. Cleanup is inside the existing history transaction
and precedes save. Stir, BIG STIR, Liquidizer and saved-audio recall are unchanged;
there is no DSP or render-identity revision for this generation-only policy.

Patch randomizers (ordinary, Mega and Sparse) also unmute the canonical main
output, retaining its volume and Through Main routing. This is inside the
accepted generation/history edit, not a saved-patch migration.


## Source Solo isolation (2026-11-15)

A layer Solo means the selected layer plus its processing, not every contributor
to the same effect. Source-derived effect selection and explicit manual effect
Solo have different ownership. Cooking Pot filters each branch's source inputs
before their sum using `effectOutput.allowsSource`; manual effect additions
apply only in live monitoring. The branch identity includes its semantic source
membership so excluded sources cannot survive in a shared DSP history. Voice
identity is excluded so normal voice arrivals do not recreate the graph.

The normal layer gates still own unaffected dry paths; effect output selection
and Through Main remain final-output policies, not substitutes for source
isolation. No canonical recipe, route, power, level or LFO is edited by Solo.
A deliberately manual-soloed effect can add its input contributors while a
source Solo is active; removing that manual selection immediately returns to
the source-only mask. Offline renderers ignore these transient manual Solos.

Affected saved source-Solo/matching-insert parts require effect-output capability
7. Small original manifests are checked before trusting older v2-v6 freezes,
including records with stale/downgraded part markers. Backend render GET and
POST independently enforce the same rule from the original snapshot. Refresh
replaces only affected derived PCM; source ZIP hashes and Song revisions stay
unchanged. No-Solo/off/unrelated/DAW-only identities remain compatible.

Regressions: `source-solo-isolation-browser.cjs` measures native offline PCM
(including nonlinear and grouped inputs); `source-solo-live.cjs` measures
repeated live spectral isolation, additive/manual ownership, stable graph counts
and normal A/B loop controls; `source-solo-song.cjs` exercises real isolated
server preparation, stale GET/POST rejection, selective refresh and phone reuse;
`test_source_solo_isolation.py` checks JS/Python capability parity, legacy
identities and immutable portable sources. Use an isolated test store, never a
production Song, for fixtures.

### Playground activation / disposable-editor LFO controls (2026-11-20)

Playground’s omitted optional `mix` means 1, matching its own DSP and UI,
not the .5 Mutilator/Bass Face default. Only enabled non-DAW Playground
with omitted mix needs Cooking Pot capability/content revision 5; explicit
mix, bypassed/external-only states and unrelated effects retain prior hashes.
The current producer declares 5. Original ZIPs/revisions remain immutable;
GET and POST verify original snapshots even with stale part metadata.

Card LFO edits must use optional `root.mygrainCardHistory` / `root.mygrainSongBeta`
checks: the disposable shop deck intentionally has neither. Bare optional
chaining on an undeclared identifier throws before storing any LFO edit. Keep
full-app transaction/undo and Song guards when those owners exist. No synthesis
or explicit recipe PCM changes are needed for this UI-only repair.

Regressions: `tests/test_playground_activation.py`, `tests/cooking-pot.test.cjs`,
`tests/playground-activation-song.cjs`, `tests/playground-mutilator-browser.cjs`.

### Touch slider ownership (2026-11-20)

All effect cards, Cooking Pot and Master Baker/standalone mastering ranges
use predeclared `touch-action:none`, scoped in the critical Cooking Pot CSS
(inline in index too). The shop deck must not reintroduce pan-x/pan-y. Native
range events retain control; scroll/pinch gestures beginning elsewhere remain
native. Do not use a global body scroll lock or alter audio/recipe state.
Verification includes compositor-dispatched diagonal touch drags, value/input
events, unchanged ancestor scroll positions and absence of pointer cancellation,
plus a real outside-slider swipe. WebKit tap checks and all214 current slider
computed styles are checked separately; these are browser emulation, not a
physical iPhone confirmation.

### Movable Master Baker VU header (2026-11-20)

The inline Stereo VU header now opens the existing floating meter window and
can begin its drag. Both grips use pointer capture and 44px targets; the floating
window retains arrow-key movement and resize/visual-viewport clamping. Its six
digital meters are in an expandable Levels & loudness section, leaving the
VU window small enough to move on a phone. Canonical mastering settings,
comparison state and export DSP are unchanged.

### Source protection during Stir (2026-11-22)

Stir and BIG STIR are effect-only history actions. Neither switches Robot off,
restarts its source node, changes its grid/markers/audio, nor changes shared
transport phase. Robot initially Off stays Off. Full patch generation keeps its
separate Robot shutdown policy. Regression: `tests/robot-stir-browser.cjs`.

### Randomisation isolation (2026-11-23)

Only Mega/Sparse enforce group Off and cross-card resets. Local sample, pattern
and sound randomisers and ordinary patch randomisation retain complete Pot state,
all unrelated effect recipes/powers, EQ and source powers. Stir/BIG STIR preserve
already-powered effects and Master Baker; their new random selection may add
effects, not silently remove existing powered ones. Historical all-randomisers
Master Baker Off policies are superseded. Saved recall and server rendering do not
apply generation policy or need new render identities.
