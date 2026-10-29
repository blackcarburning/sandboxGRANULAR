# Q saved chord instances

Note editing updates sequence pitches immediately but never adds to the custom holding pool. Save chord explicitly creates or overwrites the entry identified by customChordId. Copied/pasted chords and sections detach identity; saving them creates a new independently coloured entry. MIDI Save and candidate drops each create a new entry.

The pool remains account/browser-local under mygrain-q-custom-chords-v1. Legacy entries receive a deterministic swatch without rewriting storage on read. New entries store a colour integer (0..3599, hue in tenths of a degree); sequencer steps preserve customChordId and customChordColour through normalization and server song archive validation. Existing songs without these optional fields remain valid. No stored songs are bulk-rewritten. Deleting an entry never deletes recorded steps. Editing one recorded step does not rewrite other steps that previously recorded the same pool chord.

Save updates pool contents explicitly, independently of sequence Undo history. Sequence Undo does not erase the persistent holding library.

Holding-area placement (native drag, touch hold-and-drag, or tap-to-record) allocates a fresh sequence identity, retaining the source swatch until explicitly saved. First Save adds an independent entry and assigns an unused swatch; later Save updates that new entry. Original library chord and other recorded cells remain untouched. Touch movement before the hold threshold remains ordinary scrolling; library drag data is closure-local and external drops are ignored.
