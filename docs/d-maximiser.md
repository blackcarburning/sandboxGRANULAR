# D-card maximiser

`modes.loopD.maximiser` is an amount from 0 to 100; missing/zero bypasses exactly.
It is applied to derived fitted PCM before cut/gap gating and before native,
Mutilator and Cooking Pot paths diverge. Original imported PCM stays unchanged.
D Level remains the channel mix gain.

Amount scales automatic RMS makeup gain (target -12 dBFS, maximum +24 dB).
A stereo-linked 5 ms lookahead peak limiter with 50 ms release keeps derived
sample peaks at -1 dBFS. This is sample-peak limiting, not true-peak metering.
Fitted PCM is cached by source, fit, transpose, reverse and maximiser amount.

The native ID-less slider commits one history edit on change. Settings travel
with normal patch JSON/ZIP and server render decks. Default zero is omitted
from Song content signatures to preserve legacy cache identity. Audible D with
maximiser requires loopDVersion 2; bypassed D remains version 1. Render uploads
advertise version 2 and both server admission and client compatibility reject
older capabilities for maximised sources. Source ZIP hashes/revisions stay intact.

Regressions: tests/d-maximiser.test.cjs, tests/d-maximiser-render.test.cjs,
tests/d-maximiser-live-browser.cjs, tests/d-maximiser-song-browser.cjs, and the
D maximiser test in tests/test_song_backend.py. Browser fixtures must be isolated
localhost account stores, never live account data.
