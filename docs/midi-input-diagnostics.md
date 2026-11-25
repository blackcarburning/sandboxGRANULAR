# MIDI input parity investigation

Target: the CEF plugin must expose the usable controller coverage of the normal
MYGRAIN app, including USB keyboards. Reported host: Windows/Cubase. Keep macOS
support; physical Mac hardware testing is not available from the requester.

The app and plugin load the same hosted MIDI selector. CEF runs in a separate
helper/profile for each plugin component. The current selector excludes ports
reported as disconnected; it has no USB- or manufacturer-specific exclusion.

Upstream Chromium's Windows WinMM manager opens ports during discovery and
marks failed opens disconnected. This is a possible driver-sharing explanation,
not a confirmed diagnosis of the requester's machine. Do not switch MIDI backends,
change Cubase's configuration, or call hardware-free CI a physical-device fix
without the working-app/plugin comparison under matching conditions.

## Existing debug report

`mygrainMidiKeyboardInput.diagnostics()` is a passive snapshot. Current debug
reports include it as `currentState.midi`, even without an active AudioContext.
It records API/request state, browser-reported input/output names, manufacturer,
state/connection, selected flag, state-change and selected-input session message
counts/times. It does not request permission, open ports, change selection,
record MIDI bytes/notes, include raw device IDs, add timers, or submit itself.
Inventories are bounded to 256 ports with original totals and a truncation flag.
Existing permission requests, MIDI dispatch, patch/project formats and native
binaries are unchanged. Existing debug logging/submission lifecycle is retained.

Compare **Submit Current Log** from the normal app and CEF while Cubase remains
open, on the same computer with the same attached devices. For CEF, first use
Store + reload app to fetch the hosted diagnostics; no plugin reinstall is needed
for this diagnostic-only change. Open/close a controller and receive real events
before asserting usable parity. A resolved request or empty inventory is not proof.

`node tests/midi-input-diagnostics-browser.cjs` runs Chromium/WebKit with synthetic
ports, intercepted submission and no production writes. It checks passive capture,
unchanged filtering, selected-input delivery counts, hotplug and API failure cases.
It does not test physical USB devices, Cubase or native CEF device sharing.

## Manual MIDI inventory refresh

The keyboard MIDI card and the existing L/X MIDI controls expose **Rescan MIDI**.
They share one in-flight `requestMIDIAccess({sysex:false})`, refresh the input list,
and display the connected-input count. A selected input remains selected when
present; an unavailable preferred input is restored if it reconnects in this
page session. Explicitly choosing No MIDI input clears that preference. Replacing
the access object detaches the old state-change and selected-message listeners.
A failed refresh retains the previous usable access/list/selection and allows
retry. There are no new background timers, startup delays, automatic submissions,
permissions, native backend switches or audio/patch/schema changes.

This is a Web MIDI inventory refresh, **not a guaranteed native driver rescan**.
The API provides no driver-reset operation, and repeating the access request can
return a cached native inventory. It cannot take a single-client port from Chrome,
Cubase or another helper. If devices remain missing, close other MIDI apps and
reconnect the device; some drivers require a full DAW restart. Do not describe
the control as a verified repair of physical USB enumeration or message delivery.
References: [Web MIDI access](https://www.w3.org/TR/webmidi/#dom-navigator-requestmidiaccess),
[Chromium Windows enumeration](https://chromium.googlesource.com/chromium/src/media/midi/+/refs/heads/main/midi_manager_win.cc).
The latter is upstream reference behavior, not a reproduction with every pinned
CEF build or controller. The shared hosted UI applies to Windows and macOS CEF
without rebuilding either native bundle; no physical Mac coverage is claimed.

The browser regression also checks delayed inventory exposure on explicit
refresh, deduplicated requests across controls, fresh access objects/listener
cleanup, selection preservation, reconnect and explicit No input, usable previous
list after failure, and reachable 44px controls at 390/430/1440 widths. Synthetic
MIDI fixtures do not establish OS-level rediscovery.
