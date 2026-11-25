# MyGrain CEF FX 0.1.2 — Web MIDI and Downloads

Setup/downloads: https://openclaw.blackcarburning.com/mygrain/cef-fx-setup.html
Native build source: `3100ecbbc0aee43b1c49167155a543b44943da12`
Native CI: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/45634634673

## Changes and retained boundaries

The separate FX helper now includes instrument 0.1.6's trusted-origin CEF MIDI
permission fix and instrument 0.1.5's direct Downloads handler. CEF Alloy has no
Chrome permission UI. The pinned CEF156 SDK uses MIDI_SYSEX for ordinary MIDI
prompts too; the app still requests sysex:false. Only the exact trusted MYGRAIN
HTTPS origin and existing loopback capability are accepted. No blanket origin
permission, microphone/camera grant or new VST3 host MIDI-input bus is added.
Select a keyboard/interface in the app after Start MYGRAIN.

Downloads use the OS Downloads folder with numbered duplicates and completion
notices, without an OS Save dialog. Existing keyboard/Space handling is retained.
FX DSP, stereo format/rate support, one-second PDC, real-time wet processing,
bypass/offline aligned-dry fallback, factory CID/category, MGX1 v2 project state
and server Song synthesis/rendering are unchanged. No source-audio migration.
The CEF instrument 0.1.6 and all existing release archives remain unchanged.

Both setup cross-links and in-app VST3/DAW INPUT download cards now show current
versions: instrument 0.1.6, CEF FX 0.1.2. The FX 0.1.2 links replace stale FX
0.1.0/0.1.1 labels; external Bridge 0.8.0 and FX 0.4.0 links are retained.

## Verification

Windows x64 and native Apple Silicon macOS CI both passed. Each SDK validator
passed 47/47. Real requestMIDIAccess({sysex:false}) resolved with permission
"granted" on both fresh and restored native helpers, without CDP permission
grants or navigator mocks. Both runners reported zero input/output ports.
The new Downloads handler saved byte-exact duplicate WAVs in OS Downloads
without a Save dialog, retaining the pre-existing same-name file.

Existing native FX checks passed: exact impulse/PDC at 44.1/48/96/192 kHz,
stereo float/double, bypass/offline/Arm, finite PCM, zero callback allocations,
preview/resampling/offline suppression, Space focus routing, native login,
auto-arm/explicit Stop, history continuity, all Cooking Pot powers, four input
routes, actual filter attenuation, gain/mute/native mix, silent FX clock beyond
30 seconds, closed-editor audio and automatic storage, Store/reload and fresh
editable source/input-preferences recall. Synthetic account routes caused no
production account or repository writes.

Mac CI verified universal plugin/helper/framework content, deep/strict ad-hoc
signatures, extracted the final ZIP, ran the FX-specific installer and passed
SDK validation of the installed bundle. Native Intel execution is not claimed.

The release-link regression passed Chromium and WebKit with the full editor
started and synthetic account routes, checking current labels/destinations on
both real download cards and all setup pages. Initial link-harness fixtures
omitted the private circuit libraries' patches/revision fields; corrected
fixtures passed. Windows-packaged SETUP.html differs from the live source only
by CRLF line endings, as verified without altering the original CI ZIP.

Post-publication checks passed: both new anonymous HTTPS downloads returned
HTTP 200 with attachment filenames, exact byte counts and SHA-256 matching CI.
All four instrument/FX setup-page buttons were clicked in Chromium and their
complete downloaded files matched the deployed ZIPs byte-for-byte. Chromium
and WebKit passed all three public setup pages and both running, synthetic-
account editor cards, with no page errors. WebKit file downloads and physical
CEF/DAW hardware interactions are not claimed. Exact live assets and all
38 retained archive hashes passed. Results accompany the release manifest in
the task evidence directory.

## Installation

Close the DAW completely. Extract the platform ZIP and replace the WHOLE
MyGrain CEF FX bundle, including helper and runtime, then rescan VST3. On macOS
use the included FX-specific installer. Do not replace the CEF instrument or
mix old/new helper files. Reloading the app cannot apply native fixes.
Save the DAW project normally after a completed plugin Store.

## Scope

Hardware-free native runners cannot verify actual MIDI ports, physical DAWs,
driver sharing, native Intel execution or multi-instance performance. Mac
bundles are ad-hoc signed, not Developer-ID signed/notarized. No latency change.

## Archives

Exact CI ZIP bytes, unchanged after download:

- `mygrain-cef-fx-windows-0.1.2.zip` — 191484087 bytes; SHA-256 `9531de0f062013bf3bccafe253c06a1c1cc735a4aba04419e35cbdb6a8375b69`.
- `mygrain-cef-fx-macos-0.1.2.zip` — 267256534 bytes; SHA-256 `347d8d3adca7764048579db849a56bb271b2d293f1455967a9b48ea3f571466e`.

Backup/evidence: `output/mygrain-cef-fx-midi-20261125T142816Z/`. All 38 previously deployed archives
are retained and rechecked separately at publication.
