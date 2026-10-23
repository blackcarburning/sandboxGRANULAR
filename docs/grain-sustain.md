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

## GRAIN.2 — source controls and transport scan repair

GRAIN.1's DC / sine-from-zero tests proved continuity only. They did **not**
exercise the real source-window function or controls with a silent-leading sample.
The new actual-app PCM test reproduces the following on the exact GRAIN.1 backup:

- A/B Sample bypassed the visible card's persisted `grainAMicGrain*` /
  `grainBMicGrain*` controls. Position, Size, Attack and Release produced identical
  PCM at opposite slider settings. A/B Mic did read the bank.
- Release multipliers were applied before a hard 45%-of-grain limit. Typical
  1250 ms layer release on a 150 ms grain made 25–250% source Release identical,
  even in Mic mode.
- The 120 ms grain horizon was shorter than the sequencer/Arp note submission
  queue (350 ms). A future stream could be replaced before its first grain was
  admitted. A constant-note sequencer produced zero sources in the baseline test.
- Per-note scan origins kept returning to the sample's opening fragment on the
  sequencer/Arp. A positive position offset plus scan was clamped at the final
  grain rather than wrapping through the selected region.

GRAIN.2 changes:

- Sample and Mic on each A/B card share the existing persisted control IDs,
  without duplicate controls or a saved-state migration. A and B remain independent.
- The base grain envelope is fitted before applying source envelope multipliers;
  overlapping attack/release are then proportionally fitted within 95% of the
  valid source duration. Native envelopes still start/end at zero. Default 100%
  shaping is retained. Layer release also remains the held-note release time.
- Grain cadence uses the actual scaled/pitched/cropped sounding duration; it no
  longer leaves old-size gaps after reducing source Size. Minimum cadence is 6 ms;
  the hard 96-real-source guard remains enforced, including overloads.
- Sequencer/Arp grain streams use their shared transport horizon. Held-key streams
  retain the 120 ms queue. Independent A/B clocks and source accounting remain.
- Sequencer/Arp scan position is anchored to transport origin, not each note.
  Combined base position + scan wraps within valid source starts; jitter is
  clamped afterwards so negative jitter at zero cannot jump to the sample's tail.
- Manual Arm refreshes enabled-grain playback to `grainVersion: 3`.
  Backend accepts legacy 1/2 and current 3, advertises `grainControlRenders: 3`.
  Source archives, WAVs, Song revisions and recorded/frozen audio are not rewritten.

Run the additional regression using the disposable server described above:

```sh
MYGRAIN_TEST_URL=http://127.0.0.1:18930/mygrain/ node tests/grain-controls-browser.cjs
```

It uses the **actual full-app source resolver, layer controls, playback and native
Web Audio**, including low/mid/high offline PCM comparisons, silent-leading
changing-tone real-time captures of held / sequencer / Arp, and live slider input
without restarting a held note. It also checks Sample/Mic banks for both A/B,
saved settings recall and bounded Start/End windows at five playback rates with
both Preserve Duration settings. The saved-Song regression now checks all eight
A/B position/size/envelope settings on recall and upgrades stale playback to v3.

For a reproducible baseline, set `MYGRAIN_CONTROL_BASELINE` to a backed-up
GRAIN.1 `index.html`; only the disposable test page's HTML response is replaced.
Assertions for the expected repaired behaviour are disabled in baseline mode,
and the baseline PCM measurements are reported separately. Never replace live
files just to run a baseline.

Use `MYGRAIN_GRAIN_SERVER=1 node tests/grain-sustain-song-browser.cjs` to additionally
run the real isolated backend worker (Chromium) and verify the returned v3 render,
original SHA/revision, playback PCM and saved control recall. `MYGRAIN_CONTROLS_ONLY=1`
runs only control PCM / source-boundary / settings-recall checks without repeating
real-time transport captures.
