# Saved prompts and follow-up directions (AI.6)

## User behaviour

- **Save prompt** stores the text under a name in the signed-in account. An empty name uses the first line (up to 80 characters). **Recall** fills the editor without changing audio or generating anything. **Refresh list** picks up another device's saves. **Remove saved** hides that entry without changing the editor or patch.
- Up to 200 active prompts per account, names 1–80 characters, prompt text 3–1,500 characters. Names are case-insensitively unique. Saving identical text under the same name is idempotent; a different text with that name is rejected, not silently overwritten. Use a new name for a variant.
- **Regenerate same prompt**, shown after an applied generation, uses the last successfully applied direction, ignoring unsent editor changes. It makes a fresh recipe and may choose new catalogue samples. It does not restore an identical patch. Use normal patch/audio export for exact preservation.
- **Refine current patch** works on any live patch: Mega Random, loaded patches, manual edits or an AI take. It is always available in the AI card, before any generation, and takes a short instruction (up to 500 characters). The main direction is optional: when blank, a neutral preservation instruction supplies context; the live controls/patterns—not a prior generated recipe—are authoritative. The model receives current controls, lane inventory, X/L sounding notes, Q chord cells/instrument, drum hits and drum enabled state. Refine keeps existing library source audio: reload requests are rejected on both server and browser. Requested Q instrument/chord changes can still prepare their existing multisample instrument bank. Undo of a first refinement also restores the empty main-prompt editor.
- A successful refinement is appended to the editor direction as `Refinement: …`. It can then be saved or regenerated. The complete direction must remain within 1,500 characters. Failed/cancelled work does not replace the last applied prompt.
- Follow-up actions do not require Keep. One-level Undo restores both the prior patch/audio and prior applied prompt context. Keep discards the Undo slot, not the follow-up controls. Last applied context lasts for this page session; explicitly saved prompts persist across devices.

## Storage and deployment

`backend/mygrain_ai_prompts.py` owns a separate SQLite database named `ai-prompts.sqlite3`, beside the configured account database, with mode 0600 on creation. The account database schema, patches, Songs, IndexedDB audio and tonal sample catalogue are unchanged.

Rows include account owner ID, random entry ID, display name, casefolded name, prompt text, creation time and optional removal time. All queries are owner-scoped; removal is a soft archive (the server retains text for recovery). A partial unique index and `BEGIN IMMEDIATE` serialize concurrent save/count checks. Connections close after each request.

Authenticated API:

- `GET /mygrain/api/ai-prompts` → `{ok, prompts:[{id,name,prompt,createdAt}], savedId, limit}`.
- `POST /mygrain/api/ai-prompts` with `{action:"save",name,prompt}` or `{action:"remove",id}` → the updated list.
- Existing account/session pinning, same-origin mutation protection and no-store responses apply. A page account lock clears all prompt text/list/context and aborts pending requests. Prompt API failure leaves the audio editor usable and never claims a save succeeded.

The shared documenter host must dispatch **both** `/api/ai-patch-direction` and `/api/ai-prompts`:

```python
return _ai_patch_module.handle_ai_patch_request(
    self, self.command, inner,
    source_root=pathlib.Path(MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT),
    prompt_db=MYGRAIN_ACCOUNTS.database.with_name('ai-prompts.sqlite3'),
)
```

This supplements the source-root hook documented in [ai-sample-catalogue.md](ai-sample-catalogue.md). Restart `fs7300-documenter.service` for backend changes. The static app is served directly from this repository at `/mygrain/`; AI.6 bumps HTML/JS/CSS cache markers.

## Apply/recovery details

Inference accepts optional `mode` (`generate`, `regenerate`, `refine`), refinement text and validated musical state. Old generate requests remain accepted. Refine skips unnecessary catalogue retrieval and returns status `retained`; generate/regenerate retain the bounded read-only catalogue path and fallback.

The same fingerprint/account guards, source budgets, sequential loading, cancellation and Undo transaction apply in all modes. Refine does not clear unrelated drum ratchets, percussion or extra patterns when changing one track. Returning transport lanes are planned together under a fresh buffered deadline so quick apply/refine/Undo cannot restart against a stale loop origin.

## Verification

```sh
python3 -m unittest discover -s tests -p 'test_ai_*.py' -q
node --check ai-patch-direction.js
python3 tests/song-beta-test-server.py 18876 > /tmp/mygrain-ai-prompts-server.log 2>&1
# In a separate shell; all account/SQLite/audio writes use disposable stores:
node tests/ai-prompts-browser.js
AI_PATCH_WIDTHS=390,1280 node tests/ai-patch-browser.js
AI_PATCH_WIDTHS=390 node tests/ai-patch-qxd-browser.js
```

The new prompt browser suite uses real isolated prompt SQLite/API and Q/audio graph, with deterministic model/source fixtures. It covers cross-device recall without localStorage, cross-owner isolation, CSRF, duplicate names, prompt reuse, targeted/no-reload refinement, preservation of unrelated drum patterns, Undo, cancellation, account-lock cleanup and non-silent preview in portrait/landscape/desktop Chromium/WebKit.

Opt-in real model: run another isolated server on 18877 with log `/tmp/mygrain-ai-prompts-real-server.log`, then `AI_REFINE_REAL_MODEL=1 node tests/ai-refine-real-browser.js`. It uses the previous catalogue test's `/tmp/mygrain-ai-catalogue-real-result.json`, copies only its real source fixtures into a disposable account, and exercises actual Sol refinement, no source reload, saved refined text, audible capture and Undo.

## Rollback

Pre-AI.6 revision: `afa56e3`. Exact deployed files and shared-host snapshot: `backups/ai-prompts-20261020T092422Z/`. Restore only changed app files and reverse only this task's host dispatch change; do not overwrite unrelated shared-host work. Restart the service. Keep the separate prompt database, account stores, recorded audio, Songs and offline catalogue intact. The new prompt module can remain unused during a rollback.

## Current feature knowledge

`docs/ai-feature-knowledge.md` is loaded by the backend and included in every model
request (generate, regenerate, refine and Song section). It covers current cards,
shared effects, transport-aligned filter LFOs, N threshold/envelope behaviour and
loop retention/artwork changes. It explicitly distinguishes feature awareness from
the unchanged validated writable recipe schema. Restart the backend after updates.
