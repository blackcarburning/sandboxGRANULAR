# D: pattern-fitted loops

D loads the recursive `SAMPLES_LOOPS` library or a local audio file. It retains
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
native media preview and per-row Load actions. D is scoped to SAMPLES_LOOPS;
V is scoped to SAMPLES_VOCAL and imports the complete selected vocal.
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
