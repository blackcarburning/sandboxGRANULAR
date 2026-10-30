# G · INSTAREEL

G-only controls create a flattened 30–60s WAV from a portable snapshot of the
current editor. No additional AI request is made. The editor is never recalled,
randomized, stopped or replaced. Targets round to complete source cycles within
30–60s (the actual duration is shown while queued and when ready).

- `genreator.js`/`.css`: duration, Subtle/Moderate, Make/Try Another, cancellation,
  buffered preview with Loop checkbox, naming/save and INSTAREEL WAV Browser.
- `backend/mygrain_instareel.py`: authenticated/account-pinned bounded jobs and
  private library. `deploy/instareel-server-hook.patch` adds only the dedicated
  route/module hook to the existing documenter server, before account locks.
- `scripts/instareel-worker.cjs`: fresh loopback Chromium, existing
  `mygrainSongBetaAdapter` snapshot validation/decoding and `MygrainSongClock`
  isolated render deck. The worker cannot make any HTTP write. No existing Song
  source, saved part, render version or compatibility policy changes.
- `scripts/instareel-plan.cjs`: seeded source-cycle/bar-aligned development.
  Active layer levels and master-filter brightness recede and return; a loaded,
  enabled hat lane can gain occasional offbeats. No new samples, pitches, key,
  tempo, kick/snare patterns or previously disabled layers are introduced.
- Warm one source cycle before capture, return to the original groove for the
  final cycle, and blend the actual continuation into the first 50ms. Retains
  exact duration and audio at the join rather than fading to silence. Peak-only
  attenuation prevents output clipping; silence is reported, not saved as success.

All rendering shares the existing serialized server-render executor. At most
three reels are pending globally and one per account. Snapshot upload <=96MiB;
phone source-encoding preflight <=48MiB; server admission <=512MiB, decoded-source
cache <=192MiB; output <=24MiB. These are feature-local limits, not increases to
existing app/Song budgets. Browser retains only one decoded preview <=64MiB,
using the existing fast-preview AAC encoding and shared AudioContext; it registers
with the existing `wavIphonePreviewActive` guard so idle sleep cannot cut it off.
Loop uses AudioBufferSourceNode.loop with explicit original duration. The existing
WAV Browser and its iPhone playback code are unchanged.

Temporary sources and renders live in account WAV root `/.instareel/job-<id>`;
source ZIPs are removed after worker completion/cancellation. Unsaved scratch
expires after one hour and is cleaned on later requests. Save exclusively creates
`INSTAREEL-<name>-<id>.<bpm>.wav` in the account WAV repository, registers normal
provenance and adds the dedicated G library entry. Repeated Save is idempotent.
Original WAV downloads stay lossless PCM; only the listening copy is AAC.
Private routes enforce existing session and account-header checks, never expose
filesystem paths, reject changed/missing originals and use private/no-store.

## Checks / rollback

Use `tests/song-beta-test-server.py` with a dedicated `/tmp` test root and
`MYGRAIN_TEST_ADMIN_PASSWORD=instareel-fixture` on port 18936.
`tests/instareel-browser.cjs` tests real server renders, untouched editor, PCM,
loop wrap/toggle, save/library, account rejection and phone portrait/landscape in
Chromium/WebKit. `INSTAREEL_ENGINE`, `INSTAREEL_SECONDS`, `INSTAREEL_VARIATION`
and `INSTAREEL_HATS` select a focused extra run. `tests/instareel-cancel-browser.cjs`
checks saved playback past eight seconds and actual job cancellation.
Unit tests: `tests/instareel-plan.test.cjs`, `tests/test_instareel.py`.

Before-edit files and measured evidence: workspace
`output/mygrain-instareel-20261030/`. To roll back, restore only the G assets/index
script versions and remove the exact server hook, then restart documenter. Do
not remove saved WAVs, account state or unrelated current server changes.
