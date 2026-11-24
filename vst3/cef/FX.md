# MyGrain CEF FX 0.1.1

Separate stereo VST3 effect: **MyGrain CEF FX**, CID
`2642D59B6C824E319ADE03F7B8562C10`, category `Fx|Filter`.
CMake target `MyGrainCEFFX` defines both `MYGRAIN_CEF` and `MYGRAIN_FX`.
It reuses the FX 0.4.0 Engine/FxTransport, stereo input/output, bypass parameter
100, fixed one-second reported PDC, effects-only DAW clock, native dry/wet and
MGX1 v2 project state. No DSP fork, new Song schema or render-version migration.
The existing plugins/CIDs/releases remain independent and byte-preserved.

The CEF 0.1.4 runtime/editor/native dialogs/keyboard/login are shared. The whole
private Chromium runtime ships inside each bundle; the browser process is owned
by the component, not its editor. No external Chrome window is needed. As with
the CEF instrument, the app is the current hosted MYGRAIN app, requiring internet.
AppKit classes and bundle identifiers are distinct from the CEF instrument, to
allow both loaded in one DAW. Private instance profiles and parent-exit cleanup
are unchanged. Only the existing authenticated remembered-login store is shared.

The loopback server supplies #fx= rather than #daw=. Native Store/Reload select
mygrainDawFx from the original launch capability, never the always-present but
unconnected instrument API. Reload waits for acknowledged FX patch storage.
Input gain/mute/route/preferences are in the FX project snapshot; native
Arm/bypass/mix retain the original state bytes. The current shared FX page has
all existing effect controls; the native toolbar retains Arm/Stop/Store/Reload
and auto-store. No new DAW automation is promised.

The FX return worklet remains a silent destination, preventing doubled browser
monitoring. Independent browser previews use the CEF preview ring; host bypass
and offline processing discard that ring. Missing FX returns, Stop, disconnect,
and offline processing retain the original one-second aligned dry fallback.
No native CEF initialization, allocation, locks or network operations enter the
real-time callback. No app synthesis/Song engine is changed in this release.

## Build and release

See README.md for pinned CEF 156 and Steinberg SDKs. Build MyGrainCEFFX;
CEF helper target stays MyGrainCEF. stage.py, metadata.py and package.py take
--fx explicitly; without it they retain the existing instrument release behavior.
The macOS installer is generated for the distinct FX bundle and verified by CI.

.github/workflows/mygrain-cef-fx.yml builds Windows x64 and universal macOS 13+.
It runs the unchanged core FX impulse/PDC/rate/float/bypass/allocation tests,
CEF preview tests, SDK validator and a real native-host/CEF integration suite.
MYGRAIN_CEF_FX_TEST=1 selects fx_tests.cjs through the existing native-login driver.
The current checkout's public frontend and synthetic account routes are used;
no production account/repository is written. Worklet bytes are explicitly pinned.
Checks include PCM gain/mute/mix/routes/filter, host bypass/offline, native toolbar,
closed editor processing/auto-store, real reload and fresh project/settings recall.
No claim of physical DAW/device testing, native Intel runtime, international IME
or production multi-instance performance; Mac signatures are ad-hoc, not notarized.

## Integration fixture isolation

Use a deterministic patch for audio measurements: zero LFO/motion depths,
normalize mixer gains and explicitly turn unrelated effects off. Compare an
effect against its own route baseline rather than assuming every route has
Direct's amplitude. Pause periodic auto-store during DSP sweeps, then re-enable
it and verify processing/storage with the editor closed in a separate phase.
Actual project recall/engine replacement invokes the FX dry fallback. Ordinary
history journaling and background snapshots must NOT withdraw browser readiness
or reset the native PCM epoch; test their continuity separately from DSP sweeps.

Capture the store count before sending the native Store command: a small delta
can complete before its UI acknowledgement reaches the test. For input silence,
allow the fixed one-second dry delay PLUS the complete one-second RMS window to
drain. Persist per-route PCM metrics and the FX (not disconnected Bridge)
diagnostics on failure. Match real native processing, not only an analyser
upstream of the plugin's dry fallback.

## Silent FX clock

The helper installs an FX-only zero-output automatic-pull worklet in
the main interactive AudioContext. It generates no samples and changes no FX
DSP, mapping, latency or native callback. Chromium otherwise migrates a silent
output to its fake sink after 30 seconds, which is inappropriate for this
sample-timestamped return. Native integration keeps the browser output silent
and asserts continued processed PCM without UI gestures beyond that threshold.
The guard is disposed on navigation and recreated for a replacement context;
the CEF instrument does not install it. See `fx_clock.h`.

Chromium source rationale:
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/renderer/media/renderer_webaudiodevice_impl.cc
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webaudio/realtime_audio_destination_handler.cc
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webaudio/audio_worklet_handler.cc

## 0.1.1 focused Space passthrough

Shares the CEF instrument 0.1.4 Space routing: return unhandled from VST3
callbacks, native-window parent/responder fallback, duplicate/WM_CHAR suppression,
and editable focus reported by Chromium through private display/input IPC v3.
Text/password inputs, textarea and contenteditable retain ordinary spaces.
Replace the whole FX bundle with the DAW closed, then rescan; app reload alone
cannot update native keyboard handling. The instrument installers, FX DSP,
fixed one-second PDC, bypass/offline dry fallback and MGX1 v2 state are unchanged.
Native FX release tests run the same six focus cases before FX audio/state tests.


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
