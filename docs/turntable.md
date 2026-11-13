# T · Turntable

Sepia record-player card after Final Stage, before Wasp (flex order 98; Wasp 99).
T · Turntable appears in the shared desktop/iPhone Jump menu after Pan Lab.
There is deliberately no Turntable shortcut in the iPhone edge controls.

## Sound and routing

Route defaults to **Whole mix · includes drums**. The final compressor's stable
output feeds a unity routing junction, followed by Wasp. Direct Out drums,
sidechain-kick bypass audio and the separate drum effect returns already reach
this master insert; Direct Out only bypasses earlier processing.

**Drums only · dry + returns** bypasses the master T insert and instead inserts
T on the main drum bus, the sidechain-kick bypass bus and drum FX return. Each
branch is processed once, with clock-aligned wow/flutter. Surface noise is added
only on the main bus, avoiding tripled hum/click/crackle. Non-drum layers do not
pass through T. The drum return insert precedes latency/panning, so Pan Lab
rewiring cannot bypass it. Direct Out changes detach old route links first.

OFF directly connects all routing junctions; zero Turntable processors or
modulation sources remain allocated. Selecting a route alone never enables T.
Drums-only treatment occurs before shared final processing; Whole mix remains
the after-Final-Stage / before-Wasp insert. Routing is saved with the patch,
history and Song part. Missing legacy route defaults to Whole mix.

`turntable-dsp.js` owns the DSP shared by the live engine and isolated Song deck:
fractional-delay wow/flutter, 50 Hz hum with a quiet 100 Hz harmonic, stochastic
click and dust envelopes, fine surface hiss, needle-dependent saturation, and
an age-dependent high-pass plus four cascaded low-pass stages. The 1920–current
year control narrows bandwidth progressively. Surface noise is intentionally
audible even without musical input when explicitly powered on and the live
composition transport is running (isolated renders retain saved T processing). No animation
clock, analyser, noise oscillator or UI timer runs for this card.

## State and safety

- Page reload retains saved T power and all Turntable settings. Fresh devices still default OFF.
- Ordinary, Sparse, per-card randomisation and AI application keep T OFF. Mega randomises settings and independently chooses T ON/OFF (50% each).
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
needle identifiers. Active T settings add `turntableEngineRevision` to the content hash: revision 3
for Drums only; Whole mix retains revision 2 when wow or flutter is nonzero,
otherwise revision 1. The default mix route is omitted from hashing, preserving
existing active-T cache identities. Bypassed T metadata is omitted, so unchanged pre-T renders remain
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

## Drum-route verification

- `node tests/turntable-drums-browser.cjs`: native Chromium/WebKit PCM through
  real main, Direct Out, sidechain-kick and drum-return graph junctions;
  non-drum isolation, exclusive route processors, route changes and cleanup.
- `node tests/turntable-drums-song-browser.cjs`: actual kick sample scheduling
  through real isolated server jobs, current Drums only versus legacy Whole mix
  with no route metadata; pitch analysis, warm reuse, playback and archive/hash
  preservation. No production Songs or accounts are changed.

## Surface-speed arm lever — 2026-11-04

Three detents: 33 (33⅓ RPM), 45 and 78. The arm-style control uses a native
three-step range input for keyboard access, explicit pointer tap/drag detents
(Safari does not reliably jump a native range track on touch), an RPM readout and a
visible pivot/metal lever. The committed value is captured before asynchronous
Undo snapshot work so a UI refresh cannot replace the chosen detent.

`rpm` is additive in version-1 Turntable state, defaults to 33, and survives
patches, Song snapshots, Undo and local reload (including saved power).
Only click/scratch and dust event density/decay change: relative rates are 1,
1.35 and 2.34. Music base tempo/tuning, mains hum, routing and output are unchanged.
Wow/flutter cycle speeds now follow the lever as described below. Decay coefficients are computed once per audio block; no extra
buffers, nodes, timers or bypass work. Legacy/default 33 PCM was compared
bit-for-bit with the backed-up DSP over 512000 stereo frames.

The shared worklet DSP is used by the live and isolated Song render engines.
The existing Song clock/adapter preloads Turntable before timed capture; server
worker uses this same engine. Backend validates only 33/45/78, defaults missing
RPM to 33 and omits explicit 33 from content hashing, retaining legacy freezes.
45/78 are included in enabled-T content hashes; bypassed T remains omitted.
No blanket render revision bump or source-archive migration is needed.

Tests: `turntable.test.cjs` checks transient density, faster decay, stereo,
unchanged music and legacy PCM; `test_turntable.py` checks validation/hash
compatibility. `turntable-browser.cjs` checks detent keyboard/touch input,
320/390/844 layouts, patch/Song persistence, reload, power and graph rebuild.
`turntable-rpm-song-browser.cjs` sends current 78 and missing-RPM legacy 33
snapshots through real cold server jobs; verifies faster surface transients,
warm reuse, phone PCM playback, untouched source hashes/revision and cleanup.


### RPM-linked wow/flutter — T-RPM.2

Wow and flutter cycle frequencies track platter speed at 1× / 1.35× / 2.34×
for 33⅓ / 45 / 78 RPM. Amount settings are retained. A separate integrated
rotational phase preserves phase continuity when the lever moves, while mains
hum stays at 50/100 Hz on its independent wall clock. At 33 the DSP remains
bit-identical to the preceding engine; missing-RPM legacy states keep 33.
No added timers, audio nodes or buffers. Main music tempo/base tuning stays
unchanged; the intended wow/flutter pitch movement follows RPM.

Song rendering shares this same DSP through the isolated deck/clock/adapter
and server worker. Enabled 45/78 snapshots with nonzero wow/flutter use render
revision 4, selectively regenerating the now-different freezes. Bypassed T,
33 RPM, and 45/78 with both modulation amounts zero retain their hashes.
Source ZIPs are never rewritten. Seven backend tests cover this selective
compatibility boundary. PCM tests identify each modulation's dominant frequency
at all detents and verify no phase reset when moving the lever. The real-server
`turntable-rpm-wow-song-browser.cjs` checks modulated 78 versus legacy missing-
RPM 33, warm-cache reuse, phone PCM playback and unchanged hashes/revision.

### UK/EU and US mains hum — T-MAINS.1

`mainsHz` is an additive version-1 setting: 50 (default/legacy) or 60. A numeric
selector saves it in patches/Song/local state with the existing Hum amount.
The worklet generates fundamental + 17% second harmonic (50/100 or 60/120),
independently of RPM, using a continuous phase offset when switching frequency.
The existing .009 peak fundamental at Hum 100% is unchanged; at default 12%
measured hum-only RMS is -62.218 dBFS before downstream app gain. This can be
masked by music; it is not evidence about the listener's headphones. UI notes
suggest T ON and raising Hum to audition. No gain boost or extra nodes/timers.
Legacy 50-Hz PCM is bit-identical over 256000 stereo frames.

Server uses the same preloaded worklet via Song clock/adapter/isolated deck and
server-arm worker. Backend validates 50/60, treats omission as 50, omits default
50 from content hashes, and ignores frequency differences when Hum is zero.
Audibly enabled 60 Hz changes its hash naturally, without blanket invalidation
or source ZIP migration. Browser tests cover numeric selection, 320/390/844
layouts, patch/Song/reload, power, random/AI bypass and rebuild in Chromium and
WebKit. DSP tests measure both fundamentals/harmonics and RPM independence;
backend tests verify legacy and silent compatibility. Real server tests in
`turntable-mains-song-browser.cjs` verify current 60 and missing-field legacy 50
WAV spectra, warm reuse, phone PCM playback and unchanged source revisions/hashes.

## Transport monitoring (2026-11-13)

Live Turntable is temporarily bypassed while the composition transport is stopped,
including the shared sample-browser Stop button. Play restores its native or
Cooking Pot processor without changing saved power, recipe, inputs or solos.
Sample/card auditions alone do not reopen T. `effect-output.js` owns the transient
gate; `syncPerformanceControlState` publishes actual running sequencer, arp,
loop, drum, Q and Song state. Offline contexts and the isolated Song render deck
ignore the monitoring gate, so saved T processing and existing render revisions
remain unchanged.

Regression checks: `tests/turntable-transport-w-browser.cjs` measures final
PCM in Chromium/WebKit phone/desktop (native mix, drums and A input; the same
three in Cooking Pot), stopped sample auditions, repeated Stop/Play and W
Loop Store manual recut/persistence. `tests/turntable-transport-song.cjs`
checks actual current/legacy server PCM, warm reuse, source hashes/revision,
phone playback and memory cleanup. `tests/test_w_loopstore.py` checks backend
repository admission and historical digest preservation. `global-solo.test.cjs`
also checks transport-neutral saved settings and offline/wrapped render contexts.
