# Amend readiness (AMEND.2)

## Behavior

Pressing Amend now immediately identifies the selected row as **Preparing
amendment** and reports editing access, original-source download/check/decode,
and settings restoration. This is deliberately not the brown/orange ready
shading. That shading and Save Amendment become available only when restoration
has succeeded. A failed or cancelled preparation removes the pending indicator;
losing the verified editing lease during loading cannot activate the draft.

Amend restores original editable audio, not the frozen Song playback mix. Large
original archives can therefore take appreciably longer than playing an already
armed Song. The first download still depends on the connection and source size.

## Optional source reuse

A separate, account-scoped IndexedDB database (`mygrain-song-sources-v1`) caches
up to **64 MiB of encoded original archives**. It does not retain additional
decoded AudioBuffers, alter phone preparation concurrency, or replace server
storage. Oldest-written archives are evicted atomically to stay within the cap;
archives larger than the cap are not cached. Blocked/full storage falls back to
the server. Source keys include the library, Song, shared source and exact archive
SHA-256. Reads check the full archive hash and the existing complete ZIP/audio
manifest validation still runs. Damaged optional cache entries are discarded and
re-downloaded; a corrupt server archive still fails closed. A changed source
hash cannot reuse its predecessor. Browser quota eviction is harmless.

No Song/snapshot format, backend endpoint, renderer, DSP, source PCM encoding,
server revision checks or Save Amendment semantics changed. Re-amending the
currently recalled part continues to keep unsaved live edits. Clearing browser
data is neither necessary nor recommended.

## Verification

Use disposable localhost accounts/stores only:

```sh
python3 tests/song-beta-test-server.py 18896
node tests/song-amend-loading-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18896/mygrain/ node tests/song-amend-randomisation-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18896/mygrain/ node tests/song-amend-roundtrip-browser.cjs
```

The loading test uses an intentional 1.2-second download delay, native Amend
buttons, Chromium/WebKit desktop/phone emulation, genuine saved archives and
IndexedDB. It checks truthful pending/ready states, released-source and page-
reload reuse, corrupt-cache recovery, exact recalled samples, bounded eviction,
overwrite and deletion. Unit tests additionally cover optional/oversized storage,
failed lease acquisition, library/Song separation and lease loss during loading.
The existing regressions verify draft randomisation, guard rejections, Save/
recall, exact PCM hashes, unchanged-render reuse and changed-part-only rendering.
Physical iPhone/Android and the user's connection were not measured.
