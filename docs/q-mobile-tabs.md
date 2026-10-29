# Q phone control panels · 2026-10-24 · edge-loop-2

Phone portrait (up to 760 CSS px), and coarse-pointer landscape up to 1024px, use mobile panels.

- Left **Pitch / Undo**: literal candidate transpose, tonic, octave, chord Undo/Redo, advanced tonal settings.
- Right **Tools**: From Bass, Scale Pool, Custom from MIDI, recording and step controls, expandable Chord playback and Step editing.
- Start/Stop are right-edge direct-action handles, including when a panel is open. Pitch/Undo and Tools are left/right edge pull-out menu handles; no top control row.
- Done, the outside shade, or Escape closes a panel. Range-selection actions uncover the grid automatically. MIDI capture uses its existing top-layer dialog.
- Loop Set, From/To, Loop On/Off, Clear All, Delete and All loops/Q solo stay in the main sequencer panel. Steps use eight compact columns. Chords and steps scroll independently.
- Loop Set/On selects the range without independently starting transport. Start plays either Q only or all enabled loops according to All loops/Q solo. Stop preserves the selected range; Loop Off, Clear All, close and song/patch restore reset it. While shared playback is running, range changes keep its shared origin. Other loops retain full patterns. The range and playback mode are not saved into songs/patches.

One authoritative instance of each control is moved into a panel; desktop anchors restore the original structure when resized. This is transient presentation only: no Song, patch, custom-library or audio-processing schema changes. Existing delegation remains inside the body-mounted Q overlay. Undo buttons move focus to Done when disabled, preserving keyboard Escape.

Verification: `node tests/q-mobile-tabs-browser.cjs` uses Chromium and WebKit at 390×844, 320×640, 844×390 and 1280×900. It blocks all production writes and mocks account GETs. The fixture supplies a generated PCM source to avoid modifying samples. It checks pitch state, exact sequence retention, Clear/Undo, Q range playback/stop, source/MIDI location and opening, playback settings, panel/Escape behavior, viewport containment and desktop restoration. `MYGRAIN_TEST_URL` and `MYGRAIN_TEST_OUTPUT` override URL/evidence folder. These are emulated phone tests, not a physical iPhone test.

Backup: `/root/.openclaw/rollback/mygrain-q-edge-loop-20261024T102701Z`. Exact pre-change code/tests/docs are preserved. Original complete-data rollback remains intact. No production data mutations.
