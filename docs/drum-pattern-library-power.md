# Drum pattern library and iPhone Low Power

## Drum patterns

`drum-pattern-library.js` mounts Save Pattern / Browse Patterns in the drum overlay. The modal supports nested folders, pattern selection and an explicit Load into drum machine button. There is no audio preview path. Names use textContent.

Archives are stored ZIPs with `drum-pattern.json` plus exact per-channel Float32 PCM (`audio/<kind>-<channel>.f32`). Includes seven sample slots, eight sequencer lanes, ratchets, accents, Roll Dip, drum controls, drum EQ, drum sends, BPM and shared pattern length. Master/other-loop settings are not recalled. Loading changes the shared pattern length and BPM, as stated in the browser.

Authenticated/pinned `/mygrain/api/drum-patterns` routes delegate from `backend/mygrain_songs.py` to `backend/mygrain_drum_patterns.py`. Storage is the existing account-scoped SONGS_ROOT `/.drum-patterns/`; folders and patterns are indexed with opaque IDs. Uploads are bounded to 128 MB and validated without extracting archive paths. Saves append rather than overwrite. Index writes are atomic. Folders can nest and duplicate folder names in the same parent are rejected.

Loading decodes/validates all audio first, guards account/source changes, then uses Card History and one audio-store transaction. Normal Snare/Roll remain independent. Failed apply restores previous buffers/settings. The full drum kit is retained in normal page reload storage. Existing song/account files are not migrated.

## iPhone Low Power

`iphone-low-power.js` exposes a device/account-local `mygrainPower` helper. The menu button is near the top of Jump, has a lightning symbol, and is removed on non-iPhone UAs. It defaults off only when no device/account preference is stored. The account-scoped localStorage preference survives reload and randomisation; it is not represented in saved patches, presets or pattern archives. See `low-power.md` for the current live DSP policy.

Quality adaptation is live-context-only. Current Low Power uses half-rate effect
worklets, mono reverbs bounded to 0.75 seconds at native context rate, loop/card
filters capped at 12 dB/oct, the existing reduced main/drum filter stages,
no-oversampling waveshapers and 100 ms optional main modulation updates. Visible
and saved settings retain their original values; switching Off restores full
processing. Every offline/export/server render remains full quality.

Quality-specific cache keys prevent reuse of light impulses in normal mode.
Dedicated drum workers are canceled/rebuilt with the quality key. Randomisation
and reload retain the device/account preference. See `low-power.md` for engine
rate, render-deck and phone-navigation rules.

## Verification

- `node --test tests/iphone-low-power.test.cjs tests/loop-card-fx.test.cjs tests/drum-tone.test.js tests/drum-lane-solo.test.cjs`
- `python3 tests/test_drum_pattern_library.py`
- `tests/drum-library-power-browser.cjs`: isolated server on port 18959, temporary stores, Chromium/WebKit iPhone emulation plus desktop exclusion. Tests nested folders, exact seven-slot PCM, state/EQ recall, Undo/Redo/reload, pinned authentication, same-account second browser, low-power graph metrics, direct Jump interaction, unchanged exported preset/settings, randomisation and the original reload-reset behavior (superseded by the retained-preference tests in `breadcrumbs-power-browser.cjs` and `low-power-live-browser.cjs`).

Physical iPhone CPU/battery performance is not measured by these tests.
