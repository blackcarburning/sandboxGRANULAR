# Sample-load feedback (2026-10-31)

`SAMPLE-LOAD-FEEDBACK.1` adds a lazy, dismissible native dialog independently
of the transient settle/status overlay. Randomisation completion cannot clear it.
Concurrent failures update one bounded list (20 entries, 500 characters each).
It uses textContent for server error text, no timers, animations or audio changes.

Covered boundaries: Grain A/B random, Mega/Sparse granular picks, keyboard/Q
sample loading, drum random/reload/individual source loads, Dropbox layer,
Loop L/X random/remembered/manual sources, generated-loop responses and decoding,
and empty/failed sample browser catalog refreshes. A partial drum reload reports
its failed lanes even if existing buffers allow the kit to remain usable.

The wrapper preserves return values and rejection behavior; loaders retain their
existing history, ownership, source-change guards and rollback. Empty bytes or
zero-length decoded audio are rejected before a source buffer is applied. Silence
inside a valid audio buffer is not an empty response. Intentional aborts/context
changes are not reported; a failed network fetch is. Isolated Song render decks
continue receiving loader errors but never create notification UI.

Verification:

- `node tests/random-performance-samples.test.js` (12 picker/guard tests).
- `MYGRAIN_TEST_ADMIN_PASSWORD=isolated-render-refresh-fixture MYGRAIN_TEST_DAN_PASSWORD=isolated-mastering-dan python3 tests/song-beta-test-server.py 18932`
- `node tests/sample-load-feedback-browser.cjs` against that disposable server.
  Chromium and WebKit, 390×844 touch viewport: actual UI button handlers and native
  decoding, successful loads, empty catalogs/audio, invalid audio, HTTP 500,
  failed network, partial drums, prior PCM/metadata retained, browser refresh,
  dismissed/reopened errors, intentional cancellation, settle-popup independence,
  and offscreen-render suppression. No production account transactions.

The older random-performance browser suite predates the current registration
approval and grain-card layout, so the focused suite logs into the isolated seeded
account and dispatches the existing Random buttons without relying on old panel
visibility/history-count expectations. Physical iPhone/network testing remains
separate from browser emulation.
