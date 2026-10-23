# K five-track recorder (K5.1)

K1–K5 each retain their own raw take, source BPM, loop/recording step count, level, mute and stereo pan. One record-select radio and the keyboard destination dropdown address the same selected track. Keyboard **K Solo** shares the existing K layer solo; it does not create a second solo mode. Existing K master volume, pitch, reverse and filter controls remain shared. Waveform, audition, normalise and Clear address the selected track.

## Audio and memory

`k-multitrack.js` is the independent five-source recorder/playback model; `k-multitrack-host.js` bridges the existing exact-frame keyboard capture and transport. Existing K globals are selected-track editor aliases, **not canonical K1 storage**. Song/Undo/ZIP bindings must use `mygrainKMultitrack.getBuffer(0)` for K1 even while K2–K5 is selected.

Each source uses its own `loopEnd`, source-BPM playback rate and common-transport-origin modulo offset. Muted/zero-level tracks keep phase. Shorter loop periods crop playback without changing the take; longer periods silence-pad once, after an audio-memory preflight. There is no LCM/joint-cycle buffer. Ending/replacing playback disconnects each source/gain/panner/filter chain and drops retained source-buffer references. New takes and padding have bounded memory admission; existing playback is retained if a longer period is rejected. Song grid duration/repeats/boundaries are unchanged: a part boundary can still cut a longer K track, just as it could cut a long single K take.

## Persistence and conversion

- Settings: `state.modes.kMultitrack`, version 1, five track objects and selected index 0–4; presets use `kMultitrack` at their existing settings root.
- Canonical K1 Song/Undo audio slot remains `bastardK`, with existing `bastardKRender`; IndexedDB remains `bastardLoopBufferK`.
- Append-only additional Song/Undo slots: `bastardKTrack2` … `bastardKTrack5`; IndexedDB: `bastardLoopKTrack2Buffer` … `bastardLoopKTrack5Buffer`. Never insert slots into the existing binding array: durable Undo journals use numeric slot indices.
- Startup reads all five raw takes in the existing parallel, source-mutation-guarded restore batch. Account locking releases all five.
- **Song editor → Convert K to 5 Tracks** upgrades unique saved sources under the existing verified editing lease and stale-response guards. Legacy K maps to K1 at unity track level/centre/unmuted; K2–K5 are empty. It rewrites compatibility JSON only: every original source WAV remains byte-identical, and the existing server revision-recovery path is retained. Compatible old renders can be retained. Arm remains manual. Normal saved-part inspection also understands these legacy snapshots. **K5.3:** K-only conversion is an explicit action, not an Arm prerequisite: Arm normalizes legacy K1 settings and empty K2–K5 in memory, keeps existing source hashes and reuses compatible saved renders without downloading or rewriting source ZIPs. Explicit conversion still checks its full archive-copy memory budget before loading originals. Mixed older compatibility repairs retain their existing guarded upgrade flow.
- Conversion uses the recorded take's own length, not an old setting for the *next* recording. Older 1–8 pattern-multiplier settings remain readable.
- The server's bounded archive allowance is 40 audio assets plus one manifest, to admit a fully populated five-track part. No upload-byte, account or lease limits were removed.

## Verification

Run from this checkout:

```
node --test tests/k-multitrack.test.js tests/k-record-steps.test.js tests/k-count-in-level.test.js tests/k-downbeat-capture.test.js tests/song-beta.test.js tests/song-beta-storage.test.js
python3 -m unittest discover -s tests -p 'test_song_*.py'
python3 -m unittest discover -s tests -p 'test_k_multitrack_backend.py'
python3 tests/song-beta-test-server.py 18919
node tests/k-multitrack-browser.cjs
```

The browser runner accepts localhost only and creates disposable test accounts. It checks real five-track captures, analytical independent-period stereo PCM, level/mute/pan, selected-track clear/Undo, live crop/padding/memory rejection, amendment recording, saved Song recall, hidden-render output, IndexedDB reload, visible legacy conversion with exact WAV comparison, K5-only transport, final-track clear and phone portrait/landscape widths. It runs Chromium and WebKit on desktop and phone emulation; this is not physical iPhone verification.

## Track output meters (K5.2)

Each K track has a display-only stereo RMS meter (-60 to 0 dBFS), a 600 ms sample-peak hold and clipping indication. The tap is after that track's level, mute, pan and shared K filter, before downstream master/bus processing. Separate left/right analysers avoid antiphase cancellation and keep constant-power panning from changing the RMS reading. These are digital level indicators, not calibrated analogue VU or true-peak meters.

`k-track-meters.js` uses one shared 20 Hz timer and reuses two 512-float arrays per visible, playing track. An IntersectionObserver watches each meter itself, not the whole K card. Offscreen meters disconnect their side-branch analysers and receive no sample reads or DOM writes; no timer remains when all meters are offscreen or playback stops. Hidden tabs, page lifecycle and suspended/replaced audio contexts release taps. Voice replacement disconnects only the meter branch, never the audible destination; account lock destroys observers/listeners/taps. Hidden Song-render decks never initialise the meter controller. No saved-state, Song or export fields changed.

```
node --test tests/k-track-meters.test.js
python3 tests/song-beta-test-server.py 18919
node tests/k-track-meters-browser.cjs
```

The meter browser runner checks actual five-track signal levels, a 6 dB fader reduction, mute/silence, zero offscreen analyser reads and DOM mutations, unchanged playing voices and audio energy across visibility changes, actual context suspension/resumption, synthetic visibility events, repeated playback replacement, account lock and 320 px/landscape layouts in Chromium and WebKit desktop/phone emulation.
