# Named ZIPs and editable WAV renders — ZIP.2

- **Export Patch ZIP** always asks for a name, using the existing name field as the suggestion. Cancelling does not capture or upload anything.
- New patch ZIPs use the complete portable snapshot codec: current settings, notes, audio sources, active/muted layers, grain mutes, drum/K track state and solos. Restore updates the existing Layers panel in its normal order. Older preset ZIPs remain importable.
- Each final-mix WAV render and Take capture asks whether to include a ZIP. Declining creates only audio. A Take retains its capture-time patch even if the workspace changes before upload.
- Paired files use the same filename stem, including collision/rename suffixes: `name.wav` and `name.zip`.
- The WAV browser adds a compact **ZIP · Restore Patch** row only for entries with a valid associated ZIP. Downloads are authenticated and hash checked. Restore is a stopped-playback, Undo/Redo-aware replacement of the editable patch, not the rendered audio.
- Local paired exports also save an account-private browser copy before downloading both files. If that browser save fails, both local downloads remain available and the failure is reported.
- Song WAV exports can include a ZIP containing each distinct saved part and the ordered arrangement/repeats. **Restore Patch** lets the user choose a part; it does not replace the saved Song. The archive contains no Song-library access key.
- No backfill, migration, deletion or rewrite is performed on existing WAVs, comments, hearts or history. Existing account boundaries and audio-only sharing remain unchanged.

## Verification

Focused tests: `tests/wav-pattern-export.test.cjs`, `tests/test_wav_patterns.py`, existing WAV browser recovery/responsiveness/mobile-scroll tests, and `tests/wav-pattern-export-browser.cjs` against disposable authenticated stores.

Browser checks cover Chromium/WebKit desktop and phone emulation, complete mixed-mute state/layer order, source audio, standalone ZIP import, authenticated ZIP download, Restore/Undo/Redo, history feedback retention, local paired export, Song patch selection and reload. Chromium checks use real live audio renders; Linux WebKit has no MediaRecorder, so its live-capture checks reuse real Chromium WAV bytes. Song assembly runs in both engines. No physical iPhone verification is claimed.
