# MyGrain CEF 0.1.1 preview

Setup/downloads: https://openclaw.blackcarburning.com/mygrain/cef-setup.html

Validated source: `0b9777ea1a514276919097f77d745e01293c51f6`
Passing native CI: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/43272506419

## Repair

- Implement VST3 IPlugView keyboard/focus callbacks, not just native window input.
- Translate Steinberg key codes/modifiers and Unicode text into CEF events; preserve macOS native hardware key identity and character events for editing.
- Restore browser focus on clicks, release host keys on blur, and suppress duplicate native delivery after the host uses its SDK keyboard path.
- Route explicit editing shortcuts to Chromium's focused frame.
- Keep completed browser pixels under Windows paints; use an AppKit backing layer and browser-only damage instead of clearing the whole surface.

This requires replacing the whole native CEF bundle with the DAW closed, followed by rescan. A hosted-app reload does not install the native fix. Same instrument class ID; DSP, audio/project protocol, state layout, Live/Rendered behavior and component-owned auto-store are unchanged. Existing Bridge/FX and CEF 0.1.0 archives remain available unchanged.

## Verification

Both Windows and Apple Silicon macOS native runners passed signed-out login typing through native and VST3 input, punctuation, Tab, Backspace, Ctrl/Cmd+A, Enter submission, blur/re-focus and duplicate suppression. Authentication requests used synthetic data and isolated routes, not production accounts. The harness acknowledges each key before sending another.

Both passed SDK47/47, native PCM, automatic editable patch storage (15-second check after sample/history/generation loads settle), continued native PCM and storage with editor closed, UI-thread dirty notification, real full-document reload, fresh editable source/patch/preferences recall and clean unload. Mac final ZIP extraction, supplied checksum/signature-verifying user-local installer, installed SDK47/47 and deep/strict ad-hoc signatures passed. Universal plugin/helper/framework slices inspected.

Physical DAWs/devices and Intel runtime are unverified. International IME and OS-file drag/drop remain unsupported. Not Developer-ID signed/notarized. Repaint code was repaired; no physical DAW flicker observation is claimed.

## Archives

- `mygrain-cef-windows-0.1.1.zip` — 191374675 bytes; SHA256 `18ed82fdf928bdc263227d64598b975889364580790c7f9b3d6a60341ecf1415`
- `mygrain-cef-macos-0.1.1.zip` — 267159131 bytes; SHA256 `4d6b966071642229e8e29af4d492dbfbdcece8c0aba8584879d309e6056c471a`
