# Effect-card LFOs and Liquidizer — 2026-11-14

## Contract

Five additive card panels follow the actual preset bank: WireWorld, Sonic Crystal,
Bubble Chamber, Bass Face and Mutilator. Heavy Lifter retains its existing shared
panel under Samples used, available on all six tabs. No unrelated cards move.
Eight Heavy LFO waveforms, 1/32 through two bars, dotted/triplet, depth and pulse
width are reused. Manual assignments are unlimited; Clear removes only that
card's assignments (Heavy Clear remains global across its tabs), preserving base
values, waveform and rate. No assignment list grows the panel.

Liquidizer in Cooking Pot chooses one to three numeric destinations on every one
of these six cards and randomizes their oscillator settings. It never changes
base recipes, sources, power, order, return routing or Master Baker. On Heavy,
common controls and the active tab are eligible; hidden tab assignments persist.
The oscillator itself remains shared across Heavy tabs. Big Stir retains the
entire existing LFO objects, including hidden Heavy assignments; absent optional
LFO state stays absent. Bubble is included in ordinary effect randomisation;
Liquidizer is the explicit LFO-only exception. An inert legacy Bubble control is
not selected. Modulating a new v2 control manually upgrades via the existing
upgrade path, just like moving the original control.

## Ranges (40 new destinations)

- WireWorld: dispersion, travel, feedback, damping, width, level — 0..1.
- Crystal: tuning, spacing, coupling, disorder, defect, loss, reflection, width,
  level — 0..1; cells steps 4/8/12.
- Bubble v2: radius, spread, decay, resonance, damping, fizz, motion, flow, width,
  level — 0..1; population steps 8/16/24.
- Bass Face: amount, tone, mix, body — 0..1.
- Mutilator: amount, tone, mix, resonance, sweep, freeDepth — 0..1;
  freeRate .125..12 Hz; output -18..+6 dB; cycleBeats .5/1/2/4/8.

The saved base is normalized to its actual min/max, then
`clamp(normalizedBase + depth * bipolarWave, 0, 1)` is mapped back. Thus full
positive and negative deflection reaches both endpoints from any base, not just
from the midpoint. Numeric selectors quantize across all choices. Routing,
presets, power, circuit type, direction and other nonnumeric switches are not
continuous modulation destinations. Rhythm-dependent parameters remain assigned
when their original mode is inactive but consume no work until applicable.
Mutilator sweep requires rhythm or free motion; freeRate requires free motion to
be audible. Liquidizer avoids selecting a known inert freeRate/sweep or Bubble
motion configuration. Explicit effect Off always wins; zero base return/mix/drive
may be lifted by an active assignment to that parameter.

## Timing and original processing

`effect-lfo.js` reuses Heavy's waveforms and musical period. Audio-time updates
run every 32 frames with the existing 1 ms control slew and bounded scheduled
clock history; no UI timers, new delay lines or FFT windows are inserted. Base
settings and effective controls are separate. Native, Cooking Pot and isolated
Song render contexts receive initial clocks through processorOptions and later
changes through MessagePort. UI-only modules do not run on render decks, except
the shared clock relay.

Acoustic bodies retain their input histories; setters update coefficients. Bass
Face/Mutilator retain native BiquadFilters, gains, body branch and pulse buffers.
Only assigned Amount uses a dynamically evaluated version of the exact sampled
legacy transfer curve, since native WaveShaper.curve cannot be automated. When
Amount is not assigned, the original native WaveShaper remains. The original
Mutilator 2x oversampling topology retains its existing 128-frame latency where
that path already uses 2x; non-oversampled paths add zero frames. Tests compare
all 30 Bass circuits and all 12 Mutilator strains, native versus dynamic shaper,
both rates and browsers, including impulse positions and 2x oversampling.

Chromium's primary implementation references for float32 curve interpolation
and the half-band resampler, with the original BSD notice retained in the worklet:
- https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/audio/wave_shaper_handler.cc
- https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/audio/up_sampler.cc
- https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/audio/down_sampler.cc

Cooking Pot keeps its legacy numeric-coefficient path unchanged without native
card LFOs. For active character LFOs, dry coefficients are audio-rate control
signals. Selected-source corrections are sums of products of coefficients,
never divisions (so full-wet zero coefficients remain defined). Owned factor
worklets are cached per source/expression and retired on route changes. Sum
inputs 16/17 carry Mutilator/Bass dry controls; existing wet ports and all other
public protocols are unchanged.

## Persistence and render cache

Each card owns optional `lfo` with Heavy's waveform/rate/timing/PW/depth schema and
an unlimited unique allowlisted `targets` array. Generic DOM slider/select saves
exclude panel controls. No-target/depth-zero state uses original DSP and cache
identity. Strict Python validation uses generated `backend/effect-lfo-schema.json`.
`mygrain_effect_lfo.py` and JS make the same audibility decisions, including zero
base, explicit Off, DAW exclusion and implicit D ownership. Acoustic capability 9
is required only for effective new audible modulation. Heavy capability remains
8; previously supported audio retains its existing capability. Stale 8 freezes
cannot satisfy a 9 source; source ZIP hashes/revisions are never rewritten.

## Verification entry points

- `MYGRAIN_LFO_BEFORE_ROOT=<before> node --test tests/liquidizer.test.cjs`
- `PYTHONPATH=tests MYGRAIN_BASELINE_BACKEND=<before>/backend/mygrain_songs.py python3 -m unittest test_effect_lfo test_acoustic_fx test_cooking_pot test_bass_face test_heavy_lifter_lfo`
- Isolated authenticated server: `tests/song-beta-test-server.py`; browser scripts
  `liquidizer-native.cjs`, `liquidizer-browser.cjs`, `liquidizer-song.cjs` use BASE,
  OUT, MYGRAIN_LFO_BEFORE_ROOT and disposable STORE as appropriate.

Native Bass's three float32 summation branches can differ by an addition-order
ULP between separately constructed graphs; reference tolerance is 1e-8 RMS.
Mutilator legacy reference is exact. Curve tests explicitly reproduce native
float32 virtual-index/interpolation arithmetic; they do not relax timing checks.


Native/Pot PCM identity is not asserted across different pre-roll/topologies.
A disposable depth-zero control measured the existing Bass selected-source
native/Pot difference at 0.03176 RMS; changing that processing is outside this
update. Mutilator retains its pre-existing native 2x versus Pot non-oversampled
paths. Time-varying acoustic delay coefficients and Bubble free flow also depend
on graph warmup. Instead, tests compare every native acoustic processor against
its shared engine with identical clock/input history (54 cases per browser),
check every native distortion curve/impulse against the original nodes (108
cases per browser), compare no-LFO paths with the pre-task implementation, and
verify the requested 0.1875-second BPM gating in both actual saved render paths.
Render-deck disposal explicitly releases its own LFO graphs; native node factory
calls retain the supplied context wrapper for its tracking/cancellation ownership.

### Liquidizer depth default

Liquidizer chooses each of its six LFO depths within 80–100%. Manual sliders
and saved recipes still support the full 0–100% range. Target count, hidden
Heavy tab assignments, base recipes, power and routing are unchanged.

## Cooking Pot global reset (2026-11-14)

Reset modulators beside Liquidizer clears every assigned target in Mutilator,
Bass Face, WireWorld, Sonic Crystal, Bubble Chamber and every Heavy Lifter mode
(including hidden tabs/common controls) in one Undo/Redo edit. Power, base recipes,
sample provenance, input/output routing, output volumes and oscillator settings
are retained. Empty assignments are an idempotent no-op. The existing canonical
setters and Liquidizer rollback/account guards are shared; busy/Song playback
blocks the button. JSON/ZIP/local saves use the unchanged LFO schema; no DSP or
render compatibility revision is necessary. Per-card Clear retains its scope.
