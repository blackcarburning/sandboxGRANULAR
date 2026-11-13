# Normal-log interaction breadcrumbs and iPhone quality preference

Build v2026.11.03.BREADCRUMBS.1 adds `runtimeDiagnostics.breadcrumbs` to the existing
normal log. This additive field requires no changes to old saved reports. It keeps
at most 120 timestamped scalar records separately from the existing error events.
The existing five-second runtime persistence heartbeat saves them; UI breadcrumbs
add no polling or persistence timers. The existing 32 KiB limit trims breadcrumbs
before error events if necessary. Clear Log clears the current breadcrumb buffer.

Delegated passive/capture listeners record interaction card/overlay IDs, slider
start/end values (not every input tick), checkbox/radio changes, selected indices,
button IDs and aria-pressed toggle results. Existing UI busy/settled events provide
scroll burst boundaries and scroll-target metadata. Context audio time and the
MYGRAIN Low Power state align actions with normal audio diagnostic timestamps.
No text/password values, select labels/filenames, pointer-move stream or layout
measurements are collected. An interaction identifies a card; this is not continuous
viewport tracking. Fast actions can exceed retained history; crashes can lose activity
since the last checkpoint. No automatic server telemetry upload is added.

`iphone-low-power.js` stores `mygrain-iphone-low-power-v1` through the existing
account-scoped localStorage proxy. Missing/unavailable storage defaults OFF. The
preference is device/account-local, not embedded in editable patches or export/Song
schemas. Randomisation no longer calls `mygrainPower.set(false)` or resets the mode
through a global random-button listener. ON stays ON; OFF stays OFF. Start shows a
nonblocking 4.5-second MYGRAIN Low Power ON/OFF toast and records its status. This is
not Apple's Adaptive Power/Low Power setting, which is not detected here.

No DSP algorithm has changed. Live quality selection already exists and is now
retained; its isLive(context) gate still excludes offline/export contexts and Song
render decks, which retain full quality and unchanged cache versions.

Tests: `node --test tests/runtime-diagnostics.test.js tests/iphone-low-power.test.cjs`.
Use `tests/song-beta-test-server.py` with a disposable `/tmp` store, then run
`MYGRAIN_TEST_URL=http://127.0.0.1:PORT MYGRAIN_TEST_ADMIN_PASSWORD=... node tests/breadcrumbs-power-browser.cjs`.
Tests cover bounded/throttled metadata, privacy, no added persistence timer, fault
retention, normal-log inclusion, preference ON/OFF reload, startup notices, actual
drum randomisation and full-quality offline impulse behavior. Chromium/WebKit
phone emulation does not establish physical-device overhead or audible performance.
