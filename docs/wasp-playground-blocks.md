# Filter Playground block editor

Build v2026.11.04.PG-BLOCKS.1 adds editor-only controls to all three drawn modulation lanes.

- Drawing mode defaults to Freehand. Blocks offers Square, Saw down (height to zero), and Ramp up (zero to height), with bipolar heights.
- Pointer down chooses one snap-resolution cell; vertical movement adjusts its height without painting adjacent cells. Snap Off uses eight cells. Double click or double tap clears only that cell to zero. Cancel/lost capture discards previews.
- Zoom 1–8× enlarges the canvas and timeline in an internally scrolling viewport; coordinate reads use the enlarged canvas rectangle, including horizontal scroll. It does not change musical timing or increase the existing 64-point saved resolution. Grid cells are bounded to the available point resolution.
- Modes/shape/zoom are ephemeral editor preferences, not patch fields. Curves still save as the existing 64 numbers, through the existing card-history/save path. No DSP, worklet, Song engine, source hash or server-render revisions changed; all generated curves use the same existing render path as freehand curves. Opening or editing does not enable Wasp/Playground.

Regression: `node tests/wasp-blocks-browser.cjs` against isolated test server port 19089, admin password isolated-playground. Chromium and WebKit cover all three lanes, shapes, height drag, mouse double-click and touch double-tap deletion, touch placement, zoomed/scrolled placement, cancelled gesture, freehand, normalization roundtrip and 320/844/1440-width layouts. Physical iPhone not tested.

Backup: `output/mygrain-playground-blocks-20261104T154905Z/`.

## Sectioned factory preset bank (2026-11-10)

Filter Playground has a native grouped dropdown with 74 alphabetically sorted
patches across ten sections. The original 24 remain unchanged in five sections: BPM grid-locked blocks; BPM ramps and saws; BPM
polyrhythms; free-running Hz motion; experimental strange machinery. Together
they cover all ten architectures, slopes to 96 dB/oct, three independent drawn
lanes, independent BPM, main-tempo sync, multipliers, triplet/dotted timing,
and bipolar motion. Descriptions explain each patch's clocks and pattern.

The bank is editor-only in `wasp-ui.js` (`MygrainPlaygroundPresets`). Applying
a preset is one existing `runDraftEdit` transaction, replaces only Playground
controls, and preserves Playground power, shared tempo, kick routing, and all
Wasp controls/routes. It never turns processing on implicitly. Block/ramp
entries set the corresponding ephemeral drawing tools without changing zoom.
The selector derives its name from canonical values (ignoring power, tempo
and kick routing), so Undo/Redo and recall recover the label and edited curves
show Custom. No preset IDs, new settings, timers or schema versions
are introduced by the bank; independent-BPM presets retain their own stated lane tempos.

All saved curves use the existing 64-point representation, including its normal
interpolation/slew. Snap controls govern drawing alignment, not a new audio
quantizer. Existing freehand/block controls remain editable after recall.

Server Song renders receive only existing normalized Playground settings and
curves. `song-beta.js`, `song-beta-clock.js`, the isolated render deck and
`server-arm-worker.cjs` already pass those values to the shared current engine;
the accompanying Q fix bumps only audible non-comb Playground renders to
engine revision 8. Comb modes and bypassed/legacy settings retain their previous
render signatures. Source ZIPs and saved controls remain untouched. Tests exercise grid-locked and mixed Hz/BPM factory
settings through actual isolated server jobs alongside a pre-Playground source,
then warm reuse, phone-mode PCM playback, stable hashes/revision and release.

Tests: `tests/playground-presets.test.cjs`,
`tests/playground-presets-browser.cjs`,
`tests/playground-presets-song-browser.cjs`. Runtime browser tests require an
isolated loopback server and disposable accounts, not production user storage.

### Audible Q / cutoff resonance correction

Previously the main cascade hardcoded Butterworth damping (`sqrt(2)`) in every
section, so Q moved only the separate resonant peak, often masked by the main
cutoff. A controlled 700 Hz final-output probe measured essentially no cutoff
change (0.99× RMS) when Q rose from 0.707 to 8 with the peak at 5 kHz.
Q now sets inverse damping on the final main-filter section too. Earlier
sections retain Butterworth damping, avoiding Q-to-the-number-of-sections gain;
comb feedback is unchanged. The independent peak retains its existing Q
response. Shared phone/desktop DSP, modulation smoothing, bypass, CPU/memory
limits and final-output protection remain intact. Disabled Playground and comb
audio remain byte-identical; only active non-comb render signatures become 8.

`tests/playground-resonance-browser.cjs` compares low/high Q and bypass at the
actual final output through visible controls in Chromium and WebKit.

Selective cached-playback refresh also uses `playgroundVersion: 1` on newly
rendered PCM. Old metadata without this marker is inspected through the bounded
manifest endpoint, not source audio on phones. Only enabled non-comb Playground
settings reject an unmarked freeze; comb, disabled and legacy snapshots reuse
existing PCM. Local and server render uploads carry `playground=1`; the backend
validates/stores it and retained compatible renders propagate it. No saved-source
ZIP, part hash, Song revision or preparation memory limit changes on Arm. The
real-server test strips old render markers in its disposable store and verifies
three affected refreshes, unchanged comb/legacy neighbours and warm reuse.

### 50 additional main-BPM-locked presets

The original 24 recipes, metadata, IDs and order are retained exactly. Five new
sections add ten individually designed presets each: Groove & gates, Ramps &
ratchets, Triplet & dotted, Long-form movement, and Spectral experiments.
All 150 new modulation lanes use the main `sync` clock (never free Hz or
independent BPM). Straight, dotted and triplet relationships, 1-beat ratchets,
and up to 16-bar evolving cycles come from existing beat/multiplier settings.
The dropdown count derives from the catalog length. Names remain alphabetical
within each section, with descriptions explaining lane interplay and timing.

These are canonical control recipes, not new DSP: current live and server Song
engines process their saved settings without backend, schema, source archive or
render-signature changes. Existing power/tempo/kick-routing preservation and
history/recall behavior are unchanged. The original-24 fixture fingerprints
protect both normalized settings and metadata; tests also verify all 50 new
recipes are main-clock locked, run both sample rates, select every entry in the
browser, and prepare actual server Song jobs including new long-form/comb
presets, legacy audio, warm reuse and phone-mode playback.

## Clock-tight instrument extension — 2026-11-10

The bank now contains **174** presets: the previous 74 are retained with exact
metadata and normalized recipes, plus 100 aggressive main-tempo recipes in ten
new, alphabetically sorted sections. These cover industrial gates, acid
ratchets, broken ramps, metallic combs, spectral cuts, triplets, dotted
accents, polyrhythms, rate sculpting and audio-rate clockwork. Preset names
remain editor-only; every audible setting is portable without the bank.

### Timing

Previously Playground started a free-running oscillator when its processor was
created; ordinary transport did not supply an epoch and phone ignored frame
position altogether. Linear interpolation also anticipated block edges, and
a fixed 6 ms glide softened attacks. The three curves now evaluate their
phase from audio sample position. Main-tempo lanes use the shared transport
origin and scheduled BPM handoff; late enabling inherits the same epoch. Hz
and independent-BPM carrier lanes use context time, not changes in main BPM.
Desktop, phone, external transport and server decks share PlaygroundEngine.
Initial clock queues travel in processorOptions as well as subsequent port
messages: WebKit offline rendering can outrun pre-render MessagePort delivery.
No UI timer controls curve phase. Maximum clock retention is 16 entries.

The default glide is now 0.35 ms (adjustable 0.05–40 ms). Tight/auto edges
preserve discontinuities at their boundary instead of ramping early; Hold
selects sample-and-hold and Linear explicitly restores smooth interpolation.
Each lane also has a saved `phaseOffset` (0–1 cycles). This name intentionally
differs from the bank's old construction-only `phase` helper: treating that
helper as a saved offset would rotate existing recipes twice. Motion scales
all three bipolar depths and wet/dry blends Playground only. Neutral optional
fields are omitted from old normalized recipes. Existing 64-point data,
drawing tools and snapping remain intact.

### Rate Sculptor

A fourth drawable 64-point curve modulates the speed of cutoff, resonant, Q
or all three drawn curves. Its clock is main-tempo sync or 0.02–1000 Hz; depth
is 0–6 octaves. Carrier Hz controls now also reach 1000 Hz. The speed curve is
preintegrated into a bounded 2049-value table, normalized to mean speed 1.
Analytic phase evaluation returns to the unwarped phase at each modulator
cycle, avoiding accumulated drift and activation-order dependence. The new
rate-warp presets use the sync clock; deliberately free Hz modulation can
bend rhythmic positions. FM and audio-rate carriers update SVF coefficients
every sample; ordinary modulation retains the bounded 8-frame coefficient
interval. Closed/off processing frees curves, filter/comb state, rate table
and queues. Native envelope detection remains separate from this rate LFO.

### Saved parts and server renders

Optional glide/motion/mix, lane interpolation/phaseOffset and rateMod properties
receive bounded defaults and strict backend validation when present. All 74
legacy recipes and old ZIPs load unchanged. Only active moving Playground or
non-unity mix uses engine revision 9 and `playgroundVersion: 2`. Static
non-comb resonance remains revision 8 / version 1, static comb remains 7,
and bypassed/legacy Wasp signatures are retained. The client inspects old
manifest metadata where necessary and refreshes affected freezes through
the existing worker; sources, hashes and Song revisions do not change on Arm.
Render uploads and retained compatible freezes propagate capability 2.

Regressions: playground-clock.test.cjs (late enable, 1000 bars, scheduled BPM,
step edge/settling, integrated FM); playground-presets.test.cjs (174 recipes,
retained-74 fixture, 100 tempo additions, two-rate PCM); preset UI tests
(phone/desktop Chromium/WebKit, history, canonical ZIP, layout);
playground-instrument-native-browser.cjs (original 7 Mutilator PCM, both
modes/12 strains and native phone/desktop worklet PCM);
playground-instrument-live-browser.cjs (switch/history, late live insertion,
scheduled BPM, drawing/cancel, recall, randomization and mute); and
playground-instrument-song-browser.cjs (real isolated server jobs, legacy
loading, selective stale refresh, warm reuse, bounded phone PCM and WAV).
