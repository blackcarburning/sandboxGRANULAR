# W Song compatibility — SONG-W.1 (2026-10-25)

## Failure and automatic recovery

Adding W appended `bastardW` to the Song audio bindings. The strict portable
inventory reader then required that slot even for genuinely pre-W snapshots,
but the additive compatibility registry did not migrate it. Reproduced with the
previous adapter: `Saved part audio inventory is incomplete for bastardW`.

The canonical `song-w-compat.js` migration now runs before normal Song inventory
validation. A portable snapshot with no W slot, assets, settings, controls,
metadata or solo references receives `bastardW: false`, null metadata and neutral,
disabled W settings. The original object and all existing assets are untouched.
Pre-portable snapshots keep their original format. A real W inventory/audio
mismatch is still rejected, not silently cleared or replaced from device audio.
Existing W snapshots are no-ops. Missing support produces a reload instruction.

Arm uses normalized metadata in memory. It does not rewrite a saved source ZIP,
require conversion first, change device memory budgets, or acquire an edit lease
for automatic compatibility. Original render reuse remains intact.

## Explicit Convert W

Song mode exposes **Convert W** beside **Convert K to 5 Tracks**. It calls
`POST /mygrain/api/songs/{song}/convert-w`; there is no device ZIP conversion.
Normal account ownership, editing lease and exact revision requirements apply.
Stop playback and finish an amendment before using it.

`scripts/convert-w-snapshot.cjs` uses the same canonical migration as the browser.
The existing K streaming transaction is shared, not reimplemented: bounded Node
metadata work, unchanged/hash-checked WAV streams, all unique referenced sources
(including hidden reused sources), staging and one atomic Song revision commit.
Original archives/history and playback WAV bytes are retained. Playback hashes
are rebound to changed source metadata. A repeat conversion is an idempotent no-op.
Errors roll back all newly staged/published files. Responses from a stale Song,
library, generation, revision or source selection cannot overwrite client state.
No saved user Song was converted as part of deployment or verification.

## Verification

- `tests/song-w-compat.test.js`: immutable, idempotent migration; real W
  preservation; corrupt/missing W evidence rejection; server-only controller,
  stale-response checks and malformed response rejection.
- `tests/test_song_w_server_conversion.py`: real route/Node conversion,
  unique/hidden reused sources, WAV/render preservation, idempotence, edit and
  revision guards, whole-Song rollback, modern W no-op and corruption rejection.
- `tests/song-w-conversion-browser.cjs`: disposable localhost accounts/stores
  only. Baseline reproduces the W failure. Chromium/WebKit load, Arm, convert,
  recall and play a mixed pre-W/current-W Song. Existing W audio remains audible,
  old parts clear current-device W audio, conversion downloads no source ZIP,
  and existing renders/arrangement remain intact. Includes actual Convert W
  button, portrait/landscape fit, and the unchanged 96 MiB phone allowance.

Evidence/backup: workspace `output/mygrain-song-w-20261025/`. Browser mobile tests
are emulation, not a physical iPhone or MacBook Safari crackle test. All existing
X envelope/audio functions remain unchanged.
