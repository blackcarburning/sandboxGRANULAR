"""Bounded, expiring immutable source PCM cache; no credentials or output files."""
from collections import OrderedDict
import threading
import time
import numpy as np


class SourceCache:
    def __init__(self, max_bytes=192 * 1024 * 1024, ttl=120):
        self.max_bytes, self.ttl = max_bytes, ttl
        self.entries = OrderedDict()
        self.lock = threading.RLock()
        self.bytes = self.hits = self.misses = 0

    def get(self, key, build):
        # Single-flight preparation also bounds concurrent cache-build allocations.
        with self.lock:
            now = time.monotonic()
            for old, (expiry, audio, _) in list(self.entries.items()):
                if expiry <= now:
                    self.bytes -= audio.nbytes
                    del self.entries[old]
            found = self.entries.pop(key, None)
            if found:
                self.entries[key] = found
                self.hits += 1
                return found[1], dict(found[2])
            self.misses += 1
            audio, meta = build()
            audio = np.ascontiguousarray(audio, dtype=np.float32)
            if audio.nbytes <= self.max_bytes:
                # Own storage: callers/builders cannot mutate cached audio by alias.
                audio = audio.copy()
                audio.flags.writeable = False
                while self.entries and self.bytes + audio.nbytes > self.max_bytes:
                    _, (_, evicted, _) = self.entries.popitem(last=False)
                    self.bytes -= evicted.nbytes
                self.entries[key] = (time.monotonic() + self.ttl, audio, dict(meta))
                self.bytes += audio.nbytes
            return audio, dict(meta)

    def diagnostics(self):
        with self.lock:
            return dict(bytes=self.bytes, entries=len(self.entries), hits=self.hits, misses=self.misses, limitBytes=self.max_bytes)


CACHE = SourceCache()
