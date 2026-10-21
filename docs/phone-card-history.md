# Phone loop actions, card history and Solo

Build: v2026.10.20.TOUCH.9.

## AI.10 — AI patches use the same Undo/Redo journal

Successful Generate, Regenerate, Refine and AI section generation each add one named step to the main ten-step history. Nested source/sample/drum operations are part of that step, not extra entries. Undo restores the previously loaded sounds, settings, notes/chords, drum patterns and tempo; Redo restores the exact result without a model request, a new random choice or sample refetch. The AI prompt/direction and section context travel with the same step. Cancelled, failed, invalid and no-op recipes do not add entries or discard an existing Redo branch.

The AI card's **Undo direction** delegates to this same history (with the existing manual-edit fingerprint guard). It is offered only when the next undo is an AI step; it never skips a later card action. **Keep current** dismisses that shortcut but does not remove the step from the main journal. AI controls stay disabled while shared-history travel is pending. Stored-take recalls dismiss the old shortcut; Q capture bookkeeping retains the fingerprint guard.

The journal remains local to the exact account + stable Song device ID. Persistence version, audio-slot order/codecs, ten-step limit, tab-writer protection and Song reservation checks are unchanged. Existing journals need no migration; the AI direction is an optional JSON delta, separate from Song/patch export formats. Main history continues to merge only changed fields, preserving unrelated later manual fader edits. No desktop/mobile styling or audio engine changes are made.

Regression: `tests/ai-patch-history-browser.cjs` uses real audio decoding and stereo PCM hashes, native portrait/landscape taps, fine-pointer desktop clicks and actual browser-process restarts in Chromium/WebKit. Run against the disposable local server documented below; set `MYGRAIN_TEST_URL` and optionally `AI_HISTORY_EVIDENCE`. AI/source replies are deterministic fixtures, not real model requests or production writes.

## K.6 — completed keyboard / ARP recordings

Each successfully captured K take adds one **Record to K** step at the asynchronous replacement boundary, not when the count-in is armed. Both previous and new raw/rendered buffers, metadata and source BPM are retained by the existing exact-PCM journal. Undo can return to empty K or the previous take; Redo restores the recording after travel and browser restarts. The narrow `recordK` transaction permits only K's processing phase, never history travel or unrelated randomisation during capture. Pending history prevents arming a take. A changed account history/audio context rejects stale completion; failed/cancelled capture leaves the existing Redo branch intact. Ten-step limits, stable device identity, tab locks, Song reservations, lazy PCM restoration and persistence formats remain unchanged.

Regression: `tests/k-record-history-browser.cjs` uses real ARP and keyboard-bus captures, native phone taps, per-channel PCM hashes, replacement takes, unrelated fader preservation, actual browser-process restarts, cancellation and existing Clear K history in Chromium/WebKit.

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

## TOUCH.8 — consistent thin button edges

Action buttons retain one-pixel borders in every toggle state; the extra three-pixel active inset stripe is removed. Transient press feedback overlays the existing edge with one pixel instead of adding a thick inner ring, and action-panel keyboard focus remains visible with a thin offset line. Palette colours, labels, toggles, native taps and persistent history are unchanged.

## TOUCH.9 — V loop cut randomisation and edit history

V’s card and Loop Cut editor have Randomise Loop Cut. It selects source Start/End, Stretch and From Start, enables the cut, respects the selected snap grid and keeps a non-empty source/destination within the loop. Stretch stays between roughly half and twice the chosen duration (grid-rounded); Repeat, snap size and the original source audio stay unchanged. Plain patch randomisation includes existing V cuts; Mega/Sparse chooses V’s cut after source replacements settle so the new mapping is not reset.

Randomisation, editor toggles/fields and complete handle drags each participate in the existing ten-step account/device-scoped persistent history. A drag is one transaction, not one entry per pointer movement; pointer release/cancel, lost capture and Close finish it. Existing Song/preset/state cut fields retain their format.
