# BIG STIR control eligibility and percentage

2026-11-14 · build v2026.11.14.BIG-STIR-AMOUNT.1

The **Controls moved** 0–100% slider sits directly beneath BIG STIR. Default:
100%. It selects an exact random subset of the eligible controls across all
eleven reorderable effect cards: `round(controlCount × percentage / 100)`.
This is a percentage of controls, not an interpolation/depth amount. Selection
is without replacement. Curves count once per graph, not once per point; a
Heavy Lifter sample/seed/cut selection counts once per tab. Hidden Heavy tabs
are included, unlike Liquidizer, which retains its active-tab-only policy.

0% retains every recipe, source, balance, volume and sample reference. Both
Stirs still shuffle audio order and choose 5–11 eligible powers independently.
100% selects every eligible control, including cards left Off. A source menu
with only one active choice can remain on that choice. Linked object/material
validity may require a companion field change. Inactive model fields are saved
for when their model is selected. No fake source choices are introduced.

## Inventory

The declarative inventory is `parameterControls()` in cooking-pot-model.js.
`docs/big-stir-control-inventory.json` records the audited desktop controls.
With active source/destination choices and modern models, there are 304:

| Card | Controls |
|---|---:|
| Mutilator | 14 |
| Bass Face | 8 |
| Turntable | 14 |
| Resonator | 50 |
| WireWorld | 10 |
| Sonic Crystal | 13 |
| Bubble Chamber | 14 |
| Wasp | 40 |
| Filter Playground | 63 |
| Henry’s Hose | 30 |
| Heavy Lifter | 48 |

This includes continuous controls, discrete model/strain/mode choices, source
menus, Resonator dimensions/excitation curves/delay, all Wasp recipe filter and
route controls, Playground curves and their existing clock/rate-sculptor
parameters, all Heavy mode recipes and per-mode real-corpus selections, native
four Dry/Wet balances, seven Pot balances and all eleven terminal output levels.
The Wasp's two route editors remain subject to its existing one-active-route
invariant; active-route selection is one coupled control. On iPhone, five Wasp
filter numeric controls fixed by the existing phone DSP are not offered as
random destinations; its mode remains eligible within low/high-pass choices
(299 controls in the same fixture). The disabled extra four Wasp routes are
not editable destinations. Other counts adapt to runtime source availability.

Protected: the six Liquidizer/card-LFO objects and assignments; global tempo
and master-volume mirrors; Master Baker recipe (still Off); Through Main and
main-output mute; source PCM outside Heavy's derived selections. Existing
Playground/Wasp *recipe* curves and clocks remain eligible as they were distinct
from the six subsequently added Liquidizer LFOs. Factory preset banks, ordinary
per-card preset actions, Mega/Sparse, Liquidizer and normal Stir recipe behaviour
are not rewritten. All existing manual and saved value ranges remain intact.
Generated return/overall levels and Dry/Wet have nonzero musical ranges; this
is not a manual-control range restriction. Hose random depth is restrained; its
recently calibrated factory preset recipes are unchanged. Legacy Hose upgrades
only when Doppler is selected; legacy Bubble uses its existing unit-aware
upgrade when a redesigned model control is selected. 0% is a legacy no-op.

## Persistence, failures and Song

Optional normalized `modes.cookingPot.stirAmount` is 0–1; missing/unity means
100%. It survives history, JSON, portable ZIP, local reload and saved Song parts.
The backend validates its type/range, strips it from audio content identity and
keeps every engine revision unchanged. Adjusting the slider does not rebuild
processors. BIG STIR snapshots and rolls back recipes, Pot metadata/mixes,
terminal output volumes and Baker power atomically. The original output routing
flags and mute are retained even when volumes change.

## Verification

- 18 Node inventory/routing tests: all canonical editable fields audited,
  all 101 percentages exact-sized, 130 seeded/endpoint complete recipes,
  real corpus cut bounds, protected data, invalid draws, legacy models,
  existing 5–11 cardinalities and source-owned routing.
- 14 focused backend tests: metadata neutrality, strict validation, existing
  insert identity, effective terminal gains and JS/Python agreement.
- Actual Chromium and iPhone-UA WebKit UI actions: 0%, 37%, 100%, independent
  5/11 power endpoints, Undo/Redo, setter failure and post-output-mutation
  rollback, source eligibility, linked powers, JSON/ZIP/reload and 320/390/844/1440
  widths. Slider measured below its own button and inside the Pot.
- Eight real isolated server Song fixtures across full/partial generation and
  0%/37%/100% saved metadata: dry, generated five/eleven inserts and group Off; finite/nonzero PCM, exact frame counts, Off identity, immutable
  sources/revisions, no browser rendering uploads and warm desktop/phone reuse.
- Syntax checks and exact live asset bytes. All production user stores untouched.

The expanded tests fail against the pre-task model (inventory/amount missing).
The inherited test_wasp_playground.py has two content-hash expectations that
also fail unchanged against the pre-task backup with identical hashes; those
pre-existing assertions were not edited or reported passing. Their baseline
and staged outputs are retained with the task evidence.

The extra constant-zero partial-selection probe correctly rendered silence for
a one-second fixture: it selected a two-second Resonator delay (and zero slot
levels). This is a valid extreme recipe, not a renderer failure. The partial
nonzero-PCM fixture uses an interior draw; endpoint normalization/selection
remains covered independently without changing valid manual or DSP ranges.
