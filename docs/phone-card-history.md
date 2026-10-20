# Phone loop actions, card history and Solo

Build: v2026.10.20.TOUCH.2.

- Touch/pen loop-card and L/X/Q editor action buttons require a 350 ms hold, then release. A quick tap, pointer cancellation, scrolling or >10 px movement cancels. The release must still hit that button. No repeat or synthetic-click double application.
- Playable keys, chord pads and step grids stay immediate. Solo toggles and Stop/Close/Cancel stay immediate. Mouse and keyboard activation retain their usual behaviour.
- Left-edge Undo (red) and Redo (green) retain two global randomisation steps. Numbers show available steps. New changes discard the redo branch. History is temporary and cleared on account lock/reload.
- The shared implementation is in `song-beta-adapter.js`: `installCardHistory`, `installPhoneCardActions`, `mountCardSolos`. It reuses the complete Song audio/metadata bindings but does not archive, encode, clone PCM, recall a Song part or refetch on redo.
- Curated wrappers encompass whole source/loop/drum/OSC3/Patch/Mega/Sparse actions, including the original returned asynchronous promise. Nested actions form one step. Q random and extra drum pattern callbacks explicitly use the transaction API.
- Deltas merge changed settings into current state, preserving unrelated subsequent manual edits. Arrays are atomic. Changed sound buffers are retained by reference with their metadata. Only changed audio persistence slots are written during travel. Current playing loops/drums, held keyboard notes, arpeggiator and Q-only transport resume against one fresh audio deadline.
- Pending random changes block additional trusted random action input and disable Undo/Redo. Recording, Song and AI operations block history travel. No-op failures add no step; changes from partially failed actions remain undoable.
- All actual Solo controls share `mygrain-solo-button`: dark red off, bright red active. New card controls for L/X/M/M+/K/drums use the existing authoritative layer Solo setter; Layers/Mix/card controls remain synchronized. Q Only play/stop are preview transport controls, not Solo toggles.

## Verification

Use disposable local accounts only, never production writable tests:

```sh
MYGRAIN_TEST_ROOT=/tmp/mygrain-history-store python3 tests/song-beta-test-server.py 18833
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ node tests/phone-card-history-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ WEBKIT=1 node tests/phone-card-history-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ node tests/solo-tap-history-rail-browser.cjs
```

Chromium uses native CDP touch presses; WebKit uses native taps plus dispatched PointerEvents for held/cancelled gestures (not physical iPhone verification). Both use actual original ALTBASS downloads and the native audio graph. The script checks two-step exact patterns/sounds, metadata, unchanged unrelated volume, Q and extra drums, branching, delayed completion, failed actions, account isolation, uniform Solo colours, playback resume, immediate Stop and keyboard activation, portrait/landscape quick controls and uncaught errors.

## TOUCH.2 correction

Solo controls are normal tap toggles and are explicitly excluded from the hold guard. TOUCH.1 incorrectly protected them and its test held Solo instead of checking ordinary taps. The independent left-side history rail no longer changes the original right quick stack or its spacing/order.
