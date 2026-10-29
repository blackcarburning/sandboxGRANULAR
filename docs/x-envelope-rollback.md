# X sample-envelope rollback — 2026-10-25

Mark explicitly requested backing out any X sample-envelope changes made during the Safari click investigation, because those can affect the sound.

Live build: `v2026.10.25.X-ENVELOPE-RESTORE.1`.

## Restored

Original sample playback and preview code from the exact pre-investigation `v2026.10.25.SYNTH-EXIT.1` snapshot (`output/mygrain-noise-crackle-20261025/before/index.html`):

- Original linear attack, attack bounds and exponential decay.
- Removed added Click Guard extension, rounded attack curve and eased decay junction.
- Original region/pitch-derived duration, slide-tail/gate timing and preview/held-key timing.
- Removed the added terminal zero ramp, natural-end clamping and slide-duration solver.

Diagnostics, native voice lifecycle cleanup, source routing and existing sample/filter controls remain. The two diagnostic wrappers for removed envelope helpers were also removed. X OSC/synth voice code, scrolling/scheduler improvements, noise-meter improvements and new global FX controls were not reverted. No patch/Song/storage schemas changed and no samples or saved projects were modified.

## Verification

The audio-construction prefixes of both affected functions match the original snapshot exactly. Native PCM comparisons render the original and restored code in separate OfflineAudioContexts: 24 cases per engine across Chromium and WebKit (48 total), 44.1/48 kHz, normal/short/pitched samples, slides, ratchet windows, long attacks, preview and held-key playback. Every rendered sample matches exactly (maximum difference zero). This is original-sound parity, not an assertion that the old envelopes eliminate all clicks.

The former onset/edge smoothing checks asserted the changes the owner asked to remove. Their pre-rollback scripts are preserved in the backup; their entry points now run original-envelope parity checks instead. Portable original function fixtures and a snapshot SHA256 are in `tests/fixtures/x-original-envelopes.json`.

57 inline scripts parse; external load notes parse; diff whitespace checks pass. Public HTML/load notes are verified as HTTP 200 with exact bytes.

Before-rollback backup: workspace `output/mygrain-x-envelope-restore-20261025/before-20261025T133227Z/` (HTML, load notes and previous smoothing tests). Evidence/own patch in its parent directory. Do not reintroduce the anti-click envelope changes to satisfy historical smoothing expectations without Mark’s explicit instruction. The physical MacBook Safari crackle remains unresolved.
