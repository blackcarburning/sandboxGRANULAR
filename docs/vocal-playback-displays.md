# M / M+ playback displays and take imports

`vocal-takes.js` adds stereo playback VUs and cached two-channel waveform envelopes
with transport playheads to M and M+. Existing microphone input meters remain
separate. Meters branch from each lane's FX output; they never insert nodes into
or disconnect the audible route. The existing `MygrainKTrackMeters` factory now
accepts optional `selector` / `index` host fields; K's defaults are unchanged.

Waveforms show the processed playback buffer (including reverse/pitch), report
channel count, duration and rate, and redraw only on buffer/width changes.
IntersectionObserver and document visibility suppress offscreen work; meter
taps detach offscreen or on account lock. Waveform envelopes are weakly cached.

A reproduced silent import decoded stereo successfully but left the selected
lane disabled at zero level. Imports now prepare the selected lane with the
existing ReadyForTransport helper, update its mix and persist the result.
Running loop transport is preserved and the selected lane rejoins it. The
other lane's audio is untouched. Stopped imports stay stopped and explain how
to start playback. M+ browser buttons now say `Load into M+`, not M. Existing
confirmation, recording/Song guards, source stereo and account APIs remain.

Verification:

- `node --test tests/vocal-take-import.test.cjs tests/vocal-takes.test.js tests/k-track-meters.test.js`
- Workspace: `MYGRAIN_TEST_ADMIN_PASSWORD=isolated-m-test python3 sandboxGRANULAR/tests/song-beta-test-server.py 18959`, then `node sandboxGRANULAR/tests/vocal-displays-import-browser.cjs`.
- Browser regression saves a real stereo WAV through the temporary take API,
  reloads it with the actual M and M+ browser buttons, checks initially-off /
  zero-level readiness, playback output, VU readings, waveform pixels, playheads,
  mobile overflow, stopping, imports during playback and other-lane isolation.
  Runs Chromium and WebKit at 390×844 and checks desktop at 1280×900.
- Evidence/rollback: `output/mygrain-m-displays-20261026/`.
- Live marker `v2026.10.26.M-DISPLAYS.1`; served directly from sandboxGRANULAR.
  Physical iPhone interaction remains unverified.
