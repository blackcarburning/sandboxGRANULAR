# Loop W / Weird — 2026-10-25

## Source and operation

- Source key `samples_modular`, label `SAMPLES_MODULAR`, generated prefix `bastardloop-w`.
- Dropbox `dropbox:SAMPLES_MODULAR` is copied into `/srv/sftp/mark_sftp/files/mygrain-source-mirrors/SAMPLES_MODULAR`.
- `scripts/sync_mygrain_source_mirrors.sh` includes this folder in the existing hourly cron (minute 17). Copy semantics preserve existing local files; remote deletions are not propagated. Initial verification: 42 matching files, 298,459,794 bytes, zero differences.
- W is independent of V, with matching resolution cuts, same-sample re-cut, pitch, reverse, shift, mixer/solo and Loop Cut trim/repeat/stretch controls. It defaults off for existing workspaces and is included in Sparse's random subset and Mega's generated loop tasks.
- `weird-loop-fx.js` uses an independent `MygrainQ.Controller` effects graph with Q's stereo hall and tempo delay, persisted as `bastardLoopWEffects`. It does not change Q settings. The W EQ is connected once, after W effects; the input filter chain skips a second EQ insert. Global BPM changes resync W delay.
- W audio is appended to Song/Undo audio bindings: never insert before existing journal slot indexes. W is included in patch audio, stems, Song capture/render and loop-copy selection. Legacy parts lacking W have no W audio and default W off.

## Repository browser repair

A/B/C/V/W/P/O share `openBastardLoopRepositoryBrowser`. Repository-directory navigation is intentionally redirected to MYGRAIN by the account wrapper, so `window.open('/mygrain-bastardloops/')` cannot work.

The shared action now opens `bastardloop-browser.html` inside a closable iframe. Its base is `/mygrain-bastardloops/`, but API fetches use the parent account guard after resolving URLs against the iframe base. Do not use native iframe fetch for APIs: backend requires `X-Mygrain-User` as well as the session cookie. Native audio/download URLs include `mygrainUser` to retain account binding. Do not weaken authentication or expose the protected directory as a public workaround.

## Verification

- `tests/weird-loop-browser.cjs`: actual source generation, shared transport audio, reverse/pitch/shift, independent V/W cuts, effects isolation, portable Song capture, browser buttons, reload restoration. Chromium/WebKit desktop and 390×844 touch viewport passed.
- `WEIRD_EXTENDED=1 node tests/weird-loop-browser.cjs`: additionally actual Mega W build, same-sample re-cut and non-silent Song rendering.
- `tests/weird-browser-routes.cjs`: authenticated local repository listing, native WAV preview and RIFF/WAVE download; Grain A/B, sample layer, keyboard, drum sample and repository browser controls; no new tabs or page errors.
- Song loop-copy suite includes W; cut/stretch/randomisation unit suites passed. Public assets checked byte-for-byte; anonymous protected APIs still return 401.

Browser account tests use a disposable server/store and a fixture-only password override. They do not modify production accounts or saved songs. Phone tests are browser emulation, not a physical iPhone test.

## W-CUT.1 — shared V/W source-area dragging

W uses the same `MygrainVocalCut.Editor` as V. The V-only source-area gesture
is now enabled for both V and W, with a per-editor `CutDragSection` ID and one
shared `.vocal-cut-drag-section` style. Stretch Off drags the source window
without changing its width; trim handles remain independent. Snapping/free
movement, keyboard arrows/Home/End, clamped boundaries, drag preview, one
Undo/Redo transaction, and phase-preserving audition restart match V.
Stretch On keeps the existing destination-body move and stretch-end behaviour.
Gap On hides/disables source dragging so gap placement/copy is not intercepted.

W retains the shared Gap Copy/Copy Sec controls, repeat-output waveform,
From Start, repeat, stretch, reset and both auditions. Only W's saved source
window changes when dragged; V and source PCM remain untouched. No DSP/schema
or render-compatibility revision changes: Song capture/server preparation and
DAW already read W's existing cut settings and the same shared gate. Saved
amendments retain the new source window using normal revision invalidation.

Checks: 59 focused cut/gap units; `tests/w-loop-section-drag-browser.cjs`
(Chromium/WebKit source drag, keyboard, snap/free, boundaries, history, native
Chromium touch, stopped/running Amend, save/recall and Chromium isolated Song
render); `MYGRAIN_GAP_COPY_LANE=W node tests/gap-section-copy-browser.cjs`
(both browsers, W gap copy/repeat, 375/390 portrait, 844 landscape and 1440
desktop, history and saved-source/amendment roundtrip). All browser writes use
isolated localhost fixture stores; physical iPhone untested. Evidence and
before-edit copies: `output/w-cut-parity-20261027/`. No mixed-baseline commit,
push, service restart or production-store writes.
