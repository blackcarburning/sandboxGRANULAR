# Mutilator controls and factory bank

Build `v2026.11.11.MUTILATOR.1` adds 100 factory recipes: 50 synced, 30 free-running and 20 static, grouped into ten sections. The bank is a separate editor-only module (`mutilator-presets.js`). Names/IDs are not playback state or render inputs.

## Interaction

- Power and input routing remain independent of D; selecting a recipe retains both.
- `Custom` never erases the last matched factory cursor. +/− uses displayed option order and wraps. A fresh unmatched bank starts at first/last respectively.
- Recipes replace sound parameters, avoiding stale optional settings. Parameter changes use card history; recall, Undo/Redo and reload derive matching from normalized sound settings.
- New component-owned controls carry `data-mutilator-owned`, excluded from generic slider/select initialization, history inventories, imports and randomization. Canonical settings live only in `loopD.mutilator`.

## Seven additive controls

| Field | Range/default | Behavior |
|---|---|---|
| filter | auto, lowpass, bandpass, highpass, notch; auto | Original strain filter or explicit override |
| resonance | 0…1; .5 | Multiplies original Q, bounded at 16 |
| sweep | 0…1; 1 | Scales synced or free cutoff modulation |
| cycleBeats | .5, 1, 2, 4, 8; 4 | Tempo-locked 16-cell pattern cycle |
| freeRate | .125…12 Hz; 1 | BPM-independent sine modulation |
| freeDepth | 0…1; 0 | Enables/scales free motion with rhythm Off |
| output | −18…+6 dB; 0 | Wet-only output trim, leaving drive and dry gain intact |

Neutral extension fields are omitted by normalization. The original Q, wet-gain and tempo-clock arithmetic is retained when neutral, preserving old PCM. Wet trim is a separate post-wet gain (initialized before the source starts), so it scales startup transients as well as steady audio; scaling the legacy smoothed wet-gain target alone does not do this. No UI interval drives motion: each voice uses a looped 64 KiB audio buffer, with phase anchored to the existing transport origin. Bypassed/disposed voices stop/disconnect the clock.

## Songs and compatibility

The current editor, offline WAV export and isolated server render deck share `mutilator-dsp.js`. The new asset files are explicitly allowlisted. Async script loading completes DSP and recipe modules before `loop-d.js` initializes.

The backend strictly validates only the new fields. Defaults, unused motion controls and inactive processing preserve legacy content signatures. Audible expanded processing alone adds `mutilatorControlsEngineRevision:1` and source capability `mutilatorControlsVersion:1`. Render upload must explicitly declare `mutilatorcontrols=1` before its audio is certified; the server version alone is not proof. Old/neutral states retain existing freezes. Source edits back to legacy settings remove the optional source capability. Source ZIPs, part IDs and Song revisions are not rewritten during preparation.

## Verification

Task evidence and pre-change baselines: `output/mygrain-mutilator-bank-20261111T102619Z/` in the workspace.

- `tests/mutilator-bank-browser.cjs`: runtime-enabled desktop/phone Chromium and WebKit; all 100 Chromium selections, section boundaries elsewhere, all original/new parameter cursor checks, Undo/Redo, power/input independence, JSON/ZIP/reload, and 320/390/844px layouts.
- `tests/mutilator-expanded-dsp.cjs`: 48 exact legacy PCM comparisons per engine, all 100 recipes at 44.1/48 kHz, two BPMs/five cycles, free-Hz independence, every new control, trim and bypass. Set `OLD_LOOP_D` to the backed-up `loop-d.js` and `OUT` to the evidence directory. `ENGINE` can isolate one browser.
- `tests/test_mutilator_expanded.py`: strict new-field validation, original and neutral hashes, inactive semantics, producer declarations and source integrity. Set `MYGRAIN_BASELINE_BACKEND` to the backed-up backend for historical comparisons.
- `tests/mutilator-expanded-render.test.js`: selective frontend freeze compatibility.
- `tests/mutilator-expanded-song-browser.cjs`: disposable authenticated local server, real current/legacy jobs, WAV, phone PCM, warm-cache reuse and selective stale-marker rebuild. Only its explicitly provided `/tmp` test store is altered to create the stale fixture.

Physical iPhone hardware is not covered by browser emulation.
