# D: pattern-fitted loops

D defaults to shared `SAMPLES_LOOPSTORE`; its Loop library dropdown also offers
the recursive `SAMPLES_LOOPS` library. Local audio import remains available. It retains
original PCM separately from its playback cache. WSOLA fits either one source
repeat or a nearest whole repeat count to the exact current pattern frame count.
Source BPM in the filename informs the repeat count. BPM, pattern length, pitch
and reverse changes derive again from original PCM, not a previously stretched copy.

Mega/Sparse load a new D source. Reel arrangements never choose another D source:
they apply seeded grid-aligned gaps through Loop Cut while preserving source,
source-window and timing controls. D has standard channel EQ, loop FX, solo,
portable patch/Song persistence, history and stem routing.

D's audio binding is append-only to preserve older journal indices. Pre-D Song
snapshots normalize an empty, disabled D lane in memory; they need not be rewritten
or lose reusable render hashes. Server validation accepts both old FX inventories
and inventories containing D. Source ZIPs remain unchanged during rendering.

## Verification

`tests/loop-d-browser.cjs` uses `tests/song-beta-test-server.py` on port 18983 with
an isolated `MYGRAIN_TEST_ROOT`, an admin test account, and two synthetic non-silent
WAV fixtures under `admin/source_mirrors/SAMPLES_LOOPS/Drums/Bass`. It checks
Chromium/WebKit mobile layouts, 18 timing combinations per engine, real library
selection/import, history, Mega/Sparse, reel gaps, new and pre-D server Song renders,
warm-cache reuse and original source hashes. `D_FORCE_SERVER=1` explicitly exercises dedicated server-arm worker jobs;
`D_ENGINE=chromium` or `webkit` limits the browser pass. Never run it against
production data.

## Playback lifecycle and sample selection

D preserves transport intent across settings/history restoration, solo/mute,
source replacement and audio-slot invalidation. Explicit Stop clears that intent;
UI synchronization must not resurrect a stopped source. Resumed sources use the
shared transport origin, retaining pattern phase rather than starting at zero.

D and V use X's shared sample browser, including search, favourites, collections,
native media preview and per-row Load actions. D uses its selected library;
V defaults to SAMPLES_NCRVOCALS and also offers SAMPLES_VOCAL; both import the complete selected vocal. See `vocal-libraries.md`.
The separate D picker and its preview AudioContext are no longer used.

`tests/loop-d-v-shared-browser.cjs` exercises both mobile browser engines,
favourite persistence, stopped-engine media preview, real D/V loading, and D
restore, Undo/Redo, solo/mute, timing, source replacement and audible PCM.
`tests/loop-d-stop-browser.cjs` checks that Stop silences D and shared previews.

V, D and X now use native audio controls directly, without a separate Preview
button. Source URLs are session/account pinned; playback is lazy and independent
of the main transport. Global Stop pauses these widgets without disposing their
rows; Close and row replacement release them. `tests/v-d-x-native-preview.cjs`
checks touch Play, advancing media time, Stop/replay and Close in both engines.

## Loop-speed correction

Loop speed offers ×1 (default), ×2, ×4, ÷2, ÷4 and ÷8. It multiplies the
normal source cycle count after Repeat/Single fitting, without changing pitch.
Fractional cycles are allowed: slow settings may play only the first portion of
the fitted source before the pattern repeats. Pattern output remains exact-length.
The fitter always passes original source channels to WSOLA; changing speed back
to ×1 produces the same PCM as the initial ×1 fit. No derived buffer is persisted
as source. The speed is in D settings for patches, history and Song rendering;
legacy settings without it use ×1. Loop-copy routing includes loopDSpeed.

The D browser regression covers all six speeds in both fill modes, repeated
changes and source hashes, original WSOLA inputs, exact pattern frames, saved
half-speed server rendering, legacy renders and warm-cache reuse.

## Solo/dropout recovery — v2026.11.01.D.14

Reproduced: start with D soloed, solo A, then solo D again. D had no source
although `bastardLoopPlaying` remained true. A's `stopBastardLoop` called D's
`stopAll` even for A-only mute/replacement (`preserveTransportState:true`),
erasing D's transport intent. Only an actual whole-transport stop now does that;
`stopAllBastardLoopLayers` still stops D before any UI refresh callbacks.

Solo-button refresh updates existing D gain without replacing its source. A
native unexpected D `ended` preserves transport intent, while explicit D/transport
Stop clears it before cleanup. `mygrainD.checkCycle()` inspects once per observed
audio-time pattern cycle through the existing background controller bookkeeping
and native scheduler pulses. It creates no timer, analyser or audio clock. Missing
eligible D voices restart through the same origin/shift-aware `start` entrypoint;
existing and future-scheduled voices are untouched. Audition, stopped/suspended
contexts, startup, render/restore transactions, history edits and active D loads
cannot be revived by the check. Mute/solo/enable and loaded source guards remain
in force. No silence detection: intentional cut/gap silence is not a dropout.

The server worker loads the same editor and isolated render deck; normal D start,
stop and restore paths include the fix. There is no new DSP or serialized state,
so existing correct freezes need no render-version invalidation. Verify current D
and legacy pre-D sources, source SHA preservation and warm cache via
`D_FORCE_SERVER=1 node tests/loop-d-browser.cjs` against the isolated 18983 store.
`node tests/loop-d-resume-browser.cjs` checks real PCM, repeated solo/mute/restore,
A-only teardown, stable voice identity under UI refresh, actual native-ended
recovery, stopped/muted silence beyond cycle boundaries and fresh playback.

## Load status (D.15)

D has a dedicated accessible info line beneath its source details. Random, browser
and file imports report downloading/reading, decoding, fitting and saving, then
retain the loaded filename or failure message. While the D sample browser is
open, its existing status line mirrors the same progress. Long filenames wrap
within the card on phones. Restoring another sound clears the transient message.

This is UI-only instrumentation: source bytes, fitting, playback, rollback, saved
parts and server Song rendering are unchanged; no render-version bump is needed.
Verification: `node tests/loop-d-load-status-browser.cjs` against the isolated D
fixture server covers delayed download, failure rollback, retry, random, browser
selection and imported files in Chromium/WebKit at phone and desktop widths.


## Optional transport-locked Mutilator — 2026-11-10

The original Mutilator was a static filter/distortion, not a BPM modulator. All
seven original strains add distinct one-bar, straight-16th filter patterns when
**Tempo-locked rhythm** is On (Off is the original static processor):
Gnaw accented bites, Melt curved acid swells, Rupture 3–3–3–3–4 fractures,
Scab stepped decays, Venom offbeat stabs, Hollow sparse openings and Splinter
busy broken accents. Tone sets the centre; Damage controls both distortion and
sweep depth. Existing shaper curves and dry/wet gains are retained. Source shift
moves the loop against the common grid, not the Mutilator clock.

A native looping AudioBufferSource drives filter.detune through a gain: 16,384
samples at 8,192 Hz (exactly one bar at 120 BPM), playbackRate = BPM / 120.
The shared transport origin supplies the offset even for late enabling, strain
changes, recovery and offline starts. Small continuous attacks/releases keep
triggers on the grid; no JavaScript timer schedules the rhythm. Tone/Damage/Mix
edits retain the modulation source and the D PCM source. Bypass stops/releases
all Mutilator nodes and its 64 KiB control buffer. No asynchronous preload.

At a BPM handoff D retires its old graph at the scheduled boundary, including
EQ and modulation cleanup. Its old parameter-change wrapper no longer starts
D a second time after the shared transport has scheduled the new voice. Explicit
Stop still removes both current and retired D voices.

`tests/mutilator-clock-browser.cjs` checks native output and control PCM across
7 strains, 3 tempos, 44.1/48 kHz, late activation and a 40-bar run in Chromium and
WebKit, plus phone live edits, beat-boundary retiming and ZIP recall. Run against
a disposable authenticated fixture with MYGRAIN_TEST_URL and MYGRAIN_TEST_OUTPUT;
never production account data. Existing Mutilator/Dropbox browser tests cover
randomisation cleanup, Undo/Redo, AI and effect checkboxes.

### Original / rhythm switch and five further strains

The D card now has a visible Tempo-locked rhythm switch. Missing `rhythm`
defaults to false, restoring the original static filter/distortion. It changes
only modulation, not the D source. The recent BPM-locked code is retained
intact behind On, including beat-boundary handoff and late-activation phase.
All seven original static strain outputs are PCM-identical to their pre-clock
implementation in Chromium and WebKit.

Diode (asymmetric bite), Cinder (scorched fuzz), Shred (serrated fold), Vortex
(hollow notch) and Maw (gated snarl) bring the strain selector to 12. Each also
has its own rhythm pattern when the switch is enabled. All strains remain
available to existing Mutate / AI / Sparse / Mega integration. Generation
retains the chosen rhythm preference and still actively disables processing
on disabled/muted D. Off/mix-zero/damage-zero has no modulation source.

`mutilatorVersion: 2` / render upload `mutilator=2` identifies switch-aware
PCM. Old accidentally always-rhythmic freezes (version 1) refresh; unmarked
pre-clock static originals retain their signatures and remain reusable.
Original strains use engine revisions 1/2 (static) or 3 (rhythm); new strains
use 4 (static) / 5 (rhythm). No ZIP rewriting on preparation. The switch uses
only canonical `modes.loopD.mutilator.rhythm`, not a duplicate extra control.


## 2026-11-10: reload / Sparse / Mega policy

Saved controls and power survive reload. Sparse keeps Wasp, Mutilator, Filter
Playground, Turntable and Olaf’s Resonator off. Mega randomises their settings
and independently chooses each effect in or out; Mutilator may only run when
Loop D is active, loaded and audible. Bypassed Mutilator settings are randomised
too without changing the manual per-card random button’s readiness requirement.
The confirmation and completion dialogue describe this policy and history
captures the final effect choices. See `effect-reload-mega.md`.

## Shared store default · v2026.11.12.DSTORE.1

`modes.loopD.repository` is the canonical next-load choice: `samples_loopstore`
(default) or `samples_loops`. The ID-less card selector and D browser selector
mirror it. Changing the library is one history edit, never an audio replacement;
Choose, Random, Mega/Sparse and AI fresh D loads use the selected source. Reels
still retain the loaded original and vary gaps only. Local import keeps the
library choice. Legacy D metadata from SAMPLES_LOOPS retains that selection on
restore; absent/null D state defaults to Loop Store. JSON/ZIP/local persistence
retains selection and original PCM.

The shared source key resolves directly to `mygrain_loopstore.ROOT`, never an
account mirror or Dropbox. Listing matches the store's published top-level WAVs;
hidden/pending/recovery directories and symlinks are excluded. Loads/previews use
existing authenticated, account-pinned source routes; shared-store notes/reactions
remain unavailable, while private favourites remain usable. Fresh arrivals are
listed without stale TTL caching. Stored original BPM reaches D through the
source response header, preserving intended repeat counts at another tempo.

The library field is validated on the backend but stripped only from audio
content signatures: changing the next-load choice must not invalidate unchanged
Song PCM. Source ZIPs/metadata and selector settings are not rewritten; original
audio in portable snapshots renders without requesting either library. Existing
render capabilities/DSP are unchanged.


## Four independent sample lanes — v2026.11.15.D4.1

D is now four sample lanes. The old D source and all its existing controls are
lane 1, unchanged by legacy recall. Lanes 2–4 start empty/Off. Each has a separate
standard rainbow browser with native audition and reversible in-track Preview,
Import, Random Loop, next-load library, fit and pitch-preserving speed selector.
A confirmed browser Add is the only replacement; Preview never changes canonical
PCM, metadata, saved settings, history or plugin captures. Switching Preview off,
closing or history travel restores the original. Other lanes keep their sources
and shared transport phase during an individual lane edit.

The separate D mini mixer has one On/Off, level and pan per lane. Existing D
master level, On/Off and Layers/Solo remain WHOLE-CARD controls. Mixer level
multiplies the existing master; neutral lane 1 is exactly unity with no panner.
Non-centred pans use an explicit stereo input so mono input has no centre-law
jump. The four lane EQs precede ONE combined D filter/LFO/hall/delay chain and
source-owned inserts. D2/D3/D4 are EQ identities, not new global Solo/effect
source keys: all remain semantic source D. Never put the primary D EQ after the
four-lane sum or allocate separate local effects for the added lanes.

EQ keys D/D2/D3/D4 reuse the shared four-band popup and complete R/W/Delete
one-pass automation. There are now 31 registered EQ channels. Curves use the
existing shared pattern/audio clock and manual-bypass precedence; no extra lane
scheduling timers are introduced. Browser/manual source speed does not change
the arrangement length or global BPM. The primary lane retains its old pitch,
maximiser, cuts, gaps and source-preserving derived fit.

Optional VU meters tap each lane AFTER its EQ and fader/pan, before shared D FX.
They are transient view state (Off after reload), not generic saved controls.
No analyser or animation task remains when disabled, off-screen, stopped,
hidden or in a Song deck. Pan/level range gestures use one history transaction;
per-lane speed and loading actions are undoable without replacing other lanes.

### Persistence, render and compatibility contract

- `modes.loopD.mix` is optional lane-1 `{enabled,level,pan}`; omit the exact
  unity/centre/On default. Existing `loopD.enabled/level` remain group controls.
- Optional `modes.loopD.lanes` contains exactly three lane-2/3/4 settings:
  `enabled, level, pan, speed, fill, repository, metadata`. Omit untouched lanes
  entirely. Missing lanes restore Off; loading an old patch must never enable
  the new sources. New per-lane EQ/automation remains in `modes.channelEq`.
- Original PCM is append-only in history bindings as bastardD2/3/4, DB keys
  bastardLoopD2/3/4Buffer, portable paths bastardloops/loop-d2/3/4.wav (editable
  patch) and audio/bastardD2/3/4.wav (Song source). Do not reorder history slots.
  Full D copy includes all four originals, settings and EQs. Account and async
  load guards retain the standard preview/commit lifecycle.
- Audible extra lanes or a non-neutral primary mixer require loopDVersion 3 in
  client reuse/admission and server GET/POST. Ordinary old D stays version 1,
  maximised old D stays 2. Missing/default additions preserve exact pre-task
  content identities. Do not rewrite old source ZIPs, audio or Song revisions.
- Isolated render preparation pre-fits every enabled D lane before capture.
  Low Power remains live-only; server/offline/borrowed-context renders always
  use full quality. Audio archive bounds increase only by three source entries
  (44 audio assets / 45 ZIP entries). Dfeeder's source whitelist is unchanged.

Regression commands (isolated loopback store only):

```
node --test tests/channel-eq.test.cjs tests/eq-automation.test.cjs tests/global-solo.test.cjs
python3 -m unittest discover -s tests -p 'test_d_four_lanes.py'
BASE=http://127.0.0.1:19345/mygrain/ OUT=<evidence> node tests/d-four-lanes-browser.cjs
BASE=http://127.0.0.1:19345/mygrain/ OUT=<evidence> node tests/d-four-lanes-song.cjs
```

The Python identity comparison needs MYGRAIN_D4_BASELINE pointing to the exact
pre-task backend backup. Browser fixtures expect disposable admin credentials,
two distinct 240-BPM WAVs in the isolated shared SAMPLES_LOOPSTORE and current
Playwright Chromium/WebKit. Tests cover final-output PCM, four independent
lanes, panning, EQ isolation, shared filtering, exact preview restoration at
source PCM, separate random loading/Undo/Redo, real speed/native pan controls,
four one-pass EQ takes, ZIP and IDB reload, legacy defaults, viewport containment,
and optional meters allocating zero analysers when off-screen/disabled/stopped.
Three actual server jobs verify legacy/current/automated-EQ PCM, exact frame
counts, channel panning, warm reuse, phone playback and immutable source hashes /
revisions. Run source-solo-isolation-browser (now including D2–4 semantic masks),
source-solo-live, source-solo-song and test_source_solo_isolation as well.
These are browser-engine checks, not a physical iPhone listening test.

Pre-task backup/evidence: `output/mygrain-d-four-20261115T141915Z/`.


## Mini-mixer lane Solo — D4.2 (2026-11-15)

The four mini-mixer Solo buttons are **local to D**, explicitly not global
source Solo. Selected lanes combine; clearing the last selection restores all
otherwise enabled D lanes. Other cards and the existing card/global Solo mask
are unchanged. D master/lane enable and levels still apply: audition never
powers a muted lane or overrides a globally excluded D card.

This is a transient input-monitor mask, applied before per-lane EQ and D's shared
filter/reverb/delay/insert feed. Existing shared effect tails decay naturally;
there is no global DSP reset on an audition click. Changes use the existing D
voice gain/stop/resume lifecycle and common transport origin; explicit Stop must
not be undone. Buttons have no saved-control IDs and never make a history edit,
change source PCM/provenance, source mutation serial or canonical settings.
Settings recall, history restore and account lock clear the monitor mask.

Offline contexts, borrowed-context render decks and server Song rendering always
ignore it. Live-graph WAV/Loop Store capture temporarily bypasses the monitor mask
and restores it in finally (also on cancellation/error), without serializing it; preparation still fits all enabled lanes. No schema/content identity
or render-version change is required. Portable source ZIPs and saved source Solo
stay compatible. The ordinary D Solo above the mixer remains global.

`tests/d-local-solo-browser.cjs` checks native Chromium/WebKit PCM for individual
and additive local selections, a real concurrently playing A card, global Solo
separation, on/off, repeated toggles, stopped/restarted transport, shared space
and powered inserts, phase, unchanged settings/history, render context bypass,
ZIP/recall/reload and phone portrait/landscape/desktop layouts.
`tests/d-local-solo-song.cjs` takes source snapshots while local audition is active
and verifies full four-lane audio via actual server jobs, plus old single-lane
identity, independent pan/EQ, exact frames, source hashes/revisions and warm reuse.

`tests/d-local-solo-render.cjs` measures all four tones through actual current-pattern
WAV capture and the native borrowed-context renderer with local Solo active.

### D4.3 — uniform sample controls

All four lanes now use the same layout and control order: Random/Choose/Import,
library, fit, speed, maximiser, pitch, reverse/shift, Loop Cut/Randomise Gaps/Start,
then automated four-band EQ and status. Start remains the existing shared
Bastardloops transport, not an independent lane clock.

Lanes 2–4 gain their own duration-preserving pitch (±24 semitones), 0–100%
maximiser, reverse, 16th-note shift and full cut/gap editors. Existing speed,
fit, mixer, EQ, source browsers and reversible Preview remain independent.
No per-lane filter/LFO/reverb/delay is introduced. Every operation derives from
original PCM; random gaps retain the two-/one-bar generation policy. Manual
cuts retain the standard full editor resolution. Replacing a source resets
that lane’s cuts, while browser Add installs its explicit candidate cut.

Additional transform fields are optional, neutral values omitted from lane
settings. Recall of old four-lane settings is unchanged. Audible new extra-lane
processing requires loopDVersion 4; old D versions 1–3 retain their audio and
content identities. Server and borrowed-context renders use the same full-quality
processing. Mini-mixer Solo remains a transient local audition only (D4.2).

Regression coverage: d-lane-controls-browser.cjs, d-lane-controls-song.cjs,
test_d_lane_controls.py plus existing local/global Solo and cut suites.

Stopped lane cut auditions participate in D's aggregate active-voice checks for
idle output gating, background-context ownership, Stop and tempo handoff. Do not
use only the original lane-1 source as proof of D activity. Native final-bus PCM
and zero-voice cleanup are covered in d-lane-controls-cut-preview.cjs; unchanged
neutral extra-lane PCM is compared exactly against the pre-D4.3 fitter.

### Card randomisation (2026-11-18)

D card Random and shared batch randomisers replace lane 1 and clear lanes 2–4
(original PCM, saved IDB slots and lane settings), only after a successful load.
The whole change remains one history edit. A failed load preserves all lanes.
Manual loading, individual lane Random and saved patch/Song recall remain additive;
this is generation policy, not a render-time override or capability change.

## Unchanged-tempo preparation cache — 2026-11-24

The global BPM/pattern-control observer must not unconditionally clear D’s
prepared PCM. `fitted()` already keys the cache by original source identity,
AudioContext, exact target frames, repetitions/speed/fill, pitch, reverse and
maximiser. Real parameter/source changes refit from the original PCM as before.
Unchanged notifications retain that exact prepared buffer, including the second
BPM application between native Live prewarm and scheduled start. Previously that
path ran the same time-stretch twice (roughly 250–350 ms each in the saved-source
replay). Explicit source/history/restore invalidation remains intact.

`tests/loop-d-cache-browser.cjs` uses isolated stores and real Chromium/WebKit to
check zero warm stretches, identity reuse, tempo/pattern/source invalidation,
bit-identical regenerated PCM and unchanged originals. An isolated real server
Song render and warm-cache playback also passed; no render-compatibility bump is
needed because source metadata and output PCM are unchanged.

This removes confirmed redundant startup work, not all live starvation: full
Linux native-core replays still underrun and have variable AudioContext/wall
progress. Preserve that failure separately from the passing cache checks; a
physical Windows CEF/DAW result cannot be inferred from this optimization.
