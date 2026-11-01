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
warm-cache reuse and original source hashes. Never run it against production data.
