# WASP-SINGLE.1 — 2026-10-26

Ordinary page startup forces Wasp power off, route/processor 1 enabled and
route/processor 2 disabled, even when the working patch previously saved both.
This applies at host initialization and startup restore. Explicit patch imports,
Song/history restores and Wasp preset/patch recall retain their chosen routes.
This changes the two channel checkboxes, not the underlying mix-insert topology.

When route 2 is enabled, an inline accessible warning explains that iPhone may
refuse to start Wasp with two processors, and suggests unticking processor 2.
The warning disappears when route 2 is disabled; it does not block operation.

Export Final Mix to Repo is bright green with a green play-arrow pseudo-icon.
The icon survives export progress-label changes. Both jump menus now include a
green link to this existing export control; jumping does not start an upload.

Live assets: index.html, wasp-host.js, wasp-ui.js, demand-ui.js. Backups in
backups/wasp-single-export-20261026. Verification:
node --test tests/wasp.test.cjs (118 passed), and
[MYGRAIN_NOTE_DESKTOP=1] node tests/wasp-single-export-browser.cjs.

Verification completed: WebKit and Chromium desktop (1440×1000) and
phone-sized touch contexts (390×844) passed startup defaults, warning show/hide,
Wasp on/off, saved-two-route reload and green export jump/arrow checks. Live
responses for all four changed assets matched the working files exactly. All
73 inline scripts parse. Physical iPhone hardware remains unverified.
