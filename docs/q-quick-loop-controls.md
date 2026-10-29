# Q main-panel audition and pitch controls

## Immediate sequence controls

- **Clear All** clears all 64 Q cells, including inactive cells beyond the current pattern length. It clears the current selection and ends Q playback/audition. Local Q Undo restores the exact chords, velocities, gates, accents, ratchets, ties and custom voicings. The custom MIDI pool is not deleted. Other tracks are untouched.
- **Loop Set** arms two grid taps: first and last step. The inclusive range starts playing once the required local samples are ready. Click Loop Set again to cancel marking.
- **From / To** also accept step numbers; **Loop On** starts that range. Changing endpoints during an active loop reloads and starts the new range. Invalid/empty ranges report an error without changing the saved sequence (an empty range is allowed for armed Live recording).
- **Loop Off** returns to the full Q sequence. Stop, restore, leaving Q or opening the individual-chord editor clears the temporary range. Loop endpoints and active-loop state are not saved into songs/patches/exports.
- This is a **Q-only audition range**. It does not crop other tracks, change pattern length or launch the shared pattern transport. Step recording still uses the selected grid cell; Live recording maps the playback clock back to the original numbered grid cells within the range.

Playback uses a cropped copy of Q settings, cached for each immutable playback snapshot; original stored indices are retained for live editing. Existing block/ARP/hold/ratchet/accent scheduling is used. Voices are bounded at the selected loop boundary. With no range, playback retains the full existing pattern behavior. The individual-chord editor's existing whole-pattern section preview is unchanged.

## Immediate chord-selection controls

Three +/- groups above the chord candidates:

- **Chords**: literal one-semitone candidate transposition, -24 to +24, without quantizing to the scale or changing recorded chords, the scale tonic, or the playback transpose.
- **Tonic**: one-semitone changes to the existing scale tonic/key, wrapping B/C; synchronizes the existing advanced Key and Chord Root controls. Since holding-pen-1, Tonic ± also moves current bass-root pitch classes; From Bass refreshes the original Bass X roots.
- **Octave**: changes the existing candidate octave by one. It synchronizes the advanced octave control.

Native red candidates display and record their shifted pitches. Since holding-pen-1, green candidates keep fixed original notes and ignore candidate transpose, tonic and octave. Dragging snapshots a red tile’s current displayed pitches into that holding pen. See `q-holding-pen.md` for current behavior and portable green sequence provenance.

Candidate shifts use additive Q state field `paletteTranspose`, default 0. Existing v1 Song/patch/browser data remains valid; the server accepts a missing field and validates new values as integers -24..24. This value is metadata for future candidate choices, not a pitch change to the existing audio bank or sequence. No user-data migration or rewrite is needed.

## Verification

- `node --test tests/q-*.test.*` includes scheduler, live-index mapping, cancellation, full 64-cell Clear/Undo, literal shifts and no-change bounds checks.
- `python3 -m unittest discover -s tests -p 'test_q_*.py'` covers old and new server Q settings, including an unchanged playable legacy sample bank with candidate transpose set.
- `tests/q-quick-loop-browser.cjs` uses disposable localhost accounts and actual piano audio in Chromium/WebKit desktop and phone sizes, with smaller portrait/landscape reachability checks.
- Existing custom MIDI and individual-chord Undo browsers remain regression checks. No production Song/sample/account fixtures are mutated.
