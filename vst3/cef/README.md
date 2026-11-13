# MyGrain CEF 0.1.4 preview

Separate VST3 instrument, name **MyGrain CEF**, class ID
`A44B25E13DE64853A16CC63921C9D4B2`. Never replaces MYGRAIN Bridge 0.8.0 or
MYGRAIN FX 0.4.0. No synthesis, source, Song-renderer or existing Bridge PCM-protocol changes.

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

Browser profiles remain per-instance and temporary, including local UI/patch state.
Only the trusted origin's host-only Secure/HttpOnly `mygrain_session` cookie is
remembered across plugin unloads in a separate per-OS-user login store. It uses
Windows user-bound DPAPI in LocalAppData; macOS uses a user-private 0700 directory
and 0600 file under Library/Application Support/MyGrain CEF. No password, account
cookie or capability is written into plugin/DAW project state. The server's
existing 90-day expiry/revocation still applies. Log out to forget the session.
A later new instance uses the last login; already-open helpers do not swap users.
An unchanged old helper cannot overwrite a newer remembered login. Browser
profiles are never shared, avoiding Chromium singleton/profile locking between
simultaneous instances. Account services still require an internet connection.

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
CEF was_hidden(). macOS helpers declare user-requested real-time activity
(with idle system sleep allowed), independent of speaker audibility/App Nap.
Software painting avoids binding a DAW host's graphics device to Chromium's GPU.
Mouse, wheel, keyboard, native save dialogs and browser select popups are routed
through the surface. Native OS-file drag/drop and international IME/composition are not integrated;
use file pickers/click controls. Physical DAWs require target-device coverage. New browser-window popups are blocked; the
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

## 0.1.1 keyboard and painting repair

The editor implements IPlugView onKeyDown/onKeyUp/onFocus. Steinberg key codes and
modifiers are translated explicitly; Unicode text events are sent alongside raw
key events. Native-window delivery remains a fallback until the host uses its
VST3 route, then is suppressed for that focus session to avoid duplicate typing.
Blur releases keyboard capture; native toolbar controls retain their own focus.
CEF is refocused on browser clicks. Windows paints the completed browser bitmap
without clearing beneath it; AppKit uses a backing layer and browser-only damage.

Release CI enters synthetic credentials into the real signed-out login with
native input and the VST3 ABI, including Tab, Backspace, punctuation, focus loss,
no duplicate native delivery, and Enter submission to isolated mocked auth.
No production account requests or credentials are used. Existing audio, closed-
editor automatic storage, reload, fresh recall and clean-unload gates remain.

## 0.1.2 native toolbar and automatic-store visibility

Native controls match the app palette: blue actions, green armed/auto-save states
and red Stop, rounded gradients and visible keyboard focus. The toolbar adapts
to the minimum 800px editor width without clipping the interval controls.
Auto-save explicitly displays On/Off. Every (s) accepts 15–3600; Apply commits
through the existing acknowledged remote protocol (action 12). Invalid values
do not change the stored interval. Editing a value is not overwritten by timer
updates; acknowledged project changes resync the field when it is not edited.

Two persistent info lines show transport/disarmed state plus the app's activity
(including deferral/error messages), last completed time/duration, payload and
full snapshot sizes, completed/unchanged counts and next check/paused/storing.
The disk boundary is explicit: save the DAW project normally. Auto-save still
runs while the editor is closed and persists its preferences in project state.
Native Windows/macOS release tests exercise the actual toggle, invalid/valid
interval, Apply, manual store, unchanged skips, minimum width, status labels and
closed-editor store, alongside the existing input/audio/reload/recall gates.
No synthesis, source, Song renderer, PCM protocol or stored-patch format changes.

## 0.1.3 sessions, repository dialogs and preview output

Native helper-owned modeless prompt/confirm/alert dialogs preserve synchronous
JavaScript semantics and allow named WAV/Loop Store exports. OK, Cancel and page
navigation complete or cancel the original CEF callback; no export is auto-approved.
Only the trusted hosted origin can request these dialogs.

CefAudioHandler captures browser audio (and suppresses system-speaker playback)
into a separate fixed-size single-producer/single-consumer preview ring. The native
callback mixes it after the existing Bridge engine. It has no locks, allocation,
CEF calls or network I/O; resamples to the host rate, sanitizes nonfinite samples,
drops overflow/stale buffers and discards previews during offline bounce. Browsers
are not explicitly muted, which would also mute the captured preview PCM.

The helper adds `mygrain_cef=1`. Only that embedded mode enables the capture
worklet's idle passthrough, so inline auditions reach the preview ring while the
DAW stream is disarmed/stopped. During an active live epoch, the worklet remains
silent and the existing scheduled network PCM is the only main-patch output.
Normal external Bridge tabs are unchanged. DSP/export buffers, Song preparation,
render compatibility and saved state formats are unchanged: this is native output
routing, not a synthesis/rendering change. Preview audio requires the DAW to call
process(), generally via track monitoring even while transport is stopped.

Release tests use real native dialogs and actual renderer/export payloads at an
isolated upload sink, stopped/disarmed WAV/media and decoded Loop previews,
independent widget contexts and inline main-bus audition at native PCM output.
They log in with synthetic credentials, unload fully, recover the session in a
fresh isolated helper, then log out and verify it stays forgotten after another
unload. The diagnostic native-dialog driver is enabled only by the explicitly
requested loopback DevTools port. No production accounts/repositories are used.

## Separate CEF FX variant

For the embedded stereo effect counterpart to MYGRAIN FX 0.4.0, build
`MyGrainCEFFX`. See [FX.md](FX.md), the separate `mygrain-cef-fx.yml` workflow and
[CEF FX setup](https://openclaw.blackcarburning.com/mygrain/cef-fx-setup.html).
Both CEF variants use the full private Chromium runtime, not an installed browser.

## 0.1.4 focused Space passthrough

Space belongs to the host transport even while the embedded app has focus.
IPlugView returns kResultFalse for both down/up without sending them to CEF.
Native Windows fallback forwards the original down/up to the host parent only
when the host has not selected the VST3 keyboard route; AppKit returns them via
the normal responder chain. Duplicate native delivery and WM_CHAR are suppressed.
Chromium reports actual editable-node focus from its renderer through private IPC;
text inputs, textareas and contenteditable retain spaces and consume the key.
The route is fixed for a held key's repeat/down/up pair and resets on blur.
Native dialogs keep their own normal OS keyboard handling. No audio engine,
transport synchronization, project state, Song rendering or saved schema changes.
The private display/input IPC is version 3, so replace the WHOLE CEF bundle.
A hosted app reload alone cannot change this native behavior.
