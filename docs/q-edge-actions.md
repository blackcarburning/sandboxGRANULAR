# Q dedicated edge actions — 20261024-q-edge-actions-1

The same authoritative controls occupy edge rails on desktop and phone. The centre contains chord pools, the sequencer and From/To loop numbers. Green chord Delete buttons remain beside their individual pool entries.

Left: Pitch/Undo drawer, Copy Chord, Paste Chord, Copy Range, Copy Section, Paste Range, Mark Trans, Seq −/+, Clear Mark, Delete and Clear All. The editing actions are direct buttons, not hidden behind menus. Copy Range copies a marked section once; Copy Section preserves the existing repeat-fill behavior. Mark Trans selects first/last cells for the separate sequence transpose buttons. Actions close an open drawer so grid marking stays interactive.

Right: Tools drawer, fixed Start/Stop, scrolling loop/mode/practice/record/rest controls and fixed Close. Tools holds source-pool choices, Keep selected, playback and step-editing settings. Rails scroll independently on short screens; Start/Stop does not scroll away. Only numeric loop endpoints remain on the main sequencer panel. Pitch controls and Undo/Redo remain together in the left drawer.

This is a DOM/CSS layout change. No audio, Song schema, server conversion, chord data or sample-storage changes. Existing fixed green holding-pen behavior and shared/solo loop playback are preserved.

Checks: 163 Q unit tests; read-only Chromium/WebKit browser checks for direct range copy, repeated section copy, chord copy/paste, marked sequence transpose, Delete/Clear All and Undo/Redo, transport audio and loop preservation, portrait/narrow/landscape containment, plus holding-pen pitch/MIDI/drag/persistence regression. All production API writes blocked in live verification. Browser-emulated phones, not a physical iPhone.
