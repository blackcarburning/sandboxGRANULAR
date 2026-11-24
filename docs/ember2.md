# Ember 2 — independent BPM stereo glitch instrument

Requested by Mark, 2026-11-17. Replaces the rejected Ember design, not a skin or
revision of its synthesizer. Retains E / `bastarde`, `modes.ember`, normal MYGRAIN
source-owned EQ/inserts, shared transport and the private account patch manager.
Ember 1 code and immutable saved sounds remain an archive, not v2 synthesis.

## Signal and clock

- Four independent dual-mono pulse-width oscillators with sine-body blend,
  stereo detune, position and de-clicked rhythmic envelopes. New 2x oversampled
  polyBLEP source, not an imported legacy generator; no noise or bit crusher.
- Every carrier is BPM × cycles-per-beat / 60, with optional stereo cents and
  deterministic glitch pitch jumps. No free-Hz oscillator, pulse or LFO clock.
- Sixteen steps per bar, 0–4 manual repeats, deterministic probability/extra
  ratchets, swing and gate fraction. A sample-clock processor owns all events.
  Timing/LFO phase remains continuous across live local/song tempo changes.
- Each stereo side: DC/low cut, two TPT resonant filter stages, LP/BP/HP morph,
  notch blend and stereo cutoff separation. LFO modulates cutoff and pulse width.
- One orthogonal four-line stereo feedback chamber per voice, with fractional
  delays sized in beats. Independent wet, size, decay, damping and reverb-to-cross
  send. LFO moves wet, room size, decay and damping. Fractional read indices are
  wrapped as INTEGERS before lookup: negative sub-ULP positions must not round to
  buffer length, which previously caused a NaN latch in the staged implementation.
- Twelve directed signed cross-mod routes (row receives column), diagonal zero,
  one global depth. Causal previous-output-sample source includes pre-envelope
  carrier plus optional per-voice chamber return. Coupling has a bounded
  through-zero frequency excursion; switching a voice Off removes its send.
- Every voice has an independent beat-length LFO: sine, triangle, variable-width
  pulse or repeatable stepped pattern; stereo phase, PWM/filter/reverb/pan depths.
- Smooth master ramp, output DC rejection and high-frequency rolloff. A protective
  soft knee is unity below .85 and bounded below .98. Normal bank audio does not
  depend on the safety knee for level control.

## Code and integration

New files: `ember2-dsp.js` (model/native host), `ember2-worklet.js` (synthesis),
`ember2.js` (interface), `ember2.css` (cream/copper design and geometric pulse icon).
No v1 engine code is in the new processor. `ember-dsp.js` and its worklet remain
unchanged solely for archived version-1 Song/patch playback. The new host calls
that module only for explicit v1 settings. New defaults and all 24 new studies
are version 2. Version-1 recall is prominently labelled as an archive, with an
explicit **Start a new Ember 2** action; it is never silently converted.

The account patch-manager block is carried forward: `{version:1,ember,eq}` is
still the library envelope; ember itself is now v1 or v2. Saves retain account
isolation, revisions, atomic writes, confirmations and completed E automation.
Factory/new-patch/clean-start keep power, level and local/song tempo. Full project
recall/Undo restore actual saved values. Whole-app generation powers E off and
retains its sound. No production account/library records are migrated.

`MygrainEmber.prepare(context)` preloads processors before native/offline/server
capture. `mygrainEmber.start()` uses the ordinary E route and activity ownership;
Play wakes the shared context and starts the common loop transport. Do not
replace this with an upstream-only audio proof. `finalAmplifierNode` is the test
tap for actual application output, after normal gain/effect gates.

## Persistence and server Songs

`modes.ember.version:2` is independently validated in `backend/mygrain_songs.py`.
New audible v2 sounds require `emberVersion:22`; inactive/zero/empty cases keep
legacy identities. Existing v1 capability/content normalization remains exact.
The backend accepts 22 on render upload and checks original snapshot requirements
on GET and POST, even when part metadata predates the feature. The shared Song
client/isolated deck already dispatch through `MygrainEmber.prepare/renderVersion`
and `mygrainEmber.restore/start`; no separate approximation of v2 is used.
Source ZIPs, revisions and valid existing renders are not rewritten.

## Focused verification

- `tests/ember2-pcm.cjs`: Chromium/WebKit, full two-bar bank at 44.1/48k, nonzero
  later-bar energy (not just a first transient), safe finite stereo, ten audible
  mechanism counterfactuals, exact determinism, legacy float PCM, tempo scaling,
  and extreme high-feedback/manual settings. Energy onset detection smooths over
  low carrier cycles and uses a rhythm-relative refractory period, so waveform
  zero crossings are not counted as extra beats.
- `tests/ember2-core.cjs`: sustained output at eight BPM values, internal finite
  delay/filter state across fractional boundaries, independent own/other reverb
  counterfactuals for all four voices, and continuous beat phase on tempo edits.
- `tests/ember2-browser.cjs`: actual Play -> final stereo output, touch patch/
  rhythm actions, selected-voice power, representative controls, history,
  account library + EQ, portable JSON/ZIP and reload, 320/390/768/1440 geometry,
  explicit archive/new transition and rejected edits.
- `tests/test_ember2.py`: schema parity across 24+32 recipes, invalid inputs,
  unchanged v1 identity and silent v2 identity, raw snapshot freshness, immutable
  source ZIP/revision and warm reuse; existing Ember library tests retained.
- `tests/ember2-song.cjs`: baseline v1 before/after cached byte identity plus
  four fresh real server-rendered v2 parts, wet/filter/cross and EQ, current
  capability rejection, metadata/PCM-only phone playback and warm no-job reuse.

Run the new suites in an isolated `song-beta-test-server.py` store. Set TASK,
BASE, OUT for JS tests; Song PHASE is legacy-before / legacy-after / new.
The native/browser evidence is not physical iPhone or DAW listening.

## Archive and rollback

Before rebuild: `output/mygrain-ember2-20261117T115741Z/before/` saves every
modified existing file. `archive-ember-1-20R1/` saves Ember 1 UI, DSP, worklet,
CSS and docs. No user samples or account data are exposed in either location.
Restore only task-scoped files, never reset the already-dirty repository.

## Output gain revision 21 (2026-11-17)

Fixed 4x (+12.04 dB) post-sum makeup before the existing output DC/air/safety
stages. Oscillator, filter, per-voice reverb excitation and cross-feedback levels
are unchanged. Output 0 remains silent; manual volume/voice levels remain exact.
All v2 sounds use this staging; audible v2 Song renders require capability 21 so
quiet capability-20 freezes are rejected and regenerated from immutable sources.
Version-1 PCM and inactive v2 content identity remain unchanged. No saved recipe
schema or account patch records are migrated. Generate patch is a label change;
its existing history-aware generator is retained. Follow-song padding fits the
whole label in its existing 80px phone cell.

## Automatic level revision 22 (2026-11-17)

Mark requested much more level and automatic adjustment after the fixed +12dB
revision. Replaces the fixed 4x stage, without changing oscillators, filters,
feedback, patterns, factory recipes or portable schemas.

Signal: synthesis -> DC/air filters -> RMS auto makeup -> manual Output fader
-> 3ms stereo-linked lookahead limiter -> existing final soft safety knee.
The detector is before the manual fader, so it cannot undo a volume reduction.
The fader uses a 2.1x full-scale range; the limiter protects its loud end. An
explicit zero is exactly silent, including queued lookahead samples.

The gated 80ms stereo-power detector aims at .65 RMS before the fader, with
bounded .125–128x makeup, 25ms gain reduction and 600ms gain recovery. It freezes
makeup on digital silence. A monotonic peak deque, allocated once, covers 3ms of
future audio relative to delayed output. Linked gain caps both channels at .94,
with 4ms release; the retained safety knee gives a final ceiling below .93.
No per-sample allocations, noise source, feedback gain change or global-bus edit.
This is RMS-based automatic level control, not LUFS or transparent fixed gain;
peak dynamics intentionally become more controlled. It adds 3ms source latency.

Only audible Ember2 Songs require capability22; immutable quiet21 sources are
re-rendered through the same processor. Off/empty/archived Ember1 identities stay
unchanged. Existing Generate patch wording and fitted button layout are retained.
Tests: ember2-auto-level.test.cjs (abrupt levels, stereo, silence, fader),
ember2-auto-pcm.cjs (24 factories+16 generated at65/100 in both engines), ordinary
bank/mechanism/core/browser suites, and ember2-auto-song.cjs (the exact preceding
four source ZIPs, current server render, no revision/source edits, warm phone).


## Industry sample voices and 200 new studies — revision 23

Mark explicitly replaced NEW pulse-source sounds with short random recordings
from SAMPLES_INDUSTRY (2026-11-17), retaining the entire card geometry, rhythm,
filters, cross network, per-voice space, LFOs, EQ, private library and auto level.
This supersedes the new-source oscillator requirement; no originals are changed.

Optional `modes.ember.sampleSource:{version:1,seed:1..16777215}` selects the
immutable industry corpus v1 and frozen xorshift selection algorithm v1 in
`ember2-samples.js`. It picks four DIFFERENT recording IDs, active chunks and
random 180–480ms windows (shorter recordings remain intact). Explicit short cuts
are requested here, not a change to whole-app generated-cut 2/1 policy. Source
provenance is seed + corpus/selection revision, with exact original SHA, chunk
SHA, integer start/frames and applied gain exposed by prepared(s).picks. No
transient buffers, account ownership or Worker state enter saved recipes.

A dedicated Worker fetches only these four <=16s PCM16 chunks, checks exact bytes
and SHA256, removes DC, applies 3ms edge fades, and peak normalises EACH cut to
0.9 (-0.92dBFS). A near-silent window deterministically searches its SAME chunk
for usable energy; totally silent data fails honestly. No synthetic oscillator
or noise fallback is mixed into sample mode. The existing derived corpus comes
from all716 ready industry recordings: mono, anti-alias resampled24kHz, original
identity retained. It does not preserve source stereo or content above12kHz.
Caches retain four prepared banks; account lock terminates the Worker and rejects
retired work. Failed interactive loading preserves the preceding sound.

The source reader interpolates the short loop with BPM-related rate:
`rate = (BPM/120) * (ratio/32)` at recorded speed. Stereo detune and signed cross
coupling modulate it, including through-zero reading. Pulse width becomes sample
offset; body becomes original/offset blend, with the existing width LFO moving
that offset. All control IDs and ranges stay intact; source labels are truthful.
The post-source filters/chambers/rhythm and revision22 automatic output remain.
For sample sources only, the makeup ceiling is512x rather than128x so strongly
filtered/transient recordings can reach useful level; the stereo peak limiter
and manual-fader independence stay unchanged. Pulse archives retain128x exactly.
This is creative sample playback, not an alias-free physical-model claim.

New app/clean-start/Generate patch/factory loads choose a fresh source seed and
therefore new recordings/start points. Saved library/project/Undo/ZIP/Song recall
retains its seed and reproduces the SAME cuts: rendering must never reroll saved
audio. Existing v2 snapshots WITHOUT sampleSource keep their pulse sound and
capability22 exactly; archived v1 remains unchanged. Press Generate patch or
Clean start when an old current workspace is still using the pulse source.

The existing24 studies remain, with200 ADDITIONAL recipes (224 total): ten
families ×20 studies (Foundry, Relay, Conveyor, Scrapyard, Turbine, Hydraulic,
Cold Chamber, Machine Room, Metal Garden, Factory Ghost). Every new recipe has
independent sources, rhythmic layout/ratchets, gate/chance/glitch, filter topology,
coupling matrix, stereo/offset blend, chamber size/decay/send and LFO clocks/depths.
The bank is not created by transposing a small set. Tests require200 unique
non-pitch/non-seed parameter signatures AND200 distinct source realizations.

Only audible sample-source states require capability23; off/zero/empty identities
and saved pulse22 are unchanged. Both adapter decode and isolated Song deck await
MygrainEmber.prepare(context,savedState) before capture. Server validation accepts
the source revision/seed strictly and original-snapshot GET/POST admission rejects
stale22 sample freezes; sources and Song revisions are immutable during rendering.

Focused checks: tests/ember2-samples-pcm.cjs (every224 real selected source bank,
all at48k plus34 at44.1k, Chromium/WebKit; each cut peak/fade, four distinct IDs,
late energy, controls/all four real sources, determinism and eight old pulse
PCM pairs); expanded test_ember2.py; full touch/history/library+EQ/portable/reload
suite including ten new family selections and failed-load rollback; actual
server Song jobs, source immutability and warm PCM-only phone reuse. Browser
emulation/native PCM measurements do not establish physical iPhone listening.


### Precise legacy server comparison (this task)

Four original capability20 source ZIPs from the earlier task were rendered again
at capability22 in dedicated copied test stores, through BOTH exact pre-task22
files and the sample candidate. All four source instrument FLOAT renders match
before/after exactly at44.1/48k. Original source ZIPs/revisions stay exact.
Full server WAVs are not universally byte-stable against the historic freeze:
the old EQ part differs from that freeze by19.1991 int16 LSB RMS /495 peak in BOTH
builds, while candidate and pre-task EQ WAV match byte-for-byte. Other candidate
versus pre-task WAV differences are <=2 int16 LSB peak and<0.1 LSB RMS (observed
quantisation floor). Do not describe every old full-server render as byte-exact,
or treat one arbitrary baseline failure as proof. The strict historical-byte
failures, per-part paired metrics and exact float test are retained as evidence.
No shared EQ/mixer code or existing cached production WAVs was changed.

Run `ember2-samples-legacy-song.cjs` with OUT containing legacy-song-before.json,
legacy-source-{0..3}.zip and legacy-baseline-render-{0..3}.wav from its isolated
pre-task store. It checks actual candidate jobs, immutable sources/revision,
bounded per-part PCM difference against that baseline and warm no-job phone playback.
`ember2-samples-loading.cjs` separately verifies network rollback, stale restore
ownership and authoritative Stop during pending cold Play in both browsers.

A second forced server run exposed the existing one-frame capture/start timing
floor in other parts too (raw max645 LSB /21.47 RMS; best +/-1-frame diagnostic
alignment reduces relative RMS below1%, including the pre-task/historic EQ pair).
Therefore the server regression records per-part best shift/residual and asserts
<=1 frame /<1% relative RMS, not arbitrary byte equality or a universal2LSB bound.
This diagnostic alignment NEVER edits or retimes rendered/user PCM. The independent
original-source instrument comparison remains FLOAT-EXACT at both host rates.
Source preloading awaits are conditional on audible sampleSource, retaining the
legacy preparation order. No claim of universally identical full-server rerenders
is made; valid cached production audio remains untouched.


## 96 dB filters, effective cross coupling and shared clock (Mark, 2026-11-17)

EMBER2.5 /20261117-ember2-filter-1 uses optional engineRevision:2 with
clockDivider in1,2,3,4,6,8,12,16 and swing:0. Swing is removed from the card and
new sequencers. One divider slows all four patterns/ratchets/gate durations,
not sample speed, LFOs, reverb or the song BPM. Clock updates maintain a separate
sequence phase anchor. Generate patch randomises it; Randomise divider changes
ONLY it. State/history/ZIP/library/Song retain it.

The previous filter mixed a primary signal and notch in parallel around its
second low-pass stage; it could not have a steep stop-band. New Filter96 has
eight serial TPT Butterworth biquads (16 poles) at each low/high boundary. The
LP/BP/HP morph moves their edges: low-pass + low cut at0; bandpass at.5; high-pass
at1. Both bandpass edges are96dB/oct. The moving notch is SERIAL after these
edges, never a full-band escape path. Resonance adjusts the last section.
Stereo spread/filter LFO still configure each real stereo chain. Precise nominal
slope is measured below the numerical floor with settled tones; the original
short measurement captured15Hz high-pass settling, so the oracle settles5s.

Old sample RMS could drive less than1% rate modulation at normal depths. New
signed cross routes use a bounded RMS-normalised carrier followed by6x speed
and.04-cycle phase modulation per unit coupled index. Modulation still derives
ONLY from the selected recordings/voice reverb; no oscillator/noise fallback.
Depth0 / zero route is exactly off. Post-voice levels, power, signed routing and
individual reverb feedback remain. Auto output and limiter remain unchanged.

Sample cut width is a protected user-selected source.frames integer16..384000
at the immutable24kHz corpus rate. All voices request that exact width, clamped
only to shorter chunk length. Default8192. Selection consumes the original PRNG
draw even with fixed width so recording/chunk choices stay version-stable.
Source-memory admission includes actual cached banks, the chosen width, Worker
chunk bytes and worklet-transfer overlap (minimum8MiB). The four-bank cache stays
bounded. Generate patch, factory/prev/next, rhythm and divider randomisation never change
this width. Library/Undo/project/Song recall restores saved width. Its change
prepares verified real cuts BEFORE committing the state, retaining stale-load
and failure guards. Original variable-width source recipes without frames retain
their exact cuts in the rendering model.

Interactive v2 editor restores adopt engineRevision2 / straight timing / the
protected width (keeping seed, recordings, other controls and current divider).
Explicit v1 archive stays frozen. Original source ZIPs and their server deck
restores are NEVER migrated: render-deck flag bypasses interactive upgrade.
Absent engineRevision keeps the exact prior sample23 / pulse22 DSP and identity;
revision2 audible states require24. Off/zero/empty remain neutral. Admission
checks reject stale23 new-state freezes, without invalidating unaffected old
valid production audio or mutating source ZIPs/accounts.

Focused verification: tests/ember2-filter-clock-core.cjs (actual TPT slope and
processor sequence mapping/continuous phase), ember2-filter-clock-pcm.cjs (real
cut lengths, randomisation invariant, level-normalised filter/cross effect sizes,
old sample/pulse exact), expanded sample-bank/browser/backend/Song checks. Bank
timbre runs explicitly hold clockDivider1 so every sample/filter source is heard
within a4s test window; all8 actual divider factors are separately measured.
This does not claim a complete128s slowest pattern audition for every patch,
physical iPhone listening, or universally byte-repeatable full-server captures.


### This update's old sample server precision boundary

An original sample23 ZIP was imported byte-for-byte and rendered by actual
server workers in the candidate and exact pre-task build. Its historic WAV
versus pre-task rerender differed by10.06% aligned relative RMS; candidate
versus historic21.11%, and candidate versus pre-task24.66%. These complete
server WAVs therefore are NOT asserted identical or bounded by the earlier
pulse-test1% floor. Sources, revisions and valid production caches are untouched.

Fixture-only worker instrumentation verified BOTH use renderDeck=true, the
SAME complete archived normalized state (no engineRevision/no fixed frames),
and identical prepared source diagnostics. Actual scheduled origin/time were
4.5724716553287985 and4.630521541950113 at44100Hz. Rendering the pre-task
worklet alone at those two absolute times already produces40.91% relative
RMS difference after +/-1-frame alignment: the archived nonlinear feedback
engine is absolute-time/phase sensitive. This is specific measured evidence,
not an inference from an arbitrary baseline failure. The candidate worklet
versus pre-task worklet at EACH identical recorded time is float-exact. See
evidence/legacy-absolute-time.json, worker-legacy-diagnostic.jsonl and
legacy-server-paired.json in the task backup. Worker probes are fixture-only
and were removed afterwards; no shared timing/EQ/mixer fix is smuggled in.
The stable regression boundary is identical state/source/start-time DSP and
immutable original/cached audio, not universal full-server WAV repeatability.


## Damped filters, grid-locked sources and sample display — revision 25

Mark reported excessive resonance and loops sounding out of time, and requested
the actual samples used. Interactive Ember v2 now upgrades to engineRevision3.
Render decks still normalize the original revision without upgrading. Audible3
requires capability25; revision2 remains24, original samples23, original pulses22.
Source ZIPs, archive recipes, valid cached PCM and Song revisions are not rewritten.

- Baseline8192-frame/ratio32 sample loop lasted0.682667 beats, not a beat-grid
  division. New source cycles round the existing frame-count/rate-derived duration
  to the nearest power-of-two beat span (1/16384..256 beats); the same protected
  PCM cut is resampled, never resized or reselected for timing. The shortest
  allowed division rises by whole octaves when needed to keep the unmodulated
  source cycle below0.4×native sample rate at the current BPM. The speed slider
  is labelled grid-snap; glitch pitch jumps also snap the resulting loop division.
- Every accepted sequencer hit/ratchet resets the cut's source-time anchor to
  its exact shared-clock position, including deterministic chance/glitch and the
  global divider. Late starts begin at the correct age within the hit. Tempo and
  divider anchors remain continuous; loops cannot accumulate source-phase drift.
- Stereo drift is bounded phase movement and cross modulation is bounded, signed
  audio-rate phase coupling (not integrated speed). Thus both remain audible
  without letting cross FM pull the source clock off the beat grid. LFOs and rooms
  retain main BPM; only the four sequencers use the shared divider.
- New96dB/oct edges use four cascaded fourth-order Butterworth sections per edge
  with corner compensation, rather than a single high-Q16th-order Butterworth
  edge. Maximum section Q is much lower; resonance boost is restrained and edge
  motion has12ms log-frequency smoothing. Serial notch still cannot bypass edges.
  Defaults use6% resonance; future recipes generally1.5–20%, not up to72%.
  Explicit manually saved resonance values are retained, not clamped on recall.
- In the1kHz/60%-resonance LP test, maximum magnitude falls1.2106→1.0279;
  differentiated impulse-tail energy after10ms falls0.0008405→0.0001545
  (~82% reduction). This is a filter fixture, not a universal listening claim.
- The source display shows all four recording titles/filenames and original
  start times, actual extracted frame counts and milliseconds. Prepared PCM
  produces min/max waveforms; stopped cold recall shows selected identity and
  clearly says the waveform loads on Play. Actual Worker-adjusted starts replace
  provisional selection metadata after preparation. Canvas paints use the app's
  demand-display callback so backing-store parking/reveal restores the waveform.
  It adds no player, audio path, continuous animation or extra sample download.

Tests: ember2-timing-core.cjs (same-time old/new DSP,3tempos/all8dividers through
step1023,140grid ratios, all four96dB edge cases at2rates, ringing and internal
stability); ember2-timing-pcm.cjs (actual corpus loop-period correlation and
onset consistency at80/120/160BPM and44.1/48k in Chromium/WebKit); expanded
browser source identity/waveform/parking/phone layout tests; complete224patch
bank, final-output filter/cross slider spectra, backend25admission and real
server25/24/23Song jobs with EQ/source immutability/warm phone reuse. See the
timestamped task evidence for actual pass/failure results, not this test inventory.


## Ember 2.7 — dynamic downbeat resync, trimmed cuts and Export to K

Build `v2026.11.17.EMBER2.7`, asset key `20261117-ember2-resync-1`.

- Live Generate/factory/private-library/recipe changes and timing edits (BPM,
  Follow Song, divider, patterns/rhythm, sample speed/width, gate, subdivisions,
  probability, pitch jump and LFO period) retire E's existing graph and schedule
  a **fresh native worklet on the next four-beat bar**. The main/shared origin
  determines that boundary, using Ember's local BPM when selected. New graph
  origin equals its start time: sequence, sample phases, filters, rooms and
  auto-level all begin fresh, matching Stop/Start. Other cards are not restarted. Timing sliders commit on release rather than
  allocating a new graph on every drag event. Output/filter/cross changes alone remain live updates. Rapid changes replace
  future-scheduled E graphs; no UI timer owns the downbeat. Waiting source loads
  retain the old graph, then schedule only if graph, epoch, context, source/timing
  and load owner still match. Stop, restore/account changes and context disposal
  revoke pending resyncs. Stopped edits never start playback.
- `sampleSource.version:2` opts into silence-trim preparation. Source selection
  and all random draws remain the frozen v1 algorithm. After choosing a section,
  trim leading/trailing samples below max(-48 dBFS, 2% of section peak), capped
  at 25% of peak for very quiet valid recordings. Keep at least16 frames, remove
  the retained cut's DC, apply the existing up-to3ms edge fade, then normalise
  peak to0.9. Interior pauses remain musical content. `sampleSource.frames` stays
  the protected **requested maximum**, never mutated by randomisation; prepared
  `pick.frames/start` and waveform show actual retained bounds, plus
  `requestedFrames/trimStart/trimEnd/trimThreshold`. Source cache includes source
  version. All-zero cuts still fail/relocate deterministically, never pulse-fallback.
- New source-v2 audio requires selective capability26; source-v1 revision3 stays25,
  revision2 stays24, original samples23, saved pulses22 and Ember1 unchanged.
  Worklet DSP is byte-identical to2.6. The original Worker v1 extraction branch
  stays verbatim. Normalisation preserves old sources; interactive `upgrade`
  opts into trimmed v2, while archived Song render decks bypass upgrades. No
  original source ZIPs/revisions or compatible archived caches are rewritten.
- **Export to K** uses the existing Keys recording owner, four-beat count-in,
  exact audio-thread frame window, shared K step-length controls, selected K track,
  account/context/cancel guards, source BPM, persistence and `recordK` history.
  A stable E-only tap receives Ember before external bus/solo processing (its own
  filters, rooms, auto-level and manual output are included), not the backing or
  metronome. On completion K takes over and E powers Off inside the same undoable
  replacement. Previous K audio survives cancellation/failure; cold preparation
  also observes explicit Stop. Capture teardown disconnects its tap. Step length
  is the same quarter-beat unit as Keys at Ember's BPM; choose a longer take for
  a slow divided sequence. Jump to K uses the existing navigation lifecycle.

Regression evidence lives in the task backup: real running source changes vs
fresh native starts, full bank, sample-width boundaries/trim floor, late-load Stop,
real K capture/Undo/Redo and saved Song caps26/25/24/23 with warm PCM-only playback.
Phone viewports are emulation, not physical iPhone listening.

New interactive/default/factory cuts request 2,000 frames. Explicit saved/manual widths remain untouched. Generate patch and Randomise divider share a session-only shuffled bag of all eight dividers (including ÷3/÷6/÷12); each is drawn once per cycle, avoiding repeats where choices remain. The bag is not patch or archived-render data.

## Ember K destination (EMBER2.8)

The K track dropdown beside Export to K mirrors the same K1–K5 selection as
Keys and the K recorder radios, through `mygrainKMultitrack.select`. Selection
is persisted by existing K multitrack state, never a second Ember recipe or
render setting. It locks during Ember preparation and K count-in/capture/processing.
Native capture, selected-track Undo/Redo, other lanes, DSP and Song rendering are unchanged.

K remains one canonical Layers row, clearly labelled Loop K. Its existing
button volume/swipe control, additive Solo and Jump are retained, not duplicated.


## Cut-width slider and grid-only randomisation (EMBER2.9)

The existing exact numeric cut-width box retains its 16–384000-frame range for
saved/manual widths. A native slider beneath it spans 100–10000 frames in steps
of100; pointer gestures snap within200frames of5000, while keyboard steps stay
100frames (and can leave the detent). A temporary value bubble settles to an
explicit Regenerate action. Neither preview nor cancellation changes PCM/state;
Regenerate prepares the existing four deterministic cuts at the requested width
and commits one history edit. Recall/Undo/account changes clear stale previews.
Saved widths outside the slider range stay exact in the number box, not migrated.

Randomise grid replaces only the four existing 16-step voice.pattern arrays,
retaining all source identities/widths, divider, seeds, power, tempo, levels,
filters, motion, cross routes and reverb. It uses one history edit and the
existing next-bar E-only resync. The divider randomiser is separate. No engine,
saved schema, DSP/corpus, server render algorithm or compatibility bump. Existing
Song decks consume the same canonical width/patterns.


## Optional sample decay / coupling sensitivity (EMBER2.10)

A sample-cut decay control spans0–2000ms (default0). Positive values apply an
exponential envelope follower per voice, extending the existing hit envelope
into rests with a60dB decay time equal to the selected duration. Source cycles
remain grid anchored; no new hit times, source selections, reverb or delay.
Off/zero follows the exact original branch. Optional top-level sampleDecay is
seconds, omitted at0. Enabled sample sources with positive decay require27;
all archived v1/pulse/sample revisions and inactive/zero hashes remain unchanged.
Server validation and original-snapshot render GET/POST admission enforce this.

Cut slider100–20000, step100;5000detent unchanged (now24.62% along the range).
Existing numeric16–384000and saved widths remain exact.
Coupling UI100% maps to canonical crossDepth=.15, through one setter on live
and saved/server paths. Fresh factory/Generate/Clean start scale depth by.15;
raw bank recipes remain frozen. Restoring existing saved recipes does not scale
them twice: values above.15 are labelled Saved…above new range until edited.
Zero decay and grid-only Randomise retain prior settings/audio semantics.

### Grid section copy

Copy section uses the shared app convention: tap first source step, last source
step (same voice; either direction), then insert step in any voice. It copies
exact hit counts including rests and repeats through step 16, clipping the final
repeat. Source selection is highlighted and does not edit the sound. Capturing
the source before paste makes overlaps safe. One paste is one guarded Undo/Redo
edit; only the destination pattern changes. Cancel copy or Escape cancels. Other
edits, recall and account lock/change discard the transient selection. Nothing
new is serialized: live/K/Song rendering uses the existing voice.pattern arrays.


## Sample-only regeneration (EMBER2.11)

Regenerate samples, beside the sample display, rerolls the shared source identity (and clears any later per-lane overrides): four industry recordings and their cut starts. Every other canonical value stays exact, including the synthesis random seed, grid/ratchets, divider, width, decay, coupling, voice/filter/LFO/reverb recipes, power, level, local BPM and E EQ. It is separate from the cut-width preview's Regenerate action; the latter still applies only a pending width. A pending width is not applied by sample-only regeneration.

Prepare all four real samples before one guarded history commit. Failure, recall/account change, an intervening state change, recording or saved-Song playback must not replace the current sound. Loading disables duplicate sample/cut actions; Stop remains authoritative and a stopped graph is never restarted. Existing live changes use the next shared bar. Undo/Redo, private library, portable project and Song snapshots retain the selected seed deterministically. Archived v1/pulse sources cannot invoke the action.

The EMBER2.11 addition made no model, schema, sample selection/preparation algorithm, DSP, render-version or backend change. Saved/source snapshots never reroll automatically; see EMBER2.12 below for the additive per-lane source extension. Existing server render-deck preload/capture and PCM-only warm playback handle the canonical source seed. Regression: `tests/ember2-samples-only.cjs`; real isolated Song job evidence accompanies the deployment backup.


## Per-lane sample Regen and local voice Solo (EMBER2.12)

The old I–IV column is now two equal stacked controls without widening the grid.
The upper Roman numeral selects that voice editor; double-click/double-tap solos
that voice locally inside E. Double again clears, double another switches. A
copper/gold highlight and status show local Solo. Other cards/global Solo are
untouched. This is transient output monitoring after each voice's existing
filter/room, not a canonical voice On/level edit: cross-modulation and room
processing continue. It survives per-lane sample regeneration, but clears on
patch recall/history/account change and is not saved or used by offline/Song/K
exports. Normal state and legacy PCM are exact when no local Solo is active.

The lower Regen selects a new recording and cut start for only that voice; its
previous recording and the three retained recordings are excluded. Every other
canonical recipe setting and the other three prepared sample arrays stay exact.
The shared protected width is retained; pending width is not silently applied.
All samples prepare before one guarded undoable commit; failure, stale recall,
account changes and Stop retain the existing safety rules. All-sample Regenerate
clears lane overrides and replaces all four; factory/new patches also start fresh.

Optional sampleSource.voiceSeeds is exactly four null or integer source seeds
(1..16777215). Null reuses that lane's frozen shared-seed selection; a number
selects that lane from the same frozen algorithm run with that seed. Only the
chosen lane is overlaid, so other lanes never shift. All-null is omitted by JS
canonicalization and stripped only from backend content identity; original ZIPs
are never rewritten. Source preparation versions and corpus v1 are unchanged.
Audible nonneutral overrides require selective Ember capability28, without
invalidation for legacy26/27/25 audio. Client/backend original-source GET/POST
checks, render producer and saved library validation accept28 and strict optional
seeds. Server decks preload the same deterministic bank before capture; phone
warm playback stays metadata/PCM-only. See ember2-lanes tests and deployment
evidence for real current/archived server jobs and zero-delta legacy PCM checks.

## Step loop and complete next-bar changes (EMBER2.13)

The Step loop controls sit above the four voice patterns. Start step and End step
are inclusive, 1–16, and apply to all four voices. On repeats only that window;
Off plays the original complete 16-step patterns without erasing the chosen
range. The < / > buttons shift both ends by exactly one step, keeping the window
length; they disable at the grid edges rather than wrap or resize. A single-step
loop is valid. Cells outside an enabled window are dimmed but remain editable.
The common divider still owns step duration; LFOs, reverb and sample cycles stay
on the main BPM. Pattern contents and original sample bytes are never rewritten.

Optional canonical `stepLoop:{enabled,start,end}` persists through history,
private account patches, JSON/ZIP and reload. Missing means Off / 1–16; factory,
Generate patch and Clean start keep the current performance window. Saved patch
recall restores its actual window, including clearing an absent optional value.
The backend requires exact keys, a boolean enabled flag and ordered integer ends.
An enabled partial window requires the straight sequencer engine. Only audible
partial loops require Ember capability29; missing/Off/full-range loops preserve
legacy capabilities, PCM and content identities. Neutral loop metadata is removed
only from content hashing, never from stored source ZIPs. Loops containing no
enabled hits are inaudible. Original snapshots, source hashes and Song revisions
remain immutable; stale GET/POST render admission checks the original source.

Every committed Ember sound change now follows the existing next-shared-bar
resync policy, not just timing fields. Slider movement previews its value; release
commits one history action. Loop bounds, arrows, patterns, timbre, matrix, level,
tempo, presets and loaded samples all use the same path while playing. Cold
sample preparation completes before choosing the next safe deadline.

The current native graph keeps sounding while a fresh graph waits for that
audio-clock downbeat. Native sample-time retirement mutes the old graph at the
same deadline; a processor acknowledgement releases its nodes without a musical
UI timer. Repeated changes replace the pending graph instead of accumulating
future starts; automation continues observing the currently audible graph's
origin/tempo until handover. Source/global Solo monitors both graphs immediately.
Stop, E Off, account lock and context retirement cancel both graphs and cold-load
completions. Saved render decks apply their immutable recipes immediately and
render the same loop processor; no live waiting interval enters a Song or K take.

Focused tests: `tests/ember2-step-loop-core.cjs`,
`tests/test_ember2_step_loop.py` and `tests/ember2-step-loop-{browser,pcm,queue,song}.cjs`.
Use TASK for the before/evidence directory and BASE for the isolated authenticated
test server. Coverage includes all 136 ordered ranges, 9,792 four-voice events,
12 exact legacy PCM comparisons, real corpus repetition at both sample rates,
Chromium/WebKit controls/persistence/live handovers and three real server parts
(seven-step, single-step and archived no-loop), followed by warm PCM-only playback.
Queue tests cover superseded edits, the old effective Follow-song BPM, immediate
E Off and cancelled cold preparation. Existing K-export, source-lane/Solo and
section-copy regressions remain part of release verification. Browser emulation
is not a physical iPhone or DAW listening test.

## Global pitch and duration modes — EMBER2.14

Global pitch is shared by all four voices, in integer semitones from -24 to +24.
The optional canonical field is `pitch:{semitones:12,mode:'keep'}`; absence means
zero semitones and Keep duration. `keep` resamples the original prepared cut and
uses the existing WSOLA stretcher to restore its exact frame count, reducing its
analysis window for short cuts so alignment search remains available. `speed`
resamples without restoring duration: higher pitches shorten each sample cycle,
lower pitches lengthen it. Neither mode changes the sequencer, divider, LFO or
reverb BPM. Sequencer hits still retrigger the sample normally; a long sample can
therefore be retriggered before its end. Very short cuts and extreme shifts may
sound granular. The Reset pitch button returns to zero without losing the mode.

Pitch preparation happens in the sample Worker, never in the audio callback.
Original corpus chunks are SHA-256 checked before the original trim/DC/fade/
normalisation path. Antialiased resampling and stretching create derived PCM;
they never overwrite the recording, selected bounds or saved source recipe.
The Worker retains original prepared frame counts separately, allowing the
revision-3 clock to keep the original snapped cycle or divide it by the pitch
ratio without re-snapping semitones. Cached banks include nonzero pitch/mode in
their identity and are bounded by four entries and 32 MiB. The old zero-pitch
Worker output and source identity are unchanged.

Committed pitch and mode edits use the same cold-preparation/next-shared-bar
graph handover as other sound edits. Slider input is preview-only until commit.
Stop and E Off invalidate pending starts. Settings survive account patches,
history, project JSON/ZIP, reload and immutable server Song snapshots. Factory,
Generate and Clean keep the current global pitch; saved-patch recall restores
its own pitch and clears an absent optional pitch. Archived pulse-v2 voices
transpose their oscillator rate; the archived v1 engine is not migrated.

Only audible nonzero pitch requires render capability30. Neutral pitch is
excluded from content identity, preserving legacy hashes and cached renders.
Partial step loops without pitch still require29. Server upload and cached
render admission derive the requirement from the original source ZIP, not stale
metadata. Existing source ZIPs and Song revisions remain unchanged.

Focused checks: `ember2-pitch-{core,legacy,pcm,browser,queue,song}.cjs` and
`test_ember2_pitch.py` in `tests/`. Core checks cover all 96 nonzero semitone/mode
pairs and protected cut widths; native Chromium/WebKit Worker/worklet checks
measure pitch direction, frequency and exact prepared durations at 44.1/48 kHz.
Browser checks cover persistence, layout and sample-accurate next-bar handovers;
real server jobs cover both modes and an unchanged capability29 archive, followed
by warm PCM-only phone-mode playback. Run with TASK pointing to before/evidence
and BASE to the isolated authenticated fixture. These are not physical-phone or
DAW listening tests.
