# iPhone Low Power: live-only quality

Build `v2026.11.15.LOW-POWER.1` extends the retained device/account preference to
newer effects. It is MYGRAIN live quality, not an OS battery setting or an offline
mode. Normal/full-quality DSP algorithms and serialized patch settings are unchanged.

## Quality boundary

`mygrainPower.isLive(context)` accepts only the current live editor context,
unwrapping native-context proxies. OfflineAudioContext (including one temporarily
assigned to the editor variable), other contexts and every `__mygrainSongRenderDeck`
are excluded. `divisor(context)` is 2 only at this boundary, otherwise 1. Never
serialize a quality flag or infer render quality from `active` alone.

Acoustic/Heavy Lifter, Resonator, Turntable, Wasp/Playground and effect-control
worklets receive quality separately in processorOptions. `dsp-quality.js` runs
the existing engine at half its context sample rate, sends half as many samples,
filters input with a 17-tap windowed-sinc anti-alias FIR, then linearly reconstructs
stereo and sidechain outputs. Clocks/frame offsets use the effective engine rate,
so tempo and physical delay times are not divided/multiplied. This deliberately
reduces high-frequency live fidelity. Full mode delegates original arrays and frame
offsets directly to the unchanged engine: no filtering or reconstruction.

Heavy Lifter analysis/kernels are Worker-prepared for the effective engine rate;
full-rate render assets have separate existing cache signatures. Do not recompile
kernels in the real-time callback. Shared insert branch identity additionally
includes live quality, causing an explicit mode change to replace its processors
without changing source recipes, powers, source membership, routing or transport.
Preserve the source-Solo isolation contract and processor retirement acknowledgements.

Existing native reverb helpers now bound live impulses to mono/0.75 seconds.
Loop/card filters use at most one 12 dB stage; the main existing reduced-stage and
no-oversampling policies remain. Main optional audio modulation updates at 100 ms
instead of the normal cadence; musical transport/scheduling clocks are unchanged.

## Renders and compatibility

Every offline/export and isolated/server Song render uses full quality regardless
of the editor's remembered mode. This is not a saved-state or cache-format change:
no compatibility version bump and no source ZIP/revision rewrite. Existing frozen
full-quality audio stays reusable. If adding a future DSP consumer, pass the
context-bound quality separately and test both offline and borrowed real-time
render decks before enabling reduced processing.

## Phone controls

Reuse the original lightning control, directly below Top in the Jump list. It has
an accessible On/Off label, a 44 px minimum target and explanatory render text.
The startup/toggle reminder is green for ON and amber for OFF, not the same colour.
Drums and GENREator precede Keys and Actions below the render/browser shortcuts on
phone widths; desktop retains its existing priorities. Resize never clones the
canonical controls or duplicates their listeners.

## Verification

- `tests/dsp-quality.test.cjs`: exact full-quality delegation, half-rate work counts,
  clock units, anti-alias rejection, stereo/multibus isolation and bounded buffers.
- `tests/iphone-low-power.test.cjs`: account/device persistence, ineligible devices,
  render guards, accessible icon/colours and no randomizer reset.
- `tests/low-power-live-browser.cjs`: isolated authenticated Chromium/WebKit phone
  portrait/narrow/landscape UI, real native processors/Heavy assets, nonzero wet PCM,
  repeated quality toggles, unchanged settings, offline guard and reload.
- `tests/low-power-benchmark.cjs`: deterministic work counts and indicative Node CPU
  timing across four acoustic and six Heavy modes. Not watts or physical phone CPU.
- `tests/low-power-render-song.cjs`: identical wet parts captured with live quality OFF/ON, real server renders, unchanged source hashes/revisions and warm phone reuse.
- `tests/low-power-render-pcm.cjs`: independent before/after isolated static origins (`BASELINE` / `BASE`) and full-quality PCM with the after editor Low Power ON.
- Run existing source-Solo PCM/live/Song regressions and exact baseline full-quality
  renders; live-only quality must never leak into portable or server audio.

Browser phone emulation does not establish physical iPhone thermal/battery savings.
