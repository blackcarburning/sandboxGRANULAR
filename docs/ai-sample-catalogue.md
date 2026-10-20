# MYGRAIN AI sample catalogue (AI.5)

The prompted generator uses the existing tonal SQLite catalogue, **read-only**.
It does not run librosa in a web request, change source WAVs, or upload audio.
The fixed text model remains `openai/gpt-6.1-sol`.

## Retrieval and loading

- Database: `../sample-catalogue/catalogues/TONAL/catalogue.sqlite` relative to this repository. Override with backend environment variable `MYGRAIN_SAMPLE_CATALOGUE_DB`.
- Current inventory: 941 fully analysed WAVs: bass 239, leads 133, vocal 139, piano 200, orchestral 230.
- The request is bound to the authenticated account's existing `source_mirrors` path. A different account only gets candidates for exact matching copies in its own library; same-name, different-content files never inherit the catalogue metadata.
- Source mappings: X→SAMPLES_BASS, L→SAMPLES_LEADS, V→SAMPLES_VOCAL, P→SAMPLES_PIANO, O→SAMPLES_ORCH. Q retains its existing piano/strings multisample instrument and MIDI chord generator. Drums and A/B/C retain their existing libraries; their samples have not been catalogued by this work.
- Up to eight eligible candidates per tonal lane are provided, not the whole database. Prompt words, filename key/mode/tempo, usable single-note roots and warning penalties rank candidates, with bounded variation. Explicit requested key/tempo are preferred for phrase lanes; the model chooses the final compatible sample and arrangement.
- Each candidate exposes filename tags/claims, measured duration/RMS/brightness/harmonic share, conservative decoded size, tentative accepted note/key/tempo estimates, and relevant disagreement/range warnings. Raw chunks, raw pitch tracks, full host paths and arbitrary SQL are not exposed to the model.
- Missing/stale files, mismatched account copies, percussion-named entries in tonal folders, and oversized sources are excluded. X/L additionally require a usable root and exclude labelled loops/phrases and note/filename disagreements. A filename root with explicit octave is used as an unverified claim; otherwise an accepted monophonic note may supply the root only if its pitch class agrees with the filename. Unknown octaves are not invented.
- Model output can contain only a supplied `sampleId` for the matching lane. The backend validates the ID against **that request's shortlist**, verifies the selected WAV's SHA-256, then attaches trusted relative-path metadata. Omitted IDs for available catalogue lanes or invented IDs are errors before any patch changes.
- X/L use the existing exact-path GET sample endpoint. The browser checks response identity and the WAV's SHA-256, and passes the selected root to the existing sampler loader. P/O/V use the existing loop builder with a singleton `sourceFiles` list; returned paths must match the selection. `divisions: ["uncut"]` preserves a phrase within the existing tempo/stretch/trim/pad builder; other divisions intentionally slice the selected source. Uncut cannot be combined with slicing divisions.
- P/O/V are **not automatically reharmonised or key-transposed**. The model is instructed to choose compatible declared keys/modes or omit the layer. Q/X/drums remain the default arrangement.

## Reliability and fallback

Filename claims are not measurements. Acoustic note/key/tempo are tentative; bare tonic does not imply major, monophonic pitch is not chord recognition, and sampler sustain loops do not prove musical/seamless loops. Warnings and actual selected filenames are printed in the live changes log.

A missing/unreadable database or no current eligible files uses the existing random-library path, visibly labelled as fallback. A single lane without candidates can also fall back, with its own log message. The database is never automatically modified during generation. Re-catalogue changed/new samples using the standalone catalogue project.

All loading still shares the existing sequential transaction, source/decoded-memory bounds, current-account/fingerprint checks, abort/timeout cleanup and one-level Undo. Changes do not introduce new patch/Song schemas. Existing saved audio/metadata remain readable; the applied X/L root persists in the pre-existing `rootNote` metadata field. Recordings and Song arrangements are not changed by the catalogue integration.

## Backend host hook

The shared documenter server already imports `backend/mygrain_ai_patch.py` and handles the API. Its dispatch must pass the current account's resolved source mirror, rather than a global/default library:

```python
return _ai_patch_module.handle_ai_patch_request(
    self, self.command, inner,
    source_root=pathlib.Path(MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT),
)
```

The deployment applied exactly this one-line hook to the shared server. A missing account-root hook fails closed to labelled legacy random selection, never the shared catalogue. Other pre-existing shared-server modifications were preserved. Restart `fs7300-documenter.service` after backend/schema changes. Static files are served directly from this repository at `/mygrain/`.

## Verification commands

```sh
python3 -m unittest discover -s tests -p 'test_ai_*.py' -v
node --check ai-patch-direction.js
python3 tests/song-beta-test-server.py 18876
# In another shell (isolated account stores only):
AI_PATCH_WIDTHS=390,1280 node tests/ai-patch-browser.js
AI_PATCH_WIDTHS=390 node tests/ai-patch-qxd-browser.js
node tests/ai-catalogue-browser.js
```

`ai-catalogue-browser.js` expects the isolated server's first-line store path in `/tmp/mygrain-ai-catalogue-server.log` (or `AI_CATALOGUE_SERVER_LOG`). It copies a bounded set of real catalogue samples into disposable test accounts, then tests the actual exact-source/build APIs with deterministic recipe responses, non-silent capture, sampler roots, regeneration/Undo, cancellation, hash mismatch, build-identity mismatch and fallback in Chromium/WebKit. It never registers production users or writes production audio.

The opt-in real-model test is `tests/ai-catalogue-real-browser.js`; set `AI_CATALOGUE_REAL_MODEL=1` and use an isolated server on port 18877 with log `/tmp/mygrain-ai-catalogue-real-server.log`. Its tonal sources are actual catalogued WAVs; tiny drum fixtures use the real hit-loading API. Real mobile hardware remains separate from browser emulation.

## Rollback

Pre-AI.5 repository revision: `e5e404a`. Exact live file backups and a full pre-edit shared-server snapshot are under `backups/ai-catalogue-20261020T084835Z/` on the host. Restore the five backed-up app files, remove only the new catalogue hook from the shared server, and restart the service. Do not replace an unrelated newer shared-server change with the entire old snapshot. Do not roll back account stores, recorded audio, songs or the offline catalogue database.
