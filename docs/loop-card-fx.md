# Standard loop filters and space — LOOP-FX.1

A/B/C/V/W/P/O/L/X/M/M+/Q and each of K1–K5 now use the same `loop-card-fx.js` DSP and matching collapsible controls. K's panel follows the selected track. Instruments, sample amplitude envelopes, pitch/range, native M chorus/compressor and K drive/envelope are not replaced.

- Filter: bypass, low/high-pass, 2/4/6/8/16 poles (12/24/36/48/96 dB/oct), cutoff, resonance, sine/triangle/saw/ramp/square audio-clock LFO, beat-synced rate, depth and inversion. Modulation is in octaves, not a UI polling timer. Mode/slope changes crossfade old/new filter branches; parameter changes smooth in the audio graph.
- Hall: exactly the former Q stereo hall algorithm for every lane: deterministic independent stereo IRs, decay/bloom, pre-delay, low-cut, damping and mid/side width. Dry unity, independent wet send. Presets and Off are local to the lane. IR generation is lazy, bounded/cached, debounced and uses two crossfading banks. WebKit requires explicit stereo channel negotiation on the pre-delay; tests reproduce a silent wet path without it.
- Delay: the same tempo divisions, mix, bounded feedback, tone and ping-pong controls everywhere. The stereo feedback matrix crossfades self/cross feedback; delays are allocated only when enabled. Delay/Reverb Off retain the remaining settings.
- L/X per-note accent filter envelopes remain independent before the common filter; their existing timing and accent-depth calculation are retained. X sample gain/attack/decay/duration and held-key release code are unchanged (48 original-envelope native comparisons, zero PCM difference).

Legacy static filters and local wet paths are bypassed, not stacked with the new paths. Old DOM IDs live in a hidden inert compatibility bin for old imports/getters. M chorus/compressor and L's existing master-bus isolation stay intact. Q's former local FX are inactive in the app; its standalone controller remains available for legacy test fixtures. A compatibility W facade does not create an extra graph.

Canonical state: `state.modes.loopFx = {version:1,channels:{A,...,K5,Q}}`; preset export uses `preset.loopFx`. All channels are independently normalised/clamped. Old patches/Songs migrate from saved controls, never current-device settings. Legacy Q simultaneous high/low-pass is preserved by optional `legacyHighpass`; subtle randomisation clears that compatibility stage. Canonical controls are excluded from generic DOM slider/control snapshots to avoid duplicate restore events.

Normal/full-patch randomisation and its nested Mega/Sparse call randomise the canonical state once: low-pass 10–17 kHz, slow 2/4/8-bar modulation at 1.5–7% depth; hall 0–12% / 2.2–4.2 s; delay 0–8% with 12–24% feedback. This does not change the rule that global mix delay/reverb sends reset to zero.

## Songs

- In-memory inspection/preparation normalises FX metadata without rewriting WAVs or downloading source ZIPs to convert them.
- **Convert FX** uses the same account/editor/revision-guarded, staged atomic server transaction as Convert K/W. It changes only settings metadata, preserves original source WAV hashes, archives/history, arrangement and existing render bytes; repeating conversion is a no-op. It does not auto-Arm or change production Songs during deployment.
- New/converted snapshots are marked `loopFxVersion:1`; playback renders must carry the same version. Arm regenerates an obsolete render rather than falsely claiming old audio contains the new effects. Untouched compatible legacy playback remains usable until conversion/normalised preparation. Loop/K-track copy/paste includes exactly the chosen lane's shared FX; EQ-only copy remains EQ-only.
- Song preparation/recall includes a conservative allowance for stereo delay buffers, both hall banks, FFT working copies and the bounded impulse cache within the existing memory limit.
- Render-deck graphs allocate through the context facade so parent cleanup owns all new native nodes/oscillators.

Verification: `tests/loop-card-fx.test.cjs`, `tests/loop-card-fx-browser.cjs`, `tests/test_song_fx_conversion.py`, `tests/song-fx-conversion-browser.cjs`; existing Song-controller/compatibility/K/W/server/copy, W/drum randomisation and X-envelope regressions. Browser tests use Chromium/WebKit; mutating Song fixtures use isolated localhost stores only. Physical Mac listening remains unverified; this is not a claim to resolve the earlier Safari click.

Before-edit backup: `backups/loop-fx-standard-20261025T152959Z/`. Restore individual reviewed changes, never whole older files over unrelated work.

## N space extension — NOISE-SPACE.1

N now mounts the same Stereo Hall Reverb and Tempo Delay controls/presets on
`#noiseCard`. Its canonical lane is `modes.loopFx.channels.N` (also preset.loopFx),
with default dry sends. Missing N in an older snapshot normalises to dry and
bypass; the server accepts both the original 17-channel set and the new optional
N extension, with the same strict numeric bounds. Existing version-one format
and source audio remain unchanged. No production Songs are converted.

N retains its own multi-pass filter, drive, LFO level and driven envelope. The
standard FX filter controls are not mounted for N; normalization and subtle
randomisation force that additional filter bypassed. N's output gain feeds the
shared space graph directly, without adding an EQ stage or using a source-track
return. Wet sends, global BPM updates, global FX controls and Stop/Panic share
the existing host lifecycle. N disposal detaches its source route. Explicit
context ownership keeps live and isolated OfflineAudioContext render graphs
separate and preserves render-deck managed-node cleanup.

Verification: `tests/noise-n-space-browser.cjs` exercises the actual N output
through the shared FX graph in Chromium/WebKit: hall tail/stereo, tempo delay at
120 vs60BPM, dry attack unchanged, native controls/presets/off, state/preset and
old-snapshot recall, and mobile layout. Existing standard FX and native N tests
are retained. `tests/test_song_fx_conversion.py` covers optional legacy N and
malformed new settings. Existing cached Song WAVs are not rewritten.

Backup: `backups/noise-n-space-20261025T175217Z/`; evidence in workspace
`output/mygrain-noise-space-20261025/`.

## Loop and grain pan — PAN.1

Missing loop-card Pan sliders now sit above Filter & space. Their canonical
optional `pan` field defaults to 0 (centre), clamps to −1…1, and pans the complete
dry/wet return with smoothed StereoPanner updates. K and M+ retain their existing
controls, with no second visible slider. Q keeps its legacy internal pan on
recall; the new card control pans its full shared return.

Grain A/B have independent −100…100 Pan controls beside their quick Stereo Width
controls, saved through the existing slider/preset/Song paths. Pan is independent
of width; width creates symmetrical grain spread around the selected centre,
reducing that spread towards hard left/right. Old snapshots with no grain pan
reset to centre rather than inheriting the current device's slider value.

Full Patch / Mega / Sparse randomisation resets shared loop pans, all five native
K pans, M+ pan, Q's legacy internal pan and Grain A/B pans to centre. No samples
or existing production Songs are rewritten. The version-one format remains
compatible; server validation accepts absent pan on legacy channels and rejects
out-of-range/non-numeric new values.

Verification: `loop-grain-pan-browser.cjs` checks native loop and production-grain
left/centre/right PCM in Chromium/WebKit, UI controls, state/preset round-trip,
no duplicate K/M+ controls and centred randomisation. Unit/server tests cover
normalization, optional legacy data and invalid pan. Backup:
`backups/loop-grain-pan-20261027T191316Z/` (workspace root).
