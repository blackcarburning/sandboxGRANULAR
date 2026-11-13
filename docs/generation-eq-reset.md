# Generation EQ reset

Random patch/Mega/Sparse, per-card random samples/patterns/cuts and noise
randomisation clear channel EQ automation and bypass all 28 EQs. This retains
manual band settings. `resetForGeneration()` uses the existing runtime restore
boundary, which cancels armed/recording writes and transient playback overrides.

Reset happens within the history transaction after readiness guards. Undo/Redo
therefore includes EQ state. AI application resets after its rollback snapshot;
failed/cancelled recipes restore the existing patch through the normal adapter.
Merely requesting an AI recipe does not change EQs.

Persistence and server Song rendering use the existing `modes.channelEq` data.
No new saved schema, DSP, audio-clock or renderer revision is introduced. Older
parts keep their EQ/automation; new captures carry bypassed channels without
curves. Existing render caches are not invalidated.

Verification:
- `node --test tests/channel-eq.test.cjs tests/eq-automation.test.cjs tests/generation-eq-reset.test.cjs`
- Isolated server `tests/song-beta-test-server.py 19073`, disposable admin only;
  `node tests/generation-eq-reset-browser.cjs` checks Chromium/WebKit randomisation,
  all-channel bypass/Write cancellation, Undo/Redo, AI apply/Undo and preset roundtrip.
- Live changed scripts fetched with HTTP 200 and exact deployed bytes.

AI Patch Direction and GENREator now share an unchecked-by-default
Protected Layers / EQ (all channels) switch. It preserves all channel EQ settings
and curves for AI apply, refine and regenerate; ordinary randomisation still
resets EQ. This is distinct from InstaReel's arrangement-layer protection panel.
The existing saved EQ format and render path are unchanged.

AI controls are fetched with no-store before each model request, preventing a
long-lived page from rejecting updated limits such as X level 80 with old max 70.
`tests/ai-schema-refresh-browser.cjs` starts with that stale maximum and verifies
refresh, AI apply, protection, unprotected reset, Undo/Redo and preset roundtrip
in Chromium and WebKit without calling a paid model.
