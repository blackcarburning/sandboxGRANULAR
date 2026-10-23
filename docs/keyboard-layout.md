# Keyboard layout and pitch mapping — KEYS.1

The keybed uses the same absolute coordinate system for white and black keys, including border-box sizing. Each sharp is centred on the corresponding white-key boundary: C/D, D/E, F/G, G/A and A/B. There is no black key between E/F or B/C. No flex shrinking or hard-coded per-note CSS positions may independently move one colour of keys.

Responsive display uses the **keybed's actual content width**, not the containing card or window width:

- Below 430 px: C3–C4 (one octave plus the upper C, eight white keys).
- 430–899 px: C2–C4 (two octaves plus the upper C).
- 900 px and above: the original C1–B4 range.

Octave buttons transpose the original base-note identities by −3…+3 octaves, as before. Hidden key nodes are retained, including their saved held-note identities and event handlers; resizing does not erase a chord. A ResizeObserver refreshes geometry after account startup, card width changes and rotation. Accessible labels and titles follow the **sounding** octave for black as well as white notes.

`getKeyboardNoteMidi()` is the shared note-to-pitch boundary: `(octave + 1) * 12 + pitchClass + 12 * octaveOffset`. A4 is MIDI 69 / 440 Hz and C4 is MIDI 60. Sample selection/preparation and note-on use this integer mapping directly. Piano, Strings and Sample accept the complete original keyboard range at every octave setting, including C1 shifted down three octaves (C−2 / mathematical MIDI −12). The former MIDI-0 clamp collapsed these lowest twelve notes onto one pitch. This extends audio pitch calculation only; hardware MIDI and Q sequencer data limits are unchanged.

Sample remains rooted at C4, which plays its **original recorded pitch**; arbitrary imported audio is not automatically pitch-detected or retuned. The sampled acoustic piano retains its original instrument tuning/stretch. No sample files, Song schemas, stored note names, K routing or recorded takes are rewritten.

## Verification

- `tests/keyboard-note-mapping.test.cjs`: all 336 base-note/octave combinations, chromatic E/F and B/C boundaries, tuning references and agreement with the granular pitch path.
- `tests/q-keyboard-player.test.js`: all three sampled instruments, all 336 mappings, both 44.1/48 kHz context rates; exact sampler ratios and voice cleanup.
- `tests/mygrain-utils.test.js`: four-octave black/white geometry, including widths below the former hidden minimum.
- `tests/keyboard-mapping-browser.cjs`: localhost/disposable accounts only. Both Chromium/WebKit, desktop and touch phone contexts; actual fetched piano/strings assets; 1,008 host mappings per run; physical targets and repeated notes in low/default/high octaves; 320/390 px portrait and 844 px landscape layouts. FFT checks rendered sample audio down to C−2 and up to B7 and every piano semitone over C3–B3 plus a C4/E4/G4/B4 progression, using both 44.1 and 48 kHz offline rendering. Numerical render checks retain each actual keyboard voice's native-rate source and playback rate.
- `tests/keyboard-sample-browser.cjs`: real K worklet recording, held/Arp notes, Save Amendment/recall, Undo/Redo, frozen Song rendering and account reload without library refetch.

Phone checks are browser emulation, not measurements on a physical iPhone.
