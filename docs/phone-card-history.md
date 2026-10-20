# Phone loop actions, card history and Solo

Build: v2026.10.20.TOUCH.7.

- All loop-card and L/X/Q editor action buttons use normal native taps. The global hold-delay input interception has been removed entirely; accidental randomisations can be reversed with Undo.
- Playable keys, chord pads, step grids, Solo toggles, Stop/Close/Cancel, mouse and keyboard activation keep their usual immediate behaviour.
- Left-edge Undo (red) and Redo (green) retain ten global randomisation steps. Numbers show available steps. New changes discard the redo branch. History survives reloads and browser restarts in local browser storage, scoped to the account and stable Song device ID. Account lock clears RAM only; the saved journal remains isolated for that account/device.
- The shared implementation is in `song-beta-adapter.js`: `installCardHistory`, `installSoloButtonStyles`, `mountCardSolos`. It reuses the complete Song audio/metadata bindings without recalling a Song part or refetching on redo. `song-beta-storage.js` provides the separate IndexedDB history journal and exact PCM store; it does not change Song/export formats.
- Curated wrappers encompass whole source/loop/drum/OSC3/Patch/Mega/Sparse actions, including the original returned asynchronous promise. Nested actions form one step. Q random and extra drum pattern callbacks explicitly use the transaction API.
- Deltas merge changed settings into current state, preserving unrelated subsequent manual edits. Arrays are atomic. Changed sound buffers retain their full, atomic metadata, including the absence of startup-only provenance flags. Live buffers are retained by reference; persisted buffers are restored lazily and losslessly. Only changed audio persistence slots are written during travel. Current playing loops/drums, held keyboard notes, arpeggiator and Q-only transport resume against one fresh audio deadline.
- Pending random changes block additional trusted random action input and disable Undo/Redo. Recording, Song and AI operations block history travel. No-op failures add no step; changes from partially failed actions remain undoable.
- All actual Solo controls share `mygrain-solo-button`: dark red off, bright red active. New card controls for L/X/M/M+/K/drums use the existing authoritative layer Solo setter; Layers/Mix/card controls remain synchronized. Q Only play/stop are preview transport controls, not Solo toggles.

## Verification

Use disposable local accounts only, never production writable tests:

```sh
MYGRAIN_TEST_ROOT=/tmp/mygrain-history-store python3 tests/song-beta-test-server.py 18833
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ node tests/phone-card-history-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ WEBKIT=1 node tests/phone-card-history-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ node tests/solo-tap-history-rail-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ node tests/history-device-brand-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18833/mygrain/ node tests/history-restart-browser.cjs
```

Chromium and WebKit use ordinary native taps (not physical iPhone verification). Both use actual original ALTBASS downloads and the native audio graph. The script first checks ordinary native taps on L/X/Q Edit Sequence, L/X Open Synth, sample browsers and source switches. It also checks ten-step exact patterns/sounds, metadata, unchanged unrelated volume, Q and extra drums, branching, delayed completion, failed actions, account isolation, uniform Solo colours, playback resume, immediate Stop and keyboard activation, portrait/landscape quick controls and uncaught errors.

## TOUCH.2 correction

Solo controls are normal tap toggles and are explicitly excluded from the hold guard. TOUCH.1 incorrectly protected them and its test held Solo instead of checking ordinary taps. The independent left-side history rail no longer changes the original right quick stack or its spacing/order.

## TOUCH.3 correction

Removed the entire card-wide pointer/click hold guard and its CSS. It blocked normal taps on non-Solo card actions; extending exceptions was insufficient. Keep only the styling observer, exact two-step history, the existing pending-random-operation guard and the left history rail. Regression tests now require real native taps, not held or programmatic clicks, for card randomisation.

## TOUCH.4 — ten-step device-guarded history

Undo and Redo retain up to ten changes, with no copied PCM or history shared between devices. Each entry is bound to the account/device/session identity already used by Song. With a selected song, each Undo/Redo verifies its server reservation (or requests an unowned reservation using the Song device name). Another device or tab—even with the same account or label—cannot override its owner. Offline, lost reservations, account changes and selection changes block travel without consuming the history entry. No selected song means local-only history without an unnecessary network request. No Song parts are saved by Undo/Redo. The app header stacks and centres the enlarged rainbow brain, MYGRAIN and build badge; the obsolete Play/Source/BPM chip is removed.

## TOUCH.7 — persistent, device-scoped history

- A dedicated account-namespaced IndexedDB journal retains both stacks (ten changes total) under the stable Song device ID. The volatile reservation session is intentionally not the persisted identity: restarting creates a new session, not a new device. Each live Undo/Redo still checks the current session and selected Song server reservation before changing anything.
- Exact per-channel PCM, original sample rate and metadata survive browser restarts. Each distinct AudioBuffer is stored once by reference ID, shared Q atlas/cache audio is deduplicated, and unreferenced PCM is collected atomically with journal updates. No pitch or sample-rate conversion is performed. Existing stored sounds are decoded only when travelling history, not at startup. Saves follow completed changes, outside the audio-processing callback; there is no polling.
- A browser Web Lock prevents another tab on the same device from overwriting or travelling the active journal. An IndexedDB revision check is the fallback and also guards stale writers. Ordinary card taps remain immediate; no hold-delay interception is restored.
- If browser storage cannot open or fills up, a warning explains that saving is unavailable; current-session randomisation and Undo/Redo remain functional. Clearing website data removes saved history. History is local to that browser/account/device, not synced between devices.
- The restart regression closes and relaunches actual Chromium/WebKit browser processes and verifies both stacks, all ten Redo steps, exact original ALTBASS PCM hashes/metadata without redownload, lazy audio loading, Q Maps/shared audio, aborted-write atomicity and PCM collection, second-tab protection, separate device/account journals, and unavailable/quota-failed storage fallback. The reservation regression separately verifies foreign-device ownership, identical labels, offline/reconnect and selection races. Browser mobile emulation is not a physical-iPhone test.
