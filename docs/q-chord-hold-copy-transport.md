# Q Hold, edited-chord clipboard, editor history and transport (Q.16)

- `q.chordHold` is an optional boolean, default false. In block mode,
  `MygrainQTheory.playbackEvents` stretches each scheduled chord to the next
  actual chord trigger or explicit rest, including across the pattern wrap.
  Empty and accent-only cells do not interrupt it. Ratchets remain triggers;
  stored per-chord gates are preserved for Hold Off. ARP ignores this setting.
- Held grid voices have a 6 ms release ending at the boundary, not a tail after
  it. Strings use their existing sustain loops. Piano recordings retain their
  natural decay; existing Length/Decay trims and wet FX still apply.
- Main-toolbar Copy Chord reads the selected sequence cell, never the chord
  builder/template. It deep-copies edited pitches, root/type, inversion,
  voicing, velocity, gate, accent, tie and ratchet. Paste writes one independent
  copy at the cursor without advancing; repeating Paste is supported. The
  single-chord clipboard is transient and separate from the section and ARP
  clipboards. Paste and Hold edits participate in card Undo/Redo.
- Autosaves, portable patch/Song captures and JSON presets preserve the actual
  Q state. JSON presets now explicitly include/restore `q`; legacy presets
  without Q leave the current lane unchanged. Historic Song upgrades still
  add a silent, disabled empty Q lane. Explicit saved Q mutes remain respected.
- A fresh Q lane is armed for shared transport but does not start on its own.
  Edits, restores and enabled changes refresh host transport availability. This
  fixes the Q-only Start button remaining disabled until Q was played once.
- Main loop, desktop and sidebar UI starts prepare Q samples before starting
  the shared clock. Pending preparation makes Stop available; Stop invalidates
  the request via Q's generation counter. Controller.start receives the shared
  origin before its first tick; late asynchronous loading preserves the origin
  and joins any still-sounding block gate rather than resetting the clock.
- Active block Hold requires Song `qVersion: 8` freezes on both client and
  server. Older freezes cannot be reused for held blocks. Hold Off and ARP
  retain their existing version requirements; performanceVersion stays 6.

## Editor Hold and ten-level Undo/Redo (Q.16)

- The iPhone report reproduced in Chromium and WebKit touch emulation: the
  Hold button correctly changed saved state, but manual custom-chord auditions
  still used the old fixed .85-second gate. Auditions now honor block Hold.
  Strings at full Length/Decay sustain until the next audition, Hold Off,
  editor Close or Stop. Piano uses the sample's natural decay, not an artificial
  loop. Length/Decay trims and ARP timing are unchanged.
- While the sequence is running, a held manual audition ends at its next chord
  trigger or explicit rest. Switching Hold during an audition applies it
  immediately. Closing during asynchronous sample preparation cancels the
  pending audition too, so it cannot start after the editor has closed.
- Both the main Q editor and individual-note editor expose Undo/Redo buttons
  with available counts, plus Ctrl/Cmd-Z and Ctrl/Cmd-Shift-Z (or Ctrl-Y).
  Up to ten chord edits are retained; the oldest is dropped on the eleventh.
  An entire note drag is one edit. A new edit after Undo clears Redo.
- The local journal restores Q sequence cells and transpose only, preserving
  exact edited voicings and their velocity, gate, accent, tie and ratchet.
  It does not roll back bass, drums, Hold or sound controls. Temporary note
  mutes/solo remain audition state, not saved chord edits. Undo keeps the note
  editor open where possible; deleting the final note can be undone from the
  main editor. These actions still participate in the global card history.
- Local editor history survives Close/Open but is transient: restoring a
  preset, Song or global history snapshot resets it to avoid crossing states.
  The restored musical chord data continues through normal saves/Song captures;
  the local history itself is not serialized. Existing Song render versions
  are unchanged because audition/history state is not a musical render setting.

Verification commands (use an isolated test server, never production stores):

```
python3 tests/song-beta-test-server.py 18891
node --test tests/q-hold-copy.test.cjs tests/q-theory.test.js tests/q-length-decay.test.js tests/q-custom-arp.test.js tests/q-individual-chord.test.cjs tests/q-keyboard-player.test.js tests/q-strings.test.js tests/q-note-solo.test.cjs tests/q-bass-root-pool.test.cjs tests/song-beta-compatibility.test.js tests/song-beta.test.js tests/song-beta-clock.test.js
python3 -m unittest discover -s tests -p 'test_q_*.py'
python3 -m unittest discover -s tests -p 'test_song_backend.py'
node tests/q-hold-copy-browser.cjs
node tests/q-hold-transport-preset-browser.cjs
node tests/q-note-solo-browser.cjs
node --test tests/q-editor-undo.test.cjs
node tests/q-hold-editor-audition-browser.cjs
node tests/q-chord-undo-browser.cjs
```
