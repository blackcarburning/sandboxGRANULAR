# Pan Lab power and Wasp teardown — PAN-OFF.1

Pan Lab is opt-in. Editor startup always leaves its checkbox Off, including when
stored controls previously enabled it. Explicit current preset/state recall retains
the flag. Missing flags default Off in the editor.

Off, zero width, or all motion depths (LFO, Audio, Orbit) zero uses dry routing.
Gravity alone is not motion. Both Pan panners, constant source, oscillator, depth
gain and analysis tap are detached/stopped; turning knobs while Off does not
allocate them. LFO-only motion needs no FFT. Viewing Pan Lab never enables its FFT.
A visible master VU uses a separate 512-sample tap, disconnected when hidden or
scrolling. It cannot keep the Pan engine running.

Wasp Off restores dry routes and removes graphs immediately. Worklets acknowledge
disposal before ports close, with a bounded cleanup fallback. Configured routes
remain recallable but diagnostics report zero active routes when Off.

The isolated Song render deck uses the same engine and current flag. Old source
snapshots without the flag preserve their prior nonzero Pan motion/static center
only in the render deck. This avoids changing legacy freezes/source ZIPs or
invalidating unaffected renders. New zero-depth editor states always bypass.

## Verification

Evidence: `output/pan-off-20261029/` (private local diagnostic evidence).
- Focused reset/background/Wasp/diagnostic tests: 175 passing.
- All 77 inline scripts and both changed JS files parse.
- Chromium and WebKit, portrait and landscape: repeated Pan/Wasp toggles, native
  PCM witness, all-depth-zero bypass, saved flag and startup Off.
- Repeated full-page scroll sweeps after lazy mounting: no growth in DOM nodes,
  registered meters or loop-FX groups; no Pan analysis reads or Wasp processors.
- Mixed sequencer/loop/drum scroll and height-only resize fixtures: all four
  browser/view combinations retain native PCM, zero skipped steps and no
  resize-triggered keyboard/waveform/warm-up work.
- Six real isolated server jobs: current and legacy render, refresh, cache reuse,
  phone playback/audition; source hashes/revisions unchanged.

Latest submitted phone logs were LOAD-PROBE.1, not AUDIO-CLOCK.1. They show about
70% audio-clock progress with flat known PCM, not proof of a JS heap leak or a
specific thermal cause. Desktop WebKit/Chromium checks do not establish physical
iPhone performance; request a new log from PAN-OFF.1 if the symptom persists.
