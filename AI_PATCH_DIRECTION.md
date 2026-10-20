# AI Patch Direction · Beta

Current additions: [catalogue retrieval (AI.5)](docs/ai-sample-catalogue.md), [saved prompts/refinement (AI.6)](docs/ai-prompts.md), and [contextual song sections/editable part takes (AI.7)](docs/ai-song-parts.md). The original implementation below describes AI.3; the linked documents supersede its API and UI scope where extended.

Build: `v2026.10.20.AI.3`.

A bright-pink card and a full-width, two-column Jump tile generate and apply a direction to the existing patch. The fixed model is `openai/gpt-6.1-sol`; it runs through the host's existing OpenClaw one-shot model bridge. No provider key is delivered to the browser. This is not a full-song generator or an autonomous agent.

## Behaviour

1. Start MYGRAIN and finish Song editing/arming/playback, recording, other randomisation and sample loading.
2. Describe a musical direction and press **Generate & Apply**. No audio changes while GPT-6.1 Sol is deciding.
3. The validated recipe pauses transport, applies BPM, loads requested loop sources sequentially, writes note/chord patterns, and updates real controls through their existing audio handlers. Existing playback resumes after the operation; **Hear patch** starts the shared loop transport if it was stopped.
4. A timestamped **live execution log** shows before → after scalar values, actual layer switches, divisions and written notes. Sample loads show collection, filenames returned by the audio server, download/decode/load stages, duration and channel count. Q reports its exact local multisample files before loading them. The all-loop inventory distinguishes ON/OFF, loaded samples, retained audio and empty lanes. No model-written prose is treated as proof of a sample load.
5. Generate and the prompt remain available after a completed direction, even without pressing Keep. A subsequent successful direction replaces the one-step Undo checkpoint; failed work restores the patch it started from. Keep current retains the patch and clears the one-step in-memory Undo snapshot. The log remains visible. Undo restores tempo, settings, loop patterns, original sample buffers and Q state; it refuses to overwrite subsequent manual edits. Save/export a named patch as usual.

### Scope

The version-three allowlist in `ai-patch-controls.json` exposes **77 scalar controls and all 12 Bastardloop lanes**: A/B/C/V/P/O/L/X/Q/M/M+/K.

- Global BPM: 40–200, wired to the existing shared clock.
- Main/A/B granular envelopes, size, smoothing, width and shared filters.
- Every loop's level (bounded to 70% for generated recipes); transposition and cutoff on the eleven audio loop lanes.
- A/B/C/V/P/O: divisions and fresh sample-backed loop generation from their existing libraries.
- L/X: sample replacement, repeated MIDI-note/rest patterns, attack, decay, note length and start trim.
- Q: piano/strings choice, chord patterns and level, 4/8/16-step chord spacing and dry/warm/spacious tone/room/delay styles. New chord sequences clear inherited Q arpeggiation, use normal sample envelopes and a shared-clock rate of one. New chords use velocity 82 (MIDI 1–127, not a normalized fraction), a musically scaled gate, and neutral transposition. Samples are loaded by Q's existing integrity-checked loader.
- Drums: kick/snare/hat sample replacement, 1–64-step binary patterns repeated across the grid, track tuning/level/decay/length and drum bus level. Drum pattern application clears old ratchets, dotted/triplet hat timing, percussion and extra track patterns. Unmentioned recordings remain untouched.
- M/M+/K: playback settings and enabling/muting; existing recorded audio is **never replaced or newly recorded** by AI. Empty recording lanes cannot be enabled.

The default musical direction is Q chord harmony, harmonically aligned X bass and sparse straight kick/snare/hats. Other loops remain available on request, but the prompt explicitly discourages changing inactive grain controls to inflate the change count.

The model chooses library operations and bounded values; the existing audio server selects sample files within the fixed library for the lane. It cannot invent a URL/path to fetch, run code or upload audio. Source files are not deleted or altered. It does not create Song arrangements, change the master volume or expose arbitrary app functions. Standard patch/state formats remain unchanged.

### Cancellation and resource limits

At most three fresh library loop sources plus three fresh drum hits per direction, within the same total audio budget. Sources download/decode **sequentially**, with 32 MB streamed-download and per-source decoded limits. PCM WAV dimensions are checked before decoding. Fresh sources plus requested Q notes have an 80 MB decoded-audio budget. Q retains its existing manifest/hash checks. These bounds reduce pressure; they do not guarantee a physical phone cannot terminate a memory-heavy browser session.

The rollback holds references to original AudioBuffers instead of WAV-encoding/decoding a duplicate copy. A load failure or cancellation after partial application restores prior settings and sample references, including persisted loop audio, in the same account. No restoration is attempted into an expired/different account. Account lock discards late results. Hidden Song render decks do not initialize AI. Ordinary controls are guarded during asynchronous application; Cancel remains available. Q catalog/sample preparation uses an abortable 60-second stage boundary. Cancel no longer waits for an unresponsive Q request; restoration invalidates the old Q generation so late results cannot enter the restored bank.

### Preview and lifecycle

**Render 1-bar preview** captures the actual final live mix for one bar through the existing `song-beta-capture-worklet.js` processor. This is an audible real-time capture, not an offline/hidden renderer. It reuses the active AudioContext, buffers and effects; there is no second synth graph, Song ZIP, iframe or duplicate source bank. At 40 BPM the capture is six seconds; an additional 12-second hard ceiling is enforced. Only one small stereo capture is retained in memory. It is never sent to GPT-6.1 Sol.

The result reports measured peak/RMS (including near-silence or high-peak notices), and **Play rendered preview** replays that exact capture. Patch edits invalidate replay; generation and Undo discard the retained capture. The UI resets stale preview status when generation starts. Transport is restored after capture, but Stop/cancel do not restart it. Source nodes, ports and listeners are released on success, failure, hidden-page interruption or cancellation. Ordinary Stop and Panic also stop rendered-preview playback. Account lock discards the capture and stops replay.

Apply/Undo initialization is inside the guaranteed `try/finally` cleanup, so an error while stopping the old graph cannot leave the app stuck in a randomization/save-suspended state. Randomization flags are cleared before transport resumes. Audition awaits Q's real sample-preparation barrier and resumes the existing context before starting. The ordinary Bastardloop UI-start path also prepares Q before playback. Completed directions no longer disable prompt/Generate until Keep/Undo, and Hear/Stop remain available after Keep.

The submitted audio diagnostic snapshot includes AI phase, busy/Undo/preview flags and status. It does not add prompts, audio or the execution log to the model request.

A reproduced UI lock, stalled-Q cancellation and vulnerable cleanup window were fixed; browser cycles did not reproduce an OS/browser-process crash. These checks cannot certify physical-iPhone stability or an unrelated native termination cause.

Full patch/source/account/Song fingerprints reject results made stale during inference and stale Undo operations. The feature remains beta: large libraries, old mobile tabs, network failures and an OS-killed tab can still interrupt work. The log explicitly reports failure rather than claiming an unchanged or successful patch without evidence.

## Backend boundary

`backend/mygrain_ai_patch.py` handles `POST /mygrain/api/ai-patch-direction` with a maximum 32 KiB body and a 3–1500-character prompt. It accepts only the prompt, allowlisted current values and bounded loop inventory (enabled/loaded flags and displayed sample names). It rejects unsupported fields, model overrides, invalid output schemas, non-finite/non-integer/out-of-range values and overlapping filter cutoffs. Model output is data, never executable code.

Existing MYGRAIN session, same-origin and account-pin checks must run before the handler. There is one global in-flight inference and a 15-second per-account cooldown; inference times out after 75 seconds. Provider errors do not return authentication status codes. Cancel immediately discards the browser result; an already-running provider call can continue until it finishes or times out, and may still be billed. Prompts, scalar values and displayed sample names go to the model; audio and user files do not.

The shared host server loads the module using the same `importlib.util` pattern as the other MYGRAIN backend modules, then dispatches the authenticated `/api/ai-patch-direction` path **before** acquiring `MYGRAIN_ACCOUNTS.user_lock(user)`. Inference is stateless and must not hold that storage lock. The static AI assets are explicitly listed in `backend/mygrain_accounts.py`'s `PUBLIC_FILES`; do not relax the overall static-file boundary.

Example host dispatch after authentication, same-origin checks and `CURRENT_USER.set(user)`:

```python
if route['base'] == '/mygrain' and inner == '/api/ai-patch-direction':
    return _ai_patch_module.handle_ai_patch_request(self, self.command, inner)
```

The exact minimal shared-server change is included as [backend/ai-patch-host-integration.patch](backend/ai-patch-host-integration.patch). It adds the module import and dispatch without publishing unrelated shared-server source. This zero-context patch targets the exact pre-AI server version (`patch server.py ai-patch-host-integration.patch`, or `git apply --unidiff-zero` in a tracked host checkout); review it against other host versions before applying.

A plain static/GitHub Pages host does not provide this authenticated backend endpoint. It requires the host's configured OpenClaw model access. Keep shared server configuration and credentials out of this repository.

## Checks

```sh
python3 tests/test_ai_patch.py
python3 tests/song-beta-test-server.py 18876
# In another terminal (isolated localhost server only):
AI_PATCH_TEST_URL=http://127.0.0.1:18876/mygrain/ node tests/ai-patch-browser.js
AI_PATCH_TEST_URL=http://127.0.0.1:18876/mygrain/ node tests/ai-patch-loops-browser.js
AI_PATCH_TEST_URL=http://127.0.0.1:18876/mygrain/ node tests/ai-patch-qxd-browser.js
```

The two browser suites run Chromium and WebKit at phone portrait, landscape and desktop sizes, covering navigation, unchanged pending generation, direct application, real filter-node updates, exact Undo, protected state, stale patch handling, cancellation, Keep, invalid model output, provider failures and account lock. Model responses are fixtures in the browser suite. The loop suite additionally checks actual decoded PCM, all twelve loop controls, BPM clock, L/X/Q patterns, audible final output, preserved recordings, sample-identity Undo, mid-load cancellation and failed-source rollback. Real fixed-model generation and authenticated source APIs are verified separately on isolated account stores; the routine UI suites do not create provider charges.

## Rollback

The full pre-feature deployable source is committed and pushed as `d4d1a03`, tagged `rollback-pre-ai-patch-20261019`, **before** AI feature edits. The deployment operator also retained a timestamped local source archive and exact shared-server backup. A complete rollback restores that source and the matching shared-server backup, then restarts the serving service. User account stores and audio are not part of the rollback and must not be replaced.

The pre-AI.3 state is commit `7aa663c`; a timestamped local `backups/ai-all-loops-*` checkpoint contains the exact frontend/schema/backend files and shared-server copy. For this release rollback, restore those files and restart `fs7300-documenter.service`. Do not restore or modify account stores.

### AI.4 rollback and verification

The exact pre-AI.4 source is commit `1b6b7b2`, pushed and tagged `rollback-pre-ai-qxd-20261020` before the feature commit. Restore that source and restart the serving service; do not restore account stores. The timestamped local `backups/ai-qxd-lifecycle-*` checkpoint contains exact pre-edit files and verification evidence.

The Q/X/drums browser suite exercises direct regeneration without Keep, repeated real one-bar captures, measured audio, capture-listener teardown, stale capture prevention, manual edits, latest-generation Undo, failed-source rollback, cancellation before a stalled Q fetch is released, Stop during capture, Keep/play and apply-entry exception cleanup. It uses real local Q banks, decoded fixture sample audio and the real worklet. Real fixed-model generation and authenticated source APIs are separately checked using isolated account stores, not production writes.
