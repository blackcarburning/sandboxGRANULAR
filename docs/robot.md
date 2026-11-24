# The Robot (main app only)

A red, bottom-app source card. Not included in the frozen On Demand app or its
private renderer. `robot.js` owns canonical `modes.robot` state, phrase UI and
transport; `robot-dsp.js` owns normalization and preparation; `robot-worklet.js`
plays word samples on the shared audio clock. `step-grid.js` is the shared
Ember / Restructure / Robot cell-ratchet and shift helper. Existing Ember and
Restructure DSP is unchanged.

- 1–16 words per phrase, 1–16 phrases per patch. Six classic eSpeak variants plus sixteen natural Kokoro US/UK male/female voices.
- Local eSpeak NG 1.51 renders each word separately. Optional MIDI notes C2–C6
  set a monotone voiced pitch; natural speech remains available. Integer-Hz
  voice pitch is compensated by +9 Hz for 1.51's `pitch_base=(pitch1-9)<<12`.
  Consonants remain unpitched. See official eSpeak NG `docs/voices.md` and
  `src/libespeak-ng/voices.c` (1.51). No network synthesis or utterance cache.
- Speech speed / voice / note changes apply only when rendering/re-rendering.
- Initial starts are `floor(wordIndex * 16 / wordCount)`; an eight-word phrase
  starts at steps 1, 3, 5, …, 15. Ordered placement is intentionally unrestricted.
- Cells cycle Off → 1 → 2 → 3 → 4 ratchets → Off. Manual editing can create
  repeats and overlapping words. Arrows wrap the entire lane by one sixteenth.
- Grid Randomise fits **complete word durations at the current BPM**, reserving
  every occupied cell at the selected Robot loop length. It does not wrap a word past the loop seam. If all
  words cannot fit, unfittable lanes are empty and the UI reports the count.
  Later tempo changes or manual editing can create overlaps; randomise again
  to fit the new tempo. It never truncates speech to pretend words fit.
- New empty Robot cards use a four-bar independent loop. Select 1/2/4/8/16
  bars: the 16 grid cells span that whole loop, each phrase plays once, then the
  next enabled phrase. Audio itself stays at native speed. `modes.robot.loopBars`
  is saved with the patch. Missing loopBars preserves archived transport-pattern
  cycles and per-bar grids exactly (the Transport · legacy menu option).
  Disabled phrases remain saved but are skipped.
- HTML drag ordering plus accessible/touch up/down controls. Ordering, activation,
  grids, power, levels, recipes and all word PCM participate in portable ZIP,
  private patch, local state and Undo/Redo paths. Audio is one immutable packed
  `robotWords` mono WAV with per-word offset/duration ranges. Appending the
  audioBindings slot preserves existing index-based history journals.
- Global/individual non-Robot randomisation and AI generation leave Robot Off
  without erasing phrases; its own grid randomiser edits the grid. Recall does
  not enforce generation policy.

## Backend and isolation

`POST /mygrain/api/robot/render` inherits main-app authentication, pinned account
header and same-origin protections. `backend/mygrain_robot.py` allowlists voices
and parameters, bounds text/word counts, runs eSpeak via stdin (no shell), uses a
private temporary read-only-data overlay and two synthesis permits, and removes
all temporary word files. Render/cancel/account/context guards prevent late
responses from replacing a patch. No credentials or cloud API are required.

`backend/mygrain_songs.py` validates Robot recipes and embedded WAV ranges. All audible Robot parts now require render capability 34 (complete overlapping
word tails and optional maximiser). Missing-loopBars timing remains unchanged. The full phrase chain expands
Song's pattern cycle by LCM with existing sequencer/drum timing. Decode, isolated
borrowed-context preparation and server workers use the same word worklet.
Missing/off Robot state, audio slots and bank data are omitted from render
identity, preserving legacy/off patch freezes. Never rewrite source ZIPs.

## Checks

`tests/test_robot.py`, `tests/robot-browser.cjs` and
`tests/robot-edge-browser.cjs`. Browser tests use isolated account/Song stores,
Chromium + WebKit, real server-generated words, deterministic offline PCM,
portable source recall, native output, server Song render + warm playback,
16 phrases / 256 lanes, reload persistence, cancellation, delete/Undo and
250 randomized no-overlap allocations. Run with a dedicated
`tests/song-beta-test-server.py` fixture; never production account stores.

## Layers and Mix (2026-11-22)

Robot's Layers row uses the normal power / Jump / additive Solo layout and red
`robot` navigation palette. Its power button is registered with the shared
swipe/keyboard volume and visibility-owned meter owner, using `robotVolume` and
the existing graph output; canonical power, phrases and word audio are unchanged.
`robot` is an accepted saved `loopLayerSolo` target, using the existing source
mask/gain and server render-deck path rather than a separate audition flag.

Mix includes Ember, Enemy Drone and Robot faders, Solo, Jump and optional VU.
Their `data-mirror-control` proxies forward input/change to the canonical card
controls, keeping native history handlers and excluding extra saved parameters.
`mygrainInstrumentMixer.sync()` is invoked by canonical view updates, including
restore/Undo; no polling, new audio stages or DSP/cache-version changes. The
existing Restructure mixer fader remains unique and covers both archived PCM
and the eight-lane engine; its VU now follows the owning output. Mix Jump uses
the existing parked-card reveal/navigation lifecycle.


## Natural Kokoro voices (2026-11-22)

Kokoro 0.9.4 / Kokoro-82M v1.0 runs offline. The original CPU-only venv remains
unchanged at `/opt/openclaw-kokoro/venv`. CUDA torch 2.6.0+cu124 is installed in
`/opt/openclaw-kokoro/venv-cuda`, whose `kokoro-local-dependencies.pth` references
that pinned CPU venv for non-Torch speech dependencies. Exact CUDA packages are
in `requirements-cuda.lock`; original packages remain in `requirements.lock`.
Local model/voice SHA-256s and source revision are in
`/opt/openclaw-kokoro/manifest.json`. Source and voice licence: Apache-2.0,
https://huggingface.co/hexgrad/Kokoro-82M revision
`f3ff3571791e39611d31c381e3a41a3af07b4987`. No cloud speech API/key or runtime downloads.

Sixteen voices: original Heart, Bella, Emma, Michael, Puck and George, plus
Nicole, Sarah, Aoede, Kore, Nova, Alloy, Fenrir, Isabella, Fable and Lewis.
Canonical IDs use `kokoro_` plus the pinned voice filename stem (`af_nicole`,
`af_sarah`, `af_aoede`, `af_kore`, `af_nova`, `af_alloy`, `am_fenrir`,
`bf_isabella`, `bm_fable`, `bm_lewis`). Heart remains the empty-card default;
speed170 is normal. Note / key remains classic-only. Existing saved PCM never
regenerates on recall or changing the menu; explicitly Re-render selected.

`mygrain_speech_workers.py` owns at most two reusable neural subprocesses in the
native documenter service. Every active request first acquires one FIFO lease
from the existing shared ten-slot `mygrain_worker_pool`, kind `robot-speech`,
owner hashed by that scheduler. No separate capacity bypass. Each child lazily
loads one model on CUDA when available and shares it between US/UK pipelines;
CUDA failures are reported, not retried as an unlabelled CPU render. Without
CUDA support it uses CPU and explicitly reports `device:cpu`; the UI reports
RTX acceleration only for `device:cuda`. The existing CPU-only interpreter is
also available when the CUDA interpreter is absent.

Warm workers retain model/language/voice tensors only, never a phrase or audio
cache. Text travels on stdin, returned WAV/word metadata on stdout. There are no
text/audio temporary files or runtime downloads. Each inference has a 90 s deadline;
failed/timed-out children are killed and replaced on the next request. Idle
workers release GPU allocations after 45 s (child also exits after 75 s without
input), or recycle after 32 jobs. Idle workers hold no admission lease. The route
retains login, pinned account and same-origin protection but no longer holds an
account storage lock during inference; it writes no account files. Abort/stale
account responses still cannot replace browser audio.

Saved schema, embedded WAV/word bounds, DSP and render capability 34 are unchanged;
only the allowed voice inventory is extended at frontend and backend boundaries.
Server Song renders the saved PCM, never invokes neural speech, so no render
identity bump or cache invalidation is needed. The separate On Demand deployment
has no Robot route and was not changed; the shared scheduler itself is unchanged.

Verification/evidence: `output/mygrain-robot-voices-20261122T163000Z/`. All 16 voices
rendered on the actual RTX 3070; two simultaneous admitted speech jobs observed.
Warm test requests took 0.080–0.727s, cold GPU model load 5.46s; the prior
CPU process took 7.64s for the same ten-word test text. These are observed
short-phrase measurements, not a guarantee for all text/load conditions.

Natural synthesis receives the full phrase (not isolated one-word calls), then
maps Kokoro token timestamps back to original whitespace words, including
contractions/numbers/punctuation. Adjacent word boundaries use midpoint timings;
audio is peak-normalized once, then each word's quiet leading/trailing model
padding is trimmed using 2ms RMS windows at -50.5 dB relative to that word's
peak (at least one PCM16 unit), retaining 4ms attack / 8ms tail guards before
the existing 3ms edge fades. The short energy window rejects isolated low-level
model-noise spikes rather than retaining hundreds of milliseconds of padding.
Internal pauses, sample rate and speech speed are unchanged; there is no gate,
per-word normalization or time stretch. Output is mono
24k PCM16; the existing immutable packed WAV/word-lane interface is unchanged.
Unexpected alignment fails explicitly rather than silently dropping words.
Server Song uses saved PCM, not another neural render. Classic voice recipes,
missing-loopBars timing, and old/off render identities remain unchanged.

Trimming applies only to explicitly rendered/re-rendered Kokoro phrases. Existing
packed WAVs remain immutable on selection, history, ZIP/local recall and server
Song preparation; **Re-render selected** updates an old phrase. Classic eSpeak
trimming and synthesis are untouched. Playback DSP and render identities do not
change, so archived and cached Songs retain their original timing/audio.

Trim checks: `tests/test_kokoro_trim.py` covers quiet consonants, internal pauses,
short/quiet words, model-noise spikes and invalid output. The admitted RTX sweep
covered all 16 voices, soft consonants/punctuation and speeds 100/170/450;
182 new Kokoro word clips were valid and six classic outputs byte-identical.
Tested first-word onset at 1% word peak changed from 97–487ms to 3–23ms
(median 264ms to 8ms); these are synthetic test phrases, not a promise for every
phoneme. `tests/robot-kokoro-trim-browser.cjs` checks authenticated generation,
explicit replacement, unchanged patterns/timing span, exact Undo/Redo audio,
ZIP recall and reload without re-synthesis in Chromium/WebKit, including live
HTTPS. Portable recall compares against each browser's canonical decoded WAV,
not an assumed universal float-to-PCM16 rounding tolerance.
`tests/robot-kokoro-trim-song.cjs` checks archived and trimmed saved PCM through
real server preparation plus warm phone playback, retaining source hashes and
Song revisions. Backup/evidence: `output/mygrain-kokoro-trim-20261122T175917Z/`.

## Complete tails, standard FX and shared routing (2026-11-22)

Manual / ordered words and ratchets retain complete sample tails, including
across loop seams; no oldest-voice stealing at 128 voices. Durations (at most
eight seconds per word), finite grid and BPM bound natural voice lifetimes.
Randomise retains its separate no-overlap placement policy.

Optional `modes.robot.maximiser` 0–100 applies RMS makeup towards -12 dBFS,
up to 24 dB gain, followed by a -1 dBFS sample-peak limiter with 50ms release.
Off/absent bypasses it. It adds no lookahead/onset latency; it is not a true-peak
limiter. This processes playback only, never rewrites embedded word PCM.

`modes.loopFx.channels.Robot` uses the shared Filter & space panel and exact
filter/LFO, hall, tempo delay and pan DSP. New/missing Robot channels are neutral
and dry; mounted through the standard lazy host. State participates in ZIP,
Undo/Redo, recall and server rendering. The Robot joins neutral Channel EQ so
its CharacterFX route can terminate through the normal pre-EQ adapter.

The named `Robot` source joins EffectInputs, Cooking Pot leaves, Wasp input /
destination / Playground choices and source eligibility, on both client and
server. Its audio route is source -> standard card FX -> CharacterFX group ->
source-owned inserts / Wasp / Pot -> existing output. Solo identifier stays
lowercase `robot`; source key stays `Robot`.

Layers inserts Robot before the first effect, including before lazy power-row
construction. Robot-only transport admission is supported. The normal loop
and sequencer starts share one planned start time for armed Robot, Ember,
Enemy Drone and Restructure; Robot retains its independent loop length.

Regression tests: `robot-space-browser.cjs` checks dense complete-tail PCM,
limiter ceiling, hall/delay tails, four-owner loop start, routing registration,
Layers order, FX/PCM patch recall and maximiser Undo in Chromium/WebKit.
`robot-routing-song-browser.cjs` checks legacy D and Robot dry/filter/Pot/Wasp/
maximiser through real server jobs, warm-cache reuse and phone playback with
unchanged source hashes/revisions, all in a disposable account store.

## Grid note dragging (2026-11-22)

Drag a lit cell to another step or word lane to move its ratchet count. An
occupied destination swaps with the source, preserving both notes. Quick taps
still cycle ratchets; empty cells retain native grid scrolling. Touch starts a
drag with sideways movement, or a 250 ms hold arms movement in any direction.
Lit cells own touch from initial contact to avoid Safari cancelling diagonal
drags for browser scrolling. Early vertical swipes instead scroll the nearest
vertical scroll owner through the gesture handler; empty cells retain native
grid/page scrolling.
Pointer capture keeps release/cancellation bounded to this grid; outside drops,
visibility/account/phrase changes and stale gestures do not commit. One completed
drag is one canonical history edit. Existing pattern arrays, ZIP state and audio
are unchanged in format, so no DSP or Song render identity revision is needed.

Touch regression: `tests/robot-grid-drag-browser.cjs` covers held vertical-first
movement (failed before the touch-ownership fix), immediate vertical scroll,
trusted taps, playback, mouse moves/swaps, history and portable recall. Run only
against the dedicated localhost fixture. Physical iPhone remains a separate check.


## Grid double-tap delete (2026-11-22)

Single pointer taps still immediately cycle 0→1→2→3→4→0. Two taps on the
same logical cell within 300 ms delete it; separate cells and keyboard
Enter/Space keep ratchet cycling. Detection survives the grid redraw after
the first tap, and queued cell edits preserve order through history preparation.
The first tap remains its ordinary history edit; delete is undoable separately.
Dragging, scrolling/cancellation, other Robot edits and phrase/restore changes
break the double-tap pair. No DSP, stored pattern or render identity changes.

## Robot shared transport (Mark, 2026-11-24)

Robot has only On/Off; there is no independent Play/Stop control. Robot On arms
it for the same main-loop and sequencer start deadline as the other source cards.
Turning it On while the shared transport is stopped does not start anything.
Turning it On, or adding its first audible grid event, during shared playback
joins the existing transport origin without restarting sibling sources. Robot
Off removes only its own graph and excludes it from the next shared start.
Main transport Stop stops Robot together with the other cards.

The existing shared start/stop hooks remain the owners of transport lifecycle.
Saved enabled state, phrase PCM, loop length, word timing, DSP, server Song
preparation and render identities are unchanged. This control change is not a
repair of the separate native bridge starvation/recovery issue.

## Preserve timing (2026-11-22)

Beside Robot loop, **Preserve timing** captures the current grid span (1/2/4/8/16
bars; Transport legacy captures its original one-bar spacing). While On, loop
length changes only the repeat/phrase-change boundary. The 16 cells, ratchets,
word offsets and native speech speed stay fixed at that captured span. Longer
loops leave silence after the grid; shorter loops skip note onsets beyond the
new boundary without deleting them. Existing word tails are never cut. Switching
Off returns to the original stretch-to-loop mode; switching On again captures
its current spacing. This is beat/bar timing, so the main BPM still controls tempo.

Optional `modes.robot.timingBars` is absent for every legacy/unlocked patch.
It participates in canonical normalization, history, IDB and portable ZIP recall.
Randomise uses the captured spacing and only cells fitting the shorter loop.
Legacy worklet scheduling remains the original branch, with byte-identical PCM
verified across 48 old ratchet/maximiser/loop variants. Locked independent loops
require render capability 35 and Robot engine identity 3; unlocked and archived
transport loops retain capability 34 / identity 2. Server GET/producer upload
admission inspects actual source state; source ZIPs and word PCM remain immutable.

Checks: `tests/robot-timing-worklet.cjs`, `tests/test_robot_timing.py`,
`tests/robot-timing-browser.cjs`, `tests/robot-timing-song-browser.cjs`.


## Kokoro word alignment (2026-11-22)

The Robot's **Word alignment · Kokoro** controls offer Off (original word starts),
**Peak power**, **Attack**, and **Manual marker**. Changing the mode indexes the
existing embedded Kokoro speech locally; no server re-render or audio mutation.
Peak power is the centre of the strongest 20 ms mean-square window. Attack is
the first 5 ms trailing-energy window reaching 4% of that peak power (20% RMS).
Markers are measured on the speech source before channel/master effects; effects
and stereo modulation can change the loudness peak heard in the final mix.

Strength interpolates 0–100% toward the chosen marker. Maximum advance caps the
movement at 0–200 ms (default 100 ms); limited words are labelled. Manual mode
exposes an individual waveform, marker slider and numeric millisecond control for
every word of the selected Kokoro phrase. Peak is pink, attack blue, and the
selected marker yellow. Markers are relative to each word, not to its packed-bank
offset. Notes and ratchets stay in their existing cells, with no time-stretching
or destructive edits. Classic voices are unchanged. Switching Off restores the
original scheduling without losing analysed/manual markers.

Optional canonical `modes.robot.snap` contains `{method,strength,maxShiftMs}`;
optional lane `markers` contain `peakPower`, `attack`, and/or `manual` in seconds.
Both survive history, browser persistence, portable patch ZIPs and Song recall.
Alignment inputs are excluded from the generic Song number-control replay so
canonical Robot state is the sole timing authority. Analysis is cached only per
immutable AudioBuffer and never runs during ordinary Off/legacy startup.

Aligned event scheduling handles all ratchets, independent loop sizes, preserved
timing, phrase chains and overlapping complete word tails. A scheduled main
transport start reserves the pickup before beat one. Joining an already-running
loop skips a pickup whose start has passed rather than truncating its consonant.
Edits update the current worklet graph; already-playing words finish normally.

An actually audible nonzero advance requires render capability 36 and Robot
engine identity 4. Off, zero strength/limit, inaudible Robot and classic-only
settings retain previous identities/capabilities and exact legacy PCM. Unused
marker methods do not invalidate a prepared render. No neural-worker changes.

Saved Song renders contain a bounded prefix (`robotPreRollSeconds` and render
`robotPreRollFrames`), followed by the unchanged clock-length body. Capture starts
before beat one; one-shot rendering suppresses pickups belonging to the next
external cycle. The Song player schedules the prefix separately at each actual
placement/repeat boundary and loops only the body, avoiding outgoing ghost words
at transitions. Stop releases both prefix and body sources. Extremely short placement cuts use
a bounded pickup-aware read-ahead horizon (at most six queued placements); normal
aligned and all legacy Songs retain two-part streaming. Server admission and
GET checks bind prefix length and capability to the actual saved source. Saving
with alignment Off clears obsolete prefix metadata without changing source ZIPs.

Song WAV export mixes prefixes across part/repeat boundaries in bounded output
chunks. Its first beat follows the initial Robot pickup; the export completion
message reports that offset for DAW placement. Ordinary Song exports keep their
original byte-for-byte path and duration.

Regression coverage: `robot-alignment-worklet.cjs`, `test_robot_alignment.py`,
`robot-alignment-browser.cjs`, `robot-alignment-song-clock.test.cjs`,
`robot-alignment-song-browser.cjs`, `robot-alignment-real-song-browser.cjs`, plus
the earlier timing/transport/grid suites. Browser checks include native worklets,
first-beat live pickup capture, phone layout, manual edits, Undo/Redo, canonical
WAV recall, reload and exact hosted bytes in Chromium and WebKit. Physical iPhone
hardware was not available for this check.

## Additional server engines (2026-11-23)

The voice selector adds **16** IDs without replacing the six eSpeak or sixteen
Kokoro selections:

| Engine | Saved IDs | Generation / execution |
| --- | --- | --- |
| Festival | `festival_kal`, `festival_rab` | Installed Kal/Rab diphones, CPU |
| Flite | `flite_kal`, `flite_awb`, `flite_rms`, `flite_slt` | Installed compact voices, CPU |
| SAM | `sam_classic` | Reverse-engineered 1982 engine, CPU |
| Piper | `piper_cori`, `piper_ljspeech` | Piper 1.8, ONNX CPU |
| Qwen3-TTS | `qwen_ryan`, `qwen_aiden`, `qwen_vivian` | 0.6B CustomVoice, RTX 3070 |
| Bark | `bark_0`, `bark_1`, `bark_sing` | bark-small, RTX 3070; experimental |
| DiffSinger | `diffsinger_qixuan` | Original Qixuan 2.7 ONNX + OpenVPI vocoder, CPU |

Speech engines produce one lane per word. Bark produces one bounded vocal clip
(maximum eight words / 100 letters); it may improvise or mispronounce, and its
singing is **not** scored singing. DiffSinger renders an entire scored melody
into a single trigger lane, preserving note transitions and continuous phrasing.
Both clip types allow up to 26 seconds in saved lanes; existing voice IDs retain
their eight-second word limit. No worklet algorithm, old recipe default or audible
renderer capability is changed. New audio is created only by explicit render;
voice selection/recall never re-synthesizes existing PCM.

### Scored singing

Choose DiffSinger, enter English lyrics, then choose C3–C6 and ¼, ½, 1, 2, 3 or
4 beats for each lyric word, at 60–200 BPM. The total sung phrase is bounded to
24 seconds plus its short complete lead/release. The optional saved phrase
`melody:{bpm,notes:[{note,beats}]}` is generation metadata; changing transport BPM
later does not stretch or re-render saved singing. Existing loop timing still
controls when the complete sung clip is triggered. Unknown English dictionary
words fail explicitly rather than being silently replaced. This initial editor
supports one note per word, not phoneme editing or multi-note melisma.

Qixuan's own acoustic and variance ONNX weights are used unchanged. The English
CMU pronunciation inventory is mapped to the bank's English phoneme IDs. Explicit
note F0 includes gentle vibrato. Breathiness and voicing are **predicted dB RMS
curves**, not 0–1 controls: treating them as linear amounts grossly overdrives the
vocoder and obscures the consonants. The variance linguistic model has its own
phoneme-ID inventory and must not reuse acoustic-model indices.

### Runtime and resource bounds

Installation lives under `/opt/openclaw-robot/{piper,qwen,bark,diffsinger,sam}`.
Every Python engine has an isolated environment. Qwen/Bark use the already tested
CUDA 12.4 Torch 2.6 installation read-only; Qwen additionally pins matching
`torchaudio==2.6.0+cu124`, `accelerate==1.12.0`, `qwen-tts==0.1.1` and
`transformers==4.57.3`. Qwen needs **bfloat16 + eager attention** on this host.
Float16 produced a device assertion; a greedy-decoding experiment repeated vowel
sounds and was rejected after transcription checks. Keep Qwen sampling enabled.
Bark uses float16/eager; runtime device is reported from model parameters after
real inference, never inferred merely from CUDA availability.

`backend/mygrain_robot_engine_workers.py` owns exactly one extra switchable
process. Changing engine closes the previous process **before** loading the next;
Qwen and Bark cannot remain resident together in this pool. The existing two
small Kokoro workers are unchanged. Each active new-engine request acquires one
existing `robot-speech` host-wide render lease; no lease is retained at idle.
All exit paths release it. The extra process has a 300-second deadline, 45-second
parent idle reaper, 75-second child idle limit, 32-job lifetime, 64 KiB input and
16 MiB output bounds. Failure/timeout/oversized IPC discards the process. CPU
libraries are limited to two threads. Model loading is local/offline only; there
are no runtime model downloads and no disk text/utterance/PCM cache.

New server outputs are checked again across the IPC boundary: mono PCM16,
24 kHz, finite/bounded lane offsets and durations, expected lane names/counts,
and complete waveform bounds. Browser cancellation keeps existing phrases;
a server request already underway remains bounded by its worker deadline.

### Model provenance, terms and limitations

Operator installation evidence and SHA-256 inventory:
`output/mygrain-robot-engines-20261123T130941Z/model-manifest.json`.
Original Qixuan archive, bank terms and vocoder notices remain intact in `/opt`.
Model downloads are pinned, with repository/revision in local `provenance.json`:

- Qwen `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`,
  `85e237c12c027371202489a0ec509ded67b5e4b5` (Apache 2.0).
- Bark `suno/bark-small`, `1dbd7a128513b8ae4a4e2130fed57b7ac9da5bcd`
  (MIT).
- Piper `rhasspy/piper-voices`, `e9c8a39444359388adaa94255becb37a5a2b8e51`.
  The selected Cori dataset is CC BY 4.0 (Cori Samuel / NVIDIA Hi-Fi TTS);
  LJ Speech is public domain. Piper runtime is GPLv3. Downloaded but unexposed
  Alan/Lessac/Ryan weights were not selected: their terms and/or noncommercial
  restrictions are different. Do not infer weight rights from Piper's code licence.
- [Qixuan 2.7 terms and free original bank](https://github.com/yqzhishen/qixuan-diffsinger/releases/tag/v2.7.0):
  server inference is permitted; the bank remains unmodified/free. Public works
  require **绮萱 / Qixuan + DiffSinger** credit and an AI-singing notice. The UI
  links the original terms and free complete voicebank. The bundled
  [OpenVPI community vocoder](https://github.com/openvpi/vocoders/releases/tag/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02)
  has **CC BY-NC-SA 4.0** terms. Do not describe this combined singing stack as
  unrestricted commercial software; commercial use requires separately suitable
  vocoder rights. The selected bank's other content/service terms still apply.
- [Festival](https://www.cstr.ed.ac.uk/projects/festival/) and
  [Flite](https://github.com/festvox/flite) retain their installed copyright notices.
- [SAM](https://github.com/s-macke/SAM#license) has **unresolved rights**: its author
  explicitly supplies no clear open-source licence. Mark was told this before
  explicitly requesting the three retro engines. The selector repeats this fact;
  inclusion is not a claim of licence clearance. Build used `-fcommon`, no SDL.

No production account patches, Songs or original source archives are modified by
verification. Tests use isolated stores; the HTTPS smoke permits only stateless
`/api/robot/render` POSTs, blocks other writes and revokes its temporary login.
Regression entry points: `test_robot_engines.py`, `robot-engines-browser.cjs`,
`robot-engines-song.cjs`, `robot-engines-live.cjs`, plus existing Robot/alignment/
timing/speech-worker/backend suites. Preserve original enabled archived eSpeak
and Kokoro PCM while exercising actual server preparation, cache reuse and
phone-sized playback.

### Verified deployment results

- 16/16 selections synthesized real PCM. HTTPS phone-sized Chromium/WebKit
  generated all seven engine families; final JS/CSS bytes matched the deployed
  cache-versioned files (`20261123-robot-engines-3`).
- Scored four-note singing was independently transcribed as the requested lyric;
  measured note errors were within 20 cents, including the intended vibrato.
- 27 Robot/backend lifecycle checks and 62 Song backend checks passed. One first
  Song-suite run hit a ZIP fixture timestamp boundary; its unchanged rerun passed.
  Native timing/alignment regressions and 106 inline script syntax checks passed.
- Chromium/WebKit verified 390/844/1280 px layouts, 16-ID normalization, real SAM
  and >8-second singing creation, exact Undo/Redo PCM, decoded ZIP PCM/recipe
  equality, reload without re-synthesis and unchanged audio on voice selection.
- 19 actual isolated server Song jobs included every new voice, long singing and
  archived eSpeak/Kokoro PCM. Warm preparation added no jobs, source hashes and
  revisions stayed unchanged, and phone-style playback reserved no decoded
  full-Song buffer. Legacy eSpeak PCM was byte-identical to pre-task synthesis;
  24 legacy normalized recipes/render identities were unchanged.
- Production concurrency probe: one new model process maximum; overlapping new
  engine request rejected busy; Qwen cold **17.500 s**, warm **3.977 s** for two
  spoken words, observed model-process GPU peak **2622 MiB**. This is one host/
  phrase measurement, not a guaranteed render time for arbitrary text. Bark
  measured 8.562 s cold / 2.456 s warm in the separate two-word fixture.
- Temporary production test sessions were revoked; account/patch/Song saves were
  blocked by the live browser guard. The isolated fixture service was stopped.

## Singing melody Copy Sec (2026-11-23)

DiffSinger’s melody editor has **Copy Sec**: tap the first source lyric word,
then the last (either direction), then the insert word. Pitch and beat duration
repeat from the insert row through the final lyric word, including a partial
last repetition. One-word sections and overlapping destinations are supported;
the source is captured before inserting. Selected source word buttons highlight.
Cancel copy / Escape leaves everything unchanged. Changing lyrics, voice, phrase,
individual melody fields, account or patch discards the transient selection.

Copy operates on the same unrendered melody fields as manual note editing; it
does not alter lyrics, BPM, stored phrase metadata, grid, effects or PCM. Use
Render new phrase / Re-render selected to synthesize and commit the draft; that
existing operation remains shared-Undo/Redo, portable ZIP and reload compatible.
Bark does not follow scored notes and therefore has no melody Copy Sec. No DSP,
Song renderer, audio compatibility version or saved schema changes are needed.
Browser regression: `tests/robot-melody-copy-browser.cjs`.
