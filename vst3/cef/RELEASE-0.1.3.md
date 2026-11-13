# MyGrain CEF 0.1.3 preview — sign-in, exports and preview audio

Setup/downloads: https://openclaw.blackcarburning.com/mygrain/cef-setup.html
Validated source: `b998dc0b5fbccd0173d3726f74c938f5068dd8c6`
Native CI: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/43292981528

## Changes

- Remember the authenticated MYGRAIN session across complete plugin unloads and DAW restarts. Log in once after installing, then the server's existing session expiry/revocation applies. Logout forgets it. No raw password is saved; no cookie/password is placed in DAW project state. Windows uses user-bound DPAPI; Mac uses a private 0700 directory and 0600 file. Each plugin keeps its own temporary browser/patch profile, avoiding shared-profile locks.
- Support actual native, modeless prompt/confirm/alert dialogs so WAV Repository export can include its editable patch ZIP and both repositories can accept filenames. OK/Cancel continue the original CEF callback; navigation cancels outstanding dialogs. Exports retain their existing engine, authentication and repository rules.
- Capture browser media/Web Audio previews into a separate bounded native preview bus. WAV-browser playback and decoded loops, independent widget contexts and inline main-bus auditions reach DAW output while main transport is stopped/disarmed. Native output resamples to the host rate and discards stale/offline preview buffers. Explicit CEF mute was removed because it also muted captured PCM.
- Enable main-bus idle audition only for the embedded `mygrain_cef=1` mode; normal external Bridge tabs retain their silent sink. Active main-patch streaming is not duplicated into previews. Main transport still starts disarmed on a new instance: Arm then DAW Play for synchronized main playback. The toolbar distinguishes DAW sync from previews.
- Preserve 0.1.2 toolbar/auto-store features and existing synthesis, Song rendering, saved patch/state and main PCM protocol. Automatic snapshot storage still requires a normal DAW project Save for disk persistence.

## Verification

Windows x64 and native Apple Silicon macOS release runners passed remembered sign-in across a full unload and fresh helper, logout plus a further signed-out relaunch, password/session exclusion from project state, original native keyboard/focus input, actual native filename/confirmation/cancel controls, actual WAV+editable ZIP and PCM24 Loop Store payloads, cancelled-export suppression, stopped/disarmed WAV/decoded-loop/widget/inline preview PCM and pause/close silence. Export payloads were additionally accepted by the live backend validation functions without writing to production repositories; Loop Store exact-cut frames and peak normalization passed.

Both native suites retained toolbar/interval/manual-store/unchanged-skip, main audio, closed-editor automatic store and audio, UI-thread project dirty notification, real-document reload, fresh editable patch/source/preferences recall and clean unload checks. SDK validators passed 47/47 each. The Mac ZIP's checksum/signature-verified installer, installed validator and deep/strict ad-hoc signatures passed. Plugin/helper/framework universal architecture slices and Windows native executable imports were inspected. Final native surfaces were reviewed.

Every archive manifest entry was verified. Both full HTTPS downloads returned 200 with exact attachment filenames and byte-matched runner ZIPs. Actual setup-page browser clicks downloaded the same bytes. All 24 earlier archives and protected live synthesis/Song/project files remain unchanged. Production accounts/repositories were not used by tests.

Physical DAWs/devices, native Intel execution, multi-instance performance and international IME remain unverified. Mac is ad-hoc signed, not Developer-ID signed/notarized.

## Install and playback

Close the DAW fully, replace the whole CEF bundle with the platform installer/instructions, then rescan. Log in once after updating. Reloading only the hosted app cannot update native behavior. Preview playback does not require Arm or DAW Play, but the DAW must process the track: enable monitoring if it suspends stopped instruments. Previews are not included in offline bounce.

## Archives

- `mygrain-cef-windows-0.1.3.zip` — 191459879 bytes; SHA256 `3c4eeba7c052116bec83deb0151c971dfc3dfa2a5eb8d087c54c9eb0097591a8`
- `mygrain-cef-macos-0.1.3.zip` — 267216903 bytes; SHA256 `99c70233c4fac31f804bd4f4d7d4796a233388a23910e68364bd890b126c3fd0`
