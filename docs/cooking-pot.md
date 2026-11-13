# The cooking pot · v2026.11.11.POT.4

Optional source-aware serial rack for Mutilator, Bass Face, Turntable, Olaf’s Resonator,
WireWorld, Sonic Crystal, Bubble Chamber, The Wasp and Filter Playground. Drag a
handle or use its arrow keys / Move buttons. A committed move or Stir enables the
pot. Cancel, Escape, a stationary tap and pointer cancellation do not write state.
Old patches default to Pot Off and retain original routing. The separate card is
next to Layers, with pot-icon drawer and mixer shortcuts.

## One state owner

`modes.cookingPot = {version:1, enabled:boolean, order:[nine unique semantic keys]}`.
No effect power copies live in this object: its nine On/Off proxies invoke the
existing Layers power actions. Card setters remain canonical, retain settings,
and synchronize all three views. No transient row/drag/proxy state is serialized.
The ordinary history/account/Song guards apply. JSON presets, editable ZIPs, local
restart snapshots and Undo/Redo retain pot enable/order plus existing powers.
Mega uses Fisher–Yates to shuffle all nine slots and enables the pot before the
existing independent effect choices. Sparse bypasses the pot, retains its order
and switches effects Off. Ordinary/per-card/AI generation adds no pot override.

## Real routing

One context-owned graph receives the post-global-FX/compressor mix before the old
master insert block. Active effect stages connect in the stored order; disabled
stages are removed and bypassed. Mutilator/Bass Face use their shared native graph
builders. Other stages use existing versioned worklets. Reordering rewires only
owned edges, preserving active processor objects and tails. Switching Pot Off
releases rack processors and restores original routes without changing powers.

Pot On retains each card's selected input and Turntable's mix/drum route. Each
stage receives that selected original excitation plus preceding wet audio. Base
worklets apply earlier global dry coefficients; selected-source dry corrections
preserve the main dry mix without feeding unrelated loops into independent wet
returns. The carrier removes the base dry component before passing wet audio to
the next stage. Wasp's per-source cross-modulation remains its original pre-chain
sidechain, and Playground detector taps are pre-effect source copies, not returns.
Native duplicate wet processing is bypassed while the rack owns it. D's raw card
level/envelope taps survive scheduled voice handoffs and retire with their voices.
Mutilator power is independent of D power, but a selected input must actually be
playing to excite it, just as with Pot Off.

The sum worklet decomposes `Y[n] = d[n]Y[n−1] + wet[n]` into the original dry input
and each card’s wet contribution after all downstream dry coefficients. At unity
these reconstruct the serial chain. The fourth optional Wasp-master output carries
the *sample-accurate* smoothed dry coefficient; existing one/three-output PCM is
unchanged. Per-card `Through main output` gates and the dry Master Vol fader remain
at the final sum, never before excitation. Thus Master Vol zero retains independent
wet returns; following returns still obey Master Vol. Turntable is fully wet and
therefore replaces preceding dry contributions, as in its original mix insert.

## Rendering and compatibility

The same graph is used by live audio, WAV/DAW capture and isolated current-engine
Song/server decks. Deck and adapter readiness await worklets and effective wiring
before scheduling capture. Worklet queues, source taps and edges are owned by the
context and disposed on power-off, account lock, replacement and pagehide.

The backend strictly validates the nine-key permutation. Disabled/all-effects-Off
pot state is excluded from render identity, preserving legacy hashes. Active pot
state and formerly source-pruned parameters (including D-Off Mutilator) enter a
selective `cookingPotEngineRevision:2` identity. Old original ZIPs, SHA hashes and
Song revisions are untouched. Active saved parts require explicit producer
`cookingpot=2`, recorded as `cookingPotVersion:2`; an undeclared upload is rejected,
not certified by the receiving server version. Frontend compatibility and server
Arm both rebuild stale affected freezes while retaining current neighbours.

## Verification

- `node --test tests/cooking-pot.test.cjs`: normalization/permutations, 1,024 serial
  decomposition combinations, exact legacy master PCM with/without fourth port.
- `MYGRAIN_BASELINE_BACKEND=/isolated/before/backend/mygrain_songs.py python3 tests/test_cooking_pot.py`:
  old/bypassed identity, strict rejects, order-sensitive hashes, D-Off/DAW controls.
- `BASE=http://127.0.0.1:19347/mygrain/ OUT=/isolated/evidence node tests/cooking-pot-browser.cjs`:
  runtime desktop/phone Chromium/WebKit, native Chromium touch drag, pointer/keyboard
  drag/cancellation, nine linked powers, final-output PCM, audible reversed order,
  main-zero routing, Mega/Sparse, history, ZIP/JSON/restart and responsive containment.
- `BASE=... OUT=... STORE=/tmp/mygrain-cooking-pot-store node tests/cooking-pot-song-browser.cjs`:
  actual server jobs, legacy/bypassed dry, both orders, nine effects, independent and
  following main-zero paths, real WAV, producer rejection, selective stale rebuild,
  warm reuse, bounded phone PCM playback, unchanged source hashes/revisions.

Use isolated loopback accounts/stores only. Physical iPhone and DAW hardware are not
covered by emulation. Backup/evidence: `output/mygrain-cooking-pot-20261111T104509Z/`.

### Verified release receipts

- Four runtime browser cases and four final visual/layout cases passed in desktop/
  phone Chromium/WebKit. Native Chromium touch drag, keyboard/cancel, concurrent
  handoff edits, all nine powers, live parameter changes, JSON/ZIP/restart, Mega/
  Sparse and Undo/Redo passed. Latest visual checks match actual hydrated card
  icons (not lazy placeholders), check readable contrast and 320–1440px containment.
- Four focused unit tests cover 1,024 decomposition combinations, exact legacy
  master PCM and teardown without context regrowth. All 171 existing DSP tests,
  58 existing Song backend tests and five cooking-pot backend tests passed.
- Seven real server fixtures plus one selective stale rebuild passed, including
  opposite orders with different captured audio, all nine stages, legacy and
  bypassed dry, main-zero follow/independence, WAV, undeclared-producer rejection,
  warm reuse and bounded phone-style PCM playback. Original ZIP hashes and Song
  revision stayed unchanged. An early weak-signal fixture produced too little
  spectral difference for its proposed assertion; the final deterministic source
  is bounded below full scale and exercises the nonlinear order audibly.
- The existing independent-output browser regression is also run against Pot Off
  on Chromium/WebKit desktop, with its original assertions unchanged; only its
  phone loop is filtered in the isolated evidence copy. See original-routing.log.


## Reciprocal navigation · v2026.11.11.POT.2

Every effect-name block in the pot is a labelled Jump button. Each of the nine
real effect cards has an accessible pot-icon return button in its own navigation
row, installed when the card's actual header hydrates (never in a lazy placeholder).
Layers contains one pot-icon Jump entry, with no power, Solo, volume or saved state.
All paths use `mygrainJumpToButton` for detail opening, visibility reveal, lazy
loading and the existing desktop transition. The existing mutation owner adds
missing return buttons after hydration without duplicates; repeated mount is inert.
No audio graph, DSP, power action, patch serialization or Song render identity is
changed. New asset cache keys are limited to cooking-pot.js and cooking-pot.css.

Before a rack-to-effect jump, the rack awaits the existing Turntable/Wasp/Playground
lazy UI jobs. These neighbouring cards can otherwise expand after navigation and
push Resonator out of view. This is user-triggered UI hydration, not startup DSP
or a new audio loader. A newer navigation click cancels an obsolete pending jump.
UI synchronization retains rows already in the correct position, preserving focus
and avoiding gratuitous DOM moves while neighbouring cards hydrate.

Verification: Chromium/WebKit desktop and touch/phone-sized contexts passed all
nine effect/return round trips, keyboard Enter, single jump-only Layers entry,
unchanged effect/pot state and keyboard reorder/Undo. Four final visual cases
retain all source icons, readable colours and 320–1440px containment. Physical
phone hardware is untested. Exact audio/state ownership code and all 95 inline
script blocks are retained, apart from the two scoped cache URL changes.


## Stir and BIG STIR · v2026.11.11.POT.3

The spoon **Stir the pot** shuffles the nine-stage order, enables the pot and
chooses exactly two distinct eligible effects On, retaining every effect's settings.
Bubble Chamber is excluded from selection and always left Off by both Stir actions;
its manual settings and its ninth slot in the order are retained.
If Mutilator has zero Mix/Amount, Stir chooses two other effects instead of
changing its controls or asking its canonical setter to arm an inaudible stage.
The ladle **BIG STIR** also generates settings for **all eight eligible** effects,
including the six eligible effects it leaves Off. Bubble Chamber stays Off and its
settings are not randomised. Power, parameter and ordering changes use canonical
card setters in one draft-history action; the rack, cards and Layers share power.
The pot power button retains its pot icon through every On/Off update.

BIG STIR uses the 100-patch Mutilator/Bass Face banks, the WireWorld/Sonic Crystal
recipe banks, bounded Turntable/Resonator recipes and Wasp/Playground random controls.
Source selectors, Turntable routing, tempo, source audio, L/X levels and main/
return routing remain untouched. Wasp's internal modulation choices are part of
its generated sound. Presets/ZIPs/restart already store these existing settings;
no schema, DSP, worker, render identity or legacy freeze revision changes.

A failed setter is awaited alongside the other setters and the prior effect and
pot snapshots are restored. Busy/Song/account/audio guards apply. The separate
`mygrainCookingPot.randomise` helper also forces Bubble Chamber Off. Mega still
uses independent coin flips for the other eight effects; Sparse still bypasses
the pot and switches all effects Off. The button-only `stir({big,random})` exact
two-effect policy must not leak into either batch generator.

Focused verification: `tests/cooking-pot-stir-browser.cjs` exercises real buttons,
eight-effect generation, manual Bubble Chamber retention, exact two-power policy, one-step
Undo/Redo, injected setter rollback, Song guards, preserved inputs/tempo/volumes,
Mega/Sparse, portable ZIP/JSON/restart and three icons at 320–1440px. The matching
`tests/cooking-pot-stir-song-browser.cjs` extends the real server fixture suite
with generated two-effect and all-nine recipe parts, WAV and warm phone playback.
Run only against a dedicated loopback server/account store. Physical phones are
not covered by browser emulation.

Release checks passed: Chromium/WebKit desktop and phone-sized touch (four cases),
48 responsive button measurements, ZIP/JSON/restart, all nine canonical powers,
Undo/Redo and injected rollback. Four existing pot/DSP unit regressions passed.
Nine real server fixtures plus one selective stale rebuild passed, retaining
source ZIP hashes/revision, warm reuse and bounded phone-style playback. The
feature regression rejects the pre-task assets because BIG STIR is absent.
No production account/Song writes or application-service restart are required.

## Clock and output correction · v2026.11.11.POT.4

The prior rack overrode source selectors with whole-mix excitation. Those wet
returns intentionally bypass Master Vol, so unrelated loops reappeared inside
them at zero. The fix preserves selection and final return ownership instead of
putting independent effects under a new master gate. Input/route selectors now
also contribute to active-pot render identity. Old active-pot freezes must be
rebuilt; bypassed/legacy content identities and original ZIPs/revisions stay intact.

A new Playground stage received `{origin,bpm,time}` although its clock requires
`at`, so it ignored that initial epoch until a later transport event. Every new
worklet now receives the shared queued epochs, including future tempo handoffs.
Mutilator/Bass Face edits read the current shared origin/BPM/deadline; native
context aliases are resolved when rebuilding card LFOs and delays. Free Hz and
fixed-BPM Playground lanes retain their own clock modes. No main-loop stop or
restart is used to repair phase. Diagnostics expose native modulation epochs.

Regression entry points: `tests/pot-clock-routing-browser.cjs` (six selected and
unselected inputs, Master/follow levels, live Mutilator/Bass Face preset changes,
Playground clock messages and native card LFO rebuilds), the native Mutilator clock
suite, and twelve real server fixtures in `tests/cooking-pot-song-browser.cjs`.
The latter includes unrelated-source and drum-only silent freezes, global returns, explicit v2 producer
capability, v1 freeze refresh, warm reuse and bounded phone-style playback.
Evidence/backup: `output/mygrain-pot-clock-routing-20261111T114010Z/`.
Physical iPhone and external DAW hardware remain untested.

Final phase tests also change a filter preset while a future tempo handoff is
pending (`CLOCK_ONLY=1` runs the fast clock subset). Stage wiring is rebuilt only
when node/source/order/coefficient ownership changes, not for a tone-only edit.
Broader DSP checks recorded 258/259 passing; the one older phone startup expectation
also fails against the untouched before-copy (no affected DSP/worklet was changed).
All 58 legacy Song backend tests plus six routing/backend tests pass.

## Bubble Chamber manual-only · v2026.11.11.RANDOM.1

Bubble Chamber remains an orderable/manual ninth stage, but no longer participates
in patch randomisation or either Stir action. Mega generates the other eligible
effects independently; BIG STIR generates eight recipes and selects two eligible
effects On. Both Stir actions leave Bubble Chamber Off and preserve its recipe.
Manual power, preset browsing, portable/restart recall and server rendering of
existing On patches remain unchanged. No DSP/render identity change is needed.

Focused checks: `bubble-randomisation.test.cjs`, the adapted acoustic Mega browser
regression and `cooking-pot-stir-browser.cjs`. These retain the prior manual-On
round trips and add deterministic exclusion, linked powers, history, two-effect
selection and generated recipe retention. `acoustic-song-browser.cjs` exercises
manual-On and pre-feature source ZIPs through real server workers and warm reuse.

## Cooking Pot main output controls (2026-11-11)

The Pot has a **Main output volume · linked Master Vol** slider and **Mute main
output / Unmute main output** button. The slider mirrors the existing `volume`
control, not an extra Pot gain. Mute is a separate saved post-excitation switch
in `modes.effectOutput.mainMuted`. It preserves fader level, all Master Vol LFO
assignments and source/effect settings. Unmute reopens the main gate at the
existing (possibly modulated) level. Changing a fader does not clear the mute.

Independent wet returns remain audible; returns explicitly set to **Through
main output** also mute. Native whole-mix Turntable is itself a fully wet return
and retains its independent/following policy. Source excitation and routing are
untouched in Pot On and Off modes. There is no force-to-independent override.

`effect-output.js` mounts and synchronises the ID-less
`data-effect-master-proxy="cookingPot"`; generic saved-control inventories exclude
this proxy. `cooking-pot.js` supplies the shared history-wrapped mute edit. JSON,
local, ZIP and Song/native/WAV use the canonical volume plus optional true mute.
Absent/false mute normalises away, retaining old hashes and PCM for all unchanged
patches. True mute alone requires `effectOutputVersion:3`, including dry-only
patches, and is retained in content hashes. Backend validation, render admission
and current client/server rendering use this capability. No global invalidation
or stored-source rewrite; legacy versions 0/1/2 keep their existing meaning.

## Compact source menus · v2026.11.11.POTINPUTS.1

Every Pot effect row mirrors its canonical card Input using the same populated
33-source registry. Menus sit beside the effect name on desktop (>960px), and
under it on phone/narrow layouts. Resonator objects and Wasp modulation channels
keep separate numbered 1/2 menus: neither is collapsed into a false single input.
Wasp menus select modulation drivers, not destinations; accessible names and
hover titles identify each lane and its destination/Off state.

`data-effect-input-proxy` menus have no IDs and are explicitly excluded from
`saveState().selects`. Input edits capture the selected value before asynchronous
history preparation, then read current settings and use the existing canonical
setters. They retain power, recipes, other lanes, Pot order and main-output policy.
Canonical setters/subscriptions already refresh Pot mirrors on card edits,
Undo/Redo, JSON/portable ZIP recall and local restart. No timer, new saved field,
DSP, native binary, server producer capability or render revision is added.

Verification entry point: `tests/cooking-pot-inputs-browser.cjs` (isolated
`BASE` and evidence `OUT` environment variables).
It exercises all eleven menus, the full inventory, both sync directions, canonical
power/order retention, history, JSON/ZIP/restart and 320/390/844/1440px containment
in desktop/phone-sized Chromium and WebKit. Physical iPhone remains untested.


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

## Bulk main-output routing · v2026.11.12.POTOUTPUTS.1

The Cooking pot main-output panel has two independent buttons:

- **All effects through main output: On/Off/Mixed** mirrors the nine canonical
  `modes.effectOutput.throughMain` flags. On switches all nine On, including
  inactive effects; Off switches them all Off. Mixed means individual card
  settings differ, and clicking Mixed switches all On. Clicking On switches all
  Off. Changes are one guarded history edit, not a separate saved override.
- **Mute main output / Unmute main output** retains the existing saved
  `modes.effectOutput.mainMuted` post-excitation gate. It preserves Master Vol
  and its LFOs; independent returns remain audible while main-following returns
  and remaining dry audio are muted.

For effects-only listening set the bulk control Off and mute main output.
Effect inputs, power, recipes, order and Solo are not changed by either button.
These are app-wide routing controls even with the Pot Off, and individual effect
buttons remain authoritative and immediately update the bulk Mixed display.
Existing JSON/ZIP/local restoration, isolated server renders and cache identities
reuse existing routing/mute fields without a new schema or DSP revision.

## BIG STIR active-card sources (2026-11-12)
BIG STIR snapshots the existing Character FX active-input inventory (enabled, playable, positive-level, solo-eligible cards/lanes). All generated input selectors choose individual members of that pool, never Whole mix or an inactive fallback. Both resonator slots and Wasp modulation menus are included. Turntable resets to individual-track routing; Playground disables its extra kick route. Wasp destinations stay within its supported active carriers; D/host-only patches leave Wasp ineligible rather than substituting X. Empty pools reject before applying recipes. Bubble Chamber remains manual-only, Off with its recipe and source retained. Ordinary Stir, Mega/Sparse, manual recall and normalization are unchanged. Canonical source settings already persist through JSON/ZIP/history and server rendering; no DSP/schema/render-version change is needed, and legacy freezes remain valid.

## Critical layout delivery — v2026.11.13.POTLAYOUT.1

The screenshot-reported oversized effect logos and native unstyled input selects
were reproduced by failing only the separate cooking-pot.css request. Normal
browser styling was already compact: 29px row icons (23px on narrow phones).
The exact existing stylesheet is now embedded in index.html under
`#mygrain-cooking-pot-style` at the former stylesheet loading position.
It no longer depends on a separate preload/download in CEF or the browser.
Keep that embedded block byte-identical (ignoring surrounding newlines) to
cooking-pot.css when changing the rack styling. The standalone CSS remains its
authoring source and public compatibility asset.

No layout redesign, DSP/state/native-plugin changes or cache revisions. Routing,
input selectors, canonical power, reorder and pinned Master Baker are retained.
Verification includes blocked external CSS, current CEF query mode, desktop/phone
Chromium/WebKit, fully hydrated effect icons, responsive icon/control bounds and
unchanged saved snapshots. Physical Windows/macOS CEF needs a device check.
