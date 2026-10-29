# MYGRAIN maintenance requirements

## Server Song processing (Mark's explicit requirement, 2026-10-27)

Whenever audio/DSP, sequencing, effects, samples, or saved-part compatibility
changes, update the server Song preparation/rendering path wherever applicable
in the same task. Do not leave recent features or fixes only in the live editor.

- Trace `song-beta.js`, `song-beta-clock.js`, the isolated render deck, and
  `scripts/server-arm-worker.cjs` / `backend/mygrain_songs.py` as applicable.
- Preload asynchronous DSP before capture; render using the current app engine.
- Version audible render compatibility when an old freeze must be regenerated.
  Do not invalidate unchanged legacy audio unnecessarily or rewrite source ZIPs.
- Keep phone work to metadata and rendered PCM where possible; preserve bounded
  preparation/playback memory, original sources, account isolation and revisions.
- Verify an older source snapshot and current features through real server jobs
  in an isolated test store, then warm-cache reuse and phone playback. A passing
  live-editor test alone is insufficient for an audio change.
