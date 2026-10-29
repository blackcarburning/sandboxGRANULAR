# W generation and drum volume (2026-10-25)

Build: `v2026.10.25.W-DRUMS.1`.

- Normal patch Randomise previously re-cut an existing W buffer without requesting
  fresh modular audio. It now awaits the shared W generation task, native decode,
  buffer application and persistence before selecting the new cut and restarting.
- Mega/Sparse retain their existing W batch task: the nested normal randomiser skips
  W generation, so each mode makes exactly one W request. W uses `samples_modular`.
- Failed generation preserves the existing W audio, clears its in-flight flag and
  reports an error instead of claiming successful generation.
- The random drum-bus level is now 40%, independently of the legacy 65% initial /
  old-patch fallback. All existing calls to `forceDrumMachineRandomLevel` share it,
  including drum sample randomisation. Individual drum levels are unchanged.
- A Volume slider beneath the drum card's buttons mirrors the Mix drum level.
  Both controls use one setter and update the actual bus gain, without rebuilding
  the drum editor. Only the original Mix control is persisted and included in the
  slider schema; the card mirror cannot overwrite older patches with a default.
- Global FX reset behaviour and the restored original X envelopes are unchanged.

Verification: `node tests/w-drum-randomise-browser.cjs` runs Chromium and WebKit,
intercepts generation responses with a real PCM WAV, and exercises actual W
request/decode/application for repeated Normal, Mega and Sparse randomisations.
Other sample loaders are isolated. It checks exactly one modular request per run,
fresh buffers, failure preservation, 40% defaults, two-way slider/label/DSP sync,
portrait/landscape bounds, native touch input, and saved level / W buffer restoration. All API writes
are intercepted or blocked; disposable browser storage only. This is not a claim
of testing the physical MacBook Safari crackle.

Regression harness maintenance: the global-FX test now stubs W cutting along
with its intentionally skipped sample I/O. An existing extra-drum test asserted
a retired X-helper variable anywhere in the page; it now checks the drum player
uses its actual buffer argument. That stale assertion also failed in the exact
pre-change HTML. No drum audio envelopes were modified.
