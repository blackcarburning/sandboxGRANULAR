# MyGrain CEF 0.1.0 preview

Separate VST3 instrument, name **MyGrain CEF**, class ID
`A44B25E13DE64853A16CC63921C9D4B2`. Never replaces MYGRAIN Bridge 0.8.0 or
MYGRAIN FX 0.4.0. No synthesis, source, Song renderer or PCM protocol changes.

## Ownership and updates

The plugin reuses the Bridge engine, authenticated loopback server, transport,
prepared/offline playback and project state implementation. It never loads CEF
into the DAW process. Each component owns one private helper process and an
isolated browser profile; each editor owns only a bitmap/input surface. Closing
the editor hides that surface, not the app, Web Audio engine or automatic store.
The helper exits on component termination or parent-process loss.

CEF loads the hosted `https://openclaw.blackcarburning.com/mygrain/` app, not a
bundled fork. New instances fetch the current app. **Store + reload app** first
waits for an acknowledged complete patch snapshot, then loads the hosted app and
reconnects/restores it. A busy or unsuccessful store cancels the reload. Reopening
an editor resumes the same running app; it must not silently restart playback.
Reload intentionally interrupts live playback. App updates normally need no
plugin rebuild. Bridge protocol changes and CEF security/runtime upgrades can.

Profiles are per-instance and temporary (including browser login and local UI
preferences), cleaned on normal unload. Sign in for each new plugin instance.
Patch/required audio and auto-store preferences are restored from the DAW state,
not from shared browser localStorage. No login cookie or capability is embedded
in that state. Account services still require an internet connection.

## Auto-save boundary

The existing `daw-project.js` / codec worker / native immutable ProjectStore are
retained unchanged. Default On, check every 60 seconds; adjustable 15–3600.
Unchanged patches skip transfer. Loads, recording and concurrent operations defer
stores. **Store now** remains available. UI-thread host dirty notifications are
component-owned and continue without an open editor.

Save the DAW project normally to write the latest COMPLETED snapshot to disk.
An automatic store is not an automatic DAW File > Save. A save during transfer
uses the previous completed snapshot. Failed transfers retain it. Rendered loops
still need Refresh render after edits, and support native offline playback.
Live mode retains Bridge timing/buffering limits and needs real-time playback.

## Display and input

CEF Alloy windowless rendering; private bounded shared-memory RGB frames and
input ring. Rendering/copying never happens in the native audio callback.
CEF alone owns Chromium processes, timers and its UI message loop. Background
timer/renderer throttling is disabled, and closing the native surface never calls
CEF was_hidden(): macOS can suspend Web Audio despite timer switches.
Software painting avoids binding a DAW host's graphics device to Chromium's GPU.
Mouse, wheel, keyboard, native save dialogs and browser select popups are routed
through the surface. International IME/composition and physical DAWs require
additional target-device coverage. New browser-window popups are blocked; the
current app uses in-page editors. Only the trusted hosted origin is granted
loopback-network permission; mic/camera permissions are not auto-granted.

## Reproducible builds

Pinned official CEF minimal distributions: `sdk-lock.json` (156.0.28,
Chromium 156.0.8078.88), explicit C API 15600 and runtime hash verification.
Fetch with `python3 cef/fetch_sdk.py windows64 <cache>` (or macosarm64/macosx64).
Pinned Steinberg SDK/submodules: `3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96`.

Configure this VST3 tree with `-DMYGRAIN_BUILD_CEF=ON`; build `MyGrainCEF`.
Configure `cef/` separately with `-DCEF_ROOT=<minimal-sdk>` to build the helper.
Windows MSVC builds also set `-DSMTG_USE_STATIC_CRT=ON` and
`-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`. MinGW links the runtime statically.
Mac helper uses Objective-C++20 (CEF application protocol headers); native
plugin remains C++17. CEF's inspected Mach-O minimum is macOS 13.

`stage.py` assembles the private runtime. `universal.py` merges both Mac
architectures and retains BOTH architecture-specific V8 snapshots. `sign_mac.py`
ad-hoc signs leaves, helper apps, framework and outer bundle, then verifies.
The universal Mac package is not Developer-ID signed/notarized.

The separate `mygrain-cef.yml` CI builds real Windows/macOS binaries and runs
`tests.cjs` through CEF's DevTools protocol. Test-only local account/static routes
are intercepted before authenticated use; no production account or Song writes.
`MYGRAIN_CEF_DEBUG_PORT` enables an explicitly requested loopback diagnostic port;
normal plugin launches have no debugging listener. Tests exercise native output,
closed-editor automatic stores, UI dirty notifications, reload, fresh-instance
recall and clean unload. Use the final packaged binary in the SDK validator.

CEF and Chromium credits are shipped in the bundle, alongside existing SDK/
runtime licenses. Keep the whole bundle, including helpers and resources.
