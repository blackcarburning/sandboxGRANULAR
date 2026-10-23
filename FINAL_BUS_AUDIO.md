# Final Bus Comp routing

Updated 2026-10-23 (BUS.1).

The final compressor is shared by the complete audible mix, including Direct Out
drums, the independent kick path, and independent drum delay/reverb returns.
Native DynamicsCompressor makeup must never affect only the music stem.

```
processed music/filtered drums -> pan -> sidechain duck gain --+
direct drums / SC kick -> alignment delay -> pan --------------+-> drive -> Bus Comp -> final amplifier
independent drum wet returns -> alignment delay -> own pan ----+
```

Direct Out still bypasses synth filters/effects and music-side ducking. SC Kick
still keys that ducking and uses its independent kick trim; its audible path
does not feed the duck gain. It **does** share final bus compression. The old
`shouldRouteKickAroundFinalCompressor` name remains for compatibility.

Latency calibration still reports complete audible output latency. Direct paths
and wet returns compensate only the upstream processing latency, excluding the
common compressor's measured lookahead. The kick detector evaluates ahead by
that lookahead because its stored event timestamps describe audible output.

Keep idle muting on the music-side gain, not the common drive, to avoid silencing
independent drum returns. Offline final-FX exports also return drum FX before
their common compressor. These routing changes do not modify saved schemas,
sample buffers, or production Song data; existing cached Song renders are not
rewritten automatically.

Verification:

- `node --test tests/bus-compressor.test.js`
- `node tests/bus-compressor-audio-browser.cjs` — actual application graph,
  Chromium/WebKit, 44.1/48 kHz, direct/kick/return paths, low/high signal levels.
- `python3 tests/song-beta-test-server.py 18919`, then
  `node tests/bus-compressor-live-browser.cjs` — isolated local accounts only;
  desktop/phone emulation, routing combinations, live controls, sidechain,
  timing and actual high-wet drum delay/reverb audio.

Compression may change transient dynamics. A common gain/reduction stage must
not introduce different fixed makeup gain for music versus drums.
