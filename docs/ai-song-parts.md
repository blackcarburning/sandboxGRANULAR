# AI song sections and editable part takes (AI.7)

## Use

1. Generate an initial AI take. Name a slot and **Store Take 1** to preserve the original.
2. Choose **Verse, Chorus, Bridge or Middle 8**, optionally allow sparse rolls, and write a direction for the next part. **Generate progression** uses the current Q harmony, X/L notes and drum patterns as context.
3. **Hear patch**, **Refine**, **Regenerate same prompt** and **Undo** remain available. Section regeneration retains its section type/length and current sources. Refinement keeps the section context. Unsent editor changes are ignored by Regenerate, as before.
4. Name and **Store** the variant in one of five coloured slots. **Recall** restores controls, patterns, source audio and prompt context, without starting playback. **Rename** changes the saved name without changing audio. **Refresh part takes** picks up other-device saves.
5. Create/select a Song, then **Add to Song** on a saved slot. This copies that saved archive and its repeats, not the current live patch. Existing Song parts and the live patch are unchanged. Reorder, reuse, play or export with existing Song controls.

The original WAV Take 1–5 / Upload Takes workflow is untouched. This is a separate editable bank. Store replaces the active version of its slot, not an append-only list. Names need not be unique across slots. Another account cannot read the slots. A second device can recall them without the first device's localStorage/IndexedDB.

### Pattern length

The editor's existing maximum is **64 sixteenth-note steps (four bars)**. Sections use the full grid with chord changes and matching bass. Section length is explicitly **4 bars × 1, 8 bars × 2 or 16 bars × 4**. Middle 8 is fixed to eight bars, using two repeats. This release does not generate eight independently programmed bars or change the sequencer/Song schema. Rolls within the grid also repeat.

## Musical and recovery boundaries

- Section mode preserves BPM, library sample identities, Q instrument and drum pitch/tune/decay/length. Drum levels and groove may change. New Q notes can load additional notes from the same multisample instrument.
- Server and client reject source reloads, tempo/drum-tone changes and a different Q instrument. Output must include `patternSteps:64` and Q chords. Ordinary generation can still choose new sources.
- Rolls are explicit per-step ratchets (0, 2, 4 or 8), at most eight roll cells per track, and require opt-in. Existing unmentioned patterns/ratchets are retained and extended using the editor's normal repeat logic. The model receives current ratchets too.
- Full patch/account/Song fingerprints, recording/busy guards and cancellation remain. Generation Undo restores the prior prompt/section. Store captures Q's manifest without invalidating that checkpoint. Recall replaces the patch and clears obsolete generation Undo/preview.
- Recall downloads, hashes, inspects and decodes before replacing live state. Decoded source audio has an **80 MiB** budget. A larger saved take can still be added to Song, whose established cache rules apply. A live-only checkpoint restores the patch if application fails or is cancelled in the same account. Account changes never write old audio into a different account.
- Immediate recall reuses its newly decoded buffers instead of making another full copy. No automatic playback. Browser audio persistence retains the adapter's existing best-effort semantics; the server archive remains authoritative.

## Storage and API

`backend/mygrain_ai_parts.py` owns `ai-parts.sqlite3` beside `ai-prompts.sqlite3` (0600), plus `ai-part-audio/<owner-id>/<sha256>.zip` (0700 directories / 0600 objects). Account, prompt and catalogue schemas are unchanged. Complete ZIPs retain existing `mygrain-song-part` version 1, validated by the Song backend.

- Five owner-scoped revisioned slots. Names 1–100 characters, prompt context 0–1,500. Section metadata/repeats are checked against the saved four-bar grid.
- Writes use `BEGIN IMMEDIATE` and compare expected revision. Stale stores/renames return **409**, requiring Refresh, without overwriting the active version.
- Prior metadata and immutable audio are retained for operator recovery, without a history browser or automatic cleanup. Objects are deduplicated within each account. Limit: **128 MiB per ZIP; 1 GiB / 256 unique ZIPs per account**, including history. Limits leave existing takes unchanged.
- `GET /mygrain/api/ai-parts` lists metadata; `GET ?slot=1` downloads the owner's ZIP with size/hash metadata and no-store headers.
- `POST application/zip` stores a slot. `X-Mygrain-AI-Part` is base64url UTF-8 JSON `{slot,revision,name,prompt,section,repeats}`. `POST application/json` with `{slot,revision,name}` renames it. SQL is parameterized; object paths derive from authenticated owner ID + hash; reads verify integrity.
- Existing sessions, pinned-account headers and same-origin write protections precede dispatch. Account lock clears names/context and aborts work. Cancelled in-flight saves may have committed; Refresh confirms them. No anonymous archive upload is introduced.

Host dispatch includes `/api/ai-parts` alongside `/api/ai-patch-direction` and `/api/ai-prompts`, with existing `source_root` and `prompt_db` arguments. See [host patch](../backend/ai-patch-host-integration.patch). `ai-song-parts.js` is explicitly public static; private ZIPs remain behind the account API. Restart `fs7300-documenter.service` for backend changes.

## Verification

```sh
python3 -m unittest discover -s tests -p 'test_ai_*.py' -q
node --test tests/song-beta.test.js tests/song-beta-restore.test.js tests/song-beta-compatibility.test.js
python3 tests/song-beta-test-server.py 18876
# Another terminal, disposable localhost account stores only:
node tests/ai-song-parts-browser.js
AI_PATCH_ENGINES=chromium,webkit AI_PATCH_WIDTHS=390 node tests/ai-prompts-browser.js
AI_PATCH_ENGINES=chromium,webkit AI_PATCH_WIDTHS=390 node tests/ai-patch-qxd-browser.js
```

The new suite uses real isolated account SQLite/Song APIs, full ZIP upload/recall, Q multisamples and the actual audio graph. Only model recipes and tiny bass/drum WAVs are fixtures. It checks retained source identities/tempo, chords/rolls, Store then Undo, contextual refinement/regeneration, naming, cross-device recall, interrupted-recall rollback, isolation, CSRF, revision conflicts, Song handoff and audible preview at phone portrait/landscape and desktop sizes in Chromium/WebKit.

`AI_PARTS_REAL_MODEL=1 AI_PATCH_ENGINES=chromium AI_PATCH_WIDTHS=390` opts into a real fixed-model section request (provider usage), preserving the same audio/state checks. Physical iPhone testing is separate from browser emulation.

`AI_PARTS_SONG_RENDER=1` additionally arms both saved parts, checks non-silent Song renders and starts/stops playback. `AI_PARTS_LIVE_ASSETS=1` runs the same workflow against actual public static assets, forwarding **all** API calls into the isolated localhost store; it never creates production accounts, changes production audio or performs production mutations.

## Rollback

Pre-AI.7 revision: `eaecd68`. Exact live files and pre-edit shared host: `backups/ai-song-parts-20261020T111056Z/`. Restore this feature's app files and reverse only `/api/ai-parts` in the shared host dispatch, preserving unrelated host work. Restart the service. Keep the new private database/audio for recovery; never roll back account data, recordings, Songs, prompts or the catalogue.
