# Additional sample repositories — 2026-11-01

## Curated public sample scout — 2026-11-21

The Dropbox Sample Layer now offers `samples_public`, selected for fresh/reset
defaults. Explicit saved project/preset choices and embedded audio remain intact.
Mega/Sparse retain this next-load folder preference rather than choosing another
folder. Browser-only folder changes never replace existing PCM or provenance.

The authorised local-only source maps to the physical
`mygrain-source-mirrors/samples_public` directory. This is a local library under
the historical Dropbox UI label, not a claim of upload to a Dropbox account.
`../scripts/sync_public_sample_library.py` (workspace-relative) publishes only
the scout's selected `samples_public/READY_TO_USE` catalogue using verified WAV
bytes; originals, reports and licence records are not exposed. Its bounded
`public-sample-app-sync-20261121.service` follows the active run and performs its
last sync when that run finishes. Later runs need an explicit sync/watch restart.
Local enumeration sees additions immediately on browser refresh/reopen.

The source participates in the existing approved-user read-only shared allowlist;
private per-account overrides and authenticated path guards remain authoritative.
No remote/rclone fallback or symlinks are used. Only the new `samples_public`
next-load choice aliases the historical `sampledrop` choice in Song content
identity, so preference-only changes do not replace identical audio renders.
Previously supported preferences, absent fields, DSP and source ZIPs are unchanged.

Regression: `tests/public-samples-browser.cjs` against a disposable localhost
account store with three genuine-stereo WAVs in each test source. It exercises
the actual browser button, preview/Add, retained loaded PCM, history, preset
recall, Mega preference retention, reload and phone/desktop sizing in Chromium
and WebKit, plus actual server Song rendering/cache playback in Chromium.
Before-copies and live/API/checksum evidence:
`../output/mygrain-public-samples-20261121T183621Z/` (workspace-relative).

## Optional approved-user instrument corpus — 2026-11-21

Non-admin accounts originally have empty private source mirrors; with no personal
mirror, source browsing/randomisation returns “Your sample source library is
empty.” This is an account boundary, not a Unix chmod problem.

The native web host now supports an explicit owner opt-in via
`MYGRAIN_SHARED_SAMPLE_SOURCE_ROOT=/path/to/instrument-mirrors`. It defaults to
disabled. Its fixed 23-source allowlist matches the standard synced instrument
directories; only authenticated approved accounts can use the existing APIs.
An existing account-specific source directory takes priority, even when empty.
No remote Dropbox fallback, account promotion, copying or permissions changes
are involved. Shared source access is read-only through list/sample/generation;
feedback/favourites and generated outputs remain account-scoped. Radio/Video
captures, FTP, Songs, patches, recordings and saved downloads never fall back to
the shared root. Packaged factory sample banks retain their existing behavior.
Both shared directory links and leaf-file symlinks are rejected.

Mark approved this access scope on 2026-11-21. The native production service now
sets the shared root to `/srv/sftp/mark_sftp/files/mygrain-source-mirrors` in
`/etc/systemd/system/fs7300-documenter.service.d/member-instrument-samples.conf`.
This exposes only the fixed instrument-source allowlist, not the mirror root as
a browsable filesystem or any private account directory. Disable by removing
only that drop-in, daemon-reloading and idle-restarting the native host; never
roll back account databases or saved files. Evidence and before-copies:
`output/mygrain-member-samples-20261121T152209Z/` (workspace-relative).

Only restart the native web host after enabling/disabling this setting, while
its rendering jobs are idle. No On Demand or isolated-engine deployment change
is needed. Isolated stores always use their own `shared-samples/` test directory,
never a production path inherited from the environment. This changes source
availability only: immutable embedded Song/source PCM, DSP, render identities,
worker limits and checkout scheduling are unchanged.

Regression: `PYTHONPATH=../fs7300-documenter python3 -m unittest discover -s tests
-p test_mygrain_accounts.py -v`, from the native checkout. Coverage includes all
23 shared libraries, actual source bytes/random sample/generation, private
overrides, private capture exclusions, opt-out, traversal/symlink rejection,
anonymous/account-change rejection and existing account-isolation tests.

A, B, C and W each have a Sample folder selector: their historical folder or
`SAMPLES_LOOPS`. Defaults are unchanged. Direct Generate, Mega and AI/GENREator
bindings use the selected folder; global randomisation never changes it.
W Re-cut uses the loaded audio's source identity, not the next-build selector.
A/B/C Re-cut continues to operate on their loaded buffer.

The PERC browser includes `SAMPLES_PERC`; its random sample loader honours the
selected browser folder. ETC's browser offers Crash and Perc, retaining Crash
as the default. ETC remains manual-only and is excluded from random loaders.
Loaded sample metadata and the ETC browser preference persist independently.

The choices are additive in presets and Song state. Missing preferences restore
historical defaults. Existing source keys, formats, archive audio slots, playback
and DSP are unchanged. The server renderer uses these same controls and embedded
PCM through the existing Song restore deck; no render-version invalidation is
necessary for a source-selection-only change. Source files are neither trimmed
nor converted by synchronisation.

Shared-host integration and scheduled mirror additions are captured in
`backend/sample-repositories-host.patch`. Apply only missing hunks on a new host,
then restart fs7300-documenter. The hourly mirror job now includes SAMPLES_PERC,
SAMPLES_TOMS and SAMPLEDROP_RICH with additive copy operations. TOMS/RICH are
mirrored only; no new card options were requested for those libraries.

Verification:

- `python3 -m unittest discover -s tests -p test_drum_sources.py`
- Isolated test server with MYGRAIN_TEST_ADMIN_PASSWORD=isolated-sample-repositories
  and MYGRAIN_TEST_ROOT beneath /tmp; seed short WAVs under its
  admin/source_mirrors/{SAMPLEDROP,SAMPLES_LOOPS,SAMPLES_PERC,SAMPLES_CRASH}.
- `MYGRAIN_TEST_URL=http://127.0.0.1:18982/mygrain/ node tests/sample-repositories-browser.cjs`

The browser regression uses real localhost source-list/sample/generation APIs,
non-silent decoded PCM, Chromium/WebKit phone emulation, preset/old-default
recall, W recut identity, ETC's manual-only protection, real current/old-format
Song archives and server render jobs, warm reuse and phone playback. It never
writes to production accounts, Songs or sample libraries.


## Full-directory randomisation (2026-11-01)

- Grain A/B, Keyboard/Q and Mega/Sparse use the same picker across all 23 synced
  Dropbox libraries, including LOOPS, PERC, TOMS and SAMPLEDROP_RICH. Selection
  is folder-random then file-random; no instrument, pack or subfolder-name filter. The current sample also remains
  eligible, so a single-file directory still works.
- A/B/C/W generation and drum random loaders retain their selected source, but
  enumerate that entire recursive directory. ETC remains manual-only.
- Local mirrors are enumerated on each request, rather than holding a 180-second
  catalogue snapshot during sync. There is no browser-page limit on random pools.
- All mirrored audio formats (WAV, AIF, AIFF) participate; project files, executables,
  archives and sidecars are not audio. AIFF generation uses installed soundfile;
  WAV decoding and DSP remain unchanged. Auth, path and account guards remain.
- Source selection changes precede PCM capture. Song source ZIPs embed that PCM;
  server decks replay it without rerandomising. No render version bump is needed
  and existing freezes/source ZIPs must not be rewritten.
- Host integration delta: `backend/full-directory-random-host.patch`, applied after
  `sample-repositories-host.patch`. Regression checks cover every root, formerly
  excluded nested folders, >2000 files, arrivals during cache TTL, native browser
  sample loading/Undo/Redo, portable Songs, and current/legacy server renders.

## Restructure public-grain card — 2026-11-21

The former Dropbox sample card is now **Restructure**. Its generation action
posts BPM and a seed to authenticated `/mygrain-bastardloops/api/restructure`.
The backend fixes the source to account-scoped `samples_public` (including the
existing opt-in shared mirror); caller-selected repositories are rejected.
The obsolete raw-sample Browse action is hidden, not repurposed to bypass grains.

At most eight random public PCM WAVs contribute slices of the selected sizes to
one 4/4 bar (default1/16). The standard grid offers4,2,1,1/2,1/4,1/8,1/16,1/32
and exclusive Uncut; multiple musical sizes may be selected. Power-of-two slices
tile the bar exactly, choosing only sizes that fit the remaining space;4/2/1/Uncut
fill the bar without extending it. Each generation leaves2–6 independently
selected sixteenth-note windows silent. Version4 gives **each grain its own random
native Cooking Pot effect**, eligible from all eleven processors. A disposable
network-disabled offline deck reuses the actual native DSP; each grain has an
isolated effect history and random intensity/recipe, with a25/75 dry/wet insert
blend. Heavy Lifter analyses only that public grain (no industry corpus fetch).
CUDA stereo-linked RMS matching then finds one common target that every grain
can reach without clipping or excessive amplification; joins and the final gap
mask follow, so tails cannot refill gaps. Version4 records each grain's effect,
settings, gain and common target, plus divisions and explicit gap windows.
Archived versions1–3 retain their original PCM and recipes without regeneration.
Grain boundaries are rounded against the complete bar, never accumulated
or overlapped to shorten it. Channel-linked selection preserves genuine stereo;
stereo recordings receive higher selection weight. Twelve positions per grain
are compared for energy to avoid silent cuts. Sources are DC-corrected on derived
working copies only. Native 3ms bounded sample-edge fades and a .89 peak ceiling
apply to generated PCM; source originals remain untouched.

`backend/mygrain_restructure.py` reserves one slot from the shared eight-slot
worker budget. Production staging uses `/scratch/mygrain/app/mygrain-restructure-*`
and is removed on success/failure. `scripts/restructure-gpu.py` uses the existing
`.venv-gpu/bin/python` (override `MYGRAIN_GPU_PYTHON`), bounded 128MiB CuPy pool and
the checkout CUDA assembly lock. CUDA performs gather, equal-RMS gain matching, envelopes, splice and peak
control. Native Cooking Pot effects, WAV decoding/resampling and candidate
selection run on CPU. `scripts/restructure-effects.cjs` uses one disposable
Chromium offline deck within the same shared worker lease, releasing the CUDA
lock while native effects run; dry/wet intermediates remain in private scratch. There
is no silent CPU fallback; a failed/obsolete result leaves previous audio intact.
This does not claim that CUDA startup makes a two-second loop faster than CPU.

The canonical `dropbox`, `dropboxSample` audio slot, DOM IDs, aria navigation
target and saved mode/metadata keys are unchanged. Old PCM, repository preference,
pitch, timing and manual level restore without conversion or regeneration. New
results add optional `metadata.restructure` recipe/source hashes and use existing
immutable raw-WAV capture in patches, Parts Bin and Song/server decks. Generation
sets bar-fit/keep-duration On. Restructure and Mega/Sparse random levels never
exceed 70%; normal patch randomisation caps an existing higher level. Saved/manual
levels are not globally clamped. No Song render version bump is needed because
existing playback DSP and frozen source interpretation are unchanged.

Restructure's `<` / `>` arrows use the shared loop-point shift contract: one
sixteenth of the playback cycle per press, signed readout, wraparound and bounded
-16..+16 steps. The optional `dropboxSampleLayerShiftSteps` preset/state mode is
omitted at zero; legacy recalls default to zero instead of inheriting an offset.
The source PCM and grain recipe remain immutable. Both scheduled starts and
running transport starts apply the offset in `startDropboxSampleLayer`, shared
with offline/server Song decks; no raw audio regeneration or cache migration.
Button edits are Card History transactions. See `tests/restructure-shift-browser.cjs`
for actual-button, wrapping, scheduled/running offsets, Undo/Redo, preset/ZIP/reload,
responsive layout and paired shifted/unshifted server Song checks.

Division checkboxes set the next-generation preference only; changing them does
not re-cut or regenerate currently loaded audio. Restructure regenerates using
the selected set. Card Randomise always includes1/16, randomly adding1/8 and/or1/32, then calls
the same loader inside one history transaction, preserving random effects/gaps.
Normal Randomise changes the preference; Mega/Sparse change it exactly once
before their existing Restructure task. The optional `restructureDivisions`
preset/state mode defaults to1/16 for old imports and is omitted at that default.
The backend excludes this next-generation preference from stored-PCM content
identity. Backend validation rejects unsupported/empty divisions before I/O.
The loader guards the selected-set signature, disables controls during generation,
and restores previous preferences after a failed card Randomise. No other lane's
2/1 generation-only cut restriction or AI schema is changed.
Checks: `tests/restructure-divisions-browser.cjs` plus `tests/test_restructure.py`.

Verification: `python3 -m unittest discover -s sandboxGRANULAR/tests -p test_restructure.py -v`
(real CUDA/CPU parity, exact bars, stereo, deterministic PCM, failures/cleanup), and
`tests/restructure-browser.cjs` against an isolated server/account fixture, covering
legacy source ZIPs, actual button, Undo/Redo, new ZIP round-trip, failure/stale
retention and real server Song preparation/warm playback in Chromium plus WebKit
client checks. Never run this fixture against production account stores.

### Restructure Loop Cut / shared reset — 2026-11-22

The card's Loop Cut opens the full shared editor (trim/drag, grid/snap, repeat,
From Start, pitch-preserving stretch, gap editing/copy/paste and both audition
modes). Optional `restructureCut` is saved/history-aware and omitted at neutral;
old imports default to full-loop playback. Only derived playback is gated,
including the live and server Song path. Raw source PCM/recipe remain immutable.
Editor controls are excluded from duplicate ZIP `extra.controls` serialization.
Desktop shells and backdrops use translucent backgrounds, retaining phone CSS.

Normal Randomise, Mega/Sparse and Reset Patch clear all sample-card loop cuts
through their native setters (including all four D lanes). A successful new
Restructure clears its own cut; failed/stale requests retain previous audio/cut.
Cut edits during generation invalidate the result. New-output failures also
restore the previous PCM/modes/metadata/level and division preference. Explicit
Randomise Loop Cut inside the editor is intentionally not a full-loop reset.

Checks: `tests/restructure-cut-browser.cjs` (phone/desktop Chromium/WebKit, PCM
trim/gaps, native muted-card audition, reset, Undo/Redo, ZIP and paired real
server Song PCM), `tests/restructure-pot-cut-browser.cjs` (CUDA generation,
legacy v1/old Dropbox ZIPs, failures/stale/batch entry points and server Song),
and `tests/test_restructure.py` (real CUDA, numerical equal-RMS/CPU parity).
