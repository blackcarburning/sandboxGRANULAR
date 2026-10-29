# Server Song processing maintenance — 2026-10-27

Phone preparation now submits every new/incompatible part to the existing
account-scoped, bounded server renderer when available, not only estimates over
96 MB. Compatible saved audio and warm caches still reuse their existing files.
No source ZIP, placement, repeat, tempo or Song revision is rewritten by arming.
Desktop rendering retains its existing local/oversized-server fallback policy.

Phone Audition now uses the prepared part loop rather than recalling original
instruments/samples. Recall and Amend remain explicit live-editor loads: their
actual editing residency still has to fit the unchanged phone memory budget.
Desktop Audition retains live recall. Phone Play Song continues scheduled PCM
playback with bounded hot storage. No budgets were raised or bypassed.

The isolated render deck preloads the corrected persistent EQ processor before
scheduling/capture, so it does not record a cold graph transition. Enabled EQ
requires `channelEqVersion >= 2`; version-one active EQ refreshes once, while
legacy bypass/no-EQ audio remains reusable. The backend accepts uploads marked
`channeleq=1` or `2` for older-client compatibility, recording the exact marker.
The worker continues loading the same current app engine, source hash checks,
account scope and cancellation, with a single bounded render job at a time.

Required checks for future audio changes live in repository `AGENTS.md`.

## Verification

- JS controller/server/DSP suites: `node --test tests/song-beta.test.js
  tests/song-server-arm.test.js tests/eq-automation*.test.cjs`.
- Backend: `PYTHONPATH=tests python3 -m unittest test_song_server_arm
  test_channel_eq.EqSongApiTests test_eq_automation`.
- Disposable server (not production):
  `MYGRAIN_TEST_ROOT=/tmp/mygrain-server-refresh-store-v2
  MYGRAIN_TEST_ADMIN_PASSWORD=isolated-render-refresh-fixture
  python3 tests/song-beta-test-server.py 18959`.
- `node tests/song-server-refresh-browser.cjs`: Chromium/WebKit phone emulation,
  real server jobs, current EQ and genuinely pre-EQ archives, a deterministic
  linear signal path for the EQ comparison, zero phone source
  downloads or local DSP rendering, exact source hashes/revisions, warm reuse,
  saved PCM playback, cached Audition, and one-time stale-EQ refresh retaining
  the legacy neighbour. A 135 MB source-preparation estimate is injected without
  allocating that much source audio on the simulated phone; the server sees
  the real fixture archive. This is not a test of Mark's unidentified Song.
- `node tests/eq-live-sweep-browser.cjs`: manual EQ still uses persistent DSP.

Backup: `backups/song-server-refresh-20261027T204531Z/`. Restore only the changed
files, not account/Song stores, and restart `fs7300-documenter.service` after
backend rollback. No production sources were rewritten in these checks.

## Random space switch reset — 2026-10-27

Randomised parts persist explicit delay/reverb bypass flags in `modes.loopFx`;
the current shared engine used by the render deck already honours these flags.
No server-only DSP fork or render-version bump is needed: recalled existing
sources sound unchanged, and only newly randomised settings change. Existing
Song archives/renders are not rewritten. The server-refresh browser fixture now
sets nonzero hall/delay amounts with both switches false, verifying genuine
bypass survives source capture, real server jobs, warm cache and phone PCM
playback, for both current and pre-EQ archives. Phone budget remains 96 MB.
