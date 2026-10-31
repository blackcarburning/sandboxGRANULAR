# Server mastering (v4, 2026-10-31)

Open WAV Folder and choose **Master** beside any clip or exported Song. Presets:
Clean (aim −16 LUFS), Punch (−14), Dense (−11), Level only (−16 with no dynamics).
Targets are aims: input gain is bounded to −24…+12 dB and limiting/compression can
leave output quieter. Output is measured and must not exceed −1 dBTP. Choose
Loop-safe for repeating clips; turn it off for complete Songs (automatic for
`.song.` filenames). Short material is repeated for loudness measurement.

The backend hosts LSP LV2 compressor/limiter offline through FFmpeg. Automatic
limiter levelling and gain boost are disabled; limiter uses full 4x oversampling
and stereo-linked operation. Latency is calibrated by impulse for each sample
rate/preset, then removed. Loop processing repeats source material for at least
2 seconds/one whole cycle before extracting one exact cycle. Song mode instead
flushes lookahead with silence. Exact frame count/sample rate are verified.
Up to twelve source-based renders adjust post-compressor/pre-limiter makeup within −12…+18 dB towards the preset target. This compensates compressor loss without raising the output peak ceiling. Engine v3 has separate cache keys; v1 masters remain untouched.
A latency-compensated, 4× oversampled FFmpeg safety limiter catches residual peaks before measurement, so high targets do not lose whole-file loudness to isolated overshoots. A final constant attenuation is applied if required by measured true peak.
No loop crossfade is imposed; existing source discontinuities are not repaired.

Authenticated `POST /mygrain-wavs/api/mastering` accepts filename, preset, loop.
`GET /mygrain-wavs/api/mastering/<jobId>` polls owner-scoped status. Source is
snapshotted under the account lock, DSP runs outside it, publication reacquires
it. The queue permits two active workers/four jobs, one per account. Job status
is held in memory for up to one hour (server restart loses polling state).
Closing the dialog does not cancel server work. Output is a separate private
PCM24 stereo WAV; original WAV, associated editable ZIP, Song parts, revisions
and server render cache are not modified. A mastered WAV deliberately does not
claim its editable patch includes the offline mastering stage.

Results are content/settings/engine-addressed and reused only if the saved WAV
still matches its recorded SHA256. Hidden `.mastering-cache` metadata stays
inside the account WAV root. In-app A/B players attenuate the louder version to
match listening loudness; this volume adjustment is not written into the WAV.

## Song compatibility

Mastering is a post-export stage, not a per-part Song-render DSP change. The
existing isolated deck, server arm worker, part manifests/render versions and
legacy compatibility remain unchanged. Export the complete Song to WAV Folder,
then master that single arrangement. Do not independently normalize every part
unless changing relative section loudness is intentional. Current and legacy
snapshots still use the existing server renderer; no phone mastering DSP or
additional whole-Song decoded allocation is introduced.

## Deployment

Ubuntu packages: `lsp-plugins-lv2` (1.2.14), FFmpeg (existing); `lilv-utils` is
useful for inspection. No JACK server, desktop audio session or external mastering
service is needed. `backend/mygrain_mastering.py` is loaded by the documenter
server; deployment hook is recorded in `deploy/mastering-host-integration.patch`.
Apply this zero-context hook with `git apply --unidiff-zero` at the workspace
root if deploying to another copy. The public static allowlist includes `mastering.js`. UI build marker is
`Mastering · LSP + FFmpeg · v4`.

Checks: `python3 tests/test_mastering.py` (requires NumPy for fixtures),
`node tests/mastering-browser.cjs` against the isolated Song test server on
18959 with test passwords `MYGRAIN_TEST_ADMIN_PASSWORD=isolated-render-refresh-fixture` and
`MYGRAIN_TEST_DAN_PASSWORD=isolated-mastering-dan` in a fresh isolated test store. The existing
`tests/song-server-refresh-browser.cjs` exercises current/legacy real server
jobs, warm reuse and phone playback. Browser checks emulate phones; physical
hardware listening remains a user audition.

Targets are selectable from −24 to −6 LUFS (`targetLufs` in the API), independent of preset style. Omitted targets retain legacy preset defaults. Cache identity includes target. Level only remains peak-limited without compression and may not reach high targets. Preview volume compensation is off by default; a dialog-owned Web Audio gain stage updates immediately during playback, including platforms without writable media volume. Preview gain is never written into saved WAVs.


## G Reels and master library (MASTER.4)

G's completed preview and each saved INSTAREEL row expose **Master Reel**.
The same server worker snapshots the completed job or hash-verified saved reel
using `reelJobId` or `reelId` (mutually exclusive with `filename`). Source
resolution checks owner and readiness; there are no client-supplied filesystem
paths. Reels remain server-offloaded and their original audio and editable
source archives are never changed. This is post-render mastering, not a Song
renderer compatibility change: existing/current Song and reel DSP is unchanged.

The WAV browser has **WAVs** (original/main list) and **Masters**, with **Reels**
and **Waves** subsections. Every master keeps normal preview/download, artwork,
rename/delete, private notes and sharing controls. Master notes are never copied
with audio and recipient master notes are not published to the sender. Shared
master copies preserve category/settings only, not source notes or source names.
Normal WAV recipient-feedback behavior remains unchanged.

New master filenames contain only `master`, processing preset and target,
for example `master-dense-minus6LUFS.wav`. A numeric suffix avoids overwriting
another source with the same settings. Repeated identical content/settings reuse
the saved result. Category is part of the cache identity, so identical source
PCM mastered as a reel and a WAV cannot be misfiled by cache reuse.
Account-local `.mastering-library/` records bind metadata to the saved file
signature. Rename/share/delete and external-replacement checks retain or discard
metadata appropriately. Verified historical cache outputs are adopted as Waves;
their audio/notes/stable storage names stay unchanged, but browser titles and
downloads use short, timestamp-free master labels. Counterfeit/changed files
are not adopted. Hidden library/cache metadata is not publicly served.

Checks: `tests/mastering-browser.cjs` covers main-list exclusion, Waves/Reels
navigation, private comment save/reload, shared copies and two-way master-note
privacy. `INSTAREEL_MASTER_TEST=1` adds completed-job and saved-reel mastering
through real server audio to `tests/instareel-browser.cjs` (use its isolated
server URL/password environment options). The host hooks in
`deploy/mastering-host-integration.patch` include library decoration and metadata
lifecycle in addition to worker dispatch; apply only to the documented baseline.

## MASTER.5 iPhone playback and library freshness

The iPhone/iPad comparison uses `createWavIphonePreview` with the authenticated
original WAV URL, a dialog-owned AudioContext and one gain per side. It does not
use the lossy AAC listening copies used for ordinary library auditions. Trusted
Load & Play clicks resume the context before download/decode. A/B retains both
decoded buffers, pauses the opposite side, and supports seek/retry; Close and
account lock abort pending requests, invalidate decode completions, release PCM
and close the comparison context. Desktop native playback is unchanged.

Master completion refreshes the library, and tapping Masters refreshes again.
Masters has its own favourites-view state; crossing sections clears source-text
searches so a main-list filter cannot silently hide the newly saved master.
Comments/category/storage and server Song/reel rendering are unchanged.

`tests/mastering-iphone-browser.cjs` runs against the isolated test server on
18959 with the same fixture passwords as `mastering-browser.cjs`. It sets an
actual iPhone UA (viewport alone does not enter the iOS player branch), starts
the engine with a trusted tap and exercises real 24-bit WAVs, PCM analyser
output, live compensation gains, A/B reuse, HTTP failure/retry, seek, close
cleanup, stale list and inherited-filter regressions in Chromium and WebKit at
390x844 and 844x390. `MYGRAIN_IPHONE_TEST_WAV` optionally uses a local failing
source WAV in the disposable account. These are automated browser checks, not
physical iPhone verification.

## LIVE.1 — adjustable preview and shared-engine render

**Master** and **Master Reel** now open Live mastering. **Previous mastering**
retains the existing LSP/FFmpeg target-LUFS workflow without modifying old audio.
This is still a post-export operation: Song/reel source snapshots, per-part DSP,
server Song preparation/render compatibility and arrangement revisions are not
changed. Whole exported Songs are processed as one WAV, never part-normalized.

`mastering-dsp.js` is the authoritative deterministic stereo engine. It runs in
`mastering-worklet.js` on the audition device and in Node via
`backend/mastering-render.cjs` on the server. Both run at 48 kHz. Browser decode
and FFmpeg may use different source-rate conversion; bit identity is established
for **identical input PCM**, not claimed for their different resamplers. Export
is stereo PCM24/48 kHz. Five milliseconds of lookahead is compensated on export;
bypass uses the same delay as wet playback. Loop export warms whole cycles for
at least two seconds; live loops settle as they play. Finite WAVs flush the tail.

Controls: drive −24…+24 dB, adjustable two-stage sub/DC cut 0…60 Hz
(0 bypasses; Clean defaults 20 Hz, Punch/Dense 25 Hz), low-band compression amount (120 Hz split), broadband
compression amount (high-pass detector), sample ceiling −6…−1 dBFS. Stereo-linked
limiting has a 5 ms delay and 100 ms release. Clean/Punch/Dense/Level presets
initialize these same five controls; they do **not** run reference matching or
iterate towards a LUFS goal. Level only skips the two compressors but retains
the safety limiter. The sample ceiling is **not** an oversampled true-peak limit.
The worker measures achieved LUFS and true peak and reports both without hidden
post-render attenuation (which would make the rendered sound unlike preview).

Phone preview fetches one authenticated WAV with a streamed 64 MB encoded cap,
validates WAV metadata before decoding, rejects over 180 seconds, and requires
`48k stereo-float bytes + 2 * encoded bytes <= 96 MiB`. There is no second decoded
master buffer and no whole-file DSP render on the phone. The independent preview
stops page performance transport, owns its context/source/worklet and releases
all of them on close/account switch/lock. Load failure is retryable. Same-position
bypass crossfades quickly. Approximate RMS matching attenuates processed audition
only, settles while playing, and is off by default. It is not LUFS matching and
neither it nor bypass changes export. Long WAVs can use Previous mastering.

The existing authenticated mastering job API additionally accepts
`engine: "live-master-2"`, all thirteen `liveSettings`, and `sourceSha256` computed
from the preview WAV. Server re-resolves the owned WAV/reel, snapshots and hashes
it under the account lock, and rejects a changed source before queuing DSP.
Existing queue/concurrency/ownership rules still apply. Cache identity includes
source bytes, engine, kind, preset, loop and the exact settings; legacy engine
cache identities remain unchanged. Saved names are `master-live-{preset}.wav`
with collision-safe numeric suffixes. Private master metadata retains the
engine/settings; sharing copies settings/category but never private source names
or notes. Render settings are snapshotted at click; later edits visibly require
a new render. A worker continues if its dialog closes.

Verification:
- `node tests/mastering-live-dsp.cjs`: actual worklet process vs Node renderer,
  identical PCM, all six presets bit-identical, finite/nonzero output, ceiling,
  impulse delay, silence and live reconfiguration.
- `python3 tests/test_mastering.py`: legacy regressions plus live settings
  validation, 44.1→48k mono/stereo conversion, exact frames, loop/finite paths,
  original preservation and metadata/share privacy.
- `node tests/mastering-live-browser.cjs`: isolated server, Chromium/WebKit with
  iPhone UA, trusted taps and real AudioWorklet/nonzero native analyser output,
  controls, seek/bypass/matching, retry, real server save, source/hash/settings
  guards, portrait/landscape containment and account cleanup. Optional
  `MYGRAIN_LIVE_TEST_WAV` selects a local diagnostic source in disposable storage.
- Existing mastering browser tests explicitly select Previous mastering.

Static entrypoint marker: `v2026.10.31.LIVE.3`; live dialog: `Live mastering · LIVE.3`.
The public asset allowlist includes the three live JS assets. Node is required
on the server; there are no additional plugin licences or external audio uploads.
Physical iPhone performance/listening remains a device audition, not an emulation
claim.

## LIVE.2 — extended mastering

Input Drive now spans −24 to +36 dB. Independent post-dynamics Limiter drive
adds 0–24 dB, with Loud and Hot presets. Three complementary bands (180 Hz and
3.5 kHz) provide ±12 dB EQ and independent stereo-linked compression amounts.
High-band parallel tanh excitation adds harmonics before the limiter. Controls
are smoothed; meters show each band's reduction. Neutral new controls preserve
the previous chain. This is a lightweight fixed-crossover processor, not a
linear-phase crossover or oversampled exciter. Ceiling spans −6 to −0.3 dBFS
and remains sample-peak, with measured true peak reported after rendering.

Server validation, cache engine identity and metadata use live-master-2. Old
live-master-1 metadata remains readable/shareable without altering audio. New
presets are accepted only by the new live engine; legacy target mastering is
unchanged. The same server worker applies this chain to saved complete Song
WAVs (finite, tail-flushed and delay-compensated) and loop WAVs (warmed/cropped).
Song arrangement synthesis/freeze DSP is intentionally unchanged: mastering is
a separate saved-WAV post-process, not an edit to the arrangement engine.

Additional checks cover EQ frequency response, each compression band, excitation
harmonics, post-dynamics loudness, maximum settings, old metadata, and Hot preset
server saves in Chromium/WebKit. Device audition remains unverified.

## LIVE.3 — track names and original replacement

Master copies now include the original track stem in their actual filename and
visible label, for live and legacy mastering, including saved Songs/Reels. Cache
identity includes the source name and copy/replace destination so differently
named equal audio cannot reuse another track's filename. Existing masters stay
untouched. DSP/version remains live-master-2; this release changes storage/UI only.

Saved WAV mastering offers Replace original WAV → Yes, replace / Cancel. A
confirmed job renders in temporary storage and, under the owner lock, compares
the original's SHA-256 again before atomically replacing its same filename. A
private hidden `.mastering-recovery/<random-id>/` retains the previous WAV and
mastering metadata. Editable patch attachments are intentionally unchanged. The
replacement creates neither a new WAV nor a Masters metadata/cache entry; old
master metadata is removed if the source itself was a master. Share provenance
is refreshed for the changed source; existing recipient file bytes stay intact.
Reel library audio is immutable and does not expose replacement. After replacing,
the panel releases the old audition buffer and requires Load & Play to load the
updated WAV. Tests cover cancel, exact replacement, recovery, concurrent source
change rejection, no new library file and no Masters classification.

## LIVE.4 — inline control help

Each of the thirteen mastering sliders has an always-visible, screen-reader-linked
note explaining its audible role and the meaning of positive/negative dB, Hz,
percentage and zero/off values as applicable. Positive gain values show a + sign.
Notes distinguish bass compression from bass boost, limiter drive from input
drive, and a less-negative sample ceiling from a loudness target. DSP and saved
settings are unchanged.

## LIVE.5 — output loudness metering

The preview worklet meters processed stereo output before audition-only bypass
and RMS compensation. K-weighting uses the ITU-R BS.1770 48 kHz coefficients;
rectangular rolling windows provide momentary (400 ms) and short-term (3 s) LUFS.
The bounded 3 s energy ring uses 1.15 MB, independent of track duration. Readings
are blank until their window fills and for silence; a fresh worklet on play/seek
resets the meter. This is not a gated integrated live meter. The saved server
report continues to provide full-track integrated LUFS. No audio, DSP engine
version, server settings or render-cache identity changes.

References: [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770),
[EBU loudness metering windows](https://tech.ebu.ch/loudness).
`node tests/mastering-loudness.cjs` compares actual worklet output readings with
FFmpeg ebur128 on 50 Hz, 1 kHz and 8 kHz asymmetric stereo fixtures (within
0.15 LU), plus startup/silence. Existing worklet/server PCM parity still passes.

## LIVE.6 — optional target loudness maximiser

The shared live-master-3 engine adds `maximiser` (0/off, 1/on) and `targetLufs`
(−24 to −6). All presets leave it off, target initially −10. It applies smoothed
gain after EQ/manual limiter drive and before the existing sample-peak limiter.
A 400 ms K-weighted input measurement supplies the initial gain estimate; slow
400 ms output feedback then adjusts it toward the chosen target. Automatic gain
is bounded to ±24 dB. Input below −60 LUFS does not drive increases; gain rises
pause when limiter reduction exceeds 12 dB. That is an upward-drive restraint,
not a strict 12 dB reduction cap or a guarantee of distortion-free sound.

The target follows recent loudness, NOT exact gated full-track integrated LUFS.
Changing music, startup/seek settling, manual processing, ceiling and gain limits
can produce a different saved integrated reading. No export-only loudness pass or
normalisation is added: actual worklet and server renderer execute identical DSP.
Finite WAVs retain startup and flushed-tail handling; loop exports warm at least
12 seconds with the maximiser enabled (2 seconds otherwise). Phone memory
admission now includes a 4 MiB fixed meter/servo reservation.

Saved metadata/cache uses live-master-3 and all fifteen canonical controls.
Previously saved v1/v2 masters remain recognised without rewriting audio.
Replacement and track-named output paths are unchanged. Saved complete Song WAVs
use this same standalone post-process; arrangement synthesis/freeze is unchanged.

Verification includes enabled actual-worklet/server bit-identical PCM, steady
target convergence at −14/−10/−6 within 0.15 LU after 12 seconds, silence/on-off
validation, peak safety at maximum controls, preserved v1/v2 metadata, enabled
Hot preset server save and original replacement in Chromium/WebKit phone contexts.
Device listening remains unverified.

## LIVE.7 — mastering console UI

The lazy-mounted dialog is a two-frame console: a pinned monitor/transport header
and an independently scrolling adjustment body. Title, preset, play/pause/stop,
seek, bypass, RMS audition matching and loop remain accessible while scrolling.
Boxed Input, EQ, Dynamics, Harmonics, Loudness/output, destination, status and help
sections retain all settings and the named-copy/confirmed-replace operations.
The maximiser is a labelled checkbox switch, still serialized as numeric 0/1.

Six output meter bars display LUFS M/S, unweighted RMS, sample peak, combined gain
reduction and signed maximiser gain. Stereo VU uses 300 ms RMS ballistics with
0 VU = −18 dBFS calibration; needles are DOM/SVG, not an analyser/canvas loop.
Peak hold can be reset. Bass and each band's reduction remain visible. All
measured levels describe the processed signal before audition bypass/matching;
peak is now consistent with RMS/LUFS rather than following the dry audition.
Export DSP, server/cache version, settings and audio are unchanged.

One display-only 125 ms timer exists only during visible playback; numeric labels
refresh at most twice per second. Intersection/viewport checks, document visibility
and scrolling gate optional worklet telemetry/VU sampling and DOM painting. The
audio-essential LUFS measurement used by the maximiser continues independently;
resuming meters does not reset it. Close/account changes disconnect observers,
remove listeners, cancel timers and release the owned context. No perpetual RAF
loop, hidden polling or CSS meter animations remain.

`tests/mastering-console-browser.cjs` verifies 320/390/844/1024 layouts, pinned
transport, switch and needle/bar presence, real native audio, zero paints/messages/
display clock while scrolling/offscreen/synthetically hidden, continued audio time,
resumption, stop, close and reopen in Chromium/WebKit iPhone contexts. Set
`MYGRAIN_CONSOLE_ASSET_URL` for the same fixture against deployed HTTPS assets;
it is not an authenticated production transaction or a physical phone test.
The authenticated mastering browser suite still covers real saves, cache/privacy
and replacement. Meter tests cover stereo VU calibration and bit-identical audio
with telemetry disabled; worklet/server parity and FFmpeg LUFS checks still pass.

## LIVE.8 — optional floating VU

VU meters are removed from the pinned header grid. A VU meters button lazily
creates a floating stereo graphic in the modal top layer; its drag handle uses
pointer capture, and Minimise returns it to the button without changing audio.
The floating frame is viewport-constrained on drag/open/resize. Minimized VUs
receive no needle paints and their worklet-only ballistics sampling is disabled;
the other console meters continue. Closing the console removes the frame and
resize listener. The numeric/bar meters use three columns on phones (two rows),
six on larger desktop screens, preserving more adjustment space. The redundant
“Meters:” explanation is removed; peak hold and band reductions remain.
DSP, renders, settings, save/replace and gain calibration are unchanged.
Browser tests cover lazy opening, minimise/reopen, drag, unchanged header height
and viewport containment at 320/390/844/1024 in Chromium and WebKit, alongside the
existing audio/display gating checks. Unit tests verify independent VU sampling
suspension without stopping the remaining meter telemetry.

## Same-track replacement identity (2026-10-31)

Replacing an original now retains its filename and original nanosecond mtime,
keeping its position in the repository's modification-time sort. The WAV bytes
are atomically swapped, with the private recovery original still retained.

`Accounts.wav_content_replaced` updates only the existing provenance signature
(never its creator) and refreshes the artwork binding against the pre-replacement
signature. It does not delete/recreate the track, invalidate notes or alter share
records. Artwork image/thumbnail bytes and version URLs remain identical. Stale
artwork belonging to an unrelated file is not adopted. Comments, timestamped
notes and filename-keyed favourite hearts are untouched. Editable pattern ZIP bytes remain untouched. A validated same-track replacement
refreshes their WAV binding, retaining Restore Patch for the original source
settings/sounds before mastering; it does not claim those settings reproduce
the mastered DSP. Pattern signature and SHA-256 checks still apply.

A signature-bound `kind: replacement` record supplies a small `(mastered)` badge.
It is deliberately not returned by the Masters classification helper, does not
rename the WAV and follows existing metadata rename/delete/copy lifecycle hooks.
File-list reuse considers the badge field so same-size neutral renders still
refresh their row. Preview worklet/source invalidation and source-hash checks
remain unchanged. WAV delivery is `no-store`; phone preview caches already use
inode/ctime as well as mtime, so preserving list order does not reuse old PCM.

Deployment requires the `wav_art_replaced` and `wav_pattern_replaced` callbacks in the documenter account
configuration; see `deploy/mastering-host-integration.patch`, then restart
`fs7300-documenter.service` to reload Python modules.

Verified with disposable authenticated fixtures in phone Chromium and WebKit:
confirmed Replace/Cancel, original filename, changed audio hash, exact ordered
file-list equality, unchanged feedback (including timestamped notes), same art
metadata and image/thumbnail bytes, unchanged hearts and share records, unchanged
attribution, visible badge/thumbnail, no extra Masters entry, and fresh audition.
No production WAVs were modified in testing.

Checks: `python3 -m unittest tests.test_mastering` (7),
`python3 -m unittest tests.test_mastering_replacement` (2), focused artwork HTTP
lifecycle/limits tests (2), inline script parse, and
`node tests/mastering-live-browser.cjs` (both engines). An initial broader HTTP
suite hit an intermittent BrokenPipe while sending an oversized rejected art
upload; the pre-change handler and focused current lifecycle/limit checks passed.
Physical iPhone verification is still separate from browser emulation.


### Preserve Restore Patch (2026-10-31 follow-up)

`mygrain_wav_patterns.rebind_after_replace` checks the old WAV signature, the
unchanged patch-file signature and the archive SHA-256 before updating only the
WAV association. Unknown/unrelated uploads and corrupt archives remain rejected.
The source patch remains byte-identical, and the Restore Patch tooltip explicitly
identifies it as the source before mastering. The account replacement callback
preserves artwork and patch links under the same account lock.

Verification adds repeated replacements and corrupt/unrelated patch rejection to
`tests/test_mastering_replacement.py`, plus an actual paired WAV upload, mastering
replacement, byte-identical ZIP download and visible Restore Patch import in the
phone Chromium/WebKit live-mastering browser suite. The import restores the
original tempo after a deliberate tempo change; preview can reopen afterwards.

Owner-requested repair: `Laying-in-the-grass-under-the-stars.84.wav` had intact
artwork and patch ZIP sidecars but their WAV signatures still referenced the
pre-master original. Its private mastering recovery original matched both stale
bindings by original size/mtime, filename and verified recovery SHA-256. The
repair validates the saved patch and hashes, backs up current mastered WAV and
metadata, then rebinds only those attachments, restores the original list mtime
and refreshes provenance/the mastered badge. No audio, image, thumbnail, ZIP,
notes, hearts or share records are rewritten. Repair receipt remains private in
that account's `.mastering-recovery/repair-patch-art-*` directory.
