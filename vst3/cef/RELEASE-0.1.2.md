# MyGrain CEF 0.1.2 preview — native toolbar and save activity

Setup/downloads: https://openclaw.blackcarburning.com/mygrain/cef-setup.html
Validated source: `cdd3d21ec098f08fe6ac8f9432ae20112e9b9fd2`
Native CI: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/43277640404

## Changes

- App-matched rounded gradient native buttons: blue actions, green armed/auto-save states and red Stop; visible keyboard focus. Controls remain reachable at the minimum 800px width.
- Explicit **Auto-save: On / Off** and **Every (s)** input with Apply. Default On / 60 seconds; accepts 15–3600. Invalid values leave the existing interval intact. A typed value is not overwritten by ordinary status ticks.
- Two persistent info lines: disarmed/DAW transport status and current app/storage activity; last completed-store time/duration, transferred payload/full patch size, completed/unchanged counts and next check/paused/storing state.
- Retain the existing component-owned automatic-storage implementation, project preferences, manual Store now and store-before-reload protocol. Stores continue with the editor closed. **Save the DAW project normally** to write the latest completed snapshot to disk; this does not invoke DAW File > Save.
- macOS controls explicitly use Dark Aqua so the interval stays legible. No synthesis, samples, DSP, Song rendering, PCM protocol, saved-state format or instrument class ID changes.

## Verification

Windows x64 and Apple Silicon macOS native runners passed the actual toolbar On/Off toggle, invalid and valid intervals/Apply, manual store, automatic store, unchanged skip, status labels and minimum width. Both also passed native/VST3 login input, PCM output, continued PCM and automatic storage with editor closed, UI-thread project dirty notifications, safe real-document reload, fresh editable source/patch/preferences recall and clean unload. Each SDK validator passed 47/47. Mac final ZIP extraction, checksum/signature-verified user-local installer, installed SDK validation and deep/strict ad-hoc signing passed; universal native plugin/helper/CEF framework slices inspected. Final native toolbar screenshots reviewed, including the corrected Mac field contrast.

Every archive manifest entry was verified. Both full HTTPS downloads returned 200 with exact attachment filenames and byte-matched runner ZIPs. Actual setup-page browser clicks downloaded the same complete bytes. All 24 older release ZIPs and the protected live frontend/audio/project modules were preserved byte-for-byte. Only native CEF source, setup/versioned downloads and narrow public attachment routes changed.

Physical DAWs/devices and native Intel execution remain unverified. Existing preview limits (IME and OS file drag/drop, Mac not Developer-ID signed/notarized) remain. This is a toolbar/storage-visibility update, not a change to the audio engine.

## Install

Close the DAW fully, replace the **whole** native CEF bundle using the supplied platform instructions, then rescan. Reloading only the hosted app cannot update native toolbar controls. Existing Bridge/FX downloads remain unchanged.

## Archives

- `mygrain-cef-windows-0.1.2.zip` — 191394815 bytes; SHA256 `1df6abb8f09d13afbb4f46c4801f1245e0d2f15ef3181ffc2a86105355dde01f`
- `mygrain-cef-macos-0.1.2.zip` — 267170652 bytes; SHA256 `e4594628a5465ddb7068f275209a1389b896332a6d1765ec745933400d74beef`
