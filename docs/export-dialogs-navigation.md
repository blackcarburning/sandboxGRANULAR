# Export dialogs and responsive navigation

Build v2026.11.12.DIALOG.1. Presentation/control-flow only: no DSP, patch schema,
Song cache revision, native plugin binary or repository API changes.

## Owners

- `index.html`: `chooseExportSaveOptions`, `showExportActivity` and canonical
  export callers. HTML `<dialog>` renders within the editor/CEF surface.
- WAV Browser export combines name + optional editable ZIP before rendering.
  Shared Loop Store asks for its name before capture, explains shared access
  and the retained exact-cut/0dBFS normalisation. No native prompt/confirm in
  these paths. Patch ZIP save also uses the in-app name dialog.
- Cancel, Escape, programmatic close, page exit and account lock/change dismiss
  pending choices. Blank names stay in the dialog. Duplicate choices resolve
  cancelled. Explicit submit resolves once, then real render/upload begins.
- Progress is an app dialog with real preparation/render/upload/completion
  messages; Hide progress does not cancel an accepted operation. Existing
  canonical status and Jump button mirrors continue to report progress.
- Native OS download destinations may still be controlled by the host/browser;
  these are distinct from the app-owned filename and editable-patch choices.
- Existing modal scroll guard recognizes dynamically opened HTML dialogs.

## Shared desktop / iPhone Jump

`navigation-palette.js` moves existing quick buttons into the existing panel
grid at every viewport width (SMOOTH-JUMP.1). The panel is the only scroll owner;
Jump and Find/search remain fixed above it, including iPhone and landscape. The
original quick controls stay in the panel on resize, and duplicate destinations
are hidden. iPhone history-edge Pot/Baker shortcuts use separate ID-safe links
that call the same jump handler; they never steal the menu buttons or listeners.

Priority: Clear, wide Top/AI/Pot/Parts Bin/Baker/Song, then paired Layers+Mix, Mega+Sparse,
Export Mix+WAV Browser, Loop Store Add+Browse, Keys+Actions, Drums+GENREator.
As of v2026.11.12.JUMPS.1, renderers align in the left column and browsers in the
right. Loop Store render uses bright orange, its browser darker orange; the
shared navigation palette owns both themes on desktop/phone and the Actions controls.
Loops follow A/B/C/D/V/W/P/O/L/X/Q/M/M+/K; remaining areas retain existing
relative order; internal and standalone effects last. Actual card placement and
saved Cooking Pot stage order are unchanged.

Search includes the former quick shortcuts, normalizes all whitespace, honors
`hidden`, deduplicates quick/panel destinations at every width and supports Enter/Escape.
Lazy effects reuse their buttons. Wait out placeholder/final duplicate targets
before arranging; otherwise repeated reparenting can create an observer loop.

## Verification

`tests/export-dialog-jumps-browser.cjs` expects an isolated server/account store
with admin password `isolated-vst3-test`, via MYGRAIN_TEST_URL. Never point it at
production: it creates real WAV/paired ZIP/Loop Store files in the fixture.
It tests desktop order/widths/one scroll owner, fixed header, responsive ordering,
search and lazy hydration; real caller cancellation/invalid name/account change;
real captures/uploads and unchanged patch/source; clear failure recovery and no
native JS dialogs. Chromium/WebKit at desktop/phone widths. Physical Windows
CEF requires a user/device check; hosted app reload applies these changes.

## Short sample joins (2026-11-13)

`MygrainVocalCut.crossfadeJoins` and backend `crossfade_sample_joins` use a 3 ms
complementary raised-cosine blend from a mirrored outgoing tail into the incoming
head. Exact frame positions, period/tempo, original PCM and stereo alignment stay
unchanged. There is no overlap-induced shortening or additive gain boost.
Generated source-pool cuts (manual and coarse), local recuts, repeated editor
sections, D source repeats and mode-derived loop wraps share the treatment.
Cuts into silence/padding fade inside the occupied interval; gaps stay exactly
zero. Existing grain/K fade processing stays intact. L/X add a 3 ms owned gain
guard whose end follows actual sample exhaustion, including pitch slides, rather
than an ADSR duration that can outlive the source. No envelope control is reset.

New captures with an enabled affected sample source advertise `sampleCutVersion:1`
and a selective audible content revision; inactive/synth-only parts keep legacy
hashes. Client compatibility and backend render GET/POST inspect actual source
metadata, including older parts without the flag. Arm refreshes affected freezes
with the current engine; it never rewrites source ZIPs or advances Song revision.
Warm renders reuse the saved PCM. Tests: `sample-crossfades.test.cjs`,
`test_sample_crossfades.py`, `smooth-jump-browser.cjs`, and real old/current
`source-grid-song.cjs` server jobs in a disposable account store.
