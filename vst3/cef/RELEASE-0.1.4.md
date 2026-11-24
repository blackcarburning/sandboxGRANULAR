# MyGrain CEF 0.1.4 preview — focused Space passthrough

Setup/downloads: https://openclaw.blackcarburning.com/mygrain/cef-setup.html
Validated native source: `cc0364da96780326f8d1e37ba77dea167dc762e0`
Native CI: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/43493238040

## Changes

Space belongs to the DAW transport while the CEF plugin/app has focus, including
over focused app buttons. Both IPlugView callbacks return kResultFalse without
queueing Space into CEF unless an editable text field is active. Windows native
fallback forwards original down/up to the host parent; AppKit uses its normal
responder chain. Duplicate native delivery and Windows character events are
suppressed after host routing. The down/repeat/up route remains consistent if
editable focus changes while held, and resets on native blur.

Chromium reports editable-node focus across private IPC as a boolean only.
Text/password inputs, textareas and contenteditable retain ordinary spaces.
Native dialogs keep normal OS keyboard handling. Replace the whole CEF bundle:
its private display/input IPC is now version 3, not the saved project protocol.

Synthesis/DSP, main/preview PCM, DAW transport synchronization, Song rendering,
source audio, project schemas and automatic storage are unchanged. Standard
external-browser Space controls, CEF FX installers and earlier archives remain.

## Verification

Windows x64 and native Apple Silicon macOS passed focused body/button Space
passthrough using both VST3 and actual native-window delivery, host-parent/
responder reception, text/password/textarea/contenteditable spaces,
virtual-key-only Space, and duplicate native delivery suppression. No Space event
or default button action reached the app outside text editing. Held-key focus
changes also passed a local check of the shared routing class.

Existing native login/editing/blur, remembered-session/logout, repository dialogs/
exports, preview/main PCM, toolbar, closed-editor audio/automatic store, real app
reload, fresh project recall and clean-unload checks passed. SDK validators passed
47/47 on each platform. The Mac final ZIP's installer, installed validator and
deep/strict ad-hoc signatures passed. Universal plugin/helper/framework slices,
Windows imports, all checksum entries, full HTTPS attachment bytes and actual
setup-button browser downloads were inspected and verified.

Cubase and other physical DAWs/devices, native Intel execution and IME remain
unverified. Mac is ad-hoc signed, not Developer-ID signed/notarized.

## Install

Close Cubase/the DAW fully, replace the WHOLE MyGrain CEF bundle using the platform
instructions, then rescan VST3. Reloading only the hosted app does not update
native keyboard handling. Click the app's Start/Stop controls for local transport.
Arm still follows the DAW; Stop disarms. Normal DAW project Save is still required
to write the latest completed automatic snapshot to disk.

## Archives

- `mygrain-cef-windows-0.1.4.zip` — 191462677 bytes; SHA256 `4b1db63f82bbdde5701ce821cc41a0930679cd2d4b236bc5dc78dd053267f0e9`
- `mygrain-cef-macos-0.1.4.zip` — 267226357 bytes; SHA256 `2fb82b50ca604e9749ec5c7ea4395b022571891e6c3b5e77c0113c76f9397bcf`
