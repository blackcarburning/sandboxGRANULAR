# Sequencer shortcuts and grid sustain — SEQ-KEYS.1

Desktop (fine pointer/hover, width >960px):

- Open L or X, select a step: R invokes the existing Rest entry (Record mode stores it and advances); A toggles accent; S toggles slide.
- Open Drums, click or focus the desired main-grid step: R switches it off; A toggles accent. Keyboard focus and pointer selection share the target. No drum slide shortcut.
- Ignore editable fields, composing text, modifier shortcuts, repeated keydown, and unrelated dialog focus. Only the currently open editor receives shortcuts.
- Permanent help text is placed under each sequencer title, separate from changing status messages.

Manual L/X sample-grid auditions now use the keybed's natural-duration, constant-sustain envelope, respecting sample region, pitch, attack, filters and routing. Only manual grid auditions change: transport length/decay and ratchets remain unchanged. Synth grids already use the same audition voice as synth keybeds. Stop still owns the preview voices. This applies on desktop and phone.

Kick, snare, percussion and clap now join hats/crash/ETC with per-step accents. The original hat/extra-track accent arrays are retained; new base-track arrays are captured/restored in presets and saved modes, normalized on pattern resizing, cleared with sequence clearing, applied to scheduled audio and included in drum MIDI export. Existing presets default those accents off.

Verification:

- `tests/seq-shortcuts-sustain-browser.cjs`: WebKit/Chromium in native desktop and iPhone-sized contexts. L/X R/A/S, every main drum track R/A, editable-field/modifier/repeat guards, no phone shortcut interception, accent scheduled gain, preset payload restore, MIDI construction. Final PCM remains audible 600–850ms after a grid tap with Decay/Length at 10%.
- 58 focused note readiness, sampler and solo unit tests pass.
- All inline scripts parse; HTTPS live HTML matches local bytes and both build badges show SEQ-KEYS.1.
- Physical iPhone hardware remains unverified.

Rollback: `backups/seq-keys-20261026/index.html`; task-only diff: `backups/seq-keys-20261026/change.patch`. No unrelated dirty changes committed or pushed.
