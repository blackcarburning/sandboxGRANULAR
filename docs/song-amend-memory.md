# Stopped editing preparation

Recall/Amend uses `recallEditable`, not the server-rendered playback cache. Its
source loader reads and validates one WAV at a time, deduplicates exact sources,
transfers decoded ownership, and preserves unsaved live sounds with a temporary
IndexedDB rollback checkpoint when necessary.

`beginEditingPreparation()` stops live playback and parks common loop effects.
The host replaces the graphs with wet-disabled graphs and clears its impulse
cache: merely disconnecting an old delay graph would retain DelayNode storage.
Saved knobs remain untouched; graphs created or restored during preparation
also remain parked. The idempotent cleanup restores effects after sequential
source persistence or rollback and releases the preparation reservation.

Before planning, inspect the current editor's residency and worst-case hash
copy. A large inherited editor is not itself a newly allocated preparation:
when hashing would exceed admission, skip optional live-source reuse and park
that editor in a chunked checkpoint. The checkpoint writes one explicitly copied
Float32 chunk (at most 1 MiB) per awaited transaction. Structured cloning a view
of a large backing channel is not bounded; use a slice. Reads validate each
chunk's dimensions and SHA-256 before restoring its exact native-rate PCM.

Inherited residency is rollback-only credit during checkpoint transfer. Charge
at most 2 MiB of PCM copies plus 4 MiB of checkpoint headroom in this phase,
then release the old deck before decoding the replacement. Rollback can restore
only the previous measured resident deck, never an oversized new part. The
replacement plan must independently fit the unchanged preparation budget. A
rejected new deck or failed checkpoint never detaches current audio; failed
post-detachment loads restore the complete previous snapshot and source aliases.

While parked, replacement admission charges source/transfer/persistence copies,
dry/pre-delay graph overhead and noise headroom, not future renderer dual-bank
convolution/FFT/crossfade allocations. Ordinary render admission, server engine,
render compatibility markers and the phone's 96 MiB limit are unchanged.
If the parking host is unavailable, retain the conservative full DSP estimate.

Verification:

- `node --test tests/song-beta.test.js tests/effect-idle.test.cjs tests/loop-card-fx.test.cjs`
- Run `tests/song-beta-test-server.py` against disposable local stores with
  `MYGRAIN_TEST_ADMIN_PASSWORD=isolated-edit-fixture`, then run
  `tests/song-amend-memory-browser.cjs` with `MYGRAIN_TEST_URL` targeting it.
  This covers a populated current editor whose initial admission exceeds the
  reduced limit, wet saved parts, corruption, cancellation,
  checkpoint quota failure, original PCM recovery, repeated Amend/Save and Undo.
- `node tests/effect-idle-browser.cjs` uses read-only live API fixtures to verify
  desktop/phone Chromium/WebKit bypass and real audible effect resumption.
- `tests/song-server-refresh-browser.cjs` uses a separate disposable server seeded
  with its test-only password to verify actual server jobs and phone playback.

A private local copy of the reported legacy chorus was also tested without
writing its production Song: 30 WAV hashes matched after editing capture (the
redundant legacy K render equals its raw source), with an 85 MiB peak admission
reservation. This is a reservation measurement, not native iPhone heap profiling.

Follow-up verification recreates the submitted log's 135 MiB initial admission
with an inherited 103 MiB editor, including an 86-second mono M recording and
multiple K sources. Chromium/WebKit both load the legacy chorus at an 85 MiB
replacement reservation; forced cancellation restores all inherited Float32
checksums. The 103 MiB is existing editor residency, not an allocation admitted
by the replacement preparation budget. Tests are emulated, not physical-device
heap measurements.
