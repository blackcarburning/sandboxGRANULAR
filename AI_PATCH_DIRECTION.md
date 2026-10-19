# AI Patch Direction · Beta

Build: `v2026.10.19.AI.1`.

A bright-pink card and a full-width, two-column Jump tile generate a proposed direction for the existing patch. The fixed model is `openai/gpt-6.1-sol`; it runs through the host's existing OpenClaw one-shot model bridge. No provider key is delivered to the browser. This is not a full-song generator or an autonomous agent.

## Behaviour

1. Start MYGRAIN and finish any Song edit, playback, arming, recording or randomisation.
2. Describe the desired texture, or choose an example. Generate returns a proposal without changing anything.
3. Review the title, description and exact control changes. Apply updates the existing controls and their normal engine handlers, then autosaves through the existing persistence path.
4. Keep current clears the temporary Undo snapshot. Undo restores precisely the controls changed by the proposal. Undo is one-step and in-memory, not retained across reloads. Save/export a named patch as usual.

The allowlist in `ai-patch-controls.json` has 21 scalar controls: Main/A/B grain size, envelopes, smoothing and stereo width; Main blend; shared low-pass/high-pass cutoff. Generated filter ranges are narrower than the engine's full ranges. Original values outside those narrower ranges can still be restored by Undo.

Samples, sample regions, layer enable/mute states, pitches, BPM, modulation routing, mixer/master levels, effects and arrangement remain unchanged. An inactive granular layer stays inactive, so the result depends on existing sounds and routing. Standard patch JSON/ZIP schemas are unchanged; applied AI settings are ordinary patch values.

Full local patch/source/account/Song fingerprints invalidate stale results. A changed patch also prevents stale Apply/Undo from overwriting newer edits. Account lock aborts the browser request and discards any late result. Hidden Song render decks do not initialise AI or fetch its control schema.

## Backend boundary

`backend/mygrain_ai_patch.py` handles `POST /mygrain/api/ai-patch-direction` with a maximum 16 KiB body and a 3–1500-character prompt. It accepts only the prompt and allowlisted current control values. It rejects unsupported fields, model overrides, invalid output schemas, non-finite/non-integer/out-of-range values and overlapping filter cutoffs. Model output is data, never executable code.

Existing MYGRAIN session, same-origin and account-pin checks must run before the handler. There is one global in-flight inference and a 15-second per-account cooldown; inference times out after 75 seconds. Provider errors do not return authentication status codes. Cancel immediately discards the browser result; an already-running provider call can continue until it finishes or times out, and may still be billed. Prompts and scalar values go to the model; audio and user files do not.

The shared host server loads the module using the same `importlib.util` pattern as the other MYGRAIN backend modules, then dispatches the authenticated `/api/ai-patch-direction` path **before** acquiring `MYGRAIN_ACCOUNTS.user_lock(user)`. Inference is stateless and must not hold that storage lock. The three static AI assets are explicitly listed in `backend/mygrain_accounts.py`'s `PUBLIC_FILES`; do not relax the overall static-file boundary.

Example host dispatch after authentication, same-origin checks and `CURRENT_USER.set(user)`:

```python
if route['base'] == '/mygrain' and inner == '/api/ai-patch-direction':
    return _ai_patch_module.handle_ai_patch_request(self, self.command, inner)
```

The exact minimal shared-server change is included as [backend/ai-patch-host-integration.patch](backend/ai-patch-host-integration.patch). It adds the module import and dispatch without publishing unrelated shared-server source.

A plain static/GitHub Pages host does not provide this authenticated backend endpoint. It requires the host's configured OpenClaw model access. Keep shared server configuration and credentials out of this repository.

## Checks

```sh
python3 tests/test_ai_patch.py
python3 tests/song-beta-test-server.py 18876
# In another terminal (isolated localhost server only):
AI_PATCH_TEST_URL=http://127.0.0.1:18876/mygrain/ node tests/ai-patch-browser.js
```

The browser checks run Chromium and WebKit at phone portrait, landscape and desktop sizes, covering navigation, proposal-only behaviour, Apply, exact Undo, protected state, stale patch handling, cancellation, Keep, invalid model output, provider failures and account lock. Model responses are fixtures in the browser suite. Real fixed-model generation and the authenticated backend are verified separately, so automated UI runs do not create provider charges.

## Rollback

The full pre-feature deployable source is committed and pushed as `d4d1a03`, tagged `rollback-pre-ai-patch-20261019`, **before** AI feature edits. The deployment operator also retained a timestamped local source archive and exact shared-server backup. A complete rollback restores that source and the matching shared-server backup, then restarts the serving service. User account stores and audio are not part of the rollback and must not be replaced.
