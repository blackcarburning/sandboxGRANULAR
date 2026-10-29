# Initialise Patch

Build: v2026.10.26.CLEAR.1

The orange smoking-bomb control, labelled Clear Patch, sits immediately above AI Patch in the
right-hand quick jump stack and expanded jump menu, on desktop and phone.

It stops old playback and held notes, resets sound controls, disables sound layers,
piano/strings, Hold/arp/sustain, filters and effects, clears sequencers,
accents/ratchets, cuts/gaps and all current-patch audio, including all five K
tracks. Current-patch IndexedDB audio slots are deleted so stale samples do not
return on reload. Saved Songs, sample/repository libraries and history are not
removed. The entire edit participates in existing Undo/Redo.

Implementation: final inline script in index.html; strict current-audio-slot
clearing is exposed by song-beta-adapter.js. Keep the inline implementation
because arbitrary new external scripts require the backend asset allowlist.

Verification: tests/initialise-patch-browser.cjs exercises live files with
isolated browser storage and mocked account/API reads. It checks both jump
placements, orange/round styling, no horizontal overflow, cleared current audio
and DB slots, disabled layers, Undo/Redo and persistence across reload. K test
fixtures must refreshBuffers() after direct setBuffer() calls to synchronize
legacy selected-track aliases before save/history capture.

Verified 2026-10-26: desktop and iPhone-sized WebKit/Chromium all pass; 16
focused K/FX unit tests pass; all 73 inline scripts and adapter parse. Live
index.html and adapter HTTP responses exactly match the working files. Physical
iPhone hardware was not available for this check.

CLEAR.1 keeps generated-loop transport enabled (not its dry audio layer) and
starts the empty clock after the clear transaction. Start/Stop remains usable
with no buffers or enabled sounds. Focused clear-patch-clock browser regression
checks the advancing clock, silent layer state, Start/Stop and Undo.

CLEAR-LINK.1: Clear Patch is now only in the expanded Jump menu's Direct Links
(on both desktop and phone). The duplicate quick-stack / right-edge button was
removed. Its clear/empty-clock/Undo behaviour is unchanged.
