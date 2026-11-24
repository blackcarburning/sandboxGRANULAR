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


## Hosted FX startup/continuity repair — 2026-11-15

Each FX page load/connection sends one Arm after its audio graph and saved-project
recall are ready. Native Arm state remains the authority for both the native
button and the in-app “FX armed” indicator. Explicit Stop in the current
connection is retained across clock ticks; it is not an always-on auto-arm loop.
A new page load/connection arms again, including a previously stopped snapshot.
No native binary/latency/state format changes or installer update are required.

Do not equate Undo/Redo journal busy with invalid audio. Journal capture and
background storage can run while the existing FX graph streams; withdrawing
ready or restarting silent modulation for ordinary edits resets/rebuffers the
return. Real restore/engine changes still gate readiness. Keep this distinction
scoped to the external FX endpoint, never Song/offline synth rendering.

Cooking Pot power mirrors use the same canonical setters as the effect cards
and retain normal history when available. If optional Song/history startup
failed, they use the same direct edit fallback as the cards, not an unchecked
runDraftEdit call. This fallback has no Undo journal until history is available.


## Shared bins, opt-in telemetry and Cubase rendering — 2026-11-15

Hosted build `v2026.11.15.PLUGIN-LIBRARY.1` adds account-private universal Parts
Bin snapshots, including creation/upload from FX sessions. See docs/parts-bin.md.
No native installer update is required; Store + reload app after storing edits.

Top → **Telemetry: Off** is off on every load. Selecting it collects numeric
pipeline metrics once/second and uploads an initial sample followed by batches
of five. It includes acknowledged plugin Arm/active/offline state, native epoch,
queue occupancy/drift/underrun/late/missing/input-drop counters, browser audio vs
wall-clock advance, UI timer delays/long tasks, scheduling misses, rate/latency,
heap size, error counts and completed project-transfer timing. These are timing
indicators, not hardware CPU readings or proof that a click occurred. No source
PCM, recording, patch, filenames, free-text logs, passwords or capability is sent.
Deselecting aborts pending uploads, drops the unsent bounded tail (up to five
seconds normally), removes observers/listeners and stops collection immediately.
A new selection is a new capture ID. Account lock/change and page exit stop it;
no opt-in or capture ID is saved in browser, patch, Song or DAW state. Failed
uploads are shown and three failures stop capture. No offline/background replay.
Server admission uses numeric/boolean/enumerated fields only, a 32 KiB request
cap, 10-sample maximum, per-account rate limit, idempotent batch identities and
at most 4000 batches; data older than seven days is pruned on next submission.
Storage is private per-account `plugin-library/telemetry.sqlite3`, not HTTP-readable.

Top → **DAW rendering** now explains the actual native boundary:
- CEF instrument / Bridge **Live** needs a real-time host clock; accelerated
  offline rendering has no browser packets and intentionally produces silence.
- **Rendered** holds a completed loop in native memory/state and reads it at the
  DAW's musical position, including offline callbacks. The new preparation action
  uses the existing renderer/upload, waits for a new acknowledged revision, Arms,
  and waits for completed project Store. Save the DAW project normally. The loop
  repeats; refresh after sound changes. This is a patch snapshot, not arrangement
  rendering or a recording of external track input.
- **CEF FX** remains real-time-only. Offline callbacks output one-second aligned
  dry, not the Chromium effect return. Do not remove its offline guard or block
  the real-time callback to disguise this architectural boundary. There is no
  accelerated offline FX engine in this build. In Cubase use File → Export →
  Audio Mixdown → Real-Time Export and reimport the WAV, or record the processed
  output to another audio track in real time. Include the intended effect tail.

Steinberg's Real-Time Export control:
https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/export_audio_mixdown/export_audio_mixdown_options_r.html
No native audio/DSP, PDC, preview, state envelope, factory CID or installer bytes
are changed by this hosted UI/storage feature. Server Song synthesis/rendering
and source compatibility remain unchanged; the new dialog is excluded from
ordinary capture/control journals.
