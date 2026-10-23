# Synth preset navigation — SYNTH.1

The synth preset dropdown has **− / +** buttons below it. The keyboard duplicates the same pair directly below its OSC/Synth sound and Jump buttons, with the current synth preset name below the sound selector. Both pairs use the existing factory preset dropdown and loader; they do not maintain separate cursors or patch copies.

- **+** selects the next factory preset; **−** selects the previous one, in the existing 500-preset dropdown order. The ends wrap.
- From Custom or a saved custom patch, + starts at the first factory preset and − at the last. Neither overwrites the custom-patch library.
- Manual dropdown choices, sound edits that mark Custom, and loaded/saved custom patch names update both name displays.
- Each step is one card-history draft edit, so Undo/Redo and verified Song amendments work. Busy/recording/account/reservation guards are retained.
- Preset loading has the same synth sound/mix effects as the original dropdown. It does not select a different keyboard instrument, change held notes/BPM or replace source samples. Select OSC on the keyboard to play the synth.

Saved state already includes `selects.synthPresetSelect`. Restoration now reapplies that saved cursor after synthetic control events have finished, without reloading the factory sound or overriding the restored parameters. This keeps Undo, Song recall and reload navigation consistent. Old states without the field remain Custom; there is no new saved-data schema.

## Verification

`node --test tests/synth-preset-step.test.js` checks complete forward/backward traversal of all 500 factory records, wrapping, Custom/saved entry points, synchronized names, one transaction and busy/invalid-input refusal.

`tests/synth-preset-step-browser.cjs` only accepts a localhost disposable-account server. Chromium and WebKit desktop, 390×844 phone and 844×390 landscape cases cover native taps in both control pairs, manual dropdown changes, wrap-around, synchronized labels, Undo/Redo, actual held-key non-silent Web Audio before/after stepping, retained held notes/BPM/instrument, preserved custom patches, and reload. Portrait cases additionally save and recall a real Song amendment. Geometry checks enforce 44px touch targets below the keyboard's OSC button and no horizontal page overflow. These are browser-emulation checks, not physical-phone tests.
