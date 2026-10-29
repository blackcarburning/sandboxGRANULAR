# Compact Drum Machine editor — 2026-10-28

The header no longer contains the desktop shortcut and sample-description paragraphs.
The eight toolbar buttons appear before the status node: Save Pattern and Browse
Patterns follow Export MIDI. Status remains available to assistive technology but
does not reserve a visible row. Phone buttons use four columns (two rows); short
landscape screens use eight columns. The editor retains its own vertical scrolling.

A single drum navigation tap still jumps to its editor. Two completed clicks/taps on
the same button within 360 ms toggle its existing lane solo, without separate Solo
buttons or browser double-tap zoom. Green with an S indicates solo. Multiple solos,
undo/redo, saved patterns and workspace reload use the unchanged solo state/engine.
Roll is included. There is no DSP, Song-render or saved-state schema change.

Verification: isolated localhost accounts only; `tests/drum-mobile-compact-browser.cjs`
checks touch input, layout, library actions, roll edits, undo/redo and reload in
Chromium and WebKit at 390×844, 844×390 and 320×640. The existing solo/recall test
now uses drum-button double-clicks. `tests/drum-lane-solo.test.cjs` checks the actual
scheduled-hit gating. Physical iPhone testing remains separate from browser emulation.

## Lane Copy Sec placement — 2026-10-28

Copy Sec now lives in each lane’s controls grid immediately above its steps,
beside Accent Filter Envelope on Hat, Crash and ETC. Lanes without that envelope
retain their existing controls; Roll places Copy Sec with its length/page/dip controls.
There is one authoritative button per lane, with unchanged selection, cancellation,
ratchet/accent copying, history and save behavior. Empty prompts no longer reserve space.
Placement verified for all eight lanes in Chromium/WebKit at 390×844, 844×390 and
320×640; no physical iPhone test. Live HTTPS shell/CSS match the checkout.

## Lane Accent Amount — 2026-10-28

All eight lanes now have one authoritative Accent Amount slider in a full-width,
two-column row beside Copy Sec, immediately above their steps. Existing Hat,
Crash and ETC controls are moved, not cloned. Kick, Snare, Perc and Roll gain
controls persist through the existing slider snapshot format; missing legacy
values default to 35%. Roll now has independent per-note Accent toggles, retained
by normalization, resizing, Copy Sec and history alongside its existing Dip.

Fixed the actual sampled-hit gain path: Kick/Snare/Perc/Roll schedulers must pass
`accent:true` to the shared hit player, otherwise its normal 1.0 gain ceiling
silently discards boosts at full lane level. Existing amounts and curves remain:
these sampled lanes use 1 + amount × .5; Hat retains its own gain/timbre curve.
Only marked steps change, not the whole lane. A fully raised slider gives these
sampled lanes +50% linear gain (+3.52 dB); master compression/distortion can still
reduce the perceived difference.

Song render uploads carry `drumaccent=1` / `drumAccentVersion:1`. A legacy freeze
is invalidated only when its saved enabled drums contain active accented
Kick/Snare/Perc/Roll notes. Other existing freezes remain reusable. Metadata is
inspected before a legacy fast-path reuse; the server worker uses the same
current engine and no phone DSP/budget increase is introduced. Source archives
and production Songs are not rewritten.

Verification: `tests/drum-accent-browser.cjs` covers all eight visible controls,
actual scheduled gain options, Roll Accent touch/Undo/Redo, and save/reload in
Chromium/WebKit at 390×844, 844×390 and 320×640. Physical iPhone untested.
`tests/drum-accent-song-browser.cjs` exercises real isolated server jobs, legacy
Roll archives without accent fields, native PCM, warm reuse and phone playback.
The older Roll unit suite has 12 pre-existing mock-fixture failures, reproduced
against the exact before-edit files; focused accent/tone/solo tests pass.

Before-edit backups: workspace `backups/drum-accent-20261028/`. The checkout had
substantial pre-existing uncommitted work; it was preserved, not bundled into a
commit or push for this task. Live CSS/Roll script bytes were checked over HTTPS.
