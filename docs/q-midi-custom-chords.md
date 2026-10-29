# Q — persistent custom chords from MIDI

Only the Q custom-candidate workflow is added. `q-card.js`, `q-card.css`,
`q-theory.js`, sequencing/audio and Song/patch schemas are unchanged.

**Custom from MIDI** sits beside **From Bass** / **Scale Pool**. A native modal
shows the existing MIDI input selector, connection/retry, estimated chord name,
exact note names and a highlighted keyboard. Play notes together; the complete
voicing is latched after staggered releases. A new gesture replaces the capture;
Clear and closing discard unsaved capture. Sustain, channels, velocity-zero
note-offs and MIDI panic are handled. Q's existing 1–8 notes / A0–C8 limits apply.
The identifier is the existing Q pitch-class/inversion identifier; unrecognised
voicings remain explicitly Custom rather than being labelled major.

Save adds the exact notes to a separate green pool on the right of the native
candidate area. Each has a Custom label, estimated name and Delete underneath.
Tapping a candidate uses unchanged Q `playChord`, practice/Step/Live behaviour,
current gate/velocity and instrument. Removing a pool entry never removes notes
already placed in the sequence. Identical voicings are not duplicated.

The pool uses **account-scoped browser local storage**, key
`mygrain-q-custom-chords-v1`, `{version:1,chords:[{id,notes}]}`. It survives reload,
scale/bass changes, randomising, and loading other patches/Song parts because it
is deliberately outside recalled Q state. It is not part of patch/Song exports
or a cross-device cloud library. Storage failures are displayed; failed writes
do not claim success or remove the old pool. Unknown/corrupt stored schemas are
not silently overwritten. Storage events refresh other tabs; edits re-read the
latest pool before adding/deleting. Explicit deletion is the only pool UI removal.

Integration: one passive observation call in existing `handleMidiMessage`, a
read-only refresh bridge to the existing MIDI input initializer, and two new
sidecar assets loaded after Q. MIDI messages are not consumed, remapped or
redirected; normal keyboard handling still runs. The backend asset allow-list
adds only these two static filenames. No backend data conversion or migrations.
The sidecar is skipped in hidden Song render decks and locks with the account.

Tests: `q-custom-chords.test.cjs` covers capture, sustain/releases, range limits,
identification, storage and malformed schemas. `q-custom-chords-browser.cjs`
uses virtual Web MIDI through the real selected-port callback in Chromium and
WebKit at desktop/phone sizes. It verifies save/reload/delete, independent pool,
exact Q Step recording, MIDI denial and geometry. No physical MIDI device claim.
