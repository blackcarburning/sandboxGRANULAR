# Keyboard layout and pitch mapping — KEYS.2

The keybed uses one absolute border-box coordinate system for white and black keys. Sharps sit on the C/D, D/E, F/G, G/A and A/B boundaries; there is no black key between E/F or B/C. Key labels, hit targets and sounding notes all use the same absolute note name.

## View and selection

Responsive geometry uses the keybed's actual content width:

- Below 900 px, including iPhone portrait: **two octaves plus upper C**, 25 keys / 15 white keys. Default C2–C4.
- At least 900 px: four octaves, default C1–B4.

Octave buttons move only this visible window by −3…+3 octaves. They do not transpose notes, restart sounding voices or change the held/Arp note pool. Hold selections retain their absolute names when hidden, and their highlights return on navigating back. An overlapping note in adjacent windows is the same selectable note. All 120 fixed nodes C−2–B7 retain their handlers and selection state; rotation only recalculates geometry. A ResizeObserver refreshes layout after startup and card-width changes.

`getKeyboardNoteMidi()` maps an absolute name directly to MIDI: `(octave + 1) * 12 + pitchClass`. A4 is MIDI 69 / 440 Hz; C4 is MIDI 60. Sample preparation, note-on, Piano, Strings, oscillator and granular keyboard paths use those pitches independently of the view. Mathematical MIDI −12 supports C−2 without collapsing the lowest notes onto MIDI 0. Hardware MIDI and sequencer limits are unchanged.

Sample remains rooted at C4, playing its original recorded pitch. Imported audio is not automatically pitch-detected or retuned; the acoustic piano retains its instrument tuning/stretch.

## Persistence and older Songs

New state/presets include `keyboardNotesVersion: 2`; selected note names are absolute. The persisted `octave` value now describes only the view. Song capture accepts all keyboard notes, including selections outside the sequencer's C1–C5 note list. Save Amendment/recall and card Undo/Redo use the same normalization boundary.

Older snapshots stored base note names plus a playback octave shift. Recall converts selected notes to their original sounding names **once in memory**, without rewriting saved ZIP originals. Recapturing marks those notes as version 2, avoiding a second shift. Older global octave settings also affected non-keyboard synth/grain backing: `keyboardLegacyBackingOctave` retains that original tuning separately on recall and subsequent saves. New view navigation never changes it; new parts default to zero. Reset clears the compatibility setting. Recorded K audio and unrelated sequencing/routing are unchanged.

## Verification

- `tests/keyboard-note-mapping.test.cjs`: 120 absolute keys across seven view positions; tuning and chromatic boundaries; one-time legacy conversion; independent backing compatibility.
- Focused regression slice: keyboard mapping, keyboard/K readiness, geometry utilities, Q keyboard player, piano startup, K multitrack and Q Song source-memory tests.
- `tests/keyboard-mapping-browser.cjs`: disposable localhost accounts; Chromium/WebKit desktop and phone; 2,520 host pitch mappings, 162 physical key presses and 38 rendered-audio FFT pitch checks per context. Includes Piano/Strings/Sample, C−2–B7, 44.1/48 kHz renders, narrow portrait and landscape hit geometry.
- `tests/keyboard-octave-view-browser.cjs`: two-octave 320/390 px portrait and 844 px landscape geometry; native touch/click selection across windows for Sample/Piano/Strings; exact sounding-voice identity; overlapping-key deselection; absolute Arp pool/playback; Undo/Redo; real Song Save Amendment/recall, old snapshot conversion and unchanged source JSON; non-silent Song rendering.

Phone checks use browser emulation, not a physical iPhone.

## iPhone card containment — KEYFIT.1

The outer keyboard card and its nested sound-card grids explicitly use `minmax(0, 1fr)` and zero minimum inline sizes. Direct children cannot exceed the card; sound/record controls cap at 760 px. This prevents intrinsic content widths from expanding a single card while the page shell still fits. Scoped text-size adjustment avoids Safari text inflation without disabling user pinch zoom. Number/select fields use at least 16 px on coarse pointers to avoid iOS focus magnification.

K destination and K Solo occupy separate two-column cells on row six. The original one-column auto placement let the destination label/select overflow underneath Solo on 320–430 px phones. The destination wraps within its own cell. No audio, saved notes, Song state or K recording logic changes.

`tests/keyboard-card-fit-browser.cjs` uses isolated localhost accounts and real startup/keyboard handlers in Chromium and WebKit. It checks 320/390/430 portrait, 844 landscape and rotation back; nested card scroll widths; all 25 keys; destination/select/Solo separation; 16 px focus fields; repeated Hold key taps; and recording-length/destination persistence through reload. Browser emulation cannot prove the exact Safari UI zoom behavior of a physical iPhone.
