# Layer keys and card enables — LAYER-KEYS.1

Piano and Strings have independent On/Off gates, source Solo controls and Jump-to-keys actions in Layer Switches. On and Solo select that keyboard instrument; Jump selects its keyboard sound and navigates to the keys. Muting preserves the mixer level. Enable gates persist in workspace state and presets; legacy states default both gates on. These controls affect the playable keyboard channels, not Q’s independent sequencer.

A/B/C/V/W/P/O/L/X/M/M+/K cards have a synchronized enable button forwarding to the authoritative Layer Switches control. Q already has its native enable button. Card controls observe changes to the original toggle, including recall and randomization; no second layer-enable state is stored.

Verification: tests/layer-keys-browser.cjs covers WebKit and Chromium phone contexts, card-to-panel and panel-to-card updates, keyboard mute/solo isolation, Jump sound selection, persistent gate recall and portrait/landscape overflow. Existing keyboard/solo unit slice: 10 passed. Public /mygrain/ HTML verified HTTP 200 and byte-identical. Physical iPhone unverified.

Pre-edit HTML and task-only patch: backups/layer-controls-20261026/. Existing working tree contains unrelated uncommitted changes; these were preserved, not committed or pushed as part of this UI update.

## LAYER-KEYS.2 — desktop visibility and state colours

Card enable proxies are prepended inside the existing action stack rather than added as a separate flex-header child. All 13 card enable controls, including Q's native switch, display Enabled in green (#176534) or Disabled in dark scarlet (#861c2b) with white text. Shared high-specificity styles override vocal-card styling. Q script cache key bumped.

Regression: tests/layer-enable-colours-browser.cjs checks desktop 1440px, phone 390px and landscape 844px in WebKit/Chromium, text/background state, action-stack placement, real centre-point hit testing, and no horizontal overflow. Startup overlay must finish dismissing before hit testing.
