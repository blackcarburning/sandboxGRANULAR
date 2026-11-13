# Standard sample chooser

Mark's standard, 2026-11-13: use this compact rainbow browser for sample-chooser
work, rather than a card/audio widget for every file. The first rollout covers
all seven independent drum sounds and the Snare Roll lane. Other existing
instrument browsers are not silently migrated by this rollout.

## Interaction contract

- Enumerate **every sample** under the lane/instrument's assigned repository,
  including nested paths, and make one Fisher–Yates shuffled array on open or
  folder change. No reshuffle on page changes, selection, hearts or Load.
- 200 samples per page; five columns on phones (including touch landscape),
  ten on desktop. Scroll inside the browser; the app behind it stays put.
- Compact cells contain a position number, a play triangle and a small heart
  when the sample belongs to any heart collection. Colours
  progress from red to violet over each page. Numbers identify this shuffled
  visit, not permanent source IDs. The last, partial page spans the spectrum too.
- A single tap auditions. Double tap/click loads the selected sample into the
  editable patch **without closing**. A dedicated Load button does the same.
  A pan, long press or cancelled pointer gesture must not load a sample.
- Icon-only green ▶ and red ■ sit beside every shared browser title, including
  multi-source browsers. They call the existing whole-composition transport:
  Play is idempotent while running; Stop stops composition/Song and active
  audition, leaving the browser open for fresh sample-only audition. Stop/Close
  cancel a pending asynchronous start. They add no saved controls or audio logic.
- Small fixed header: previous page / next page at the edges, collection-heart
  selector and selected heart toggle, selected filename, Load, Close. A folder
  select appears only where that instrument already supports folder choices.
  Close has its own 44px square in a 44px title row; scoped sizing overrides
  the app-wide Close treatment, while the overlay retains phone safe insets.
- Large-enough `−` and `+` targets (44px): move one item and immediately audition
  it; they do not load it. Arrow keys move/audition by cell or row and cross page
  boundaries. Enter loads the focused cell, Space auditions, Escape closes.
- Keep live transport clocks and playback running during auditions and loads.
  New hits use the new buffer; already scheduled hits may finish the old sound.
  Do not restart, clear patterns, change Solo/FX or move the transport origin.
- Close explicitly exits and stops only the audition. Focus returns to the
  launch button. Account change/lock/pagehide cancels and clears the browser;
  hidden-page state stops auditioning without stopping the composition.

## Implementation and ownership

`sample-grid-browser.js` exports `MygrainSampleGrid.Browser` and owns only
ephemeral list, page, selection, gesture and audition state. Its CSS is scoped
under `#sampleGridBrowser`. Use one instance and one native audio element.
Native playback starts synchronously from the gesture using the original
streamed file, with an active-user media pin. Only unsupported original AIFF
uses the existing bounded decode-preview adapter. Do not preload hundreds of
files or create per-cell audio/feedback/favourite widgets.

Adapters provide identity, asynchronous full-folder list, pinned preview URL,
guarded canonical load, optional decoded preview and folder preference update.
The shared favourites library exposes `subscribe()`; hearts use its existing
`["sample:<sourceKey>", "<relativePath>"]` identity and server API. Hearts do not
rename originals. Filtering uses a view of the same shuffled array.

`openDropboxSampleBrowser` routes drums, D/L/X, Dropbox, Grain A/B and Keys to
this component. A/B/C/W/V/P/O use its selected-source Recut mode. Main/Mic and Q
retain their existing choosers. All migrated launch buttons use the same instance.
Kick/Snare/Hat/Clap/Cymbals use their assigned drum repositories; Perc remembers
its full existing repository choice and Etc its Crash/Perc choice. Roll opens
the same chooser for the **shared Snare buffer**, not a new eighth sound.

Loads use the existing raw-buffer/metadata/normalization persistence boundary
inside `mygrainCardHistory.runDraftEdit`: Undo/Redo retains original PCM,
normalization and provenance. Preview is never committed. Fetch, decode and
normalization completion are guarded against selection, folder, context,
account and close changes. A commit that has already completed synchronously
is not retroactively undone just because the user exits afterward.

The chooser's view controls have no saved-control IDs and add no patch/Song
schema. Source ZIPs continue to contain canonical original buffers, paths and
drum processing, not a shuffled order or player state. The server Song path
(`song-beta.js`, `song-beta-clock.js`, isolated deck, server-arm worker and
`backend/mygrain_songs.py`) already restores those canonical fields: there is
no new DSP or render-signature revision. Do not invalidate unchanged renders.

Prepared **Song arrangement playback** uses immutable rendered parts; opening
the browser leaves it playing and previews remain available, but its frozen
PCM is not rewritten by a live-patch edit. The existing Song/history reservation
rules still apply to Load during arrangement operations. To change a saved
part, amend it and save normally. This is distinct from live composition/beat
playback, where successive loaded sounds are heard immediately in the running
drum pattern.

## Verification

Use a disposable authenticated store; never mutate production Songs for tests.
Run `python3 tests/sample-grid-fixtures.py /tmp/mygrain-grid-UNIQUE` to seed
417 short, distinct WAVs under `admin/source_mirrors/SAMPLES_KICKS/Nested` and
four WAVs under each other drum source folder. The AIFF test reads an original
`.aif`/`.aiff` from the app's bundled AltBass/SFZ collection (its account-resolved
source deliberately points there, not at a synthetic account mirror).
See `tests/song-beta-test-server.py`; start it with that dedicated
`MYGRAIN_TEST_ROOT`, `PYTHONPATH` including `fs7300-documenter`, and test-only
`MYGRAIN_TEST_ADMIN_PASSWORD=isolated-vst3-test`.

- `tests/sample-grid-browser.cjs`: Chromium/WebKit × phone/desktop; real buttons
  for eight lanes, 200/200/17 paging, stable/reopened order, native auditions,
  double taps, keyboard, hearts, assigned folders, scroll containment, cancelled
  requests, final-output PCM and unchanged running transport origin.
- `tests/sample-grid-lifecycle-song.cjs`: safe geometry at 320/390/touch-landscape,
  streaming PCM, exact Undo/Redo, cancellation during normalization, stale lists,
  AIFF, account cleanup, source archives, actual current/legacy server Song jobs,
  warm cache and bounded-memory phone arrangement playback.
- Existing favourites tests and JavaScript/inline-script syntax checks remain
  required. Inspect screenshots, including WebKit native selects. Browser
  emulation is not physical-iPhone verification.

Both scripts accept `MYGRAIN_TEST_URL` (localhost only) and
`MYGRAIN_TEST_OUTPUT`. The test-only admin password is `isolated-vst3-test`.


## Selected-source Recut mode (2026-11-13)

A/B/C/W/V/P/O have Choose Samples (V's existing Choose Vocal Samples) controls.
Tap auditions the original; double tap/click toggles that sample in the top
list: first selects it, the next deselects it, without modifying card audio.
The Add button remains add-only and never duplicates or deselects a sample.
Picked cells become bright green, including after
paging/hearts filtering. A source chip removes that selection; Clear list leaves
card audio unchanged. Up to 64 sources are accepted, matching canonical metadata.
Folder changes start a separate list for that assigned folder; cross-folder
mixes are not silently passed to the single-source backend. The current card's
matching source pool seeds the list on reopening; imported PCM with no repository
paths remains playable, with an empty source list until samples are added.

The browser mirrors each card's standard cut checkboxes (4, 2, 1 bars, 1/2 down
to 1/32, Uncut). Uncut is exclusive and at least one division stays selected.
This is an explicit **manual Recut exception**, not a change to 2/1-bar ordinary,
Mega/Sparse or AI generation. Both request helper and backend opt in separately;
other callers retain coarse normalization. The backend reads only selected
original source files, returns WAV bytes and never archives generated results.

Recut is a guarded history transaction: fetch, decode and verify current account,
context, selection, tempo and pattern before committing. It writes the existing
card PCM/metadata/DB slot, clears the previous cut envelope to full playback and
retains the entire selected source pool in samplePaths/sampleNames. No browser
schema is added. Only the changed running lane is replaced, aligned to the
existing origin. Enables, solos, FX, patterns and other clocks are retained.
A request cancelled before commit, or a failed generation/decode, leaves the
previous card intact. Closing after synchronous commit does not undo the load.

Play loop auditions the canonical recut PCM using the same single native player,
looped through a transient WAV Blob; Stop loop stops only this audition. The
browser attempts playback after Recut, with the explicit Play control available
for mobile autoplay policies. Closing/reopening revokes the temporary Blob URL.
Keys retains its own guarded history transaction; other direct sample targets
reuse their canonical apply/load paths, original AIFF decoding, root/provenance
and sample/source controls. D links the browser abort signal to its own loader.

Verification additions: source-grid-browser.cjs exercises 14 real launch controls,
selected-source lists, manual fine Recut WAVs, native source/result PCM, safe
layouts, continuing final PCM and clocks, history and pre-commit cancellation.
Backend checks cover standard/manual versus coarse schedules and actual WAV
responses with source byte hashes. source-grid-song.cjs covers canonical loaded
samples and recuts in old/current immutable source ZIPs, real isolated server jobs,
warm reuse and bounded phone playback. No render-signature revision is required:
the renderer continues to consume existing canonical PCM/state, including manual
fine cuts in old exports. Never invalidate unrelated already-prepared Songs.


Reproduce source-grid checks from the app checkout with an unused localhost port:

```sh
python3 tests/source-grid-fixtures.py /tmp/mygrain-source-grids-UNIQUE
MYGRAIN_TEST_ROOT=/tmp/mygrain-source-grids-UNIQUE MYGRAIN_TEST_ADMIN_PASSWORD=isolated-vst3-test PYTHONPATH=../fs7300-documenter python3 tests/source-grid-test-server.py 19016
```

In another shell set `MYGRAIN_TEST_URL=http://127.0.0.1:19016/mygrain/`,
`MYGRAIN_TEST_ROOT=/tmp/mygrain-source-grids-UNIQUE` and an optional
`MYGRAIN_TEST_OUTPUT=/tmp/mygrain-source-grid-results`; run
`python3 tests/source-grid-backend.py`, `node tests/source-grid-browser.cjs` and
`node tests/source-grid-song.cjs`. The Song test's synthetic legacy ZIP was
captured from actual DRUM-LEVELS.1 before this release, not a relabelled new
manifest. The test server alone redirects NCR vocals to its synthetic fixture
mirror; production's READY_TO_USE folder stays unchanged. AltBass is read from
its real bundled original AIFF collection. Physical iPhone playback remains a
separate manual check.

## Browser-header transport (2026-11-13)

`tests/source-grid-transport-browser.cjs` uses the same disposable source-grid
fixtures/server above. Run with `MYGRAIN_TEST_URL` pointing at that localhost
server and optional `MYGRAIN_TEST_OUTPUT`. It checks all 22 shared targets in
Chromium/WebKit phone and desktop: icon-only title adjacency, idempotent Play,
Stop, sample-only auditions, final-output PCM/silence, Stop/Close cancellation
during asynchronous preparation, native keyboard activation, retained card-loop
preview and responsive geometry. `QUICK=1` limits an installed-file smoke check
to Chromium phone/Loop A. No production accounts, Songs or libraries are changed.
This adds UI callers of the existing transport only; saved fields, source PCM,
server rendering and render identities are unchanged.

## Multisample selection toggle (2026-11-13)

`tests/source-grid-toggle-browser.cjs` uses the same isolated source-grid
fixture/server and `MYGRAIN_TEST_URL` / `MYGRAIN_TEST_OUTPUT` variables. It
verifies select/deselect/reselect on A/B/C/W/V/P/O with actual mouse double-clicks
and phone double taps, untouched canonical PCM/metadata, add-only Add, independent
selections, page reconstruction, the 64-source cap, cancelled pointers and
unchanged repeated direct-sample loads in Chromium/WebKit phone and desktop.
`QUICK=1` runs Chromium phone only. Selection stays transient until Recut; no
saved schema, render identity or server Song changes are introduced.

## W Loop Store source (2026-11-13)

Loop W offers SAMPLES_MODULAR, SAMPLES_LOOPS and SAMPLES_LOOPSTORE in both its
card selector and shared multi-source browser. The existing next-load
`modes.loopSampleRepositories.W` field persists the choice; changing it never
replaces loaded PCM. Manual Recut and ordinary/AI generation use the same source
resolver. Backend validation accepts all three. New Loop Store next-load state
aliases the historical Modular render identity; existing supported choices keep
their historical digests and original ZIPs are not rewritten.

Regression checks: `tests/turntable-transport-w-browser.cjs` measures final
PCM in Chromium/WebKit phone/desktop (native mix, drums and A input; the same
three in Cooking Pot), stopped sample auditions, repeated Stop/Play and W
Loop Store manual recut/persistence. `tests/turntable-transport-song.cjs`
checks actual current/legacy server PCM, warm reuse, source hashes/revision,
phone playback and memory cleanup. `tests/test_w_loopstore.py` checks backend
repository admission and historical digest preservation. `global-solo.test.cjs`
also checks transport-neutral saved settings and offline/wrapped render contexts.


## Current replacement contract: in-track Preview (2026-11-13)

This section supersedes the earlier Load/double-click/Recut-immediately-applies
wording above. The shared browser covers drums/Roll, D/L/X, Dropbox, Grain A/B,
Keys, and multi-source A/B/C/W/V/P/O (22 entry points).

- **Preview** starts OFF whenever a browser opens. With Preview ON, selecting a
  single source auditions it through the live track and its current FX, timing,
  pitch, envelopes, levels and mute/solo. The original is retained. Grain and Keys
  source modes are projected for audition, not changed in saved controls.
- Double-click multi-source cells to select/deselect; green cells and the top list
  remain browser-owned. Division choices are pending. **Recut** prepares new audio
  but does not overwrite the current card. Preview ON auditions that candidate in
  the track; **Play loop** still auditions the candidate independently.
- **Add** asks “Are you sure? This will replace the current loop”. Only confirming
  Add writes the selected source/cut and pending divisions, in one history edit.
  Cancel/Escape cancel only the confirmation; closing or changing account cancels
  the whole audition. Undo/Redo restore exact original/committed buffers.
- Preview OFF, Close, account lock/change, history travel and Song/project recall
  remove the audio-read overlay. Failed/cancelled/stale prepare/recut never commit.
  New selections abort old work; guards include browser epoch, file, account,
  AudioContext, source-mutation serial, original buffer, and recut tempo/pattern.
- Canonical globals, metadata, IDB, ZIPs and native project snapshots are untouched
  while auditioning. Browser controls have no saved IDs. Plugin Live and standalone
  use the same playback reads; no plugin rebuild is needed for the hosted update.
  Native Rendered mode intentionally plays its frozen render; choose Live to hear
  live edits/Preview. No render revision/schema change or cache invalidation.

Verification: `tests/source-grid-track-preview.cjs` runs actual network recuts,
final-output spectral PCM, retained snapshots, original identity, modal Cancel/
Escape/commit, exact Undo/Redo, stale decode races and account cancellation on
Chromium/WebKit desktop and phone layouts. `tests/source-grid-song.cjs` builds
real current and actual legacy server Songs and checks warm reuse/source hashes.
