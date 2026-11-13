# Patch Browser: enabled-source downloads

Patch Browser **Download ZIP** builds a portable copy using the selected saved
patch's source gates, not the currently loaded editor. Audio from explicitly
disabled or unused cards is omitted. A saved drums-only patch therefore exports
the seven drum-lane WAVs, without previously loaded loop/grain/keyboard/Q audio.

## Boundaries

- Save, Open, WAV sidecars, and the complete stored original retain their existing
  codec. Download never rewrites the repository ZIP or changes editor/history.
- Kept WAV bytes are copied unchanged. No decoding, resampling or synthesis is
  involved in filtering. The download also works before starting audio.
- Keep required dependencies: selected grain sources and their fallback buffers,
  Q grain inputs, generated-loop base audio, enabled Q banks/sample sources,
  enabled K tracks, and raw/render pairs. Volume zero or an empty pattern is not
  proof that a source can be removed.
- Maintain the manifest asset inventory and freeze audio-slot flags. An omitted
  disabled Q bank/sample also clears its downloaded Q notes/bank so the strict
  portable-bank validator does not see dangling references. The stored original
  remains complete. Other settings remain as normal schema-required metadata;
  filtering does not remove UI cards from MYGRAIN.
- A disabled, empty Q with no bank does not demand absent source audio on a later
  capture. Enabled Q, notes anywhere in its 64-step sequence, and existing banks
  retain their preparation/validation requirements.
- Legacy manifest/preset ZIPs are supported. Missing historical enable flags are
  treated conservatively, not guessed Off (notably some old K parent gates).
  Unknown future asset slots are likewise kept. Such ambiguous archives may need
  opening and saving again before fully trimmed downloads are possible.
- Invalid inventories or fetch failures report an error and restore the button;
  never silently offer the complete archive instead. Guard against account changes
  between fetching the saved file and delivering the generated copy.

## Song and render compatibility

The same song-part format/version and validators remain in use. There is no DSP
change, render compatibility bump, source migration, backend patch mutation or
forced invalidation of existing freezes. The isolated server worker loads the
same app and codec. Retained source WAVs are byte-identical; realtime rendered
PCM can vary at its initial attack, so compare with an unchanged-source repeat
control rather than assuming server output is bit-deterministic.

## Focused verification

- `node --test tests/active-patch-download.test.cjs tests/q-empty-capture.test.cjs`
- `MYGRAIN_TEST_URL=http://127.0.0.1:19281/mygrain/ MYGRAIN_TEST_OUTPUT=... node tests/active-patch-download-browser.cjs`
- `MYGRAIN_TEST_OUTPUT=... MYGRAIN_PATCH_FIXTURES=... node tests/active-patch-download-server.cjs`

Browser/server checks require an isolated authenticated fixture using the real
backend, a dedicated account store and no off-origin requests. They must never
upload into production user patches. Browser checks exercise actual downloads,
retained WAV equality, saved original equality, contrasting live/history state,
recall, legacy gates, strict Q-bank validation, no full-archive error fallback,
and cold downloads. Server checks exercise complete/trimmed/repeat-control jobs,
warm-cache reuse, rendered-PCM phone playback and unchanged source hashes/revision.

On this host Playwright downloads need the Chromium binary at
`/snap/chromium/current/usr/lib/chromium-browser/chrome`, not the snap launcher:
the launcher places download artifacts in a snap-private temporary directory.
The mobile fixture exercises browser downloads, not the native share sheet.

Task backup and evidence: `output/mygrain-active-patch-download-20261110T214641Z/`
in the parent workspace. Compare changes against `before/`, not the dirty Git
baseline. A public guest login-shell HTTP 200 is not authenticated feature proof.
