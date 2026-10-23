# Sustained granular scheduling — GRAIN.1

The 20 October CPU change reduced `MAX_GRAIN_NODES` from 150 to six.
The pool counts real AudioBufferSourceNodes, including sources queued ahead of
playback and fading transport handoffs; it is not a six-note polyphony limit.
With the 350 ms queue, a single two-layer default note could fill it and silently
drop later grains. The previous code reproduces roughly 130 ms holes in a DC PCM
fixture, despite having non-zero overall RMS.

The repaired engine uses:

- A hard 96-source ceiling, retaining queued/fading accounting and idempotent
  cleanup. It never resets counters to admit more sources.
- A grain-only 120 ms lookahead, bounded by any shared transport boundary.
  Other sequencer/drum transport lookahead remains unchanged.
- Independent, transient per-layer next-event times. A fast A layer no longer
  repeatedly creates long B grains at A's cadence. Pitch, levels, stored controls,
  existing envelopes, source regions and source audio are not rewritten.

The ceiling is still an overload guard, not unlimited polyphony or a physical
phone CPU guarantee. Very large chords/settings can reach it; normal sustained
notes, four-note maximum-smoothing chords, six-note default chords and mixed
20/500 ms layers are covered by continuity tests. Existing intentional keyboard
Decay, Arp note length and short/cropped source limits still apply.

## Saved Songs

New enabled-granular playback renders carry `grainVersion: 2`. Manual Arm detects
older enabled-granular renders and rebuilds playback through the same app engine
on the device or the existing server preparation branch. No automatic Arm is
introduced. The backend accepts legacy marker 1 and current marker 2, advertises
`grainSustainRenders: 2`, and rejects unsupported versions. Non-grain renders remain
compatible. Song revisions, editable source archives and recorded K WAVs remain
unchanged; a frozen recording of earlier staccato audio cannot be repaired by
changing the synth scheduler.

## Verification

Run from the repository root:

```sh
node --test tests/grain-sustain.test.js tests/song-beta.test.js tests/song-server-arm.test.js
python3 -m unittest discover -s tests -p test_song_backend.py
python3 -m unittest discover -s tests -p test_song_server_arm.py
node tests/grain-sustain-browser.cjs
```

Set `MYGRAIN_GRAIN_BASELINE` to an exact backed-up pre-change `index.html` to
include the previous engine's failure in the PCM comparison. Browser PCM uses
native Web Audio envelopes/sources with a deterministic scheduling clock; source
cleanup disconnects are delayed until offline rendering completes. This is
complemented by real-time AudioWorklet captures of the full app.

Start the disposable loopback account/Song server and run:

```sh
python3 tests/song-beta-test-server.py 18930
MYGRAIN_TEST_URL=http://127.0.0.1:18930/mygrain/ node tests/grain-sustain-app-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18930/mygrain/ node tests/grain-sustain-song-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18930/mygrain/ node tests/grain-keyboard-ready-browser.cjs
```

PCM continuity is tested at 44.1/48 kHz in Chromium/WebKit. Full-app captures use
390x844 portrait and 844x390 landscape, check sustained mono/chord output in 10 ms
blocks, zero retained sources/capture connections after stop, and no horizontal
overflow. The Song test seeds a v1 playback render, manually Arms to v2, checks
non-silent PCM, unchanged source SHA/revision, warm reuse and zero memory
reservations. Exhausted-pool recovery and backing-role isolation remain covered.
Tests use disposable accounts only, never a user's original Songs. Phone tests
are emulation, not measurements on a physical iPhone.
