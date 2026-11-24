# MyGrain CEF FX 0.1.1 — focused Space passthrough

Setup/downloads: https://openclaw.blackcarburning.com/mygrain/cef-fx-setup.html
Validated native source: `2adba175aedefcefb070dccb48f514797e4b3850`
Native CI: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/43495809840

## Changes

Rebuilds the separate MyGrain CEF FX stereo effect with the CEF instrument
0.1.4 keyboard repair. Space belongs to the DAW transport while the embedded
app or an app button has focus. Both VST3 callbacks return unhandled without
queueing Space to Chromium. Native Windows parent forwarding and the AppKit
responder chain cover native-window delivery; duplicate native delivery and
Windows WM_CHAR are suppressed. Text/password inputs, textareas and
contenteditable retain spaces using Chromium's actual editable-focus report.
Private display/input IPC v3 requires replacing the whole FX bundle.

FX DSP, stereo input/output, factory CID/category, fixed one-second PDC,
bypass/offline aligned-dry fallback, automatic storage, MGX1 v2 project state,
source audio and server Song rendering remain unchanged. The CEF instrument
and all earlier release archives remain byte-identical.

## Verification

Windows x64 and native Apple Silicon macOS passed all six focus cases before
the FX suite: body/button passthrough through both VST3/native delivery,
host-parent/responder reception, editable text/password/textarea/contenteditable
spaces, virtual-key-only Space, duplicate suppression and no app-loop/button
activation. SDK validators passed 47/47 on both platforms.

Native callback PCM verified stereo input/processed return, gain/mute, four
routes, actual LPF attenuation, native mix, bypass/offline dry, sustained
silent-browser clock beyond 30 seconds, processing/automatic storage with the
editor closed, manual Store, actual reload and fresh editable source/settings
recall. Native login/remembered-session and preview bypass/offline suppression
passed. Tests used synthetic account routes without production data writes.

The final Mac archive was extracted, its installer executed, installed SDK
validation passed and deep/strict signatures verified. Universal plugin/helper/
framework slices, Windows imports, every ZIP checksum entry, complete HTTPS
attachment responses and actual setup-button browser downloads were checked.

The first Mac attempt passed every Space focus case, then failed the sustained
FX timing check with browser audio advancing about 3% slower than wall time and
late returns. Its logs/PCM/trace are retained privately. An exact-source rerun
passed the entire suite without relaxing assertions or changing DSP. This does
not establish physical-DAW performance.

Cubase/physical DAWs/devices, native Intel execution, international IME and
multi-instance performance remain unverified. Mac is ad-hoc signed, not
Developer-ID signed/notarized. Processing remains real-time-only; native offline
bounce uses delayed dry. No latency change.

## Install

Close Cubase/the DAW fully, extract the new platform ZIP and replace the WHOLE
MyGrain CEF FX bundle, then rescan VST3. Mac users can run the included distinct
FX installer. Do not replace the CEF instrument or mix old/new helper files.
Reloading the hosted app alone cannot apply this native fix. Use app controls
for its local loop. Normal DAW project Save remains required for disk persistence.

## Archives

- `mygrain-cef-fx-windows-0.1.1.zip` — 191476691 bytes; SHA256 `e02f884e10bcf840cdc9a21864f619dff519d16003e4e2e4eeaf3045c4902843`
- `mygrain-cef-fx-macos-0.1.1.zip` — 267227042 bytes; SHA256 `80b23c292f38aa7546961907322fe35d362900bfca81eee6d38fe55aeca3a0d2`
