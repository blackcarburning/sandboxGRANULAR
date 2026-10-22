# L independent reverb

L samples, held sample keys and L-role synth voices use a private lane:

`L voice/filter → L delay → L dry + room reverb → mirrored master effects → stereo splitter`

The normal master lane still serves all other sources. L never connects to
`finalReverbPreDelay`, the overall convolver or its wet return, in either pre-
or post-filter FX placement. Both lanes rejoin before shared stereo modulation,
output pan, compressor, sidechain, amplifier and recording taps.

The private lane follows the existing master gain, HPF/LPF, legacy drive,
phaser, tremolo, final drive, ring and delay controls. Its modulation nodes use
the same LFO sources, without creating or restarting oscillators. L synth voices
also retain the shared synth drive/filter/output settings before L's local bus.

## Controls and compatibility

The four `performanceBastardLoopLReverb*` ranges are ordinary saved sliders:

| Suffix | Default | Range |
| --- | --- | --- |
| Mix | 0% | 0–100% |
| Size | 45% | 0–100% |
| Decay | 55% | 0–100% |
| Tone | 6400 Hz | 800–12000 Hz |

Older patches, presets and Song parts default to dry L, rather than inheriting
another patch's room. No export schema version changed. Song render decks load
the same lane; the public asset allowlist includes `l-reverb.js`.

## Runtime invariants

- Create the lane lazily; allocate a room convolver only when its mix is positive.
- Coalesce room impulse changes during drags and flush pending changes before live export.
- Use `effectParamTargets` to follow ramp targets, not freeze midway through ramps.
- Track drive curve revisions. Web Audio returns a new array on each `curve` read;
  comparing array identity would copy/rebuild waveshapers every modulation tick.
- Keep the shared compressor awake through the local delay/reverb deadline after notes stop.
- Preserve held-key auditions when transport stops; layer solo and master volume still gate L.
- Panic and engine reconstruction disconnect owned nodes and only L's shared-LFO edges.
- If adding a master processing stage, update L's mirrored topology as well.

Separate processing means nonlinear master drive acts on L independently of the
other layers. At heavy distortion this can sound different from distorting the
summed signal. This is the deliberate trade-off for keeping L out of the shared
reverb while retaining the other master controls.

Run `node tests/l-reverb-browser.cjs` against the disposable server on port 18891.
It checks graph reachability, real audio/tails, controls, node/curve stability,
Panic, engine reconstruction, old-state defaults, persistence, Song recall/freeze
and live export where the browser runtime provides MediaRecorder.
