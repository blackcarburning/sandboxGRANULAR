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
