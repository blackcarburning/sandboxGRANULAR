# Generated drum-loop transport — DRUM-LOOP.1

The Actions Loop Play / Loop Enabled control owns the generated drum-audio
lane and its step clock. The step scheduler previously also sent every enabled
step to `playOscillatorNote` and `startGrainStream`; the latter played both
Granular A/B sample voices. The clock no longer creates either kind of note.
The generated dry loop source, timing, phase, waveform trim, mixer levels,
channel EQ/FX routing, Layers Loop mute/solo and transport enable/disable
remain unchanged. Unrelated drum-machine and loop-card transports are retained.
Keyboard, held-key and arpeggiator streams still have their own note ownership.

The obsolete Seq Grains input remains hidden/disabled for old snapshot and
fixture compatibility, with a visible drums-only explanation. Its default and
generation reset are false. Even an old true flag cannot re-enable melodic
triggering because the scheduler has no synth/grain note path. Stop clears any
legacy sequencer-owned voices unconditionally, not keyboard/arp-owned notes.
No saved-data schema change, sample rewriting or production Song mutation is
required. Existing cached Song audio is not rewritten.

## Verification

- `tests/generated-drums-only-browser.cjs`: Chromium and WebKit; isolated
  account/API fixture, all writes blocked; real Web Audio and Actions buttons.
  Generated loop bus has signal, granular bus is exactly zero, note-trigger
  spies see no sequencer calls, disable stops drums, independent keyboard grain
  remains audible. Legacy true checkbox/flag restore remains drums-only.
- Updated phase-recovery regression passes with the old true grain flag and
  rejects the pre-change scheduler, which still creates melodic notes.
- 76 focused mixer, keyboard solo, randomisation and Song compatibility tests pass.
- Broad legacy transport/arp fixtures have the same 239 failures on backed-up
  and changed index (missing runtime stubs). Eleven other deadline fixture
  failures likewise match before/after; they are not claimed as passing.
- Inline/changed JS syntax, diff whitespace and exact live asset bytes checked.
  Physical device listening not performed.

Backup: `backups/generated-drums-only-20261025T162425Z/`. Evidence:
`output/mygrain-generated-drums-only-20261025/`. Unrelated dirty files retained.
