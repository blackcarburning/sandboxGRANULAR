# V vocal libraries

Build `v2026.11.13.VOCALS.1` adds a Vocal library dropdown to V and the shared
Vocal Browser. `SAMPLES_NCRVOCALS` is the default; `SAMPLES_VOCAL` remains available.
The historical on-disk/API name is singular `VOCAL` (not `VOCALS`).

- New library: shared, authenticated, read-only source key `samples_ncrvocals`.
  Documenter maps it to the workspace collection's `READY_TO_USE/` directory only:
  3,335 edited WAVs, recursive category paths. Originals, archives, licence/report
  documents and work files are not part of the sample source. No Dropbox fallback.
- The dropdown affects the next Choose/Generate/Mega/Sparse/AI/GENREator load,
  never replaces current PCM. Existing private RadioLab/VideoLab/FTP/M controls
  remain separate. Re-cut uses the loaded metadata source key and original paths,
  even if the dropdown now selects the other library. Old metadata without a
  source key falls back to the historical `samples_vocal` source for Re-cut.
- Selection persists as `loopSampleRepositories.V` in state/preset/Song ZIPs and
  history. Missing/unknown UI values default to the new library without changing
  loaded audio. The selector has no `id`, so it is not duplicated into generic
  portable control inventories. Backend validates V's choices and excludes this
  next-load value from audio content identity; existing renders stay reusable.
- Whole-file V loads retain `sampleNames` and `samplePaths` as well as original
  source identity so the existing metadata snapshot preserves Re-cut references.
- AI inventory includes V's selected repository; model recipes cannot switch it.
  The new collection has no tonal-analysis SQLite catalogue yet: its shortlist
  is empty and existing bounded random generation uses the selected new source.
  Selecting the old library retains the existing analysed tonal shortlist. Old
  clients that omit the repository keep the old backend catalogue behavior.
- No DSP, Song engine revision, original recording or source ZIP migration.

## Focused verification

Run `tests/test_vocal_libraries.py` for inventory, shared read access, source path
boundary, no fallback, saved validation/render identity and AI routing. Existing
D-store, AI and generated-resolution tests remain applicable.

`tests/vocal-libraries-browser.cjs` uses `tests/song-beta-test-server.py` with an
isolated temporary store. It exercises Chromium/WebKit desktop/phone, real native
preview and loading, both dropdowns, preserved PCM and original Re-cut source,
Undo/Redo, state/preset/portable ZIP, failure rollback and reload.
`tests/vocal-libraries-song-browser.cjs` exercises actual per-card generation,
Mega/Sparse's shared V task builder and the real AI adapter for both libraries,
then real server Song preparation of old/new sources, legacy missing selection,
render identity, warm reuse, phone playback and unchanged source ZIP hashes.
Never point these mutation tests at production.
