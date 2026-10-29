# V / W Loop Cut audition

Both audition modes must prepare cut/pitch buffers before reserving their origin.
Use `withBufferedTransportStart(null, operation, {reset:true, exactStart:true})`
for the entire start, including backing layers and the audition lane. A fixed
`currentTime + .08` cannot survive cold buffer / FX work and prevents transport
replanning. An independent lane restart after a committed backing start is not
atomic. Prepare Q samples before starting the combined mode.

Set preview state before starting the audition source and pass
`preserveCutPreview:true`; mix updates must retain audition gain even if its layer
switch is off. Keep W alongside V in compressor-idle / transport / Song playback
activity checks. Stop and failures must release both the source and metronome.

Verification:

- `node --test tests/loop-cut-audition.test.cjs tests/vocal-loop-cut.test.js tests/vocal-loop-stretch.test.js tests/vocal-loop-stretch-integration.test.js`
- From workspace: start `MYGRAIN_TEST_ADMIN_PASSWORD=isolated-cut-test python3 sandboxGRANULAR/tests/song-beta-test-server.py 18958`, then run `node sandboxGRANULAR/tests/loop-cut-audition-browser.cjs`.
- Browser regression uses disposable local accounts only; tests V/W on and off,
  deliberately slow preparation, and actual W popup buttons in Chromium/WebKit
  at 390×844 and 1280×900. Measure W's post-effects gate, not the mixed metronome,
  to establish that the sample itself is audible. Check Stop clears all nodes.
- 2026-10-26 evidence: `output/mygrain-w-cut-audition-20261026/`. The broader
  transport-sync suite has 19 identical failures against the pre-change backup;
  these are not introduced by the audition repair. Physical iPhone unverified.
