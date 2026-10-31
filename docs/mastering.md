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
