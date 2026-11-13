# MyGrain CEF 0.1.0 preview — delivered

- Downloads and setup: https://openclaw.blackcarburning.com/mygrain/cef-setup.html
- Windows x64; macOS 13+ universal Apple Silicon/Intel. Separate instrument ID A44B25E13DE64853A16CC63921C9D4B2. Bridge0.8.0 and FX0.4.0 unchanged.
- Validated source: 210263a34274ce430b8598f109d77fbc4cb722e8 on branch mygrain-cef-20261112.
- Passing native build/release run: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/43233804959
- Pinned CEF156.0.28/Chromium156.0.8078.88; Steinberg SDK3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96.

## Verified

47/47 SDK tests on each platform. Actual Windows and Apple Silicon macOS CEF helpers/native plugin hosts: native input, output PCM, automatic full/delta stores while editor closed, UI-thread dirty notification, genuine full-document reload, fresh editable patch/source/auto-interval recall, and clean native teardown. Mac final ZIP extraction, checksum/signature-validating supplied installer, installed SDK47/47, universal plugin/helper/framework slices and deep/strict ad-hoc signatures verified.

Public endpoints returned200, application/zip and exact attachment names; complete HTTPS payload SHA256 matched native-runner ZIPs. Actual browser clicks from existing setup to CEF setup and both download buttons saved identical ZIPs. All20 old release archives and frontend/index/daw-project/daw-bridge files remained byte-identical. Only new route allowlist entries, attachment names and an existing setup-page CEF link were added. Shared service active, frontend remains v2026.11.12.AIFX.1.

## Auto-save / lifecycle

Existing project implementation is unchanged. Default On/60sec, configurable15–3600; check execution tested at15sec while editor closed. Save the DAW project normally to persist the latest completed snapshot to disk. The browser/helper belongs to the component, not the editor. Keep renderer active without was_hidden and declare macOS user-requested latency-critical activity (idle system sleep allowed), since muted speaker output cannot be relied upon to prevent App Nap. Native macOS diagnostic PCM remained0.009629RMS with zero underruns across close.

Store+reload waits for an acknowledged snapshot and navigates with a fresh cef_reload query, not merely the #daw fragment. New instances/reload fetch the hosted app, never the frozen CI frontend fixture. Profiles are temporary/per-instance; sign in each fresh instance. Runtime/protocol/security upgrades may need a plugin release.

## Preview limits

Physical DAWs/drivers/devices, native Intel runtime, multi-instance load and international IME are not verified. OS-file drag/drop/IME are not integrated; use file pickers/click controls. Mac signing is ad-hoc, not Developer ID/notarized. Existing Live/Rendered timing and offline boundaries are retained; no new DSP, Song schema or automation.

## Archive identities

- mygrain-cef-windows-0.1.0.zip: 191373252 bytes; SHA256 `211a59b4bd4eb760f6622a93166b35c3ff31b0a9b9d828ce43b0c1eafcc16e37`
- mygrain-cef-macos-0.1.0.zip: 267153021 bytes; SHA256 `a21d4c2729c88646e9c9ccdba824bcf5bba8d7c6553b8865fc2e7270645033db`
