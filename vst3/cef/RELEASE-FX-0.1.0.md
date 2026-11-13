# MyGrain CEF FX 0.1.0 preview

A separate stereo insert effect using the existing FX 0.4.0 processor and the
CEF instrument's embedded browser architecture. Full private CEF runtime in
both bundles; current hosted MYGRAIN app still requires internet.

- Native build source: `ad752c224fb87b3e97e3e8a8b8626822f66fd117`.
- Factory CID: `2642D59B6C824E319ADE03F7B8562C10`; category `Fx|Filter`.
- CEF 156.0.28 / Chromium 156.0.8078.88, pinned SDK checksums.
- Windows x64; macOS 13+ universal arm64 + x86_64.
- Whole bundle installation; no separate Chrome window or installation.

Native build run: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/43440471439

## Verified

Both native runners passed all 47 SDK validator checks, the existing FX
impulse/PDC/rate/float/stereo/bypass/offline/allocation tests and CEF preview
checks. Native-host integration measured the actual VST3 callback PCM for gain,
mute, four routes, LPF attenuation, dry/wet, bypass, offline aligned dry, sustained
silent-browser FX clock without gestures, closed-editor processing and auto-store,
manual Store, real document reload and fresh-instance editable source/settings
recall. Real native login typing/focus and remembered sign-in were exercised.

The macOS ZIP was extracted and its distinct installer executed on the native
runner; installed SDK validation, universal architectures and deep/strict ad-hoc
signatures passed. It is not Developer-ID signed/notarized. Native Intel runtime,
physical DAWs/devices/recording alignment, international IME and multi-instance
performance remain untested. The existing one-second latency and real-time-only
processed printing are unchanged; native offline bounce falls back to dry.

The helper's FX-only zero-output automatic-pull node keeps the silent browser
clock real-time; no test signal, effect algorithm or server Song render changed.
It excludes OfflineAudioContext. Pre-fix Mac diagnostics measured the browser
clock at 0.3381x real time after 30 seconds, growing queues and late dry fallback.
See `FX.md` and `fx_clock.h` for the clock and test-fixture rationale.

All 28 previous release archives remained byte-identical. Both final HTTPS
attachment responses and actual setup-page browser clicks were checked against
the local complete archive size and SHA-256; each archive's checksum manifest
was verified. Reports are in the private local release evidence directory.

## Published files

- `mygrain-cef-fx-windows-0.1.0.zip` — 191,475,508 bytes; SHA-256 `c7bde13e958bdade0b3260556ad21f3ab69239454040544a015983f71071477e`.
- `mygrain-cef-fx-macos-0.1.0.zip` — 267,223,216 bytes; SHA-256 `dba359fc18bc94ae225dfce7bc5a9b52d221a52da63f1aeb22d0c22ced9b25c1`.

Setup: https://openclaw.blackcarburning.com/mygrain/cef-fx-setup.html
