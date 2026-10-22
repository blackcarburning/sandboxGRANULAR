# Full-decay sampled drums (DRUMS.1)

## Reproduced fault

`playDrumMachineHit` always scheduled an exponential amplitude ramp from the
hit's level to 0.0001, even at Decay 100%. A sustained 1.6-second ETC recording
had fallen to about 0.001 gain after 1.2 seconds, although its buffer was still
playing. Both Chromium and WebKit reproduced this with actual touch controls.
The sample decoder preserved the original duration; retriggers did not choke
older voices. The extra amplitude envelope was hiding the recorded tail.

## Playback contract

- Decay 100% preserves the recording's own envelope, after the existing short
  attack guard. Only the final 3–20 ms fades out to avoid an abrupt trimmed end.
- Length 100% plays the complete sample at its current pitch/playback rate.
  Lower Length settings still trim it; lower Decay settings retain their
  existing exponential shortening. Stored slider values and formats are unchanged.
- The shared sample path covers kick, snare, sampled hat, percussion, clap,
  cymbals/crash and ETC, including ratchets and offline Song rendering.
- The synthesized fallback hat keeps its intentional noise envelope. This fix
  does not lengthen the source recording or extend a Song beyond its selected
  number of steps.

## Song cache compatibility

Active drum patterns require a `drumSampleVersion: 1` playback freeze. The client
inspects legacy source snapshots before trusting an unmarked render, even when
older portable-render flags would permit fast reuse. Muted/empty drum patterns
do not force a new freeze. Existing editable snapshots and audio assets are not
rewritten; only affected playback freezes refresh on Arm Cache.

The backend accepts `drumsample=1`, returns `drumSampleVersion: 1` on the saved
render and advertises `drumSampleRenders: 1`. Unknown versions are rejected before
mutation. Marker forwarding is retained when an upgraded part keeps its render.
Restart `fs7300-documenter.service` when deploying this backend change alongside
the HTML and cache-versioned `song-beta.js`.

## Verification

Use disposable localhost accounts/stores, not production Songs:

```
python3 tests/song-beta-test-server.py 18891
DRUM_DECAY_REPRO=1 node tests/drum-sample-decay-browser.cjs # baseline only
node tests/drum-sample-decay-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18891/mygrain/ node tests/drum-etc-browser.cjs
node --test tests/drum-tone.test.js tests/drum-perc-routing.test.js tests/drum-reverb-send.test.js tests/drum-send-impulse-worker.test.js tests/song-beta.test.js tests/song-beta-compatibility.test.js tests/song-beta-clock.test.js
python3 -m unittest discover -s tests -p 'test_song_backend.py'
```

The new browser regression measures a long sample's live tail and overlapping
retriggers, real offline PCM at pitch rates 0.5/1/2, Length trimming, short Decay,
Stop, exact Song PCM, server freeze version and audio/settings after reload.
