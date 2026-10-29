# Backend acceleration — 2026-10-29

Three independent changes; no live-editor DSP, browser build marker, saved
source ZIP, revision or render-compatibility version changes.

## Content-addressed source preparation

`backend/mygrain_source_cache.py` and `scripts/install-source-cache-hook.py` add
a shared, locked, single-flight LRU to the two server V/P/O/other loop-generation
branches (cut and uncut). The decoded/resampled stereo PCM and BPM-conformed PCM
are separately cached. Repeated cuts no longer decode/stretch the same file.
Decoded PCM can also be reused when the destination BPM changes.

- 192 MiB total retained PCM; 120-second absolute TTL, purged on subsequent access;
  LRU eviction under pressure. Oversized entries are computed but not retained.
- Immutable owned arrays; per-job random cuts, panning, envelopes and normalisation
  work on copies. Cached metadata is copied. No generated output is cached.
- Every access **still fetches through the original account/path checks** and hashes
  the current bytes. Cache identity includes resolved account scope, user, source
  key/path, content SHA-256, target sample rate and (for conforming) target BPM.
  File replacement, FTP changes, permission rejection and account changes cannot
  silently return a stale or different account's cached audio.
- File/network fetch is deliberately not bypassed: this is a preparation cache,
  not an unvalidated remote-file cache. `MYGRAIN_SOURCE_CACHE=off` bypasses it.

Install into the supported sibling host and restart:

```sh
python3 scripts/install-source-cache-hook.py
```

The installer checks both exact preparation blocks before writing, compiles the
result and is idempotent. Keep this in addition to the existing GPU-hook installer.

## Warm Song browser, fresh audio/account context

The one-thread, four-pending-job server-arm queue is unchanged. Python keeps a
private stdin/stdout JSON-lines worker rather than launching Chromium for each
part. `server-arm-worker.cjs --persistent` reuses **only the Chromium process**;
every job creates and closes a new browser context/page, restoring the current
app/audio graph and the supplied account credentials from scratch. It intentionally
does not keep an account page, source buffers, cookies or audio graph alive.

The Python transport waits for an explicit idle/zero-context acknowledgement
before accepting success. A context leak, worker failure, stale hash, bad output
or timeout discards the entire worker process group. Subsequent jobs can retry
with a new process. Stage messages now update queue status as they arrive.

Chromium recycles after eight jobs, the worker exits after 60 seconds idle, and
Python retires it before reuse at 55 seconds to avoid an idle-exit race. Existing
512 MiB preparation and 1536 MiB JS heap budgets, 120–600 second timeout, one-job
concurrency, off-origin rejection and exact render-upload-only write allowlist
remain. These are not a total Chromium RSS limit. One-shot stdin mode remains
available. Credentials never enter argv, status, evidence files or public output.

## Full CUDA stretch

`backend/mygrain_gpu_phase.py` now transfers PCM once per request and performs
STFT/cuFFT, phase propagation, inverse FFT, deterministic overlap-add and Hann
normalisation on GPU. A custom overlap-add kernel avoids the per-frame Python
launch loop in generic GPU ISTFT. Each output sample accumulates frames in order,
without floating-point atomics. Window, framing, scales, boundary trimming and
padding match the original SciPy path. Reconstruction and transfer are included
in timings; this is not just kernel timing.

The previous phase-only interface remains for warm-up and regression checks.
The original CPU path handles disabled, cold, busy, failed, short, unsupported
and oversized work. Existing private IPC, one cross-process GPU lease, 30-second
request timeout, 60-second retry/idle release and 32 MiB PCM input limit remain.
FFT/spectral/inverse-frame estimates are checked against 192 MiB before dispatch;
output is separately bounded. Startup warm-up compiles FFT/reconstruction in the
background as well as the phase kernel. CuPy pool is 384 MiB, FFT plan cache 32 MiB. These
limits do not include the CUDA context/driver. No phone WebGPU/CUDA dependency.

## Measurements

RTX 3070, stereo 48 kHz, real mirrored vocal PCM at rate 0.83. Three warm runs;
median, no preparation cache for the CPU/GPU comparisons:

| Work | CPU | Full GPU | CPU/GPU speedup |
|---|---:|---:|---:|
| 2-second stretch | 60.7 ms | 6.1 ms | 9.9× |
| 8-second stretch | 235.3 ms | 24.6 ms | 9.6× |
| 30-second stretch | 972.1 ms | 78.3 ms | 12.4× |
| Seeded V generation, 32 steps/eighth-note cuts | 3.916 s | 0.586 s | 6.68× |

With preparation caching enabled, the same V-generation request took 0.073 s
on the first request (its later cuts reuse the first prepared source) and
0.038–0.039 s on subsequent requests. This fixture repeatedly uses **one source
file at one BPM**; new sources/BPMs and network access have additional costs.
The cache retained 6.0 MiB for that fixture, within its 192 MiB bound.

Compared with CPU: 104.7–119.4 dB floating-PCM SNR in the stretch tests; actual
V output differs by at most one PCM16 quantisation level (94.1 dB SNR). Source
hash, source selection and frame counts are unchanged. Timing depends on source,
load, cold start and cache state; the GPU stretch ratio is not a whole-Song ratio.

## Verification / reproduction

```sh
MYGRAIN_TEST_CUDA=1 python3 -m unittest discover -s tests -p test_gpu_phase.py -v
MYGRAIN_GPU=off PYTHONPATH=tests python3 -m unittest test_source_cache test_song_server_arm test_warm_renderer_transport test_loop_browser -v
node --test tests/song-server-arm.test.js tests/song-beta-account-render.test.js
python3 scripts/benchmark-gpu-loops.py
```

`tests/warm-song-render-browser.cjs` uses an explicitly isolated localhost test
server, temporary account store, synthetic PCM and test credentials supplied in
its environment. It creates current/wet-FX and older pre-W snapshots, executes
real backend render jobs, proves process reuse plus zero-context cleanup, rejects
an invalid-login job and verifies fresh-worker recovery. It also arms/plays the
finished parts on Chromium and WebKit phone viewports without downloading source
ZIPs, checks source hashes/revision unchanged and zero reserved preparation memory.
Portrait 390×844, 320×640 and landscape 844×390 layout checks are included.
Wet-effects real jobs measured 6.644 s cold and 5.614 s warm overall;
process/context setup before page navigation was 0.699 s cold versus
0.085 s warm. These are individual jobs, not a median whole-Song
speedup: contexts and the app/audio engine are intentionally still rebuilt.
No production account/source edits or physical-iPhone test are involved.

Local, ignored evidence: `output/backend-speedups-20261029/`. The fixture and
benchmark themselves are versioned; evidence includes only test metadata/audio
metrics, never session cookies.
