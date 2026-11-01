# V random cut limits — v2026.11.01.V.1

Mark requires every V random process, including reel creation, to use only
1/2, 1/4 and 1/8 musical divisions. No generated finer chops.

- `MygrainVocalCut.randomizeV` chooses source and stretched-output lengths from
  half/quarter/eighth of a musical bar (`240 / BPM` seconds per bar). It ignores
  a previous fine manual grid or Snap Off when making a new random choice.
  A source shorter than an eighth gets no newly generated cut.
- The V card and cut-editor buttons, regular Randomise, Mega and Sparse share
  `randomizeBastardLoopVCut`, which now calls that helper. Other lanes retain
  their original generic randomizer.
- V's Mega/Sparse sample-build pool is only those three divisions. V build/re-cut
  requests and AI/genre/Song-AI recipe application normalize generated division
  choices through `randomVDivisions`; finer values become 1/8 and longer values
  become 1/2. The private recut fallback is no finer than 1/8.
- Every reel intensity uses the same helper with the captured plan's BPM, no
  stretching and repeat/from-start enabled. New cuts remain inside an existing
  source selection where a permitted division fits. Already-too-short manual
  selections are not subdivided further. Reels still alternate the exact
  original V settings with developed cuts and honor protected V/no-recut modes.
- Manual grid/field/handle editing, saved-source PCM, existing settings, recall,
  legacy playback and other lanes are unchanged. No migration or cache-version
  invalidation: this changes future random choices, not rendering saved cuts.

## Server paths

Song snapshots carry the chosen V cut/divisions through `song-beta-adapter.js`.
The server-arm worker and isolated render deck use the same `vocal-loop-cut.js`
playback. Reel workers require `scripts/instareel-arrangement.cjs` on each fresh
job and load the current editor. No additional backend DSP implementation is
needed; no server service restart is needed for these static/worker changes.

## Verification

- `node --test tests/v-random-divisions.test.cjs tests/instareel-arrangement.test.cjs tests/vocal-loop-cut.test.js`
  covers all allowed lengths/tempos, Snap Off/fine grids, stretched output,
  short-source handling, manual compatibility and every reel intensity.
- `tests/v-random-divisions-browser.cjs` uses isolated port 18986, admin fixture
  password `isolated-v-cuts`. Covers actual Mega settings, build-plan constraints,
  V random-button taps, Undo/Redo, actual AI adapter application without a model
  call, original PCM identity, generated and legacy manual fine-cut server Song
  renders (including an older snapshot without V-cut fields), source SHA
  preservation and warm-cache reuse in Chromium. Touch checks cover both
  Chromium and WebKit.
- `INSTAREEL_RECUT_TEST=1 INSTAREEL_ENGINE=chromium MYGRAIN_TEST_URL=http://127.0.0.1:18985/mygrain/ MYGRAIN_TEST_PASSWORD=isolated-v-cuts node tests/instareel-browser.cjs`
  runs a real 30-second reel, preview, library save, loop wrap, cleanup and
  unchanged live-source/live-patch checks on a separate isolated store.

Older `vocal-cut-random.test.js` Mega mock lacks `capRandomCrashLevel`; its
failure was reproduced unchanged with pre-task index/DSP files. The two generic
randomizer tests pass separately. Old history fixture registration is incompatible
with owner approval; fresh isolated seeded-account tests above replace that path.
Physical iPhone behavior remains separate from browser-engine emulation.
