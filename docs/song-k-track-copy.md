# Copy individual K tracks in Song mode

Build `v2026.10.23.KCOPY.1` extends the existing Copy from Part checkbox picker with K track 1–5. Any subset can be combined with existing loops and drum selections, then pasted to one or several saved parts. Paste does not start Arm; use Arm Cache once after the edits.

## Persistence boundary

- Clipboard codes `K1`–`K5` travel with the existing revision-pinned source Song/part/hash. No source audio is downloaded or decoded by the device while copying/pasting.
- Each selection replaces the same numbered destination track's complete `state.modes.kMultitrack.tracks[index]` object: length/source tempo, level/mute/pan/enabled, processing and metadata. Record-selection index, global K on/off and master level stay at their destination values.
- Raw WAV slots are `bastardK`, `bastardKTrack2`–`bastardKTrack5`. K1 also replaces/removes its legacy `bastardKRender` slot. Audio bytes, manifest descriptors, portable inventory and slot metadata move together. An empty selected source clears the destination take; other source slots are not substituted.
- Source and destination K metadata are converted through canonical `k-multitrack.js` on the server, under the bounded K-conversion lock/Node heap/timeout. This is the same converter used by Convert K. No whole-Song conversion or device-side migration/upload is triggered by Paste.
- Legacy single K is track 1; old five-track shared-processing settings migrate to each track before selected replacements. Unchosen destination audio remains byte-identical; migration preserves its sound.
- K's legacy/master setting prefixes must not fall through the loop-A classifier. Copy A, or A plus K tracks, must not overwrite the K master or shared legacy settings.
- Existing editing lease, exact destination/source hashes, history and linked/reused-part updates apply. Only the amended destination loses its playback render, ready for a later manual Arm.

## Verification

Use disposable account/Song storage only:

```sh
python3 -m unittest discover -s tests -p 'test_song*.py'
node --test tests/song-beta.test.js tests/k-multitrack.test.js tests/song-server-k.test.js
MYGRAIN_TEST_ROOT=/tmp/mygrain-k-copy-store python3 tests/song-beta-test-server.py 18927
MYGRAIN_TEST_URL=http://127.0.0.1:18927/mygrain/ node tests/song-multi-copy-browser.cjs
```

`test_song_k_copy.py` checks actual ZIPs, all five individual tracks, mixed K/loop/drum copies, empty recordings, old single/v1 K sources and destinations, exact untouched WAV bytes/settings, source preservation, linked targets/history/render invalidation and failed conversion rollback. The browser regression checks K2/K4 mixed with V/M/Kick, two destinations followed by one manual Arm, actual audio hashes/processing recall, existing drum selection/shared-part/lease/stale-picker behavior and reload persistence in Chromium/WebKit desktop/phone emulation. Phone geometry includes 320px portrait and landscape. These are emulation checks, not physical iPhone verification.
