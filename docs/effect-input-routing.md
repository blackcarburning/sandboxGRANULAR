# Shared specialised-effect Input routing (2026-11-11)

`effect-inputs.js` owns the ordered 33-key inventory and user-facing labels for
all nine Cooking Pot cards. Resonator has two Input menus and Wasp has two
modulation-driver Input menus; all eleven selectors use exactly the same list.
Destination and Playground modulation/drawn-curve menus remain separate concepts.

## Compatibility

- Bass Face keeps X by default; Mutilator keeps sparse/default D.
- Turntable keeps legacy `route: mix|drums`. Optional `input` selects another
  card/track/group/host input. Whole mix and Drums are normalized back to the old
  routes without a redundant field. Old defaults and DSP recipes are unchanged.
- Acoustic and Resonator keep `source`; Playground keeps optional `input`.
- Power, recipe browsing, preset +/- anchors, source Solo and linked Layers/Pot
  controls stay owned by the existing cards. Presets do not change Input.
- JSON/ZIP/browser/native project saves continue using canonical card settings.
  Native Pot panels do not own a second set of source settings or need new binaries.
- Bubble Chamber remains manual-only; its saved/manual Input and power still work.

## Routing

`character-fx.js` binds a true summed Mutilator/Bass Face whole-mix insert before
native Turntable. Its master group is not registered as a phantom source tap.
Per-source/group character routes retain their legacy graph. Cooking Pot All uses
its original mix binding; global character dry coefficients apply once to the
main mix rather than subtracting unscaled track taps from a processed mix.

`turntable.js` owns selected-source inserts in its source-wrapper lifecycle.
Unselected sources retain their direct path. A selected group has one surface-noise
owner, even with multiple K/drum lanes. In Pot mode its physical dry path is gated
at that same source insert; the Pot processes the original excitation and owns the
wet return. Earlier whole-mix stages retain that excitation, and later stages get
the ordered carrier. No guessed raw-source subtraction is applied to final main dry.

Wasp registers D as a detector-only slot without duplicating its dry carrier, and
accepts DAW as an explicit driver. Whole mix includes all registered drivers.
Resonator host input shares acoustic effects' existing external-source observer;
source lifecycle updates rewire it without clearing unrelated resonator tails.

All source choices, including absent sources, must work with Pot On/Off, independent
returns, Through main output, additive Solo, reordered chains and source disposal.

## Song / offline rendering

`unifiedInputsVersion: 1` and targeted content revision distinguish newly supported
routing: whole-mix character processing, selected Turntable, D/DAW Wasp drivers,
Wasp All with enabled D, and Resonator host input. Client/server validate, advertise,
upload and require this capability; missing producer markers rebuild only affected
freezes. Ordinary legacy sources retain their content identity, original ZIPs,
revisions and reusable renders. Browser/worklet realms all preload the shared
registry; its exact filename is explicitly public-asset allowlisted.

Regression entry points: `tests/effect-inputs.test.cjs`,
`tests/test_effect_inputs.py`, existing Playground/Turntable/Wasp/Pot suites.
Release evidence additionally covers all eleven visible menus in four browser
profiles, actual final-output PCM, live D/DAW modulation, preset/Undo/Redo/ZIP/restart
recall and isolated real server renders with stale-marker/warm-cache checks.


## Source-isolated serial branches · FXSOURCES.1

The previous source taps were correct individually, but the next effect also
received the entire preceding carrier. An effect selecting A therefore received
B (and even the whole mix) from an earlier wet return. A global suffix also
applied unrelated later insert attenuation to earlier returns.

The rack now forwards each stage's pure wet output separately, retaining its
source scope. A later stage receives a contribution only if its selector covers
the contribution's complete scope. Exact-track, K/K1–K5 and drum-group containment
use the same rule. Each enabled Resonator slot has its own admission check.
Same-source and Whole-mix chains remain ordered; disjoint branches bypass each
other. A combined Whole-mix return cannot be separated after nonlinear DSP, so it
bypasses later narrower selections instead of contaminating them. Select Whole
mix at that later stage when the combined return should be processed.

Intermediate and final dry coefficients apply only to covered wet branches.
Wasp/Playground coefficients stay sample-accurate; extra owned scaling nodes
retire on source/order/power/context changes. Existing main/return gates, mute,
source controls, power, saved settings and independent outputs are unchanged.
Wasp Input remains a modulation driver; Destination selects its affected tracks.

Current-engine WAV, plugin audio and isolated server Song decks use this graph.
Only source-conflicting active chains require cookingPotVersion 3 and content
revision 3. Compatible chains retain revision 2; Pot Off/dry/legacy identities
and original archives/hashes/revisions remain unchanged. Metadata-only Arm checks
old v2 freezes before reuse. Render admission derives the required capability
from the stored archive, not just old part metadata or a producer claim.

Regression: effect-source-isolation-browser.cjs reproduces the pre-fix fault at
final output and verifies eight source-selecting stages, Whole-mix upstream,
unrelated 100%-wet insert bypass and all 33 retained source choices. The updated
cooking-pot-song-browser.cjs runs real conflicting/same-source/independent-return
fixtures, WAV, old-producer rejection, selective refresh and warm phone-style
playback. cooking-pot.test.cjs covers all 1,089 selector/provenance combinations;
test_cooking_pot.py compares client/server version decisions and old hashes.
The old cooking-pot-browser.cjs raw-master fixture specified nonexistent X/D/drum
taps and failed unchanged against the pre-task copy; that output/order fixture
now explicitly selects Whole mix while the dedicated source tests register real
named taps.
