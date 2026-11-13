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
