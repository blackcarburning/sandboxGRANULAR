# NVIDIA loop preparation

The optional RTX 3070 backend accelerates the **existing server-side pitch-preserving
phase vocoder** used to tempo-conform V vocal, P piano and O orchestral loop sources
whose filenames contain a BPM. It does not move Safari scrolling, live instruments,
V's in-browser Loop Cut WSOLA or the entire Song Web Audio graph onto the GPU.

## Full-pipeline update

FFT and reconstruction now also run on NVIDIA, with bounded preparation caching
and warm Song browser workers. See [backend-speedups.md](backend-speedups.md)
for the current implementation, measurements and reproduction steps. The
phase-only implementation and measurements below describe the initial version.

## Initial implementation and lifecycle

- `backend/mygrain_gpu_phase.py`: float64 phase accumulation on CUDA, complex64
  spectra. Existing SciPy FFT, Hann windows, frame placement, ISTFT, source selection,
  trimming, normalisation and WAV encoding remain unchanged.
- A private inherited socket (no public port) exchanges bounded numeric buffers.
  There is no pickle or user-authored code execution.
- One worker and nonqueued GPU operation at a time; a cross-process file lease also
  protects against concurrent isolated servers. Busy work falls back to CPU.
- GPU spectral input plus output is capped at 192 MiB; CuPy pool at 384 MiB;
  accepted input PCM at 32 MiB. Mono/stereo only; rates 0.25–4; short/unsupported
  work remains CPU. Request timeout 30 seconds; error retry backoff 60 seconds.
- Cold compilation/initialisation is **not added to the requesting user's wait**:
  the first cold request uses the original CPU implementation while a background
  warm-up prepares CUDA. Server startup also warms it. After 60 seconds unused the
  worker exits, releasing its CUDA context and VRAM. No permanent GPU idle loop.
- Missing dependencies, disabled CUDA, device errors, malformed/nonfinite output,
  worker exits and oversized work retain the original CPU reference path.
- `MYGRAIN_GPU=off` disables GPU dispatch. `MYGRAIN_GPU_PYTHON` overrides the
  isolated worker interpreter, default `.venv-gpu/bin/python`.

## Deployment

Keep CUDA dependencies isolated from the documenter's system NumPy/SciPy:

```sh
python3 -m venv .venv-gpu
.venv-gpu/bin/pip install -r backend/requirements-gpu.txt
python3 scripts/install-gpu-loop-hook.py
```

The installer modifies only the existing stretch function's name and adds the
optional wrapper in sibling `fs7300-documenter/server.py`. It is idempotent and
checks source anchors before writing. The exact wrapper is versioned as
`backend/gpu-documenter-hook.txt`; the external server is not vendored here.
Restart `fs7300-documenter.service` to load a changed backend/hook. No browser
reload/build change is needed for server generation.

## Measured 2026-10-29

RTX 3070 / driver 595.99.02. Real vocal-source PCM, stereo 48 kHz, rate 0.83;
median of three warm runs, including host transfers, IPC, FFT and reconstruction:

| Input | CPU | CUDA path | Speedup | PCM comparison SNR |
|---|---:|---:|---:|---:|
| 2 seconds | 69.8 ms | 23.1 ms | 3.02× | 119.5 dB |
| 8 seconds | 275.8 ms | 103.9 ms | 2.65× | 113.8 dB |
| 30 seconds | 893.3 ms | 410.0 ms | 2.18× | 104.7 dB |

Actual seeded **V generation**: 32 steps, eighth-note cuts, 120→97 BPM source,
including cached-source fetch, WAV decode, source preparation, all cuts,
normalisation and WAV encoding: **3.849 seconds CPU → 1.478 seconds CUDA**,
**2.60× faster**. Same source selection/frame count; final 16-bit WAV differs by
at most **one quantisation level**, comparison SNR 94.1 dB. Original source SHA-256
unchanged. Network/cold-cache time is additional and is not accelerated. Cold
worker startup measured approximately 0.9 seconds, handled asynchronously as above.

Evidence is local/ignored under `output/gpu-20261029/`. Reproduce:

```sh
MYGRAIN_TEST_CUDA=1 python3 -m unittest discover -s tests -p test_gpu_phase.py -v
python3 scripts/benchmark-gpu-loops.py
python3 -m unittest discover -s tests -p test_loop_browser.py
```

Benchmark uses an existing local mirrored vocal sample read-only, a temporary
isolated account/output store, and no production account/source changes.

## Song compatibility

`song-beta.js`, `song-beta-clock.js`, isolated render decks and
`scripts/server-arm-worker.cjs` consume already prepared source PCM. They do not
invoke this tempo-conforming server function during existing-part rendering.
No source ZIP, source hash, saved revision, render compatibility marker or existing
freeze is rewritten/invalidated. Newly generated loop PCM is saved and rendered
through the same source-asset path as before. The GPU implementation is numerical
(not bit-identical) equivalence; it adds no different effect or stretch algorithm.
