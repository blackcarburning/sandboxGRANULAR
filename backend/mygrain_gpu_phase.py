"""Optional bounded CUDA phase-vocoder worker; no browser/live audio dependency.

FFT analysis, phase propagation and reconstruction run on CUDA. The original
SciPy path remains the fallback and numerical reference. A private socket carries bounded float32 PCM/spectra,
not serialized Python objects. Busy/unavailable/failed GPU requests use CPU.
"""
import atexit
import json
import math
import os
import pathlib
import socket
import struct
import subprocess
import threading
import time
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAX_BYTES = 192 * 1024 * 1024
_lock = threading.Lock()
_process = None
_socket = None
_retry_at = 0.0
_stats = {'gpuJobs': 0, 'fallbacks': 0, 'lastError': '', 'lastMilliseconds': 0}


def _read(sock, size):
    chunks = bytearray(size)
    view = memoryview(chunks)
    while view:
        count = sock.recv_into(view)
        if not count:
            raise EOFError('GPU worker closed')
        view = view[count:]
    return chunks


def _send(sock, header, payload=b''):
    body = json.dumps(header).encode()
    sock.sendall(struct.pack('!I', len(body)) + body + payload)


def _receive(sock):
    size, = struct.unpack('!I', _read(sock, 4))
    if size > 4096:
        raise ValueError('GPU header limit')
    header = json.loads(_read(sock, size))
    size = int(header.get('bytes', 0))
    if size < 0 or size > MAX_BYTES:
        raise ValueError('GPU payload limit')
    return header, _read(sock, size)


def close():
    global _socket, _process
    if _socket:
        _socket.close()
    _socket = None
    if _process and _process.poll() is None:
        _process.terminate()
        try:
            _process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            _process.kill()
            _process.wait()
    _process = None


atexit.register(close)


def diagnostics():
    return dict(_stats, running=bool(_process and _process.poll() is None))


def phase(matrix, rate, hop, n_fft, _allow_start=False):
    """Return complex64 transformed spectrum, or None to retain original CPU DSP."""
    global _process, _socket, _retry_at
    if os.environ.get('MYGRAIN_GPU', 'auto').lower() in ('0', 'off', 'false'):
        return None
    bins, frames = matrix.shape
    outputs = len(np.arange(0, frames - 1, rate, dtype=np.float64))
    # Small work is faster on CPU; reject extreme expansion before GPU allocation.
    if frames < 96 or outputs < 2 or (matrix.size + bins * outputs) * 8 > MAX_BYTES:
        return None
    if not _allow_start and (_process is None or _process.poll() is not None):
        warm()
        return None
    if time.monotonic() < _retry_at or not _lock.acquire(blocking=False):
        return None
    started = time.perf_counter()
    try:
        if _process is None or _process.poll() is not None:
            close()
            executable = os.environ.get('MYGRAIN_GPU_PYTHON', str(ROOT / '.venv-gpu/bin/python'))
            parent, child = socket.socketpair()
            try:
                _process = subprocess.Popen([executable, str(pathlib.Path(__file__).resolve()), '--worker', str(child.fileno())], pass_fds=[child.fileno()], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                parent.close()
                raise
            finally:
                child.close()
            _socket = parent
            _socket.settimeout(30)
        payload = np.ascontiguousarray(matrix, dtype=np.complex64).tobytes()
        _send(_socket, {'bytes': len(payload), 'bins': bins, 'frames': frames, 'outputs': outputs, 'rate': rate, 'hop': hop, 'nfft': n_fft}, payload)
        header, body = _receive(_socket)
        if header.get('error'):
            raise RuntimeError(header['error'])
        if len(body) != bins * outputs * 8:
            raise ValueError('GPU result shape')
        result = np.frombuffer(body, dtype=np.complex64).reshape(bins, outputs).copy()
        if not np.isfinite(result).all():
            raise ValueError('Non-finite GPU output')
        _stats['gpuJobs'] += 1
        _stats['lastMilliseconds'] = round((time.perf_counter() - started) * 1000, 3)
        _stats['lastError'] = ''
        return result
    except Exception as error:
        _stats['fallbacks'] += 1
        _stats['lastError'] = type(error).__name__ + ': ' + str(error)[:160]
        close()
        _retry_at = time.monotonic() + 60
        return None
    finally:
        _lock.release()


def warm():
    """Cold start never delays an audio request; CPU handles that first request."""
    if time.monotonic() < _retry_at or _lock.locked():
        return
    def run():
        ready = phase(np.zeros((1025, 96), dtype=np.complex64), .9, 512, 2048, _allow_start=True)
        if ready is not None:
            # Compile FFT/reconstruction too, outside the first user's request.
            stretch(np.zeros((48000, 1), dtype=np.float32), .9, lambda x, rate: x)
    threading.Thread(target=run, name='mygrain-cuda-warm', daemon=True).start()


def stretch(samples, rate, cpu):
    """Full bounded CUDA vocoder, retaining original CPU DSP on every fallback."""
    global _retry_at
    rate = float(rate)
    if (samples.ndim != 2 or samples.shape[0] < 48000 or samples.shape[1] not in (1, 2)
            or not math.isfinite(rate) or rate < .25 or rate > 4 or abs(rate - 1) < 1e-4
            or samples.nbytes > 32 * 1024 * 1024):
        return cpu(samples, rate)
    if os.environ.get('MYGRAIN_GPU', 'auto').lower() in ('0', 'off', 'false'):
        return cpu(samples, rate)
    if _process is None or _process.poll() is not None:
        warm()
        return cpu(samples, rate)
    target = max(1, int(round(len(samples) / rate)))
    # Bound intermediates (STFT, output spectrum, inverse frames) before allocation.
    frames = 1 + math.ceil(len(samples) / 512)
    outputs = len(np.arange(0, frames - 1, rate, dtype=np.float64))
    if (1025 * (frames + outputs) * 8 + outputs * 2048 * 4 > MAX_BYTES
            or target * samples.shape[1] * 4 > MAX_BYTES
            or time.monotonic() < _retry_at):
        return cpu(samples, rate)
    if not _lock.acquire(blocking=False):
        return cpu(samples, rate)
    started = time.perf_counter()
    result = None
    try:
        payload = np.ascontiguousarray(samples, dtype=np.float32).tobytes()
        _send(_socket, dict(op='stretch', bytes=len(payload), length=len(samples), channels=samples.shape[1], rate=rate), payload)
        header, body = _receive(_socket)
        if header.get('error') or len(body) != target * samples.shape[1] * 4:
            raise ValueError('GPU PCM result shape')
        result = np.frombuffer(body, dtype=np.float32).reshape(target, samples.shape[1]).copy()
        if not np.isfinite(result).all():
            raise ValueError('Non-finite GPU PCM')
        _stats['gpuJobs'] += samples.shape[1]
        _stats['fullStretchJobs'] = _stats.get('fullStretchJobs', 0) + 1
        _stats['lastMilliseconds'] = round((time.perf_counter() - started) * 1000, 3)
        _stats['lastError'] = ''
    except Exception as error:
        _stats['fallbacks'] += 1
        _stats['lastError'] = type(error).__name__ + ': ' + str(error)[:160]
        close()
        _retry_at = time.monotonic() + 60
    finally:
        _lock.release()
    return result if result is not None else cpu(samples, rate)


KERNEL = r'''
#include <cupy/complex.cuh>
extern "C" __global__ void phase(const complex<float>* x, complex<float>* y,
 int bins, int frames, int outputs, double rate, int hop, int nfft) {
 int bin=blockDim.x*blockIdx.x+threadIdx.x;
 if(bin>=bins)return;
 const double tau=6.283185307179586476925286766559;
 double advance=hop*tau*bin/nfft;
 complex<float> first=x[bin*frames];
 double accumulator=atan2f(first.imag(),first.real());
 y[bin*outputs]=first;
 for(int out=1;out<outputs;out++){
  double step=out*rate;
  int frame=min((int)floor(step),frames-2);
  double frac=step-frame;
  complex<float> a=x[bin*frames+frame], b=x[bin*frames+frame+1];
  float aa=atan2f(a.imag(),a.real()), ab=atan2f(b.imag(),b.real());
  // NumPy subtracts the two float32 angles before promoting to float64.
  double delta=(float)(ab-aa)-advance;
  delta-=tau*nearbyint(delta/tau);
  accumulator+=advance+delta;
  // NumPy's scalar multiply follows matrix float32 precision.
  float mag=(float)((float)(1.0-frac)*abs(a))+(float)((float)frac*abs(b));
  y[bin*outputs+out]=complex<float>((float)(mag*cos(accumulator)),(float)(mag*sin(accumulator)));
 }
}
'''


OLA_KERNEL = r'''
extern "C" __global__ void ola(const float* frames, const float* window,
 float* pcm, int outputs, int target, int channels, int channel) {
 int index=blockDim.x*blockIdx.x+threadIdx.x;
 if(index>=target)return;
 int position=index+1024;
 int available=(outputs-1)*512;
 if(index>=available){pcm[index*channels+channel]=0;return;}
 int first=position>=2048?(position-2048)/512+1:0;
 int last=min(outputs-1,position/512);
 float sum=0, norm=0;
 for(int frame=first;frame<=last;frame++){
  int offset=position-frame*512;
  float w=window[offset];
  sum+=(frames[frame*2048+offset]*1024.0f)*w;
  norm+=w*w;
 }
 pcm[index*channels+channel]=sum/(norm>1e-10f?norm:1.0f);
}
'''


def worker(fd):
    import fcntl
    # Cross-process guard: isolated test servers cannot create an unbounded GPU queue.
    lease = open(ROOT / '.gpu-phase.lock', 'a')
    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    import cupy as cp
    from cupyx.scipy import signal as gpu_signal
    sock = socket.socket(fileno=fd)
    sock.settimeout(60)  # Exit and release CUDA context/VRAM when unused.
    cp.get_default_memory_pool().set_limit(size=384 * 1024 * 1024)
    kernel = cp.RawKernel(KERNEL, 'phase', options=('--fmad=false',))
    ola = cp.RawKernel(OLA_KERNEL, 'ola', options=('--fmad=false',))
    window = cp.asarray((.5 - .5 * np.cos(2 * np.pi * np.arange(2048) / 2048)).astype(np.float32))
    cp.fft.config.get_plan_cache().set_memsize(32 * 1024 * 1024)
    try:
        while True:
            header, body = _receive(sock)
            if header.get('op') == 'stretch':
                length, channels, rate = int(header['length']), int(header['channels']), float(header['rate'])
                if (channels not in (1, 2) or length < 48000 or not math.isfinite(rate)
                        or not .25 <= rate <= 4 or len(body) != length * channels * 4 or len(body) > 32 * 1024 * 1024):
                    raise ValueError('GPU PCM dimensions')
                target = max(1, int(round(length / rate)))
                frames = 1 + math.ceil(length / 512)
                outputs = len(np.arange(0, frames - 1, rate, dtype=np.float64))
                if (1025 * (frames + outputs) * 8 + outputs * 2048 * 4 > MAX_BYTES
                        or target * channels * 4 > MAX_BYTES):
                    raise ValueError('GPU PCM allocation limit')
                pcm = cp.asarray(np.frombuffer(body, dtype=np.float32).reshape(length, channels))
                audio = cp.zeros((target, channels), dtype=cp.float32)
                for channel in range(channels):
                    _, _, spectrum = gpu_signal.stft(pcm[:, channel], fs=1., window='hann', nperseg=2048, noverlap=1536, boundary='zeros', padded=True)
                    spectrum = cp.ascontiguousarray(spectrum, dtype=cp.complex64)
                    bins, actual_frames = spectrum.shape
                    if actual_frames != frames:
                        raise ValueError('GPU FFT frame count')
                    transformed = cp.empty((bins, outputs), dtype=cp.complex64)
                    kernel(((bins + 127)//128,), (128,), (spectrum, transformed, bins, frames, outputs, rate, 512, 2048))
                    inverse = cp.fft.irfft(cp.ascontiguousarray(transformed.T), n=2048, axis=1)
                    ola(((target + 255)//256,), (256,), (inverse, window, audio, outputs, target, channels, channel))
                    del spectrum, transformed, inverse
                payload = cp.asnumpy(audio).tobytes()
                _send(sock, {'bytes': len(payload)}, payload)
                del pcm, audio, payload, body
                cp.get_default_memory_pool().free_all_blocks()
                cp.get_default_pinned_memory_pool().free_all_blocks()
                continue
            bins, frames, outputs = (int(header[k]) for k in ('bins', 'frames', 'outputs'))
            if bins < 1 or bins > 1025 or frames < 2 or outputs < 2 or (bins * frames + bins * outputs) * 8 > MAX_BYTES or len(body) != bins * frames * 8:
                raise ValueError('GPU dimensions')
            matrix = cp.asarray(np.frombuffer(body, dtype=np.complex64).reshape(bins, frames))
            result = cp.empty((bins, outputs), dtype=cp.complex64)
            kernel(((bins + 127)//128,), (128,), (matrix, result, bins, frames, outputs, float(header['rate']), int(header['hop']), int(header['nfft'])))
            payload = cp.asnumpy(result).tobytes()
            _send(sock, {'bytes': len(payload)}, payload)
            del matrix, result, payload, body
            cp.get_default_memory_pool().free_all_blocks()
            cp.get_default_pinned_memory_pool().free_all_blocks()
    except (EOFError, TimeoutError, socket.timeout):
        pass
    finally:
        sock.close()


if __name__ == '__main__':
    import sys
    worker(int(sys.argv[2]))
