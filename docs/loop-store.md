# Shared Loop Store

Added 2026-11-10. **Actions → Add to loop store** renders the current final mix
as PCM24 WAV. **Actions / Jump → Loop Store Browser** uses the WAV browser's
player, search, download, private FTP destination picker and favourites UI.

## Audio contract

- Uses the existing `choosePerformanceExportSteps()` range choice and
  `renderDawReadyBarsExport({exportSteps, loopWarmupCycles: 1, signal})`.
- One complete warm-up cycle is excluded. Capture starts on the buffered
  transport origin, compensates final-output latency, and retains exactly
  `Math.round((60 / bpm) * 4 * (steps / 16) * sampleRate)` native frames.
- After the exact cut, Loop Store renders are peak-normalised to 0 dBFS in
  floating point before PCM24 encoding. One gain across all channels preserves
  stereo balance; silence stays silent. No resampling, appended effect tail,
  lossy preview or added fade changes the stored WAV. Warm-up does not guarantee
  every arbitrary patch
  is periodic (random/generative notes and long evolving effects can differ
  between cycles). The cut itself is the exact chosen musical length.
- The upload API validates RIFF sample alignment and the actual frame count
  against BPM/steps before publication. External WAV uploads retain their own
  samples and are labelled **Imported WAV**, not **Exact cut**.
- Filename cancellation, export-length cancellation/Escape, and account locking
  abort before persistence. The button remains disabled for the full operation.

## Shared storage boundary

`backend/mygrain_loopstore.py` owns `/mygrain-loopstore`, authenticated through
the existing session and pinned-identity dispatch. This is intentionally **not**
an account-scoped WAV library. Every signed-in user can contribute and read
`/srv/sftp/mark_sftp/files/SAMPLES_LOOPSTORE`.

Metadata in `.metadata/<name>.wav.json` records contributor identity, BPM,
steps, native frames/rate, format and SHA-256. Only the contributor or admin can
rename/remove an entry. Rename preserves WAV bytes; removal moves audio and
metadata into private `.trash/<timestamp>-<id>/` recovery storage. A process-wide
lock serializes all accounts' publication/rename/delete operations. Collisions
get distinct names without overwriting. Checked file paths, hidden-file denial,
and range-capable descriptor streaming are retained.

There are **no comments or reactions** in this store: no feedback UI is attached,
and feedback/share/mastering APIs are rejected. Existing WAV notes, sharing,
mastering and editable ZIPs remain in the normal WAV library. Browser mode and
callback destination are independent of the normal WAV export destination.

The new route is proxied by Caddy. Isolated fixtures must override module `ROOT`
to their own `SAMPLES_LOOPSTORE`, never a real shared folder. Account switches
abort the browser's existing fetch/player lifecycles and the new render action.

## Compatibility and checks

Normalisation is opted into only by `addCurrentLoopToStore()` via
`normaliseForLoopStore: true`. Ordinary WAV exports, WAV Browser/Masters, direct
WAV uploads and native/DAW renders retain their original levels. Existing stored
loops are not rewritten. Button help and render commentary describe this.

Loop D's source inventory, patch schema, Song adapter/clock/render deck and
server-arm worker are unchanged. No audible renderer/signature version needs
invalidation: this destination-only post-processing does not change DSP or
saved-part content. Server Song jobs do not opt into Loop Store normalisation.
D sources can be added later explicitly.

`tests/loopstore-browser.cjs` exercises real capture worklets, PCM24 upload,
sample counts at 44.1/48 kHz and 137 BPM, per-sample stereo-linked normalisation
against the raw capture, seam analysis on a periodic source,
original-PCM looping, both browser engines, phone/desktop, portrait/landscape,
Jump/Actions, cancellation, account locking, and WAV/Masters mode restoration.
It accepts only a loopback fixture URL via `MYGRAIN_TEST_URL`.

The isolated backend integration script and full task evidence/rollback copies
are in `output/mygrain-loopstore-20261110T005900Z/`. It checks cross-user access,
guest/pinned-identity denial, prohibited notes, malformed/off-by-one WAV rejection,
exact range/rename/download bytes, simultaneous-account filename collisions,
permission boundaries and recoverable removal.

## Direct render shortcuts

Jump’s Export Final Mix (quick and panel) and Add to loop store execute their existing Actions button immediately, without the navigation curtain, scrolling to Actions or closing the drawer. `navigation-palette.js` captures only `[data-render-action]` clicks, forwards once to the canonical Actions control, and mirrors its disabled/text states through a scoped MutationObserver. No render/timing/DSP logic is duplicated or changed. Shortcut labels keep the action name and reserve a progress line for Preparing, Rendering, Uploading/Adding; no inferred percentages or timer. All render shortcuts are disabled during either action, including the synchronous dispatch guard, and reset from canonical completion/cancellation/failure. Account lock retires their observer and disables execution.

Loop Store Add shares Export’s bright green treatment/play icon, including desktop navigation’s pseudo-element override. Browser-opening shortcuts retain their existing navigation path. Desktop quick/panel deduplication uses either Jump target or click target so direct Export does not appear twice.

Evidence and backups: `output/mygrain-render-shortcuts-20261110T094839Z/`; asset key `20261110-render-actions-1`. Authenticated tests use actual renders/uploads only against isolated loopback stores. Main inline engine and original exact-cut/capture functions remain byte-identical.

## Post-export audio recovery · v2026.11.11.EXPORTRESUME.1

Loop Store Add and WAV Browser/Repo export keep the existing AudioContext, DSP
nodes, source buffers, settings, mute and playback intent. The shared capture
function already releases its recorder/ports/listeners and stops only transport
started for a stopped-editor export. Healthy running audio needs no recovery.

The previous automatic full Panic rebuild was reported to hang on iPhone and
desktop. It is removed from both destination finally blocks' recovery helper.
Manual Panic/Reset Engine remain explicit actions; no automatic close, graph
recreation, PCM cloning, preset recall or silent fallback rebuild runs after an
export. If a foreground context was interrupted by a native dialog, attempt
`resume()` only, bounded to 1,200 ms. On timeout/rejection/closed context, unlock
controls, retain the saved-file/error message and show a tap-Play/reload hint.
Do not wake intentionally idle-suspended or hidden-page audio, and do not alter a
newer context if account/user actions replace it while resume is pending.

Both WAV-only and editable-patch WAV exports retain destination-owned cleanup.
Once capture starts, name cancellation, capture/upload failure and account-aborted
Loop Store capture use this same bounded recovery; pre-render cancellation and
snapshot-preparation failures do not. Direct file uploads, local WAV downloads,
take capture/upload, mastering, native/DAW and server Song rendering are unchanged.
Loop Store still peak-normalises; WAV Browser exports retain original levels.
No DSP/renderer/saved-data/capability/cache identity changes. Original source and
render files are not rewritten. Tests cover a never-settling resume as well as
real repeated exports with same-context final-output PCM on Chromium and WebKit.
