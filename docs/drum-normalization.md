# Drum sample levels and snare drive

## User behavior

Build `v2026.11.12.DRUMNORM.1` adds non-destructive peak normalization to all
seven drum sample lanes. New sample loads default to normalization. The
`Auto-normalize new loads` switch affects future loads only. Each lane has
`Normalize sample` and a reversible normalization bypass.

The target is -6 dBFS sample peak, with at most +24 dB gain. All channels use
the same gain, preserving stereo balance and sample dynamics. Samples below
-60 dBFS peak or -70 dBFS RMS stay at unity. The target is not a loudness
match: different samples can still have different perceived loudness. Lane,
accent, envelope, distortion, EQ and bus controls still act normally.

The original decoded AudioBuffer is never rewritten. Editable ZIPs and native
project snapshots retain original audio plus processing settings. Mix/Song WAVs
include the processing. Original-source WAV exports remain original.

Old patches without processing state restore with unity gain and Legacy snare
drive. They are not silently normalized. To update an old patch, use Normalize
on the desired lanes and choose Smooth snare drive explicitly. Loading a new
snare selects Smooth, even if auto-normalization is Off.

Smooth fixes the original distortion curve's low-drive attenuation. It blends
identity into a bounded, odd tanh curve without the legacy output trim. It
changes new hits; currently sounding hits keep their existing distortion node.
Legacy retains the exact former curve and trim. Roll shares the snare sample,
normalization gain and drive response. Randomization recipes and musical lane
levels were not changed.

## State and routing

`modes.drumMachineSampleProcessing` is canonical in local state, presets and
Song/native snapshots:

```json
{
  "version": 1,
  "autoNormalize": true,
  "snareDrive": "smooth",
  "lanes": { "snare": { "enabled": true, "gain": 5, "peak": 0.1 } }
}
```

`MygrainDrumTone.sampleState` supplies missing lanes. An absent entire field
means legacy behavior, not a fresh default. `analyzeSample` scans once on load,
yields between large chunks and rejects nonfinite PCM. A per-lane load token
prevents stale asynchronous measurements winning over a newer load or recall.
Normalization gain sits before the existing per-hit envelope and distortion.
Bypass changes gain on held voices with a short smoothing ramp.

Do not bake gain into stored audio or analyze/reapply it on archive recall.
`restoreSampleProcessing: true` bypasses the new-load hook during extra-lane
original-buffer restoration. Restored processing gains apply exactly once.

## Song and server preparation

`drum-tone.js` and `backend/mygrain_songs.py` derive an effective processing
signature only for loaded, patterned/Roll, nonzero-level drums on an enabled
drum bus. Bypass, analysis peaks, preferences and inaudible processing do not
invalidate old render content identities. Audible gain or Smooth distortion
requires `drumProcessingVersion: 1` and upload flag `drumprocessing=1`.

`song-beta.js` checks that marker in cached render admission, fresh uploads and
retained-render reuse. The backend rejects missing/unsupported markers on
affected parts. The render worker uses the shared current app engine; no second
DSP implementation is introduced. Partial lane copy includes the matching
normalization state and, for snare, drive response. Source ZIP hashes and Song
source revisions remain unchanged during preparation and warm reuse.

## Regression checks

```sh
node --test tests/drum-normalization.test.cjs tests/drum-tone.test.js tests/drum-accent.test.cjs tests/song-beta-compatibility.test.js
python3 -m unittest discover -s tests -p 'test_drum_normalization.py'
```

Set `MYGRAIN_DRUM_BASELINE_BACKEND` to a retained pre-change module to include
exact legacy content-identity comparison (otherwise that case explicitly skips).
The backend suite also runs the existing Song backend tests.

Browser checks require the disposable localhost `tests/song-beta-test-server.py`
fixture, port 18894 by default, with its isolated test admin password set to the
fixture value used in the browser test. Never run these mutation tests against a
production account; the test URL is restricted to localhost.

```sh
DRUM_NORMALIZE_ENGINE=chromium node tests/drum-normalization-browser.cjs
DRUM_NORMALIZE_ENGINE=webkit node tests/drum-normalization-browser.cjs
DRUM_NORMALIZE_ENGINE=chromium DRUM_NORMALIZE_BASELINE_INDEX=/path/to/before/index.html node tests/drum-normalization-portability-browser.cjs
```

Check final-output PCM with matching, settled capture windows, and direct
SongClock renders under the normal controller busy/activity lease. Checks cover
44.1/48 kHz, stereo, raw preservation, smooth/legacy curves, all lane loads,
bypass, editable ZIPs, native snapshot capture, original-format ZIP recall,
actual WAV encoding, real legacy/current server jobs, warm reuse, bounded phone
preparation/playback and reload. PCM evidence is not a physical listening test.

The unrelated older `drum-roll.test.cjs` harness has the same 13 failures before
and after this change; normalization checks do not claim a green whole-repo run.

## Rollback

The workspace rollback pointer is `output/mygrain-drum-normalize-current.txt`.
The retained baseline is `v2026.11.12.LAYOUT.1`, before normalization, with CEF
0.1.3 unchanged. The pointed backup includes exact source hashes, deployment
hashes, evidence and a guarded rollback script restoring only five source files.
Do not reset the shared dirty checkout. No account data, original samples or
existing releases are changed by this source-only update. On the old engine,
new normalization/drive metadata is ignored: saved originals remain usable but
their sound returns to the old unnormalized/Legacy behavior.
