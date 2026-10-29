# Fast iPhone WAV auditions

Desktop native WAV streaming is unchanged. iPhone/iPad use the existing WebAudio
player and `loadLoopAudioResponse`, but first request a much smaller AAC listening
copy from `/mygrain/api/wav-preview-fast`. Copies are stereo 48 kHz, AAC 192 kb/s,
and can have codec padding. They are for audition only: WAV downloads, patch ZIPs,
Song inputs/renders, editable samples and export compatibility are unchanged.
If the service or decoder fails, the player retries the original WAV endpoint.
It retains one decoded buffer, requests nothing until Play, reuses it for replay,
and releases it on selection change, Close, account change or lock. Existing
32 MiB encoded/64 MiB decoded limits remain in force.

## Deployment

- Backend: `backend/mygrain_wav_preview.py`, Python standard library plus system
  `/usr/bin/ffmpeg` (AAC encoder).
- Unit: `deploy/mygrain-wav-preview.service`, installed and enabled as
  `mygrain-wav-preview.service`; loopback `127.0.0.1:8766` only.
- Caddy: exact `/mygrain/api/wav-preview-fast` handler **before** `/mygrain/*`,
  reverse proxy to `127.0.0.1:8766`. All other app routing stays as before.
- Foreground priority: Nice -5, CPUWeight/IOWeight 1000, I/O priority 2. Two
  foreground encoder slots plus a separate low-priority watcher encoder.
- Watcher scans active accounts every five seconds, newest WAVs first. Requests
  generate immediately, without waiting for the polling interval or an app
  account-storage/render lock. Same-source simultaneous encodes are deduplicated.
- Private derived cache: `/var/cache/mygrain-wav-preview` (0700; files 0600),
  stat/version/account-keyed and limited to 512 MiB. Only derived copies can be
  evicted. Never publish this directory or add it to a static-file allowlist.
- Every request revalidates the existing session, active approval, identity
  header, account root, regular nonsymlink source file and current source stat.
  Cached audio grants no access if the source was removed/replaced. No shared
  browser/proxy cache is permitted. The service does not initialize or mutate the
  account database or original repositories.
- `X-Mygrain-Preview-Cache`, `X-Mygrain-Original-Bytes` and `Server-Timing` allow
  diagnosis without exposing authentication credentials.

## Checks

`python3 tests/test_wav_preview.py -q` uses disposable stores and real FFmpeg/HTTP:
AAC duration/size, private cache reuse, concurrent request deduplication, account
isolation, source replacement/deletion, lock independence, prewarming and retry.

`tests/song-beta-test-server.py` exposes the same service handler in its isolated
store. Seed `admin/wavs/one.wav` and `two.wav`, run on port 18933 with a disposable
admin password, then run `node tests/wav-iphone-preview-browser.cjs` (Chromium and
WebKit). Tests cover actual decoded audio, seek/pause/replay, single-buffer budget,
close/lock cleanup, exclusive selection and failure/retry.

`tests/wav-iphone-speed-browser.cjs` measures actual tap to WebAudio start at
100,000 bytes/s and 80 ms latency. Set `MYGRAIN_PREVIEW_BASELINE_HTML` to an exact
pre-change HTML backup for an apples-to-apples old/new test, and
`MYGRAIN_PREVIEW_EVIDENCE` to save JSON. This is emulated iPhone networking, not a
physical iPhone measurement. Changes are preview transport only; do not version
Song DSP or regenerate existing original renders for this change.

Initial backup and verification evidence are under
`../output/mygrain-iphone-wav-fast-20261028/` in the workspace (not public URLs).
