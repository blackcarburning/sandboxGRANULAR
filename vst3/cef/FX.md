# MyGrain CEF FX 0.1.0

Separate stereo VST3 effect: **MyGrain CEF FX**, CID
`2642D59B6C824E319ADE03F7B8562C10`, category `Fx|Filter`.
CMake target `MyGrainCEFFX` defines both `MYGRAIN_CEF` and `MYGRAIN_FX`.
It reuses the FX 0.4.0 Engine/FxTransport, stereo input/output, bypass parameter
100, fixed one-second reported PDC, effects-only DAW clock, native dry/wet and
MGX1 v2 project state. No DSP fork, new Song schema or render-version migration.
The existing plugins/CIDs/releases remain independent and byte-preserved.

The CEF 0.1.3 runtime/editor/native dialogs/keyboard/login are shared. The whole
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
Project capture/readiness transitions legitimately invoke the existing FX dry
fallback and must not be mistaken for a filter's frequency response.

Capture the store count before sending the native Store command: a small delta
can complete before its UI acknowledgement reaches the test. For input silence,
allow the fixed one-second dry delay PLUS the complete one-second RMS window to
drain. Persist per-route PCM metrics and the FX (not disconnected Bridge)
diagnostics on failure. Match real native processing, not only an analyser
upstream of the plugin's dry fallback.

## Silent FX clock

The helper installs an FX-only zero-input/zero-output automatic-pull worklet in
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
