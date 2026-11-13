# RadioLab shared-context lifetime — RADIO-IDLE.1

The editor's eight-second idle controller previously omitted RadioLab. With
all ordinary transports stopped, a running station was suspended and its
state-change handler correctly disconnected monitoring. Saved/trimmed take
auditions could likewise freeze. This is application-owned suspension, not a
network refill limit.

`mygrainRadiolab.needsAudio` now reports live monitoring, active preview sources
and pending named/current-take/trim auditions to `configureBackgroundAudio()`.
Monitor mute does not end ownership: its live PCM tap remains active. Stop,
natural preview end, cancellation, browser Close, station replacement, context
interruption and account lock use existing lifecycle cleanup. A retained take,
an open inactive browser and independent server-fetch PCM recording do not
keep an unused audio context awake. No permanent keepalive, timeout extension,
new audio context, DSP, source/patch/schema change or render invalidation.

The RadioLab module URL must match in the entrypoint and demand loader. Both
visible shell badges identify `v2026.11.13.RADIO-IDLE.1`.

## Regression

- `node --test tests/radiolab-frontend.test.js tests/radiolab-frontend-lifecycle.test.js tests/background-audio.test.js`
- `node --test tests/radiolab-frontend-browser.test.js`
- `MYGRAIN_TEST_URL=http://127.0.0.1:<port>/mygrain/ node tests/radiolab-idle-browser.cjs`
  requires a disposable localhost account store with admin password
  `isolated-radio-idle`. Station catalogue, station WAV and private recording
  are deterministic fixtures; production audio/account libraries are untouched.
  Chromium and WebKit touch profiles cover 390×844 and 844×390, 18 seconds of
  uninterrupted station PCM, saved audition past the former deadline, genuine
  idle suspension after Stop/natural end/Close, replay and account lock.
  Audio is measured after monitor gain or the direct-to-destination preview
  source, without disconnecting the normal audible output. No gesture occurs
  during the observation windows.
- `RADIO_BASELINE_DIR=<before-dir>` intercepts the exact saved `index.html`,
  `radiolab.js` and `demand-ui.js` and requires the original idle cutoff.
  The before build for this regression was `v2026.11.13.PHONE-EDGES.5`.
- `tests/warm-song-render-browser.cjs` runs actual isolated current/Pre-W
  server renders, worker reuse and failed-auth cleanup, then phone rendered
  playback in both engines with source hashes and revisions unchanged.

Evidence: ignored `output/radiolab-idle-20261113/`. Existing lifecycle fixture
gained the missing DOM `after()` stub. Its integration check now accepts
unordered folder labels, current versioned dependencies and synchronous
transaction setup between the stale-load guard and buffer application; the
same old static check failed against the saved baseline.

Physical iPhone audibility and lock/unlock are not established by these
automated checks. Existing deliberate RadioLab Stop-on-page-hidden behavior
is unchanged; this repair addresses the foreground idle cutoff.
