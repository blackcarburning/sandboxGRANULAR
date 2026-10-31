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

Static entrypoint marker: `v2026.10.31.LIVE.2`; live dialog: `Live mastering · LIVE.2`.
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
