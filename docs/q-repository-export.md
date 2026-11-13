# Q final-mix repository export — 2026-11-03

The live capture path previously nested Q startup under the sample-loop restart
branch. With a sequencer/drum clock already playing but Q stopped, an enabled Q
was prepared but never scheduled. The actual repository-export button regression
produced PCM RMS 0 and zero Q starts before the fix.

Q is now an independent participant in capture restart planning. It is prepared
before the capture deadline and scheduled once on the same buffered start time,
regardless of whether other sample loops were running. A Q layer started only
for export alongside an already-active transport is stopped after capture;
already-running Q remains running. Disabled Q is not started. The readiness
check also recognizes Q as a valid source.

No Q DSP, saved controls, source ZIPs or render formats changed. Server Song
preparation already awaits Q preparation in `song-beta-clock.js`, then starts
all enabled layers via `song-beta-adapter.js` / `restartAllTransport`. Therefore
no server render-version increment or old-cache invalidation is appropriate.

Verification:
- `tests/q-repo-export-browser.cjs`: Chromium/WebKit, native Web Audio capture,
  actual repository button event and WAV encoding. Only the final upload boundary
  is intercepted in a disposable localhost account. Active sequencer, all stopped,
  Q already playing and Q disabled; one-second frames, signal and startup counts.
- `tests/q-repo-song-browser.cjs`: actual server arm jobs for current and older
  piano-Q snapshots (without newer source/length/decay fields), rendered PCM,
  warm cache, phone-route playback/Audition and unchanged source hashes/revision.
- Inline JavaScript syntax and whitespace checks; deployed guest build marker.

Backup/evidence: parent workspace `output/mygrain-q-repo-20261103T1820Z/`.

## Q cold-routing readiness — Q-READY.1

Mark reported Q going silent during iPhone export and absent from the WAV,
with the main transport also needing a prior manual Q Start. Normal cold tests
in WebKit and Chromium passed, so the physical-device cause is not certain.
A reproducible deadline fault was found by delaying cold Q graph setup 1.1 s:
a short opening chord in a 64-step pattern was missed and the actual repository
export's one-bar WAV had RMS 0. The original one-bar-long repeating fixture
masked that failure by catching a later cycle.

`preparePlayback` now prepares Q's audio routing as well as samples before the
transport/capture deadline is selected. The main Q controller retains that
prepared graph through internal Start, main transport restart and export
restart. Normal Stop still removes all voices, timers and routing. Q-only
Start and shared-range Start also prepare routing before selecting their time.
Stop during asynchronous sample preparation cancels graph creation. Mutes,
notes, effects settings and saved schemas are unchanged; disabled Q remains
excluded. The Q asset URL and visible build badge are refreshed.

Server Song rendering uses the same controller. `song-beta-clock.js` already
prepares Q sounds and graph before choosing capture frames; its preparation
now survives `song-beta-adapter.startAt` / `restartAllTransport`, instead of
being destroyed by Q's internal Start. No DSP, scheduled-note semantics or
source formats changed, so no blanket legacy render invalidation was added.

Verification:
- `q-cold-render-stress-browser.cjs`: Chromium/WebKit phone viewport; real main
  Start before any manual Q Start, real final-output PCM and repository export
  WAV, piano/strings/sample, delayed cold graph, short first chord; all pass.
- `q-repo-export-browser.cjs`: enabled/stopped/already-running/disabled Q;
  disabled export stays silent and already-running Q remains playing.
- `q-ready-song-browser.cjs`: four actual cold server jobs (current piano,
  strings, sample and older piano snapshot), all audible; zero warm jobs,
  playback/Audition on phone presentation, source hashes and revision unchanged.
- `q-source-start.test.cjs`: preparation timing, cancellation and normal Stop
  graph disposal; syntax and whitespace checks.

Physical iPhone verification remains outstanding. This repairs the reproduced
cold-routing fault, not proof that every possible iPhone interruption is fixed.
Backup: `output/mygrain-q-cold-start-20261103T213314Z/` in parent workspace.

## Explicit iPhone export sequencer Start (2026-11-03, Q-IPHONE-START.1)

Owner reports Q-READY still fails on the actual iPhone and requests an explicit
Q sequencer Start after the export dialogues. `renderLiveOutputBarsBuffer` now
uses an iOS-specific export path: close any individual-chord audition editor
without resuming its preview, prepare the enabled Q sounds/routing, recheck
context readiness after capture setup, and enqueue a direct Q `start` on the
same deadline/origin as capture and the other tracks. This deliberately does
not depend on a previous Q Start or the normal editor eligibility gate. It also
does not invoke Q's Start-all UI action, which would restart other tracks on a
different clock. Disabled Q is not enabled. Failure to start aborts export
instead of knowingly uploading a Q-less mix. Normal desktop transport remains
unchanged. No recurring polling or persistent patch fields were introduced.

`q-iphone-render-start-browser.cjs` uses an explicit iPhone UA in Chromium and
WebKit, the real export confirmation, no manual Q Start, and an intentionally
suspended context after that confirmation. It checks piano, strings, sample,
open chord editor, editable-snapshot export and disabled Q by decoding the
actual export WAV at the upload boundary (isolated store; no production upload).
A guard makes any use of the ordinary Q transport helper fail this test.
Headless WebKit is not physical iPhone verification.

Server trace: Song's `song-beta-clock.js` prepares Q before selecting capture
frames; `song-beta-adapter.startAt` explicitly restarts transport in the isolated
current-engine render deck used by the server-arm worker/backend. Those paths
do not use the iPhone final-mix export dialogue. Four real isolated cold jobs
(current piano, strings, sample, legacy piano) remain audible, source hashes
and revision stay unchanged, and warm arm creates no jobs. No blanket render
version invalidation is appropriate for this platform-specific startup fix.

Backup: `output/mygrain-q-iphone-render-start-20261103T213941Z/` in parent workspace.
