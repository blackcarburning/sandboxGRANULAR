# L/X Sparse/Mega defaults — corrected 2026-11-03

Only Sparse and Mega force both L/X Length to 100%, Decay to 80%, and X Volume
to 80%. L Volume remains independent. The shared Mega/Sparse generation helper
and its final history boundary apply these defaults before capture.

Ordinary and per-card randomisation no longer pin those five controls. AI
Generate, GENREator, Refine and Regenerate apply recipe parameters as supplied,
without merging fixed L/X values over them. Omitted parameters remain unchanged
by this policy. Normal supported-control validation still applies.

History, rollback, patch ZIPs, saved presets and server Song rendering retain
the existing control fields. No DSP change, source ZIP rewrite, renderer-version
bump or old render-cache invalidation: the isolated deck already restores the
actual saved lengths, decays and levels. Legacy preset recall is unrestricted.

Verification: `tests/lx-random-envelope-browser.cjs` checks per-card independence,
Mega defaults, ordinary history boundary, explicit AI values, saved ZIP values,
Undo/Redo and legacy recall in Chromium/WebKit. `tests/ai-worker-wait-browser.cjs`
checks the public AI generation path with non-default L/X values, worker-busy
responses, stale schema refresh and EQ protection/reset preservation.

AI worker admission remains single-flight. Only structured busy/cooldown 429
rejections (or their exact legacy messages) wait and retry; accepted requests
and provider/validation failures are never automatically repeated. Waiting is
bounded to 90 seconds and is cancellable; the overall request limit is 180s to
allow worker wait followed by the existing model timeout. Patch/account changes
are checked before resubmission. No background or idle polling is introduced.

Backup: parent workspace `output/mygrain-ai-free-20261103T1815Z/`.
