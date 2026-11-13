# MYGRAIN maintenance requirements

## Drum randomisation volumes (Mark, 2026-11-13)

Every drum randomisation sets individual lane volumes to 80%, except
Crash/Cymbals at exactly 40% (not a ceiling). Include Kick, Snare/shared Snare
Roll, Hat, Perc, Clap and ETC; apply consistently to normal/Mega/Sparse and
drum pattern/sample randomisation. Preserve the separate drum-bus policy,
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

## Bubble Chamber generation policy (Mark, 2026-11-11)

Bubble Chamber is manual-only. Ordinary/Mega/Sparse patch randomisation and both
Cooking pot Stir actions must leave it Off without randomising its recipe. Remove
its per-card Randomise control; do not include it in effect randomisation APIs. BIG STIR randomises the other eight effects and enables two eligible
effects. Keep Bubble Chamber in the nine-stage order, manual controls, preset
browsing, linked card/Layers/Pot power and saved patches. Never enforce this
generation-only rule in normalization, imports, saved patch recall or server
rendering: existing manually enabled patches must retain their sound.

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

## Master Baker final-stage policy (Mark, 2026-11-12)

The Master Baker is a final post-main/post-independent-return mastering stage,
not a reorderable insert or independent return. Its tenth Cooking Pot row stays
pinned last even with the Pot Off. Main mute must not bypass mastering of
independent returns. Ordinary/Mega/Sparse patch randomisation leaves it Off while
preserving its recipe; both Stir actions preserve its recipe AND power. Never
apply this generation rule on saved patch recall or server rendering. Keep the
WAV browser route, private patch library and explicit confirmed original-WAV
replacement. Console mirror controls are excluded from generic saved-control
inventories; modes.masterBaker is canonical. See docs/mastering.md for routing,
latency, tape, compatibility and isolated checks.

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

Plugin-session-only jade library. Keep it out of ordinary source patch/JSON/ZIP
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
