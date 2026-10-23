# Bounded Song editing restore (K5.4)

Recall, Audition and Amend use a bounded source-restore path when the server advertises `partAudioAssets: 1`. Arm's renderer path and its existing limits are unchanged. This is not a saved-file migration.

## Source integrity and compatibility

- The authenticated, owner-scoped manifest includes per-WAV SHA-256, byte length and a canonical-PCM16 descriptor. Its outer source SHA must match the current part. Reused occurrences resolve to the same canonical source.
- `GET /api/songs/<song>/parts/<occurrence>/audio?sha256=<source SHA>&key=<manifest key>` returns only a validated listed WAV, never an arbitrary archive path. Hash changes return conflict; foreign owners, traversal keys and corrupt originals fail closed.
- The server verifies the full ZIP once per file identity/hash and keeps only bounded JSON metadata in its existing LRU. The saved ZIPs, WAVs, render files and Song revisions are not changed by reads.
- The browser checks response bounds while reading, SHA, WAV headers and dimensions before accepting a sound. Downloads/decodes are sequential. Identical saved WAVs share one decoded source, not multiple clones.
- Canonical PCM16 sources at supported AudioBuffer rates retain their original frames/rate and decode exactly as signed sample / 32768 into one AudioBuffer. Playback performs the usual output-rate conversion. Other supported WAVs use the existing Web Audio decoder/resampler with larger scratch accounting.
- Current buffers are reusable only if their PCM16 samples, dimensions and WAV hash match exactly. Arbitrary near-matching Float32 live audio is not silently treated as saved.
- Complete portable Q banks are not repacked on every capture. A later Q edit that mixes bank/repository rates resamples the affected bank segment before packing. This avoids a redundant atlas and preserves unchanged source WAVs.

## Memory and rollback

The existing strict preparation limits remain **96 MiB on phones/tablets, 192 MiB on desktops**. These are managed preparation estimates, not measurements/guarantees of native browser RSS.

- Wait for prior audio persistence, release cached source decks, trim hot playback renders, then account current editor residency, distinct new sources, scratch, sequential IndexedDB clone and 16 MiB engine/restore headroom.
- Fresh decoded editing buffers move into the editor. They are not cloned into another complete deck or retained in the immutable Song source/render cache.
- IndexedDB `put()` already structured-clones typed arrays synchronously. Audio persistence no longer makes an additional channel `slice()` first.
- If old and new decks cannot coexist, verify that both the new deck and a rollback can fit. Save the old settings and exact Float32 sounds sequentially into a temporary account-scoped IndexedDB checkpoint **before detaching any live source**. A quota/storage failure leaves the old editor untouched.
- Persisted card-history audio is reduced to its existing lazy IDs; Undo/Redo entries and counts are retained. Restoring history hydrates the exact original PCM on demand.
- After checkpointing, detach stopped editor sources, load the new deck and restore settings synchronously. Network, integrity, cancellation or lease loss before commit reloads the exact old checkpoint stopped. No Song write is needed for rollback.
- Delete temporary checkpoint databases on success or completed rollback. If a rollback itself fails, retain the checkpoint data and report its database name rather than deleting the only temporary recovery copy. Account changes never restore old-account audio into a new session.
- Generation, source-mutation, current-buffer-reference, recording and editing-lease guards are checked across asynchronous boundaries. Saved server sources stay unchanged until normal Save Amendment.
- A genuinely oversized single restore still fails before modifying live sources; the budget is not bypassed.

## Verification

Run an isolated server (all auth/accounts/files temporary):

```sh
python3 tests/song-beta-test-server.py 18919
```

Run `node tests/song-amend-memory-browser.cjs` against that localhost server. It uses a deliberately smaller 38 MiB budget to exercise real sequential decoding/checkpoint/rollback with modest three-track K sources. Chromium and WebKit phone-emulation runs cover corruption, cancel, checkpoint quota failure, exact unsaved Float32/settings restoration, unchanged WAVs, independent K loop periods, normal Save/reopen, real mobile Amend/Cancel controls, subsequent lazy Undo and temporary-database cleanup.

Controller tests in `tests/song-beta.test.js` additionally cover lease loss, budget refusal, partial settings failure and retained recovery checkpoint. `tests/test_song_audio_assets.py` covers endpoint integrity, scoping, reused occurrences, stale hashes, corruption and symlinks. `tests/q-song-source-memory.test.js` covers complete-bank identity and mixed-rate packing.

Operational evidence is in the private `backups/song-amend-memory-*/REPORT.md` created for this change. Real large saved-source replays use disposable local accounts and read-only original-file inputs, never production writes. Browser emulation is not a physical-iPhone/native-RSS test.
