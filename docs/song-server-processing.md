# Server Song processing maintenance — 2026-10-27

Phone preparation now submits every new/incompatible part to the existing
account-scoped, bounded server renderer when available, not only estimates over
96 MB. Compatible saved audio and warm caches still reuse their existing files.
No source ZIP, placement, repeat, tempo or Song revision is rewritten by arming.
Desktop rendering retains its existing local/oversized-server fallback policy.

Phone Audition now uses the prepared part loop rather than recalling original
instruments/samples. Recall and Amend remain explicit live-editor loads: their
actual editing residency still has to fit the unchanged phone memory budget.
Desktop Audition retains live recall. Phone Play Song continues scheduled PCM
playback with bounded hot storage. No budgets were raised or bypassed.

The isolated render deck preloads the corrected persistent EQ processor before
scheduling/capture, so it does not record a cold graph transition. Enabled EQ
requires `channelEqVersion >= 2`; version-one active EQ refreshes once, while
legacy bypass/no-EQ audio remains reusable. The backend accepts uploads marked
`channeleq=1` or `2` for older-client compatibility, recording the exact marker.
The worker continues loading the same current app engine, source hash checks,
account scope and cancellation, with a single bounded render job at a time.

Required checks for future audio changes live in repository `AGENTS.md`.

## Verification

- JS controller/server/DSP suites: `node --test tests/song-beta.test.js
  tests/song-server-arm.test.js tests/eq-automation*.test.cjs`.
- Backend: `PYTHONPATH=tests python3 -m unittest test_song_server_arm
  test_channel_eq.EqSongApiTests test_eq_automation`.
- Disposable server (not production):
  `MYGRAIN_TEST_ROOT=/tmp/mygrain-server-refresh-store-v2
  MYGRAIN_TEST_ADMIN_PASSWORD=isolated-render-refresh-fixture
  python3 tests/song-beta-test-server.py 18959`.
- `node tests/song-server-refresh-browser.cjs`: Chromium/WebKit phone emulation,
  real server jobs, current EQ and genuinely pre-EQ archives, a deterministic
  linear signal path for the EQ comparison, zero phone source
  downloads or local DSP rendering, exact source hashes/revisions, warm reuse,
  saved PCM playback, cached Audition, and one-time stale-EQ refresh retaining
  the legacy neighbour. A 135 MB source-preparation estimate is injected without
  allocating that much source audio on the simulated phone; the server sees
  the real fixture archive. This is not a test of Mark's unidentified Song.
- `node tests/eq-live-sweep-browser.cjs`: manual EQ still uses persistent DSP.

Backup: `backups/song-server-refresh-20261027T204531Z/`. Restore only the changed
files, not account/Song stores, and restart `fs7300-documenter.service` after
backend rollback. No production sources were rewritten in these checks.

## Random space switch reset — 2026-10-27

Randomised parts persist explicit delay/reverb bypass flags in `modes.loopFx`;
the current shared engine used by the render deck already honours these flags.
No server-only DSP fork or render-version bump is needed: recalled existing
sources sound unchanged, and only newly randomised settings change. Existing
Song archives/renders are not rewritten. The server-refresh browser fixture now
sets nonzero hall/delay amounts with both switches false, verifying genuine
bypass survives source capture, real server jobs, warm cache and phone PCM
playback, for both current and pre-EQ archives. Phone budget remains 96 MB.


## Stopped X auditions — 2026-11-02

The live editor final idle gate now recognises X sample voices (including a
quick-tap release after its key hold is removed) and scheduled oscillator
releases. Like L's existing audition/tail tracking, this keeps stopped previews
audible without starting transport. The isolated render deck loads the same
index.html; sequenced renders already keep this gate open through their running
transport. No source schema, DSP settings or render compatibility marker changes
are needed, and existing prepared PCM remains reusable.

Regression: `tests/x-preview-output-gate-browser.cjs` measures the final speaker
bus, beyond the idle sidechain gate, in Chromium and WebKit for sample/OSC3,
keyboard/grid and practice/record. The pre-fix build fails with zero final output.
The older `connectAnalysisTap` tests measure upstream of that gate and therefore
could not establish speaker output. Retain them for transport/lifecycle and
server-render coverage, not as proof of preview audibility.

## D loop offline preparation — 2026-11-02

D uses the same saved original source and live fitter in server/local render
decks: fill/speed, pitch/reverse, shift, cuts/gaps, level/solo and D EQ are
restored from the immutable snapshot. Pre-fit D before choosing capture frames,
so source stretching cannot delay the scheduled first note/capture boundary.

New renders carry `loopDVersion: 1` (`loopd=1` upload). Source metadata requires
this marker only for enabled D with a saved `bastardD` asset. Older unmarked
freezes get a metadata-only inspection before reuse: active D refreshes once;
pre-D/disabled D keeps its existing render. Original archives, revisions,
arrangement and phone/server memory budgets are unchanged. No bulk conversion
or automatic source edits are introduced.

Verification: `tests/song-d-offline-browser.cjs` with an isolated test server,
Chromium/WebKit phone emulation, current D speed/pitch/reverse/shift/cuts/EQ,
pre-D audible neighbour, real server jobs, one-time stale-D rebuild, warm
reuse, Song playback and cached Audition; zero phone source WAV downloads or
local source decoding/DSP. Physical phones remain unverified. Unit coverage:
`tests/song-server-arm.test.js`, `tests/song-beta-clock.test.js`,
`test_song_backend` and `test_song_server_arm`.
Backup: `output/mygrain-d-offline-20261102T200658Z/` (workspace root).

### Pre-D inventory false-positive correction — 2026-11-02

The first D offline regression incorrectly removed `bastardLoopDivisions` with
an overbroad D-prefix regular expression. That shared, older A-loop setting is
not evidence that a part contains D audio. Production archive metadata confirmed
the shared setting exists on pre-D parts. D lane detection now requires a true
D field boundary (end or uppercase suffix), preserving `bastardLoopDivisions`.
Missing-slot checks for real D settings, metadata, controls, solo references and
assets still reject incomplete archives; no device sample is substituted.

The compatibility unit regression preserves the shared setting and fails against
the previous adapter. The real-server D browser fixture also retains it, using
desktop viewport/Chromium and WebKit with explicitly forced server preparation.
No saved production archive, metadata or PCM is rewritten by this correction.
Backup: `output/mygrain-d-inventory-20261102T201149Z/` (workspace root).

## Interactive final-mix export length — 2026-11-02

Normal WAV download/repository renders, takes and browser stem bundles compare
Export Bars × 16 against the current main Pattern Length before capture. A
shorter export shows exact steps/bars and Keep export setting / Render to pattern
length / Cancel. The choice is passed as explicit steps for that render only;
pattern choice does not rewrite the Export Bars setting or source snapshots.
Stem components and wet/dry references share one choice. Cancel/Escape starts no
capture and keeps existing takes. Equal/longer settings do not show the warning.

Real D-enabled Chromium/WebKit exports verify 32-step patterns at 240 BPM yield
exactly one second (16 steps) or two seconds (32 steps), according to the choice.
D remains fitted to its source pattern; export capture duration is independent.
No normal-WAV pattern override was reproduced. The separate Song arrangement and
DAW ZIP exporters retain their existing arrangement/pattern-based semantics.

Server Song processing uses explicit saved-part timing and never enters these
interactive export controls; no render compatibility version or server DSP change
is applicable. Existing source archives, renders and budgets are unchanged.
Regression: tests/export-length-browser.cjs and the capture-timing/clock suites.
Backup: output/mygrain-export-length-20261102T201942Z/ (workspace root).

## Q palette-to-grid drag — 2026-11-02

Main Q candidate chords now copy directly to a chosen sequencer cell using
native desktop drag or touch hold (~300 ms)/horizontal drag, including Practice
mode. Taps still use the existing play/record path; explicit drops do not arm or
change the recording mode. Vertical candidate swipes scroll without placing.
Placement uses the current velocity/gate, preserves target accent, enters editor
and global history, and persists through the ordinary Q sequence schema.
Existing custom-pool drag/drop remains separate and retains custom chord identity.

No synthesis, timing, archive schema or compatibility marker changes apply:
server Song rendering consumes the same normalized Q sequence already supported.
The browser suite checks the saved source snapshot retains the exact placed notes.
Tests: tests/q-palette-grid-drag-browser.cjs (desktop/touch Chromium and WebKit;
Chromium uses native touch injection, WebKit touch uses synthetic PointerEvents),
and tests/q-custom-chords.test.cjs. Physical iPhone remains unverified.
Backup: output/mygrain-q-drag-20261102T203509Z/ (workspace root).


## Dropbox Sample Layer pan — 2026-11-03

`performanceDropboxSamplePan` is an additive -100..100 slider, stored by the
existing preset/state capture and restored explicitly before transport/render
startup. Missing legacy values default to centre. The live start function and
the isolated server render deck use the same per-voice StereoPannerNode after
the layer gain and before channel EQ; its ended handler releases the panner.
No polling, persistent idle graph, new assets or server schema are introduced.
Existing legacy freezes remain valid: they had no pan field and still centre.
New non-centred parts have new immutable source hashes; source-hash matching
already prevents reuse of a different part's old rendered audio.

Verification: `tests/dropbox-pan-browser.cjs` uses Chromium/WebKit, isolated
account/Song storage, patch/reload/snapshot compatibility, live voice
routing and real server renders for left/right/legacy-centre parts,
warm reuse and phone-mode PCM playback without client source rendering.

## D Mutilator — 2026-11-10
The per-voice native Mutilator graph in loop-d.js is shared by live playback, isolated render decks, DAW exports and server-arm-worker.cjs (current app engine). It needs no asynchronous worklet preload. Settings live in modes.loopD.mutilator; missing legacy settings normalize Off. Active settings and mutilatorEngineRevision 1 enter the full source/content hash, so newly mutated snapshots cannot reuse an unmutated freeze. Existing pre-Mutilator archives/renders are unchanged and retain loopDVersion 1: no blanket version bump or source migration. D Mutilator control IDs are included in the backend D paste/copy boundary. Original D PCM is never overwritten. Off owns no effect nodes or timers; stopping the D voice disposes its graph.

Mutilator regression commands (disposable authenticated fixture only):
`node tests/d-mutilator-browser.cjs`, `node tests/d-mutilator-song-browser.cjs`,
`node tests/d-mutilator-ai-reload-browser.cjs`, and
`PYTHONPATH=tests python3 -m unittest test_d_mutilator`.
The AI reload fixture uses 32 steps so a whole-bar gap fits. The historical
8-step D fixture expects a gap in half a bar, which is incompatible with the
existing coarse-cut policy; its same failure is reproduced before this change.

## More Mutilator strains and Dropbox effects — 2026-11-10
The current app engine adds Scab, Venom, Hollow and Splinter; these new active strains use mutilatorEngineRevision 2 in the content signature. Gnaw/Melt/Rupture retain their exact existing DSP and revision 1. Dropbox uses the standard `sample` loop-FX channel through its existing per-voice pan→EQ routing. Native processors are synchronous, so server and export decks need no new worklet preload. The backend accepts sample as an optional standard-FX channel alongside historical D/N shapes. Omitted Dropbox FX stays dry; no legacy source archive or freeze is invalidated just for the optional channel. Active new settings enter the existing complete content/source identity. Native DSP memory estimates include the additional lane automatically.

### Filter Playground factory presets (2026-11-10)

The 24 sectioned factory presets in `wasp-ui.js` compile into existing normalized
Playground controls and 64-point curves. No preset IDs are saved. The current
Song capture, clock, isolated render deck, worker and backend already support
all fields. The accompanying cutoff-resonance fix changes shared DSP only for
active non-comb Playground settings: `waspEngineRevision` becomes 8 for those
renders. Comb modes remain 7, and Wasp-only and bypass/legacy hashes retain their
previous signatures. No source ZIP or saved controls are rewritten. `tests/playground-presets-song-browser.cjs` verifies actual isolated
server jobs for grid-synced and mixed Hz/BPM presets plus a legacy source, warm
reuse, phone PCM playback, unchanged source hashes/revision and released memory.
See `docs/wasp-playground-blocks.md` for bank/UI details.

Selective cached-playback refresh also uses `playgroundVersion: 1` on newly
rendered PCM. Old metadata without this marker is inspected through the bounded
manifest endpoint, not source audio on phones. Only enabled non-comb Playground
settings reject an unmarked freeze; comb, disabled and legacy snapshots reuse
existing PCM. Local and server render uploads carry `playground=1`; the backend
validates/stores it and retained compatible renders propagate it. No saved-source
ZIP, part hash, Song revision or preparation memory limit changes on Arm. The
real-server test strips old render markers in its disposable store and verifies
three affected refreshes, unchanged comb/legacy neighbours and warm reuse.


## BPM-locked Mutilator rendering — 2026-11-10

Active, nonzero D Mutilator now uses content-signature engine revision 3 and
`mutilatorVersion: 1` for its cached playback. Uploads carry `mutilator=1`;
the backend validates and stores this capability. The shared live/isolated/export
engine starts the native modulation source at the same transport origin as D.
No worker fork, asynchronous worklet preload or source/schema migration is needed.

Saved metadata predating this marker is inspected via the bounded manifest path.
Only an enabled, nonzero Mutilator with a D asset rejects an unmarked static
freeze. Missing/disabled/zero-wet/zero-damage processors retain their old content
signatures and reusable PCM. Existing source ZIPs, audio hashes and Song revisions
are never rewritten merely to refresh playback. Compatible retained render uploads
carry the new capability as well. Actual isolated server jobs verify audible
rhythm, legacy D and Dropbox parts, warm reuse, phone PCM playback, WAV export,
unchanged editable sources/revisions and released preparation reservations.

## Playground instrument and switchable Mutilator capabilities

Playground moving curves now use transport/sample-clock timing in the shared
phone/desktop DSP. Its new rate sculptor and instrument controls are included
in canonical snapshots, strict ZIP validation, worker preparation and WAV.
Moving filters / non-unity mix use playgroundVersion 2 and engine revision 9;
unchanged static filters retain previous revisions. Mutilator rhythm is now
opt-in (`rhythm: true`); switch-aware freezes use mutilatorVersion 2, while
unmarked original static freezes keep their old signatures. Explicit false
is neutral. Accidentally always-rhythmic version-1 freezes refresh. The five
new strains are supported in both modes. Arm does not migrate source ZIPs,
change saved revisions or decode source PCM on phones. Compatibility reads
use bounded metadata; stale neighbours are refreshed selectively.


### Wasp one-source compatibility (2026-11-10)

The shared Wasp normalizer retains six v1 route records but arms at most one
of the two current rows. Live, ZIP recall, isolated deck and server workers use
the same normalization. Only active legacy two-source snapshots add
`waspSourceRevision: 1` to their audio content identity and `waspSourceVersion: 1`
to required part metadata. Current renderer uploads explicitly declare `waspsource=1` and carry
`render.waspSourceVersion: 1` (older-client uploads are never falsely marked); the client inspects older unmarked freeze metadata
and refreshes only affected two-source renders. One-source, bypassed and other
neighbouring freezes remain reusable. Original ZIPs, source hashes and Song
revisions remain unchanged during Arm.


## Universal independent effect outputs — 2026-11-11

The shared current app engine uses independently switchable wet returns for the nine effect cards, with Master Vol after excitation. Additive `modes.effectOutput` stores opt-in main-following switches; missing settings default to independent. Active effects require `effectOutputVersion:1`, and uploads carry `effectoutput=1`. Metadata inspection selectively refreshes unmarked active freezes; unaffected disabled/legacy dry audio retains its content identity. No source ZIP, source hash, Song revision, memory budget or source decoding policy is rewritten by Arm. The real server/WAV regression is `tests/effect-output-song-browser.cjs`; routing details are in `docs/effect-output-routing.md`.

### Cooking pot routing revision 2 (2026-11-11)

Active Cooking pot freezes require `cookingPotVersion:2` / `cookingpot=2`,
including source selectors and Turntable routes in their content identity. The
current engine preserves input selection, independent wet-return faders and
queued transport epochs. Rebuild only affected stale active-pot freezes; bypassed
legacy parts and original source ZIP hashes/revisions are unchanged. v1 producers
cannot certify a current active-pot render. See `docs/cooking-pot.md`.
