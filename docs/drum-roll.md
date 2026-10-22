# Independent Snare Roll lane — DRUMS.2

In the drum editor, choose **Roll**. Set **Roll length (steps)**, choose a
32-step page under **Steps shown**, and tap numbered steps. Ratchet buttons
above each step cycle ×1–×8. Length accepts whole numbers from 1 to 1024;
64 and 128 are ordinary choices, not the only available lengths.

## Playback

- Roll uses the currently loaded Snare sample and its pitch, level, length,
  decay, distortion and existing drum output/effect routing. It has no duplicate
  sample slot. Changing the Snare sound changes Roll immediately.
- Roll has an independent absolute step count on the same drum audio clock.
  A fill on step 125 of a 128-step Roll does not repeat at every wrap of a
  16- or 64-step main drum grid. Missed scheduler steps advance both phases;
  joining or restarting transport aligns Roll to the shared origin.
- On an occupied Roll step, its event/ratchets replace the ordinary Snare
  event/ratchets. Other lanes are unaffected. Unoccupied Roll steps leave
  Snare untouched. Existing sample tails are not choked.
- Static Song decks use a two-second drum scheduling lookahead while Roll is
  active, covering hidden-frame timer throttling in WebKit. The live editor
  retains its existing short, responsive lookahead.
- A Roll-only pattern is playable without seeding default drum rhythms.
  Section auditions address the selected source region on the Roll's own grid.
- Expanding length adds empty steps, not repeated fills. Shrinking removes the
  truncated steps. Length, step, ratchet and Clear edits participate in the
  existing device-scoped Undo/Redo history. Page choice is only editor state.

## Saves and Song

Optional `drumMachineRoll: {version:1,length,pattern,ratchets}` lives in saved
modes and patch presets. A legacy snapshot with no field restores an empty
64-step Roll, never the previous part's notes. Main drum-grid normalization
never touches Roll. Existing Snare audio bindings are unchanged. Preset import prepares the saved
main grid before slider events and skips out-of-grid step sliders; otherwise a
short preset tried to write nonexistent sequence steps.

Song capture uses the least common multiple of the enabled base L/X/Q cycle
and Roll length. Thus 16 base steps + 128 Roll steps capture 128 steps
(`patternCycleMultiplier:8`); 16 + 24 capture 48 (`:3`). Repeats, source renders,
part-step cuts and exports use this complete cycle. The backend and source
inspector validate the Roll arrays and allowable combined multipliers. Existing
no-Roll snapshots retain the previous 1/2/4/8 validation.

Active Roll requires `drumRollVersion:1` and full-decay `drumSampleVersion:1`
freezes. The backend accepts `drumroll=1` and advertises `drumRollRenders:1`.
Legacy unmarked freezes are source-inspected before reuse. Deploy the backend
with the new `drum-roll.js` entry in `backend/mygrain_accounts.py` public assets
and the cache-versioned HTML, Roll module, adapter and Song client, and restart
`fs7300-documenter.service`.

Drum MIDI exports repeat the short drum patterns through a full combined
Roll/drum cycle and merge Roll priority into the existing Snare MIDI track.
They do not introduce an extra MIDI sound or sample asset.

## Verification

```
node --test tests/drum-roll.test.cjs tests/song-full-pattern.test.cjs tests/pattern-section-loop.test.cjs
python3 -m unittest discover -s tests -p 'test_drum_roll.py'
python3 tests/song-beta-test-server.py 18891
node tests/drum-roll-browser.cjs
```

The browser regression uses disposable localhost accounts/Songs and native
mouse/touch input in Chromium and WebKit (desktop and phone emulation). It
measures two 128-step live cycles, overlap priority, actual audio, edited sample
settings, Undo/Redo, global-grid resizing, portable state/presets, absent-field
recall, exact full-cycle Song PCM and markers, save/reload, landscape and narrow
portrait controls. This is not a physical iPhone test.
