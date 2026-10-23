# Server preparation for oversized Song parts — ARM.4

Arm Cache keeps the existing 96 MiB phone/tablet and 192 MiB desktop source
preparation limits. For an authenticated account, when a part without a compatible
saved render exceeds that limit, Arm automatically requests server preparation.
The device reads the small part manifest, waits for the server job, and downloads
only the finished PCM16 playback WAV. Normal local preparation and saved-render
reuse are unchanged. No source ZIP is downloaded to the phone for this fallback.

## Same audio engine, bounded work

`backend/mygrain_server_arm.py` queues at most four pending jobs and runs one
`scripts/server-arm-worker.cjs` Chromium process at a time. The worker opens the
current loopback app, restores the saved part, and uses the existing isolated
Web Audio renderer. Only this worker gets a 512 MiB preparation budget; the device
limit is not increased. Node has a 1536 MiB JavaScript heap limit, and each worker
has a duration-derived 120–600 second timeout, after which its process group is
killed. These accounting/heap bounds are not a total Chromium RSS guarantee.

Jobs are keyed by account storage root, Song, canonical source ID and SHA-256.
Concurrent requests for the same source share a queued/running job. Completed
status is retained for polling, but a fresh POST can retry a previously completed
job if its render is no longer usable. Finished job records expire after fifteen
minutes and the in-memory registry is bounded. Queue overload returns a retry
message. An unavailable worker host does not advertise the feature.

## Originals and accounts

The authenticated endpoint resolves the caller's own Song and checks the source
hash. A reused source is rendered through a visible placement ID. The browser
worker rejects off-origin requests and every mutation except the exact target
part's existing `/render` upload endpoint. It cannot convert, amend or overwrite
source archives, acquire edit locks, change the arrangement or write another part.
The render endpoint independently checks the source hash before saving. Derived
playback preparation does not require the Song editing lease.

The caller's session cookie is passed through private subprocess stdin, never
command-line arguments, job status, files or logs. Its payload is cleared on job
completion. The worker uses only loopback URLs. The backend/worker scripts are
outside the public static-file allowlist.

The client accepts only render metadata matching its existing Song ID, revision
and source SHA-256. It does not replace arrangement or editable source state from
a job response. Cancel Arm stops the device's wait; the bounded server job can
finish and save the render for a later Arm. Restarting the backend loses pending
job status; Arm can retry without changing source audio.

## Dependencies and verification

The deployed host needs Node, the workspace's `playwright-core`, and Chromium at
`/snap/bin/chromium`. Audio decode on the phone resamples the finished WAV to the
device AudioContext rate as usual.

Focused tests:

```
node --test tests/song-server-arm.test.js
python3 -m unittest discover -s tests -p test_song_server_arm.py
```

`tests/song-server-arm-browser.cjs` explicitly requires a named `K server test`
Song copy on a loopback server. It tests Chromium/WebKit phone emulation, the
96 MiB branch, cold server preparation, warm reuse, 44.1/48 kHz playback, zero
phone source-ZIP downloads during Arm, unchanged source hashes/revision, and no
remaining preparation reservations. `SERVER_ARM_CONVERT=1` first converts only
that test copy using a server-sized 512 MiB test preparation allowance, verifies
all twelve snapshots, then restores the 96 MiB phone allowance before Arm. It
does not relax the shipping phone conversion budget or establish that on-phone
conversion can rewrite arbitrary large archives. This is not a physical iPhone
memory measurement.

When investigating real Songs, make and checksum a protected full backup first,
create a separately named test copy, and verify original checksums again after
testing. Do not test conversion against the user's original Song.
