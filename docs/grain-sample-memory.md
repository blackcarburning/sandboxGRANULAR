# Grain A/B reload persistence

Grain A/B PCM is stored in the account-scoped browser IndexedDB `GranularSynthAudioDB` / `audioBuffers`, keys `grainASampleBuffer` and `grainBSampleBuffer`. It is not an HTTP cache or hard-coded demo selection. Other browsers/devices do not share this local checkpoint. Song and portable patch audio remain separately stored in their existing formats.

The 2026-10-24 repair adds optional `sourceMetadata` to each A/B PCM record, committed in the same transaction. Browser sample loading stages that metadata before saving; loading failure restores the previous buffer and metadata. Startup uses committed metadata when available and retains the old localStorage metadata fallback for legacy records. No DB version change, data clearing or server migration is needed.

Queued Song/Undo saves are ignored if their buffer is no longer the current A/B buffer when the IndexedDB connection opens. Queued clears are ignored if a new sample is now loaded. This prevents old asynchronous work from resurrecting an obsolete sample at reload. A/B save errors now reject and display a storage message instead of silently reporting success; the previous committed record remains readable. Connections close on error as well as success, and transaction aborts reject.

Verification: `node tests/grain-sample-memory-browser.cjs` targets localhost only, mocks account/API responses, performs no server writes, and compares exact native PCM SHA-256 across reloads in Chromium and WebKit. Covers paired names, stale write/clear rejection, explicit quota failure and legacy record compatibility. The saved pre-change index reproduces the stale-write regression via `GRAIN_ENGINE=chromium GRAIN_OLD_INDEX=/path/to/old/index.html`.

The existing `tests/random-performance-samples-browser.cjs` exercises actual disposable-account Random Sample loads, Undo/Redo, portable Song amendment/recall and reload. Never run a persistence fixture against production user data.

## Sparse and Mega random sample loading — GRAIN-AB-RANDOM.1

Both modes now include Grain A and Grain B as separate sample-loading jobs in
the existing asynchronous batch, regardless of whether the arrangement later
mutes their layer. Each independently uses `MygrainRandomSamples.chooseSample`
and the same six eligible sample folders as its Random Sample button, excluding
its current sample and the existing drum/bass subfolder exclusions. The normal
Randomise button and layer-selection probabilities are unchanged.

`loadMegaRandomGranularSample` participates in the parent history transaction,
not a nested draft edit. It uses the existing granular browser loader for native
decode, waveform/source selection, metadata, transactional browser persistence
and failure rollback. Account/context/Song/recording/slot-replacement guards,
a 60-second timeout, 32 MB download limit and response-identity checks match
the individual sample-loading boundary. A per-slot buffer guard allows A/B
loads to settle independently while rejecting a competing edit to that slot.

Failures enter the existing per-layer batch warnings and keep the previous
sample; other jobs can still finish. No saved schema or source files change.
The browser regression `tests/granular-ab-random-browser.cjs` uses isolated
contexts and intercepted fixture WAV/catalog responses, blocks all writes and
checks both modes, single Undo/Redo, normal Randomise, failures/empty catalogs,
competing slot replacement and exact PCM/name/selector survival after reload.
Unrelated generators are stubbed; production source generation is not exercised
by this fixture.

Backup: `backups/granular-ab-random-20261025T161048Z/`. Evidence:
`output/mygrain-granular-ab-random-20261025/`.
