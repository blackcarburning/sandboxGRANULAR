"""Optional bounded CUDA phase-vocoder worker; no browser/live audio dependency.

Only phase propagation is replaced. SciPy windows, FFTs and reconstruction stay
in the original server path. A private socket carries bounded float32 PCM/spectra,
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
        phase(np.zeros((1025, 96), dtype=np.complex64), .9, 512, 2048, _allow_start=True)
    threading.Thread(target=run, name='mygrain-cuda-warm', daemon=True).start()


def stretch(samples, rate, cpu):
    """Original FFT/reconstruction with optional accelerated phase propagation."""
    from scipy import signal
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
    channels = []
    for index in range(samples.shape[1]):
        _, _, spectrum = signal.stft(samples[:, index].astype(np.float32, copy=False),
                                    fs=1., window='hann', nperseg=2048, noverlap=1536,
                                    boundary='zeros', padded=True)
        transformed = phase(spectrum, rate, 512, 2048)
        if transformed is None:
            return cpu(samples, rate)
        _, result = signal.istft(transformed, fs=1., window='hann', nperseg=2048,
                                noverlap=1536, input_onesided=True, boundary=True)
        result = result[:target]
        if len(result) < target:
            result = np.pad(result, (0, target - len(result)))
        channels.append(result)
    return np.stack(channels, axis=1).astype(np.float32, copy=False)


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


def worker(fd):
    import fcntl
    # Cross-process guard: isolated test servers cannot create an unbounded GPU queue.
    lease = open(ROOT / '.gpu-phase.lock', 'a')
    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    import cupy as cp
    sock = socket.socket(fileno=fd)
    sock.settimeout(60)  # Exit and release CUDA context/VRAM when unused.
    cp.get_default_memory_pool().set_limit(size=384 * 1024 * 1024)
    kernel = cp.RawKernel(KERNEL, 'phase', options=('--fmad=false',))
    try:
        while True:
            header, body = _receive(sock)
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
