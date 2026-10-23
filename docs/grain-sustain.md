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
Decay (when Grain Sustain is Off) and Arp note length still apply. Source regions
wrap in GRAIN.4 rather than truncating each grain to the remaining region.

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

## GRAIN.4 — region loops, held sustain and audible LFO depth

- Each actual granular BufferSource loops inside its selected source Start–End
  region, including grains longer than that region. The scan traverses the full
  region and wraps; grain Size no longer truncates to the available tail. Pitch
  and Preserve Duration still determine read rate/duration. No source WAV is edited
  or copied; the 96-real-source ceiling and existing lookahead remain unchanged.
- The existing raised-cosine grain envelope now also smooths internal loop joins
  with short (up to 3 ms) zero-slope splice dips. Overlapping grains retain their
  existing blend/smoothing/cadence; full source gain and recording routes remain.
- **Grain Sustain: On** is next to Keyboard Decay. It sustains held granular notes
  until key-up/Release; it does not turn Sample/Piano/Strings into looped instruments.
  Off restores the shared Keyboard Decay fade for new grains. Turning On recovers a
  still-held grain note whose timed fade has ended. Arp/Seq note gates and Panic
  still end notes. Toggling does not restart source scan phase.
- The existing `performanceGrainModAmount` control is moved into the grain LFO
  group and labelled **Grain LFO Depth** (0–100%, existing value retained). It is
  not a second independent depth. Global Mod Amount and LFO 1/2/3 Depth remain
  multipliers. Zero depth stops modulation, not sound. Start, End, grain Size and
  source Size scales now allow 65% of their full slider range per full-depth LFO,
  with INV and normal bounds/valid-region guards. At defaults (global 55%, grain
  75%, LFO 50%), a centred Start/End sweeps 26.8125 percentage points peak-to-peak
  rather than 2.475. No routes are implicitly enabled or deliberately-zero depths
  raised. Start/End routes are also admitted by preset validation.
- Browser state uses `state.modes.grainSustainEnabled`; exported presets use
  `grainSustainEnabled`. Absent values default On, explicit false remains Off.
  Existing source paths, recorded K audio and original Song ZIPs are unchanged.
  Manual Arm refreshes old enabled-grain playback to `grainVersion: 5`; backend
  accepts versions 1–5 and advertises `grainLoopRenders: 5`. No automatic Arm.

`tests/grain-loop-browser.cjs` runs the real app with disposable localhost accounts
using Chromium/WebKit portrait phone emulation. It compares the exact pre-change
HTML via `MYGRAIN_LOOP_BASELINE`, tests native looped grain PCM after the sample
end, held sustain beyond keyboard decay, release and timed decay, depth/INV and
all three LFOs, actual BufferSource start/end/duration changes, Undo/Redo, preset
validation, old-state defaults and real Song amendment/recall/reload. Existing
control, scheduler/cap, native continuity and client/server Arm tests remain.
