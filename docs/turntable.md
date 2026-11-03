# T · Turntable

Sepia record-player card after Final Stage, before Wasp (flex order 98; Wasp 99).
T · Turntable appears in the shared desktop/iPhone Jump menu after Pan Lab.
There is deliberately no Turntable shortcut in the iPhone edge controls.

## Sound and routing

The final compressor's stable output feeds a unity routing junction. When T is
OFF it connects directly to that junction; no Turntable worklet or modulation
sources are allocated. When explicitly enabled, one stereo AudioWorklet is
inserted before the junction. Wasp's final master insert follows it. Layer-level
Wasp cross modulation remains upstream in its existing locations.

`turntable-dsp.js` owns the DSP shared by the live engine and isolated Song deck:
fractional-delay wow/flutter, 50 Hz hum with a quiet 100 Hz harmonic, stochastic
click and dust envelopes, fine surface hiss, needle-dependent saturation, and
an age-dependent high-pass plus four cascaded low-pass stages. The 1920–current
year control narrows bandwidth progressively. Surface noise is intentionally
audible even without musical input when explicitly powered on. No animation
clock, analyser, noise oscillator or UI timer runs for this card.

## State and safety

- First page load/reload always starts T OFF, regardless of stored power.
- Ordinary/Mega/Sparse, per-card randomisation and AI application switch T OFF.
  EQ protection does not protect T power. Rejected/cancelled operations do not
  switch it off before their existing authorization/history boundary.
- Control changes and power participate in existing draft Undo/Redo.
- Patch snapshots store `turntable`; full state/Song snapshots use
  `modes.turntable`, version 1. Missing legacy settings default to bypass.
- Explicit saved-patch/history/Song recall preserves deliberately saved power;
  changing any sound control alone does not enable T.
- Bypass disconnects the processor, asks it to dispose its delay/filter storage
  and closes its port on acknowledgement. Context disposal releases all owned
  links. Processor/module errors restore direct audio and expose a status error.

## Song rendering

The current engine is used by both browser and server Song preparation. Module
preload and the asynchronous restore barrier complete before capture. Render
cleanup releases T independently of the shared parent context. Delay memory is
included in preparation estimates. Backend validation rejects invalid ranges and
needle identifiers. Active T settings add `turntableEngineRevision` to the content hash: revision 2
when wow or flutter is nonzero, otherwise revision 1. Bypassed T metadata is omitted, so unchanged pre-T renders remain
reusable. No source ZIP migration or production Song rewrite is required.

## Verification

- `node tests/turntable.test.cjs`: real PCM for age, needles, wow, flutter,
  hum, clicks, crackle, stereo coherence, finite output and disposal.
- `python3 -m unittest discover -s tests -p test_turntable.py -v`: backend
  validation, legacy/bypass cache equivalence and active cache invalidation.
- `node tests/turntable-browser.cjs`: isolated test account on port 19083,
  Chromium/WebKit at 320/390/844px, touch power, preset/Song state, OFF/ON cycles,
  generation and protected-EQ AI OFF rules, reload OFF and page errors.
- `node tests/turntable-song-browser.cjs`: same isolated account, real server
  jobs for a current enabled-T part and a legacy archive without T; audible
  low-frequency retention and treble ageing, warm-cache reuse, PCM playback,
  unchanged immutable sources, zero reservations and removed render frames.

Browser emulation does not establish physical iPhone audio/thermal behavior.

## Audible pitch range (PITCH.2)

Wow delay excursion is 18 ms × amount, flutter is 1.2 ms × amount.
The causal centre moves from 8 to 26 ms with the greater smoothed control;
zero modulation retains the original 8 ms delay and identical PCM. The existing
80 ms ring still bounds memory. Typical 440 Hz measurements at the unchanged
default controls: wow 22% is about −30/+26 cents, flutter 14% about ±18 cents.
Each control at full scale spans roughly 250 cents peak-to-peak.

Native worklet PCM checks: `node tests/turntable-pitch-browser.cjs` (Chromium
and WebKit). Real server current/legacy pitch fixtures: `node
tests/turntable-pitch-song-browser.cjs`. Both use the isolated port-19083 store.
Active pitch-modulated parts use content revision 2; disabled T and active T
with both modulation controls at zero retain their existing cache identity.
