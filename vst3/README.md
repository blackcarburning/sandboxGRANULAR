# MYGRAIN Bridge — portable Windows VST3 preview

Version 0.5.0. Windows x86-64 instrument; no installer, helper EXE, registry
registration, audio cable or Windows service. Copy the whole `MYGRAIN Bridge.vst3`
bundle into the standard VST3 directory and rescan. User instructions are in
`../vst3-setup.html` and included in the ZIP.

## Architecture and ownership

- A non-distributable Steinberg `SingleComponentEffect` owns a bounded stereo
  queue, native editor and per-instance loopback WebSocket listener. A combined
  component is intentional: the listener and the native audio consumer share
  one in-process SPSC queue; there is no remote/distributed processor/controller.
- The listener starts only after the user presses Open Chrome / Copy code, not
  during a DAW scan. Only `127.0.0.1:18731–18762` is bound. Windows BCrypt creates
  a fresh 128-bit capability per instance. Release Origin is exactly
  `https://openclaw.blackcarburning.com`; only the standalone test fixture adds
  an explicit isolated test origin. Codes live in fragment URLs / memory, not
  patch state, server requests, DAW state or localStorage. The fragment is
  removed immediately once the module reads it.
- `daw-bridge.js` creates a desktop-only panel and binds the final amplifier.
  Idle routing is the exact prior direct edge. Connecting adds a silent capture
  worklet and removes only that direct monitor edge. Disconnect stops playback,
  tears down the worker/capture and restores it. Engine rebuild and account lock
  disconnect. The existing `window.mygrainDaw` exporter is untouched; this
  feature's API is **`window.mygrainDawBridge`**.
- The AudioWorklet uses eight reusable 1024-frame packets. A dedicated Worker
  owns the local socket and recycles packet buffers; the UI does not copy PCM.
  Browser network backlog and all native packet lengths are bounded. PCM is
  little-endian float32 stereo, never compressed or sent to the public server.
- Only the DAW thread consumes/resets the SPSC queue while processing. Network
  frames carry generation tags, so a packet racing a reset cannot become a
  valid packet in the next generation. Invalid floats are sanitized. No mutex,
  allocation, socket, file IO or UI call occurs in `Engine::process`.
- Host callback timing chooses the next musical bar at least one second ahead.
  The browser plans transport on an exact audio sample, then begins capture
  after the measured final-graph processing delay, matching Rendered/WAV's
  audible origin. Both render ahead of the selected host target. The native
  reader presents that first audible-origin frame at the host target,
  independently of browser message delivery jitter. Starting capture at the
  uncorrected transport origin inserted the compressor's approximately 6 ms
  lookahead (288 samples at 48 kHz) into Live recordings. This browser-side
  correction requires a page reload, not a plugin reinstall. Live still uses
  independent clocks and bounded drift correction; it is not sample-locked.
- 350 ms is the intended browser lookahead, not guaranteed measured roundtrip
  latency. At first valid playback the consumer calibrates its queue target to
  actual prefill. Linear interpolation converts sample rates; a slow bounded
  ±2000 ppm occupancy correction addresses clock drift. This is preview-quality
  resampling, not a mastering-grade offline converter.
- There is no audio input path. `getLatencySamples()` is zero intentionally:
  output is an explicitly scheduled source whose first frame is already placed
  at the host target. Reporting browser prefill as input-path PDC would apply a
  second timing offset. Live control changes still arrive after buffering.
- In Live, stop, meter/tempo changes or starvation invalidate the old generation;
  re-arming on a future bar can cause a gap. ALL host loops/seeks preserve the
  live generation and queue, including hosts with absent/invalid cycle metadata.
  Live is a continuous performance, not a timeline rewind. Continuous tempo ramps and
  fractional BPM are not supported (the browser's existing BPM model rounds to
  integers). Missing musical host timing is explicitly reported.
- 32/64-bit audio processing is supported. Explicit VST offline mode is silent for live streaming, but supported for prepared playback.
  The editor may close while the component/listener remains loaded. Processing
  deactivation clears transient live streaming, never the user's Arm choice.
  Both modes retain Arm across processing/offline reconfiguration, but manual
  audition stops and needs Play again. DAW state contains a bridge version and Arm preference, no browser
  credentials, source audio, connection capability or MYGRAIN patch.

## Build

Pinned SDK: `https://github.com/steinbergmedia/vst3sdk`, commit
`3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96` (3.8.1), with its pinned submodules.
The SDK and downloaded build dependencies are not served by the MYGRAIN route.

On Linux, install CMake, `g++-mingw-w64-x86-64-posix` and Git. The standalone
Linux fixture additionally needs `libssl-dev`; the release DLL uses Windows
BCrypt, not OpenSSL. Then:

```sh
git clone --recurse-submodules https://github.com/steinbergmedia/vst3sdk.git /tmp/mygrain-vst3-sdk
git -C /tmp/mygrain-vst3-sdk checkout 3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96
git -C /tmp/mygrain-vst3-sdk submodule update --init --recursive
cmake -S . -B /tmp/mygrain-bridge-win \
  -DVST3_SDK_ROOT=/tmp/mygrain-vst3-sdk \
  -DCMAKE_SYSTEM_NAME=Windows \
  -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc \
  -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
  -DCMAKE_BUILD_TYPE=Release -DMYGRAIN_BUILD_VALIDATOR=ON
cmake --build /tmp/mygrain-bridge-win --target \
  MygrainBridge bridge-core-test bridge-windows-host validator moduleinfotool -j 4
```

With Visual Studio, configure with `-A x64`, omit the Linux compiler/system
options and build `--config Release`. That compiler path is provided but was
not tested in this release. MinGW compilation omits the SDK's **unused**
DataExchange source, whose allocator helper assumes MSVC on Windows; this does
not patch the SDK or remove any interface used by this plugin. SDK utilities
need MinGW's `-municode` entry point. All C++/GCC/pthread runtimes are statically
linked; imports must remain Windows system DLLs only.

Bundle layout:

```text
MYGRAIN Bridge.vst3/
  Contents/
    x86_64-win/MYGRAIN Bridge.vst3
    Resources/moduleinfo.json
```

Create metadata with the pinned SDK `moduleinfotool -create -version 0.5.0
-path <bundle> -output <bundle>/Contents/Resources/moduleinfo.json`. Normalize
its trailing-comma JSON to strict JSON and set bundle Name to `MYGRAIN Bridge`.
Validate the final bundle, not only the unbundled DLL.

## Verification

The test host and standalone fixture are test tools; neither belongs in the
release ZIP. `bridge-core-test` explicitly undefines NDEBUG even in Release.

- Core: bounded/wrapping queue, non-finite samples, scheduled target, disconnect,
  seek, offline silence, starvation re-arm and 44.1→48 kHz resampling.
- `../tests/daw-bridge-browser.cjs`: real Chromium live patch -> native fixture,
  monitoring isolation, re-arm/account disconnect and phone non-activation in
  Chromium/WebKit. Runs only against loopback with a dedicated account store.
- `../tests/daw-bridge-windows.cjs`: actual release DLL under Wine, native editor,
  Chrome -> WinSock/BCrypt -> DAW callback PCM, host transport transitions and
  unload. `MYGRAIN_STREAM_TEST_SECONDS=180` selects the longer stream check.
  It uses a dedicated TLS fixture on 19110 and Chrome host-resolver mapping,
  proving the release Origin check without using production account APIs. A
  response marker asserts that only the isolated server served the page.
- `../tests/daw-bridge-song-browser.cjs`: five real isolated server render jobs
  (four current resonators and a genuine legacy source), warm-cache reuse,
  phone-mode prepared playback, final WAV and unchanged source ZIP hashes.
- SDK `validator.exe`: run on the exact packaged Windows bundle under Wine.
  SDK format tests deliberately try out-of-range sample rates; individual
  `ERROR` diagnostic lines are expected for unsupported rates. Use the final
  pass/fail summary and exit status.
- Wine 9 on this host required a clean inherited environment (`env -i
  PATH=/usr/bin:/bin WINEPREFIX=<temporary-prefix> WINEDEBUG=-all ...`);
  otherwise Wine itself aborted before loading a PE file. This is not a
  plugin runtime dependency. Xvfb supplies the native test editor's desktop.

These checks do **not** establish actual Windows hardware/driver/DAW behaviour,
recording alignment, commercial-host certification or zero-latency performance.
The shipped VERIFICATION.txt must state actual checks and these remaining gaps.

## Saved Songs / export compatibility

The bridge is an optional live-output routing endpoint, not a sound-state or
DSP schema change. It returns before initialization in isolated Song render
decks and on phones. It does not add patch fields, change sound settings when
idle or bump render compatibility hashes. Existing server preparation continues
using the current engine. No source ZIP migration or cache invalidation is
necessary. Frozen Song playback and separate media previews are not captured in
this preview; only the live editor's final amplifier is bridged.

## Publication and rollback

Only `daw-bridge.js`, `daw-bridge-worker.js`, `daw-bridge-worklet.js`,
`daw-bridge.css`, `vst3-setup.html` and the exact versioned release ZIP are added
to the MYGRAIN public-file allowlist. The ZIP response has
`Content-Disposition: attachment`; do not expose the source/build/test tree.
Verify public 200 responses and byte-for-byte equality before handing out links.

The index integration is limited to the optional output binding, a connected
focus-loss guard, build label and account-managed module/style loader. Backups
and per-task diffs live in the task's private output evidence directory. Restore
only this task's deltas rather than replacing an already-dirty checkout from Git.

## 0.2 transport correction: prepared DAW loop

Instant timeline-zero audio cannot be obtained by asking a real-time browser to
start after the DAW callback has already begun. The original future-bar start
remains explicit in live mode. The optional prepared mode captures a selected
1/2/4/8/16 x four-beat duration through the existing final-mix WAV capture engine
before Play. No patch fields or server render signatures change. The native
processor reads immutable stereo PCM by host quarter-note position modulo the
prepared beat length: first callback at zero, arbitrary seeks, host cycle wraps
(including nonzero starts/in-block boundaries), stopped audition and offline
callbacks need no browser-clock refill. Tempo changes change pitch/speed; there
is no time-stretch or live editing in prepared mode. Refresh explicitly after
patch edits; cached PCM is RAM-only, never embedded in VST state.

Host cycle flags/endpoints are requested via needCycleMusic. A live discontinuity
is treated as a wrap only when previous expected PPQ reaches the valid cycle end
and the new PPQ matches the wrapped expected position within two host samples.
That classification remains useful telemetry. In 0.3, ALL live seeks/jumps preserve
the stream, not just classified wraps; no cycle metadata is required. Rendered
continues to follow each new host position exactly.

Protocol 2 advertises prepared support in clock messages. Existing version-1
stream packets remain supported. prepare:id:rate:frames:beats:bpm starts a bounded
32 MiB upload; MGL2 packets carry strict contiguous frame offsets. Rate, duration,
revision, count, packet size and finite samples are checked/sanitized. Worker
backlog is bounded. Ready PCM uses three ownership-state slots: the socket
thread allocates/writes, the audio thread adopts a pending immutable slot and
releases the old slot for later producer reuse. No allocation, lock, shared_ptr
release or buffer destruction runs in process(). Maximum slots use 96 MiB plus
a 32 MiB in-progress upload; typical one/four-bar loops use much less.

Tests: bridge-transport-test covers live wraps/seeks with and without cycle metadata, prepared first sample,
nonzero/in-block cycle boundaries, 32/64-bit output, stop/resume, rate conversion,
offline output, a process allocation/deletion guard and 5000 concurrent slot
replacements. ../tests/daw-bridge-transport.cjs uses the actual Windows DLL/editor
under Wine and Chrome's real preparation/capture/worker upload. It compares
actual host callback PCM against the browser's captured source and checks live
wrap continuity. MYGRAIN_CYCLE_TEST_WRAPS=30 selects the longer loop run.
Wine/custom-host validation is still not physical Windows/ASIO/commercial DAW
validation. Update both frontend assets and the whole 0.3.0 VST3 bundle.

Preparation cancellation propagates AbortSignal through the existing PCM capture
API. An opted-in capture checks its original AudioContext after async setup and
does not restart/stop a replacement engine. Disconnect aborts preparation, drops
stale uploads, stops its transport and restores the direct monitor only after
cleanup. Non-bridge captures with no signal retain their prior audio behaviour.

## 0.3 explicit modes and continuous Live

The desktop `dawBridgeMode` selector offers Live (default) / Rendered. Selecting
Rendered without a snapshot stops/disarms Live and exposes Render / refresh.
Render capture remains explicit; editing the patch never triggers a capture.
Protocol 2 is preserved, with `continuousLive` and `selectRendered` capability
flags. The `rendered` command selects the retained immutable snapshot (if any)
and disarms; `live` selects the live queue and disarms. Both transitions require
Arm/Start, so changing modes cannot silently play stale audio. A new capture
continues to select/arm its new render when upload succeeds. Neither selection
nor cached audio is saved in the DAW project. Older plugins can still stream or
render, but the UI tells users that continuous seeks need 0.3.0.

Live ignores arbitrary project-sample jumps, including during its initial
pre-roll. It continues consuming the same generation at monotonically advancing
processor-clock time: no discarded PCM, repeated fade or future-bar reschedule
at a loop or seek. This deliberately trades timeline rewind for uninterrupted
live editing. Explicit stop/start, host deactivation, offline transitions, tempo
or meter changes, and real starvation retain their reset/re-arm behaviour.

`daw-bridge-transport.cjs` tests default mode, render UI, native first sample,
cycles, lifecycle changes, then live wraps with and without cycle metadata and
a manual seek. It tweaks the real live level without rendering, proves the
change in native PCM, then selects the retained Rendered snapshot while that
live level is zero and checks that cached audio remains audible with the same
revision. Cancellation and monitoring cleanup remain covered. Host PCM and
block-position traces are retained as release evidence.

Packaging accepts `--setup <staged-vst3-setup.html>` so the ZIP contains the
verified release instructions rather than an older deployed HTML copy.

`../tests/daw-bridge-download.cjs` verifies the exact public HTTPS assets, ZIP
bytes/attachment header, retained old ZIPs, and the real public setup download.
It also clicks the authenticated desktop link in the isolated loopback-HTTP
fixture and compares saved bytes. This download-only fixture uses HTTP because
Chrome may cancel downloads from self-signed test TLS even when ordinary page
requests accept its certificate; release-Origin audio tests still use isolated
TLS with DNS mapping and the unmodified release Origin check. No production
account writes or browser-security bypasses are needed for download testing.
After a backend restart, check actual HTTP readiness before downloading; an
active systemd unit can briefly precede the server accepting requests.


## 0.4.0: connection, native controls and loop-capture correction

`#daw=` is consumed immediately and connects before audio initialization. The
initial output bind attaches capture without dropping that connection. Auto
Start respects Chrome autoplay: a trusted gesture can resume a suspended
initialization. Manual code/Connect remains available. Readiness gates native
Arm/Play; it must not disarm a prepared snapshot during offline transitions.

Web Locks reject another same-origin tab before audio starts (lock uses port,
not secret). Native listener refuses additional clients with HTTP 409 while
the owner remains connected, including other profiles. No queued takeover.

Native GDI+ editor embeds the existing logo, uses green Arm, red Stop and orange
Play, real output meters and keyboard-accessible native buttons. Closing the
view frees graphics resources, not the connection. No bundled helper/runtime.

Plugin-only `loopWarmupCycles:1` captures the second cycle on sample-aligned
boundaries, excluding the initial transport gain ramp. The capture allocation
remains one cycle plus existing padding; deadline includes warm-up wait. Normal
WAV/Song render defaults, source schema and render hashes are unchanged. This
does not force evolving material or arbitrary DAW cut points to be periodic.

Regression: `../tests/daw-bridge-render-seam.cjs` compares real final-mix PCM at
44.1/48 kHz. Windows transport test covers automatic connection and both tab
and native ownership rejection; Windows live test presses all three native
transport buttons. Final bundle must be tested and validated after packaging.

`../tests/daw-bridge-auto.cjs` models a first-resume policy gate using a real
AudioContext, because headless Chromium can allow autoplay despite its policy
switch. It verifies one trusted Start gesture, duplicate rejection before audio
and manual reconnect after owner release. `../tests/daw-bridge-login.cjs`
exercises the real guest shell, login form/reload and automatic fragment
connection. These use only the isolated test account store.

While connected in Live, `needsAudio` keeps the existing idle manager awake so
native transport buttons remain usable. Rendered permits browser idle sleep:
readiness accepts cached mode and a not-ready notification does not disarm
prepared native PCM. The offline setup test caught and verifies this boundary.

Native editor screenshots must include connected controls and labels. Segoe UI
is preferred; GDI+ GenericSansSerif is the fallback when that font is absent.


## 0.5.0: change-only editor and latched Arm

The UI timer no longer writes identical button labels, calls EnableWindow for
unchanged states, or invalidates every child/full window. Only changed status,
mode and quantized meter rectangles are invalidated. Buttons render to an
offscreen bitmap before one blit. Idle has no repaint churn; active meters
cannot erase the controls. Native WM_PAINT / WM_DRAWITEM / WM_SETTEXT auditing
in the test host proves this boundary against the released baseline.

`armed` is latched user intent. Only requestStop (explicit native/browser Stop)
clears it. Host setProcessing/setActive, readiness/connection loss, mode changes
and uploads retain it. requestPause resets transient live queues/audition; Live
automatically schedules a new future-bar start when ready and the DAW plays.
Rendered follows the next host position immediately. A stopped manual audition
is not resumed automatically after a graph rebuild.

The `hold` command retains Arm but prevents playback during explicit capture
or a start failure. Arm/Play/mode selection or a completed snapshot releases
the hold. Selecting Rendered without a snapshot waits, never falls back to Live.
New rendering retains Arm; it cannot override Stop pressed during capture/upload.
The `stickyArm` clock flag keeps browser behaviour backward compatible with
older plugin versions, whose mode/capture/disarm rules remain unchanged.

VST state version 2 is twelve bytes: existing magic, version and Arm flag.
Version 1 remains readable. A fresh instance restores the saved Arm choice;
state reapplied to an instance where the user explicitly chose Arm/Stop does
not override that choice. No token, source, rendered PCM or browser state is
saved. State readback, legacy restore, fresh instance restore and stale-state
Stop precedence are checked in the native host.

`../tests/daw-bridge-sticky.cjs` reproduces the baseline repaint/routing fault
and checks zero idle full-window/button/label churn, native graph rebuilds,
state round-trips, offline/realtime changes, reconnect and explicit Stop.

## macOS / Bitwig Studio universal preview

The same Bridge (0.5.0) and separate FX (0.1.0) identities now have native
AppKit editors and universal `arm64;x86_64` Mach-O bundles. macOS deployment
target is 11.0; install a Chrome version supported by your macOS. Crypto uses
Apple CommonCrypto/Security and the socket listener remains loopback-only with
an exact production Origin and per-instance random capability. No OpenSSL,
Homebrew runtime, helper app or virtual audio cable is shipped. Browser/audio
protocols, DSP, saved patch/Song formats and render cache identities are unchanged.

On a Mac with Xcode Command Line Tools, CMake, Python 3 and the same pinned SDK:

```sh
bash vst3/mac/build.sh /tmp/mygrain-mac-build /tmp/mygrain-vst3-sdk
python3 vst3/mac/release.py /tmp/mygrain-mac-build /tmp/mygrain-vst3-sdk /tmp/mygrain-mac-release
```

`mac/build.sh` builds the plugins, native AppKit test host, SDK validator,
module-information tool and the core/transport/FX test suites. `mac/release.py`
checks both slices, imports/exports, bundle metadata and ad-hoc signatures;
runs Steinberg validation on each final bundle; loads the actual Mach-O in an
AppKit host and verifies its callback PCM, WebSocket authentication/accept key,
FX return timing and gain, delayed dry fallback, prepared Bridge offline
playback, editor close/reopen, Arm/Stop and a state roundtrip. It packages only
the tested bundle, installer, checksums, licence and explicit verification notes.
The CMake target host is a test tool, not part of the release.

Bundle layout (Mac, not the Windows `x86_64-win` layout):

```text
MYGRAIN Bridge.vst3/Contents/
  Info.plist
  MacOS/MYGRAIN Bridge
  Resources/mygrain-logo.png
  Resources/moduleinfo.json
  _CodeSignature/CodeResources
```

`MYGRAIN FX.vst3` has the corresponding executable/resource layout and separate
bundle ID, class ID and Objective-C editor class. Both may coexist in one host.
The UI timer is invalidated on editor removal; closing the editor never stops
the component's audio connection. Cocoa handles Retina scaling. Socket writes
suppress `SIGPIPE` on macOS without changing the DAW process's signal handlers.

The ZIP's `Install MYGRAIN.command` verifies all checksums and the shipped
ad-hoc signature, installs to `~/Library/Audio/Plug-Ins/VST3`, backs up an
existing bundle outside that scan folder, and removes quarantine only from
the exact bundle it installed. It uses no administrator privileges and does
not disable Gatekeeper globally. It is not Developer ID signed/notarized.
Open Terminal in the extracted folder (type `cd `, drag the extracted folder
into Terminal, then Return), and run `./"Install MYGRAIN.command"` with the
capital I shown. `./` selects the current directory; quotes preserve the space.
If the executable permission is missing, use `bash "./Install MYGRAIN.command"`.
Keep the installer, bundle and `SHA256SUMS.txt` together. In Bitwig, include
that user VST3 folder in Settings > Locations and rescan. Bridge is an
instrument; FX is an effect. The release generator and both public ZIP readmes
carry these same Terminal instructions. Documentation-only ZIP updates retain
every plugin/installer byte and file mode, updating the README checksum only.

CI is `.github/workflows/mygrain-macos-vst3.yml`, using a supported macOS 15
Apple Silicon runner and the pinned SDK. Automated native-host tests are not
a claim of physical Mac/Bitwig/CoreAudio recording alignment. Both slices are
built and inspected; native execution coverage is the runner's architecture.
Actual verification logs/results travel inside each ZIP. The public setup
page at `vst3-setup.html#mac` and the two desktop plugin download panels expose
separate versioned Mac and Windows ZIPs. The exact two Mac filenames must also
be in the backend public-file and attachment allowlists; no source/build tree
is exposed through the application route.

## Live capture origin regression

`tests/daw-bridge-start-alignment.cjs` compares a known four-impulse A layer
rendered with the real final-mix engine against real Chromium/worklet/worker
audio received by the native Bridge engine. Run against an isolated accounts
fixture only, never production: `MYGRAIN_TEST_URL` must be a loopback URL. Set
`MYGRAIN_ALIGNMENT_OUTPUT` to a private evidence directory and compile
`vst3/tests/bridge_fixture.cpp` with `vst3/src/server.cpp` (`-std=c++17 -pthread
-I vst3/src -lcrypto`) as `/tmp/mygrain-live-start-fixture`, or override
`MYGRAIN_ALIGNMENT_FIXTURE`. Run at both `MYGRAIN_TEST_RATE=44100` and `48000`.
The native fixture runs at 48 kHz, so 44.1 kHz also checks resampling. JSON/PCM
evidence records cold-start alignment and subsequent bounded clock drift. It
is not a physical target-platform VST3 host/DAW/audio-device test.

## 0.6.0 Bridge / 0.2.0 FX: explicit project snapshot recall

The previous sections document earlier releases; the RAM-only/state-v2 limits
are superseded by this section. Plugin class IDs stay unchanged. Bridge reads
v1/v2 and writes v3; FX reads v1 and writes v2. The 48-byte native header stores
magic/version/flags/mix/document bytes+CRC/loop rate+frames/beats+BPM, followed
by the bounded opaque document and optional float32 stereo loop. Parse and
validate all fields before publication; malformed/truncated state leaves the
last committed snapshot intact. Host streams may make partial reads/writes.

`daw-project.js` captures the existing complete editable-part ZIP and wraps it
with versioned Bridge mode/bars or FX gain/mute/route JSON (MGP1 envelope).
`daw-project-worker.js` moves CRC-checked contiguous MGS1 chunks over the
existing per-instance authenticated loopback socket; no server storage or
credentials are involved. project-begin completes atomically into ProjectStore;
project-get retrieves only that plugin's revision. Interrupted uploads retain
the previous committed snapshot. Limits: 128 MiB ZIP, 64 KiB settings, 32 MiB
rendered PCM; 120-second bounded transfers. Explicit Store in Rendered mode
retains the most recent successful loop, not a new capture. Store then DAW Save
is required after edits; the Store button does not save the host project.

getState only serializes an already-resident immutable snapshot. No network,
browser request or render occurs in that callback. Mutexes/shared_ptr copies,
CRC and allocations occur only on state/socket threads; process() uses atomic
flags and existing ownership-state PCM slots. Producers serialize publication
off-thread; restore may safely replace a pending slot before audio adoption.
Rendered snapshots play without Chrome or an open editor. Live/FX remain gated
until the browser restores and acknowledges the current project revision.

On connection, recall waits for account/audio readiness, validates/decodes the
ZIP using the existing adapter, and applies it with start:false,persist:false.
It does not replace account scratch persistence or Song libraries, and excludes
DAW card controls from the generic Song control inventory. Existing Songs, DSP
and render compatibility hashes are unchanged. Separate instances have separate
local state and tabs; codes/tokens are never serialized.

Verification: tests/project_state_checks.h loads actual factory clones, checks
full variable-size state roundtrips/repeated pre-process restore, rejects
truncation/corruption without replacing valid state, reads legacy state and
compares exact offline Rendered callback PCM without a browser. Native Mac
integration uploads an embedded native protocol fixture and runs the same
checks on actual Mach-O. tests/daw-project-browser.cjs covers real editable
patch + sound capture, native DAW Save, fresh-instance recall and isolation.
