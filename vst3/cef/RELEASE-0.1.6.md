# CEF MIDI permission — 23 November 2026

CEF instrument 0.1.6 explicitly accepts Web MIDI permission for the exact trusted
MYGRAIN HTTPS origin, alongside the existing loopback permission. CEF Alloy did
not show a Chrome-style permission prompt, leaving ordinary interface access
blocked/ignored. The hosted app still requests sysex:false. No DSP, state envelope,
factory CID or VST3 host MIDI event bus is changed. Microphone/camera and other
origins are not automatically permitted. CEF FX 0.1.1 is not repackaged here.

Native source c0bdf2b0b48c829d2881976ff4c4e7652f18bada:
https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/45288930401

Windows x64 and Apple Silicon macOS real native CEF tests passed. MIDI permission
was granted and requestMIDIAccess resolved with sysexEnabled:false on first and
fresh restored helpers. Hosted runners had no physical MIDI ports; physical
interface/Cubase operation remains untested. Both SDK validators passed 47/47.
Existing native PCM/state/Space/downloads/store/reload tests passed. Universal
Mac plugin/helper/CEF framework, deep/strict signatures, extracted installer and
installed validator passed. Native Intel execution and notarization are not claimed.

Install with DAW closed, replacing the entire CEF instrument bundle, then rescan.
A hosted app reload cannot change this native permission handler. Select the
interface after Start MYGRAIN. Direct Web MIDI and the DAW can have driver-specific
sharing limits; this is not a new host MIDI bus.

The published ZIPs are exact CI artifact bytes, with original manifest checksums.
Evidence and before-publish rollback: output/mygrain-cef-midi-20261123T232554Z/.

- mygrain-cef-windows-0.1.6.zip: 191469669 bytes; SHA-256 `c13c4e5e188c62db3d7031e3cadbb0404799bb0b239785175191847b2718d671`.

- mygrain-cef-macos-0.1.6.zip: 267255616 bytes; SHA-256 `69846f1a05def05f5c88105bf4ffe8b7259057d5a33e338b96abbbcb62a11421`.
