# Restructure 8 — public-sample Ember-style instrument

Requested by Mark, 2026-11-22. New Restructure is the current Ember lane design
expanded to **eight** independent sample lanes, with **one shared spring reverb**
instead of the four individual feedback chambers. Ember itself is unchanged.

## Implementation

- `restructure-dsp.js` reuses Ember's validated current lane model, presets,
  grid-snap sample clocks, protected 24 kHz cut width, pitch and step-loop model.
  Eight-by-eight signed coupling, eight patterns/tabs and independent Regen.
- `restructure-worklet.js` freezes an eight-lane derivative of the current Ember
  processor. All lane/channel arrays and monitoring bounds are eight/sixteen.
  No individual Chamber instances or reverb cross sends exist. One stereo tank
  sums three damped dispersive waveguides with twelve all-pass sections each.
  Spring wet, length, decay, damping and tension are global. The mechanical spring
  decay is not a beat-length chamber; sequencers and LFOs retain Ember's BPM clock.
- `restructure.js/css` mirrors Ember's current editor: protected sample width,
  decay, regenerating all/one sample, displayed provenance/waveforms, pitch/time
  stretch, shared divider, grid/copy, step-loop arrows, lane solo, filter/motion,
  factory bank, private patch library, EQ and exact native Export to K adapter.
- Audio runs in a native AudioWorklet, like Ember, **not CUDA**. The archived
  single-loop CUDA generator and its `/scratch`/worker pipeline are retained for
  old tooling only; new generations never silently fall back to it.

## Public source bank

`restructure-catalog.json` and `restructure-corpus-v1/<sha20>/<chunk>.pcm` contain
1,056 distinct recordings derived only from `samples_public` (1,598 WAV paths;
duplicate recording hashes deduplicated). 24 kHz mono source/preparation matches
Ember. No SAMPLES_INDUSTRY recordings are selected or substituted.

`restructure-samples.js` loads the catalogue lazily and deterministically selects
eight distinct recordings. `restructure-sample-worker.js` verifies each chunk's
SHA-256 and frame count, selects/normalizes/declicks/trims like Ember source v2,
and applies its native pitch preprocessing. Protected cut width never changes
on random/factory actions. Per-lane Regen leaves the seven other choices exact.

`sampleSource` persists `source:'samples_public', corpusVersion:1`, seed, optional
eight voiceSeeds and requested frames. Checksums, selection algorithm and the
published corpus must remain immutable. `scripts/build-restructure-corpus.py`
builds from the public folder with four bounded single-thread ffmpeg decoders;
it refuses to replace a published catalogue. Future additions require a new
corpus/version, not editing v1. Source recordings are never modified.

## Persistence, transport and compatibility

Optional `modes.restructure` (or the portable preset's `restructure`) owns the new
instrument only when `instrument:'restructure8'`. Absent/null selects the archived
Dropbox/Restructure raw PCM path, including original cuts, metadata, levels and
64-grain v1 recipes. Archived UI is retained with an explicit start-new action.
No stored account patches, assets or Songs are migrated.

Shared transport starts exactly one R path; new ownership suppresses the old
buffer source even when retained in history. New portable captures omit the
archived R audio asset while the eight-lane instrument owns the source. Stop cancels cold/future work. Live
changes queue fresh graphs at the next shared bar, as Ember does. New random
patches cap output at .70; saved/manual levels are not clamped. Normal/Mega/Sparse
source tasks use the new generator; randomization/Reset clear loop edits.

History, portable ZIP, local restore, mixer/solo, pre-effects `sample` EQ/inserts,
private `/api/restructure-patches`, K recording, native stem isolation and DAW
components use the new state. Private libraries live in `restructure-patches`,
never the Ember library. Generation fingerprints pending edits, BPM, Stop and
account epoch; failed preparation/install restores previous state and edits.

The existing **instrument render capability `emberVersion:31`** also covers
Restructure 8. Backend `ember_render_version` returns the maximum of Ember's
unchanged requirement and audible Restructure's 31. `ember_only_render_version`
continues to own Ember content normalization and E-only EQ eligibility, preventing
an unrelated Restructure from changing archived Ember identities. Missing/off R
is removed from render identity. Song adapter/deck preload the exact public PCM
and worklet before real server capture. No approximation or source ZIP rewrite.

## Verification

- `tests/test_restructure_eight.py`: 225 canonical model recipes, strict public
  provenance/eight-lane/spring validation, selective capability and full corpus
  source/chunk integrity.
- `tests/restructure-eight-browser.cjs`: Chromium/WebKit archived 1/256 recall,
  eight UI lanes, lane-VIII Regen, real step-loop arrows, Undo/Redo, ZIP, individual
  lane PCM, deterministic stereo, spring/pitch counterfactuals, final app output,
  phone/desktop geometry, preparation/edit races, post-install rollback, native
  K recording/cancel and private library. `MYGRAIN_TEST_SONG=1` runs real server
  preparation, warm reuse and playback in the isolated fixture.
- Existing Ember core tests plus backend tests run with their historical TASK
  fixture. Baseline/current validators compare exact legacy Restructure ZIP
  metadata/content identities.

Use the standard isolated accounts fixture, never production Song/library stores.
