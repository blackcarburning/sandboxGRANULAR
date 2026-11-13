# D in patch generation (2026-11-03)

Ordinary Randomise now calls D's existing batch random loader after source/W generation. Mega/Sparse already call that loader once in their batch and retain their layer-selection lottery; ordinary Randomise does not duplicate that call while the Mega flag is set. D fetches an original `samples_loops` file and generates gaps. Existing batch limits, persistent original audio, pattern fit and low-power preference behavior are unchanged.

AI Patch Direction schema/inventory now includes raw-source D with reload and enabled capabilities, plus bounded level and pitch controls. D does not use the generated A/B/C divisions or tonal catalogue. AI source replacement clears stale cuts, applies/persists the decoded original, then generates gaps. D source/metadata participate in transaction snapshots and rollback; full D settings participate in stale-patch fingerprints. The existing expandable loaded-samples list automatically displays D.

No saved-part format, render compatibility version, DSP or offline engine was changed: generated D uses the existing `modes.loopD` and original-audio inventory slot.

Verification:
- `tests/d-ai-generation-browser.cjs`: Chromium/WebKit authenticated isolated app, synthetic WAV source boundary; adapter reload, controls, exact fitted frames/nonzero PCM, snapshot persistence, undo/reapply, failed-source rollback and ordinary Randomise invoking the real D loader. Unrelated source and W generation are stubbed only in the ordinary Randomise subcase.
- Optional `D_BASELINE=/path/to/backup/index.html D_ENGINE=chromium` demonstrates the old page fails the D inventory assertion.
- `tests/song-d-offline-browser.cjs`: real isolated server render jobs, immutable current-D and legacy sources, warm cache, saved playback/audition and selective freeze refresh.
- AI recipe/backend validation tests cover D raw-source capabilities and reject generated divisions for D. No paid model generation is required by these tests.

Use a dedicated `MYGRAIN_TEST_ROOT` and `MYGRAIN_TEST_ADMIN_PASSWORD` with `tests/song-beta-test-server.py`; never point fixtures at production stores.
