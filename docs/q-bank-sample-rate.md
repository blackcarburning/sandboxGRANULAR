# Q portable bank sample-rate contract — 2026-11-24

`decodeAudioData` resamples a portable Q atlas to the AudioContext rate. Its saved
frame map must use the **actual atlas PCM rate**, not the original WAV rate.
Otherwise a valid 44.1 kHz source captured at 48 kHz becomes an invalid snapshot:
strict Q validation rejects it before native recall restores Robot/W/V/other audio.

`q-card.js` normalizes a copy of the captured bank through
`MygrainQTheory.bankForAsset`; live bank, decoded PCM and source archives stay
untouched. Piano sample boundaries and string sustain loops scale in frames.
There is no sound replacement, quality reduction, source muting or DSP change.

For already affected native snapshots, `daw-project.js` corrects only the transient
main-part JSON before normal strict decoding. The known historical atlas must have
contiguous sample inventory with 20 ms padding, valid pitch/layer/loop metadata,
a supported source/destination rate, and the exact resampled total frame count
(with one-frame decoder rounding tolerance). Other corruption remains rejected.
Plugin snapshot bytes, embedded bin parts and WAV entries are not rewritten.
The next successful Store captures canonical matching metadata.

Server Song capture uses the same corrected `getState()` path. Existing server
validation stays strict; render capability and content identity for unchanged
sources do not need a version bump. Do not mass-migrate source ZIPs.

Regression: `node --test tests/q-bank-rate.test.cjs` covers piano/strings,
four rates, malformed/truncated rejection and no PCM reads/mutation. Investigation
evidence includes real 48 kHz native Bridge-core Store/reload (old capture -> new
recovery), original Robot PCM in Chromium/WebKit, and an isolated real server Song
job plus warm reuse. Linux native-core/browser tests are not physical Windows CEF
or DAW validation and do not establish sustained full-patch load performance.

If native project recall is already blocked, **Store + reload app cannot run**.
Save the DAW project normally and fully restart the DAW/project to load the hosted
recovery; reopening only the editor can keep the old helper page alive. No native
installer update is needed for this metadata repair.
