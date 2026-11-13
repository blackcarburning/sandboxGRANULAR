# RadioLab / VideoLab ten-minute captures

Build v2026.11.04.LAB-10MIN.1 (2026-11-04).

Maximum recording/take length is 600 seconds in browser recorders, capture validation, server PCM relay, saved-WAV validation, and private-sample re-trim. Default VideoLab request remains 120 seconds; the user can choose up to 600 seconds. UI/editor state and saved-file formats are unchanged.

RadioLab float PCM and VideoLab decoded PCM budgets are 224 MiB, enough for 600 seconds of 48 kHz stereo float32. Server saved-WAV limits are 128 MiB, enough for 600 seconds of 48 kHz stereo PCM16. Buffers grow from incoming chunks; no maximum-size buffer is preallocated. The server radio relay sends at most 600 seconds of frames; its independent wall-clock deadline includes bounded startup grace so connection setup does not shorten a full take.

VideoLab worker remains finite and non-live, using existing local GStreamer decode and source policy. Requested duration is capped to source duration minus start when metadata is known. Actual decoder EOF stops earlier without silence padding when metadata is absent/inaccurate. Optional embedded video preview is not the capture source. CPU/decode/network deadlines remain bounded and allow longer imports (server720s, worker718s, browser780s). Compressed source download ceiling remains64MiB.

No Song DSP, playback clocks, sources, render hash/revision, or WAV encoding changed. Longer captures are saved/imported through existing sample paths; existing snapshots/renders require no invalidation.

Verification and scoped before/after diff: output/mygrain-lab-ten-minutes-20261104T160149Z/. Covers 600-second PCM lengths/validation/save-download, 600.000+ rejection, exact EOF decode, trim/save, cancel/stale behavior, Chromium/WebKit controls. Physical iPhone ten-minute capture not tested. Two pre-existing broad-suite failures were reproduced against backups: obsolete sample-label HTML matcher; account registration test missing now-required email.

## Slow mobile transfer — VIDEO-TRANSFER.1

Production capture logs at16:17 on2026-11-04 showed ready audio in4seconds, then200 followed by400 exactly30seconds into delivery. A single whole-WAV sendall hit the socket30second timeout. VideoLab now sends64KiB chunks, allows60seconds per write and600seconds total, restores the socket timeout, and closes partial responses without appending JSON. Browser binary requests allow600seconds; small API requests retain45seconds. Interrupted/truncated downloads show an actionable error and retain the prior take; downloading/decoding have distinct status. No format/DSP/Song compatibility changes.

Evidence: output/mygrain-videolab-transfer-20261104T161959Z/. Real throttled socket regression reproduces old failure and verifies exact output after fix. Backend52,frontend10,Chromium5,WebKit5 checks pass. User iPhone retry unverified.

## Decoder-independent capture retention — VIDEO-PCM.1

The user reported no take again. New production logs showed capture readiness and audio200 at16:23:42, followed by cleanup at16:23:51 without the previous30second server failure. These logs do not expose the actual phone-side error, so the remaining cause was not conclusively identified. The completion path unnecessarily depended on native AudioContext.decodeAudioData plus the original context identity/running state.

Capture now parses canonical server PCM16 RIFF/WAV directly in16,384-frame chunks into the existing PCMRecorder. It validates RIFF length, chunk bounds, PCM format/byte alignment, sample rate/channels, duration and nonzero audio. It preserves the original sample rate and actual frames rather than resampling through the hardware context. Starting a request still requires Start; retaining the finished PCM does not require a running/still-identical context. Preview remains an explicit user action using existing audio readiness checks. No server/DSP, saved schema or existing Song snapshot/render changes.

Failures retain a stage-specific message in both status and the empty-take area; previous take stays intact. Capture errors are cleared with private state on close/account change.

Verification:12 frontend tests including actual600second PCM, malformed WAV and exact samples;6 Chromium+6 WebKit browser tests plus strengthened failure-display checks in both engines. Tests suspend the audio context during transfer and make native decodeAudioData throw, and still retain a complete take. Cancellation/account isolation, trimming/normalisation/save and existing sample loading remain covered; delayed capture fixtures now hold the body-transfer boundary, not an audio decoder no longer used. Live assets/build byte verified. Real iPhone retry remains pending. Backup/evidence:output/mygrain-videolab-pcm-20261104T162459Z/.
