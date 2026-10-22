# Song amendment PCM round-trip and Arm reuse

An unchanged recalled part must retain its exact source WAV bytes, content hash and saved render. Do not rely on equality of UI settings alone.

## Failure reproduced

The normal WAV writer truncates positive samples after multiplying by 32767. Browser PCM16 decoding uses signed integers divided by 32768. Writing that decoded buffer with the normal writer loses one positive least-significant bit on each save, changing the source hashes even without a musical edit. The backend correctly rejects reuse for the altered content; Arm unnecessarily re-renders it.

## Scoped repair

`song-beta-adapter.js` marks canonical 44-byte-header PCM16 source WAVs decoded without resampling in a `WeakSet`. Song recall propagates the tag to its normal editable AudioBuffer clones. Song source capture inverts the PCM16 decoder for tagged buffers, rounding signed samples against 32768. Other source buffers and all ordinary WAV exports retain the existing writer. Encoding still reads current samples, so actual in-place audio edits cannot reuse old bytes.

No original ZIP or duplicate source PCM is retained for this optimization. Noncanonical WAVs, different bit depths and resampled sources use the prior path. No audio graph, renderer, content-hash rule, file-format version, memory budget or editing lease changes.

## Verification procedure

1. Run `node --test tests/song-pcm-roundtrip.test.cjs` for every signed 16-bit value, mono/stereo repeated round-trips, fresh-buffer behavior, invalid provenance and real sample mutation.
2. Start `python3 tests/song-beta-test-server.py 18894`. This provides disposable localhost accounts and Song storage.
3. Run `node tests/song-amend-roundtrip-browser.cjs`. It tests Chromium/WebKit with desktop and iPhone-emulated contexts: mono drums, a stereo loop, independent Roll cycle, two unchanged amendments, an actual mix edit and re-arming.
4. Require byte-identical source WAV hashes and retained content/render hashes for unchanged amendments. Require exactly one new render after the real mix edit, with the other source and its in-memory render untouched. Require non-silent correct-duration audio and no remaining render bridges or cached decoded sources.
5. Compare stage timings rather than treating a cached Arm as a new render. Real changes still require real-time capture of the complete source cycle. Long independent Roll cycles extend that duration.

Do not test this by writing to a production account or Song library. Browser emulation is not physical-device verification.
