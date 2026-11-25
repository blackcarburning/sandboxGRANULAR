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
