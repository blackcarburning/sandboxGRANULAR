# Server-only K conversion — KCONV.1

**Convert K to 5 tracks** always calls `POST /mygrain/api/songs/{song}/convert-k`.
There is no phone/desktop source-ZIP download, rewrite, encoding or upload, and
no local fallback. The operation does not Arm, recall over the live pattern, or
save an outstanding amendment. Stop playback and finish the amendment first.
Normal Song ownership, edit lease and exact `If-Match` revision checks apply.

The backend invokes `scripts/convert-k-snapshot.cjs`, which imports the same
canonical `k-multitrack.js` migration as the app. This is metadata-only Node work,
not Web Audio or Chromium rendering. Existing single-K takes map to K1; version
one five-track Songs retain all five takes, lengths, mix and pan, with their old
shared processing migrated per track. Version two snapshots are validated and
left alone. Recorded audio and unrelated settings are unchanged.

## Transaction and memory behavior

- Each active unique source is processed once, including sources whose original
  placement was deleted but which remain referenced through reused placements.
- A process-global conversion lock serializes conversions across account roots.
  The normal account/storage lock protects a Song during its transaction.
- Settings use the existing 2 MiB metadata limit. Node has a 128 MiB heap limit
  and a 15-second per-part timeout. Supported archives retain the existing
  128 MiB per-part saved-format limit. Conversion never allocates decoded audio.
- WAV entries stream in 1 MiB chunks and are checked against the original
  validated per-asset SHA-256. The completed archive also passes normal complete
  Song-part validation. All parts stage to disk, not an all-Song RAM buffer.
- The editing lease/revision is checked again before publication. New uniquely
  named archives are hard-linked into place without overwriting any existing
  file. One atomic Song-manifest replacement commits all changed parts in one
  Song revision. Any earlier error removes staged/published new files and leaves
  the original manifest and sources unchanged.
- Old archives and per-part history are retained. Existing playback WAV files
  remain byte-identical; their metadata is rebound to the converted source SHA.
- Repeating conversion on an already-current Song returns `converted: 0` without
  a revision bump or new files. It is safe to use the button repeatedly.
- A cancelled/late response does not replace another selected Song or newer
  client state. If a request disconnects after the server commits, Refresh Songs
  reconciles that committed result; exact revisions prevent a stale overwrite.

## Arm is not a source migration

Arm previously attempted full compatibility ZIP upgrades before its oversized
render fallback. A 61.6 MB legacy archive needed roughly 197 MB for that rewrite,
so it failed the phone's 96 MiB budget before reaching server rendering.

Automatic Arm compatibility checks now normalize legacy empty lanes and K state
in metadata only. They do not acquire edit access or rewrite source ZIPs. Actual
oversized audio rendering still uses the bounded server renderer introduced in
ARM.4, and the phone fetches only the finished playback WAV. Device memory limits
are unchanged. The older programmatic non-K compatibility helper retains its
original admission/lease checks, but explicitly rejects five-track K migration
so it cannot be used as an accidental device-side conversion path.

## Verification

- `tests/test_song_k_server_conversion.py`: real canonical migration, unique and
  hidden reused sources, exact WAV/render preservation, whole-Song idempotence,
  failure rollback, editing/revision guards and corrupt archive rejection.
- `tests/song-server-k.test.js`: server-only calls, idempotent response, stale
  generation/library/Song/revision/source rejection, malformed response checks,
  and explicit rejection of the old local K-conversion route.
- `tests/song-server-k-browser.cjs`: explicitly named test copy only, Chromium
  and WebKit phone emulation at the unchanged 96 MiB budget. Local source reads
  and ZIP conversion are replaced by throwing guards. It verifies Convert,
  repeated Convert, all five unique parts/seven placements, source-preserving
  Arm, non-silent playback and responsive widths.
- `SERVER_K_BASELINE` points that browser fixture at a pre-change controller to
  reproduce the exact 197 MB/96 MB failure without altering the live original.

Never run these fixtures against an original Song. Preserve a protected complete
backup/checksum inventory and use a separately named test copy. A browser test
is not a physical iPhone RAM/crash measurement.
