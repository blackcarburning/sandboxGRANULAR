# Stir range and Bubble Chamber — 2026-11-14

Mark replaced the two-effect/manual-only policy with a random five through all
eligible reorderable effects. Eleven is reachable, including Bubble Chamber;
Master Baker stays Off and is not counted. A zero Amount/Mix Mutilator and BIG
STIR Wasp with no valid loaded destination remain excluded. Count is drawn
uniformly across the eligible cardinalities after independently shuffling order
and selection. Normal Stir never replaces recipes. BIG STIR replaces every
recipe, including effects left Off, and chooses active loaded source inputs.
Existing LFO objects, including hidden Heavy Lifter assignments, remain intact.

Bubble's per-card Randomise is restored. The acoustic effect randomisation API
includes Bubble, preserves keyed power/source policy and existing LFOs; Sparse
still only switches effects Off. Mega/ordinary patch completion retains real
Cooking Pot shutdown and unmutes main output. Mega remembers the generated
selection, including Bubble's independent coin, for explicit On. There is no
saved-state migration, DSP change, render-version change or AI contract expansion.

## Focused verification

- `node --test tests/stir-range.test.cjs tests/cooking-pot.test.cjs`: all seven
  cardinalities, min/max/clamped RNG, nonfinite rejection, existing eligibility
  guards and routing/model checks. New regression fails against the backup.
- `tests/stir-range-browser.cjs`: real Stir/BIG STIR buttons at five/eleven in
  Chromium desktop and mobile-style WebKit, linked power, recipe/LFO retention,
  one-step Undo/Redo, injected setter rollback, actual Bubble Randomise button,
  generic/keyed/Sparse policies, Mega group shutdown and explicit Bubble re-enable,
  JSON/ZIP/reload and four viewport widths (320/390/844/1440).
- `tests/stir-range-song.cjs`: real isolated server renders for legacy dry,
  generated five inserts, generated eleven inserts and group Off. Finite nonzero
  PCM, exact one-second frame counts, bypass identity, immutable source hashes
  and Song revisions, no browser render upload, warm desktop/phone playback.

The original broader `henrys-hose-stir-browser.cjs` predates several intervening
features (including group shutdown and five Pot actions) and still encodes its
historical two-effect/Bubble exclusion contract; it was not reported as passing.
No production account or Song stores are used. Mobile-style WebKit is an emulated
phone browser, not a physical iPhone listening test.

## Complete parameter coverage and amount (2026-11-14)

BIG STIR now uses a declarative inventory rather than choosing only factory
recipes. See [BIG STIR controls](big-stir-controls.md) for complete coverage,
percentage semantics, protected LFO/master/routing settings and verification.
Its amount defaults to 100%; order/power selection is independent of amount.
