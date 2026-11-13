# MYGRAIN FX 0.1.0

Separate portable Windows x64 stereo VST3 effect, using the Bridge 0.5 native
editor design and its changed-only, double-buffered repaint behaviour. The
released Bridge instrument and downloads remain unchanged. FX class ID:
`80192C741FCA4FA0A638DE42F66C7D18` (`Fx|Filter`).

## Audio / timing

DAW insert → loopback WebSocket → Worker → input AudioWorklet → selected live
MYGRAIN graph → return AudioWorklet → Worker → same native plugin. No public
audio relay, virtual cable, helper application or browser device capture.

The native callback timestamps every stereo input frame with its monotonically
advancing processor sample clock (not DAW project position). Returned audio is
resampled back to that input frame coordinate and presented exactly `round(rate)`
frames later. `getLatencySamples` reports that fixed delay. One second is a
deliberate preview stability budget, not a claim of low-latency monitoring.

Input uses 120 ms initial prefill and bounded ±5000 ppm occupancy correction.
An inverse resampler uses the *actual* source positions consumed in every
browser quantum, so clock correction does not change native PDC. The input and
return processors share only a context-local mapping/history; a second, silent
graph dependency guarantees their order without an audio graph cycle. Main
routes subtract the common compressor's 6 ms and active calibrated oversampled
shaper latency from the return coordinate. Effect phase, reverb, musical delay,
and resonator tails are creative processing, not removed timing offsets.

Two native SPSC queues are each bounded to 262,144 frames; dry storage is
preallocated for 192 kHz. Neither callback allocates, destroys buffers, locks,
uses sockets, or calls the UI. Network-thread generation/length/rate/index checks
prevent stale data becoming current after reconnect or processing changes.
Return timestamps may have gaps, never overlap. Old returns are dropped; missing
ones use aligned dry rather than replaying stale samples. Wet availability
crossfades over 5 ms. Browser return uses eight recycled 1024-frame buffers;
input delivery is credit-bounded to 32 outstanding packets. Backpressure fails
closed to the native dry path rather than growing a message queue indefinitely.

Native bypass, explicit Stop, disconnect, missing packets and offline callbacks
all retain the same one-second dry delay. Inactive host processing still means
no callback/audio, regardless of Arm. Arm is latched intent, never cleared by
lifecycle or reconnect. FX state is 16 bytes (magic `MGX1`, version, Arm/bypass
flags, dry/wet millionths); no connection capabilities or audio are persisted.
The controller restores bypass with component state; standard VST3 bypass is
the only host-exposed parameter. Input gain/route/mute are session controls.

## Routing and limits

The DAW Input card offers pre-filter, master, final-stage and direct injection,
input gain/mute/meters and native dry/wet. The final stage includes Turntable,
R and Wasp; R source **All** receives this signal. FX connection counts as an
active input in the existing final-bus idle gate, otherwise an external input
would be muted whenever MYGRAIN transport was stopped.

### Effects-only Arm / DAW clock (browser update FXCLOCK.1)

Arm temporarily gates the audible internal-layer branches **after** modulation
observations, without changing their canonical enabled, level or solo controls.
DAW Play starts the patch's enabled sources silently; host Stop, bypass, offline
or inactive processing pauses these sources but retains the armed mute. Explicit
Stop/disarm or Disconnect restores normal routing and resumes only the transport
groups that were running immediately before Arm. A patch edited/recalled while
armed retains its actual edits; no stale copy of mixer settings is written back.

The live transport and Playground Sync clocks use host BPM (1–300, including fractional
values); a missing musical clock falls back to the patch BPM, visibly labelled.
Fixed-Hz and independently set BPM curves retain their explicit clock mode.
DAW loop/seek does not rewind the running patch sources. Browser scheduling is
buffered, not a promise of sample-accurate DAW-grid phase lock. Drawn Playground
and Wasp filter phases follow the scheduled browser transport start and freeze
when it stops. Audio-envelope/cross-modulation taps retain their source signals.

Wasp's two active cross-modulation routes are temporarily applied to the DAW
carrier, with their existing source/method/depth settings. Stored destinations
remain unchanged and take effect normally again after disarm. Direct return
bypasses this processing. R source **All** receives the DAW signal; individual
internal-layer R excitations are disconnected while armed to prevent additive
layer audio entering the return. R settings are retained, and its previous tails
are cleared on the mode transition.

Implementation boundaries: the lowest channel-EQ connection gates the audible
branch only, below Wasp/Noise/R taps; Noise's Wasp-direct branch and legacy
non-EQ instrument, L room mirror and drum-return paths are gated separately.
New voices created while armed inherit a closed gate. The override is limited
to the FX AudioContext: offline contexts and isolated Song decks remain normal.
BPM-based live LFO rates follow the host/patch tempo ratio without editing the
sliders. Canonical BPM controls and Wasp destinations are not overwritten or persisted
with the external runtime tempo/route. Shared effects can naturally retain their
existing delay/reverb memory when input routing changes.

Chrome's final output monitor is detached only while connected and restored on
cleanup. Same-tab Bridge/FX ownership remains rejected in both directions; the
native origin/capability checks and exclusive-tab lock remain mandatory.
Separate instances/tabs may coexist. External DAW feedback is not detectable:
do not connect the returned bus into its own sending input.

Real-time processing/printing only. Explicit VST offline mode returns dry,
not a misleading cached effect. One stereo bus, no sidechain, MIDI or external
automation of browser effects. 8–192 kHz, float32/float64. The two resamplers use
linear interpolation; this is preview-quality, not mastering-grade SRC.

## Saved Songs / server rendering

This is an external live endpoint, not a patch sound schema. The module returns
before initialization on phones and isolated render decks. No DAW dependency,
gain/route field, render-hash bump or source ZIP migration is introduced. Print
external material to audio and import it normally to include it in a Song.
Regression uses current resonators, genuine legacy no-R source, isolated real
server jobs, warm cache, phone-mode playback, normal WAV and source hashes.

## Build / release

Use the pinned SDK/toolchain in `../vst3/README.md` and build targets `MygrainFX`,
`fx-windows-host`, `bridge-fx-test`; the Bridge target is still separate. Put
`MygrainFX.vst3` into `MYGRAIN FX.vst3/Contents/x86_64-win/MYGRAIN FX.vst3`.
Generate moduleinfo with SDK `moduleinfotool`; normalize its JSON and module
name, then validate the *final bundle*. Package with `vst3/package_fx.py` using
the staged setup page and factual VERIFICATION.txt. Check PE exports/dependencies,
SDK validator, core no-allocation/impulse tests, and
`tests/daw-fx-windows.cjs` on the packaged DLL under Wine + isolated release-Origin
Chrome. These checks are not physical Windows/ASIO/commercial-host validation.

Only daw-fx JS/CSS assets and the exact versioned ZIP are public allowlisted.
Sources/tests/build/evidence stay private. ZIP HTTP response is attachment;
verify exact HTTPS bytes and actual setup/card browser downloads.

## Desktop navigation

The blue DAW Input panel sits directly after the Bridge/download panel.
`daw-fx.js` adds a desktop-only DAW Input jump next to the DAW export link in
the navigation grid. Its click opens the details before using the established
jump transition. `navigation-palette.js` maps it to the separate blue
`daw-input` palette, not the DAW export target. The jump/panel are not created
on phones or render decks; the jump is hidden below the 961px desktop dock.
This is presentation only; connection, DSP, Arm and saved schemas are unchanged.
