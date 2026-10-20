# Loop X repositories (BASS.2)

The Bass repository select on X and the Bass Browser control one remembered preference:

- `samples_bass`: existing account-owned SAMPLES_BASS.
- `samples_altbass`: public-domain original Juno-6 bass library, `SAMPLES_ALTBASS`.

Repository choice is independent of the currently loaded audio and Sample/OSC3 mode. Mega, Sparse, pattern and mix randomisers do not change it. Account state, patches and Song snapshots preserve it. AI may explicitly change it transactionally; Undo and load failure restore the previous choice/source/audio. L and X still cannot share OSC3 simultaneously.

## Original audio — no conversion

The 63 Pulse Bass / Saw Bass split AIFFs were freshly downloaded from the upstream release archive, retaining original paths, 24-bit PCM, sample rates, frames and SHA-256 hashes. ZIP CRC32 is checked during download. `sha256` and `sourceSha256` are identical. No pitch correction, octave subtraction, resampling, trimming, normalisation or re-encoding is performed. Previously converted WAVs have been removed from the active pack (rollback copies remain in the timestamped backup).

`manifest.json` and `provenance/*.sfz` retain upstream SFZ keyboard notes, velocities and region boundaries. Playback uses the original keyboard mapping; it deliberately does not compensate for the recording's lower sounding octave. SFZ start/end are playback offsets into the full original buffer, not edits to the files. Normal user start-trim is relative to that region.

The existing authenticated source API serves original bytes with `audio/aiff`, plus root and region headers. Browser code decodes uncompressed original AIFF PCM directly into an AudioBuffer, preserving its sample rate and frames. This supports Chromium as well as WebKit without converting the assets to WAV. The bass browser's preview uses the same decoder. AI decoded-memory budgets and source hash verification remain enforced.

Old BASS.1 converted filenames in saved states map to the corresponding original upstream sample. Their cached converted buffer is invalidated; the original is fetched when Loop X next needs audio. Old embedded patch audio is similarly replaced from the original repository. New original buffers and SFZ region metadata persist normally. The remembered repository itself is not changed by migration.

## Full offline metadata index

The same analyser and SQLite/CSV/JSONL/portable-SQL workflow used by the other tonal repositories now analyses **all 63 original AIFFs over their entire duration**. Outputs:

`../sample-catalogue/catalogues/SAMPLES_ALTBASS/`

Includes file identity/hashes, original format/header diagnostics, filename tokens/tags, level/silence/DC/stereo measurements, brightness/band energy/HPSS, transient/beat data, tentative monophonic pitch/key/tempo, complete analysis tracks, warnings and provenance. Original non-audio AIFF chunk payloads are preserved in `wave_chunks`. Numeric MIDI-key/velocity filename fields are explicitly not BPM labels. `source_mappings` records the separate authoritative SFZ playback mapping, source checksums and archive identity; acoustic pitch never overwrites it.

The offline cataloguer's inventory and independent verifier filter supported audio extensions, excluding licence, JSON and SFZ documents. Apply `backend/altbass-cataloguer-integration.patch` if installing on the earlier cataloguer version. Reproduce with:

```sh
python3 scripts/prepare-altbass.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 ../sample-catalogue/.venv/bin/python scripts/index-altbass.py --workers 2
```

The preparation command downloads fresh upstream originals; it does not reverse-convert the old pack. Back up an existing pack/catalogue before rerunning. Indexing never edits audio. The final audit independently checks source hashes, full-file analysis coverage, embedded metadata bytes, SQLite integrity and a restore of the exported SQL.

MYGRAIN reads this separate finished database read-only (`MYGRAIN_ALTBASS_CATALOGUE_DB` optionally overrides its location). Each AI request gets at most eight analysed ALTBASS candidates, ranked by prompt/patch and low keyboard register, with measured fields and original playback roots. Every offered source is checked against its indexed checksum and checked again before apply. If the index is absent/unreadable there are no invented manifest-only acoustic metadata; the existing random library fallback remains available. Other collections and the combined TONAL catalogue are untouched.

## Deployment and verification

Apply `backend/altbass-host-integration.patch` to the pre-BASS shared documenter server and restart `fs7300-documenter.service`. It includes the source configuration, original AIFF listing and response metadata. For an already integrated host, apply only the missing hunks. No new public static route is needed; source access remains authenticated.

```sh
python3 -m unittest discover -s tests -p 'test_altbass.py'
python3 -m unittest discover -s tests -p 'test_ai_*.py'
node --test tests/original-altbass-audio.test.js
MYGRAIN_TEST_ROOT=/tmp/mygrain-originals-store python3 tests/song-beta-test-server.py 18832
# Separate terminal, isolated server only:
MYGRAIN_TEST_URL=http://127.0.0.1:18832/mygrain/ node tests/altbass-browser.js
```

Mobile Chromium/WebKit tests exercise byte-accurate original decoding, original-root 1× playback, old-cache migration, SFZ offsets, native audio output, original-file browser preview, repository persistence/randomisation protection, AI/Refine, Undo and failed-load rollback in portrait and landscape. Never run writable account tests against production.
