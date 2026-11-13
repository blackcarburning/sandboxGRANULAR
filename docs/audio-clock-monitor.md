# Audio clock monitor

The **Audio clock** button beside the top build badge opens a nonmodal draggable
panel. The default compact view is 250 px wide (viewport-capped), with four key
readouts; Details expands the remaining measurements and notes. `MygrainClockWidget` in `audio-diagnostics.js` reads the main editor context
and primitive scheduling counters through callbacks installed in `index.html`.
It never creates/resumes a context or changes the graph, DSP or saved data. Song
rendering is unchanged because this feature only observes the live editor.

One timeout samples once per second only while the panel and document are visible.
No RAF, AudioWorklet, analyser, PerformanceObserver, waveform scan, polling network
request or sample history is added. Closing, account changes and backgrounding
cancel that timeout. The existing independent diagnostic logger is unchanged.

The main context currently requests `latencyHint: 'interactive'` without an explicit
sample rate. The panel reports browser-default requested rate versus context rate,
not a claimed hardware sample rate. Clock progress compares `currentTime` with
`performance.now()` over five-second foreground/running windows. Less than 90%
progress flags slowdown. UI callback lateness is separately measured at 1 Hz; peaks
above the 350 ms scheduling lookahead flag possible main-thread stress. Neither
metric is hardware CPU load or proof of an audible underrun. Brief glitches between
samples can be missed. Mastering and other separate audio contexts are not measured.

Reset clears panel timer/clock peaks and its late/skipped baselines; the labelled
context-wide maximum scheduling lateness remains untouched. Live engine counters
are never reset by this UI. Closed/backgrounded periods are not clock samples.

Verification: `node --test tests/audio-diagnostics.test.js`; with an isolated Song
test server, set `MYGRAIN_TEST_URL=http://127.0.0.1:PORT` and
`MYGRAIN_TEST_ADMIN_PASSWORD=...`, then run `node tests/audio-clock-widget-browser.cjs`.
The latter tests normal/slow clocks, delayed callbacks, suspension, unavailable
latency, closed/hidden inactivity, reset, phone bounds, authenticated initialization,
real context readings, pointer drag and rotation in Chromium and WebKit. Browser
emulation is not physical-device performance measurement.

## iPhone edge launcher and incident actions

Build v2026.11.03.PERF.1 puts the iPhone launcher directly beneath the existing
left-edge Undo/Redo stack, without shifting those controls. Desktop retains its
top-of-app launcher. Mark Crackle and Submit Log proxy the existing main diagnostic
buttons; Submit always selects the current session. Disabled/busy state and upload
receipts/errors are mirrored using the already-running one-second widget sample.
No new timer or observer is added. A successful click is not treated as a delivery
receipt. The popup remains compact, nonmodal and draggable.

`tests/perf-popup-actions-browser.cjs` checks authenticated Chromium/WebKit iPhone
edge geometry at 390x844, 320x640 and 844x390, real incident marking, intercepted
current-log payload with a success receipt, failed-upload feedback, closing/reopening
and unchanged desktop launcher placement. It uses an isolated test server; no log
is submitted to production.
