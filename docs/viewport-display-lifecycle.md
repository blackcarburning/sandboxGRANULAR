# Viewport display lifetime

The editor keeps audio and controls alive independently from their visual surfaces.
Deleting live controls would lose event bindings and break DSP code that reads their
values; offscreen **rendering resources**, not sounds or settings, are disposable.

`demand-ui.js` owns one display registry and intersection observer:

- Offscreen canvas backing width/height become zero. CSS geometry is retained
  until reveal, so releasing a bitmap does not collapse its card.
- Only the latest paint callback per slot is retained; ordinary paint can be
  replayed on reveal. Transient playhead callbacks are consumed, not replayed
  into duplicate animation loops.
- Revealed canvases restore their layout and draw current data, never a stored
  image copy. M/M+ invalidate their paint cache when pixels are released.
- Removed elements are unobserved and removed from registries/pending work.
- Hidden documents release all canvas buffers. Busy scrolling/jump masks defer
  drawing until eligible again.
- Leaf feature/sound cards offscreen use explicit content-visibility hiding with
  measured intrinsic block height. Their animations/transitions/layer hints and
  backdrop filters are disabled while parked. Card height is restored naturally
  on reveal, then visibility-owned meters refresh their observations.
- Lazy modules remain one-time mounts, not repeatedly loaded scripts. Small
  waveform envelopes can remain cached to avoid rescanning long PCM on every
  reveal; no offscreen painter runs to maintain those caches.
- The isolated server render deck never parks editor cards. No audio scheduling,
  DSP routing, PCM buffers, source archives or render compatibility versions change.

`capturePhoneDiagnosticState().visualResources` records registered/visible/pending
visuals, live canvas count, logical backing bytes, release/redraw counts, registered
and parked cards. These are logical browser allocations, **not** an OS/GPU memory
measurement or proof of an iPhone thermal cause.

Evidence lives in `output/viewport-release-20261029/`. Baseline after visiting cards:
17 canvases retained 3,356,000 logical pixel bytes at the tested phone width.

Programmatic scroll integration reveals parked ancestors before invoking native
`scrollIntoView`, so existing controls and lazy modules keep their scroll contract.
Reveals re-arm the card observer, so a cancelled jump cannot leave an offscreen
card permanently unparked. Focus-before-scroll mixer jumps reveal the control first.

Final verification:

- 45 focused UI-activity, meter, K-track and diagnostic tests passed; 77 inline
  scripts and all three changed external JS files parsed.
- Four Chromium/WebKit portrait/landscape populated-waveform resource checks:
  17 offscreen canvases zero-sized; no offscreen canvas paints; current K/M/M+,
  generated and sample waveforms redraw; retained audio buffer identities intact.
  DOM/registry counts and page height stay stable after legitimate lazy mounting;
  removed fixture canvases leave the registry. Native PCM remains non-silent and
  audio/wall-clock ratio stays approximately 1.
- Four mixed sequencer/loop/drum scrolling and height-resize checks passed with
  no skipped steps or geometry/label/warm-up work from height-only changes.
- Four complete VU/navigation checks passed: all 34 legacy meters plus K/M playback
  meters resume visibly, no offscreen meter painting/sampling, black jump curtain
  and card-top arrivals. Canvas teardown style changes are not meter paints.
- Six real isolated current/legacy Song jobs passed with cached reuse and rendered
  phone playback/audition; original source hashes and revision stayed unchanged.
- Live build marker and byte-identical external display/vocal/diagnostic assets
  verified. This is browser evidence, not a physical-iPhone or OS/GPU-memory test.
