# Arm Cache preparation

## Metadata fast path (2026-10-22)

Audio rendering, duration, playback scheduling, memory budgets, cache identity,
editing leases and saved Song/source schemas are unchanged. iPhone/iPad still
render one part at a time; desktop retains its existing parallel selector.

The Song-list response advertises `features.partManifests: 1`. Clients that see
this capability can request a small JSON compatibility manifest instead of the
complete editable ZIP:

`GET /mygrain/api/songs/{song}/parts/{occurrence}/manifest?sha256={source hash}`

The endpoint uses normal library/account authorization and resolves reused
occurrences to their source. A stale hash fails with HTTP 409. It validates the
original archive hash, ZIP entries and WAV contents on the server before
returning its exact `song-part.json` snapshot. It never changes the saved Song,
source archive, history or render. The response is `no-store`.

An in-process LRU retains only JSON bytes, capped at 8 MiB and 64 entries. Keys
include the resolved source path, source SHA-256, device/inode, size, nanosecond
mtime and ctime. Amendments, cross-account paths and on-disk changes cannot
reuse a previous identity. A backend restart simply clears this expendable
cache; no migration or cleanup of saved files is needed.

The adapter uses the same snapshot normalization, inventory, Q and Roll timing
validation for both metadata and full archives. Normal rendering/recall still
download and validate the complete archive. A genuine legacy compatibility
upgrade fetches the full archive before passing through the existing guarded
save path. Old servers without the capability keep the previous behavior.

Consequently, a current uncached part downloads its original audio once rather
than twice. A current part with a compatible saved render does not download its
original audio merely to check compatibility. Existing render integrity checks
and browser-storage reuse remain in force.

## Focused verification

- `python3 -m unittest discover -s tests -p 'test_song_manifests.py'`
- Existing backend Song, lease, reuse/copy and Roll suites.
- Controller/adapter tests in `tests/song-beta.test.js` and
  `tests/song-beta-compatibility.test.js`.
- `tests/song-arm-metadata-browser.cjs`: disposable localhost accounts, real
  audio, desktop/iPhone UA and touch contexts, cold/warm/reload requests, exact
  saved render hash reuse, audible ending Roll. `ARM_BASELINE=1` records the old
  behavior; `ARM_ENGINE` and `ARM_MODE` optionally select a single case.
- `tests/drum-roll-browser.cjs`: existing full-length 128-step Roll regression.

Run browser checks only against `tests/song-beta-test-server.py` with an
isolated localhost URL. Do not create test Songs or accounts on production.
Transfer reductions are not equivalent to rendering-speed improvements:
uncached audio capture still runs in real time in the browser.
