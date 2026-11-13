# Standard loop filters and space — LOOP-FX.1

A/B/C/V/W/P/O/L/X/M/M+/Q and each of K1–K5 now use the same `loop-card-fx.js` DSP and matching collapsible controls. K's panel follows the selected track. Instruments, sample amplitude envelopes, pitch/range, native M chorus/compressor and K drive/envelope are not replaced.

- Filter: bypass, low/high-pass, 2/4/6/8/16 poles (12/24/36/48/96 dB/oct), cutoff, resonance, sine/triangle/saw/ramp/square audio-clock LFO, beat-synced rate, depth and inversion. Modulation is in octaves, not a UI polling timer. Mode/slope changes crossfade old/new filter branches; parameter changes smooth in the audio graph.
- Hall: exactly the former Q stereo hall algorithm for every lane: deterministic independent stereo IRs, decay/bloom, pre-delay, low-cut, damping and mid/side width. Dry unity, independent wet send. Presets and Off are local to the lane. IR generation is lazy, bounded/cached, debounced and uses two crossfading banks. WebKit requires explicit stereo channel negotiation on the pre-delay; tests reproduce a silent wet path without it.
- Delay: the same tempo divisions, mix, bounded feedback, tone and ping-pong controls everywhere. The stereo feedback matrix crossfades self/cross feedback; delays are allocated only when enabled. Delay/Reverb Off retain the remaining settings.
- L/X per-note accent filter envelopes remain independent before the common filter; their existing timing and accent-depth calculation are retained. X sample gain/attack/decay/duration and held-key release code are unchanged (48 original-envelope native comparisons, zero PCM difference).

Legacy static filters and local wet paths are bypassed, not stacked with the new paths. Old DOM IDs live in a hidden inert compatibility bin for old imports/getters. M chorus/compressor and L's existing master-bus isolation stay intact. Q's former local FX are inactive in the app; its standalone controller remains available for legacy test fixtures. A compatibility W facade does not create an extra graph.

Canonical state: `state.modes.loopFx = {version:1,channels:{A,...,K5,Q}}`; preset export uses `preset.loopFx`. All channels are independently normalised/clamped. Old patches/Songs migrate from saved controls, never current-device settings. Legacy Q simultaneous high/low-pass is preserved by optional `legacyHighpass`; subtle randomisation clears that compatibility stage. Canonical controls are excluded from generic DOM slider/control snapshots to avoid duplicate restore events.

Normal/full-patch randomisation and its nested Mega/Sparse call randomise the canonical state once: low-pass 10–17 kHz, slow 2/4/8-bar modulation at 1.5–7% depth; hall 0–12% / 2.2–4.2 s; delay 0–8% with 12–24% feedback. This does not change the rule that global mix delay/reverb sends reset to zero.

## Songs

- In-memory inspection/preparation normalises FX metadata without rewriting WAVs or downloading source ZIPs to convert them.
- **Convert FX** uses the same account/editor/revision-guarded, staged atomic server transaction as Convert K/W. It changes only settings metadata, preserves original source WAV hashes, archives/history, arrangement and existing render bytes; repeating conversion is a no-op. It does not auto-Arm or change production Songs during deployment.
- New/converted snapshots are marked `loopFxVersion:1`; playback renders must carry the same version. Arm regenerates an obsolete render rather than falsely claiming old audio contains the new effects. Untouched compatible legacy playback remains usable until conversion/normalised preparation. Loop/K-track copy/paste includes exactly the chosen lane's shared FX; EQ-only copy remains EQ-only.
- Song preparation/recall includes a conservative allowance for stereo delay buffers, both hall banks, FFT working copies and the bounded impulse cache within the existing memory limit.
- Render-deck graphs allocate through the context facade so parent cleanup owns all new native nodes/oscillators.

Verification: `tests/loop-card-fx.test.cjs`, `tests/loop-card-fx-browser.cjs`, `tests/test_song_fx_conversion.py`, `tests/song-fx-conversion-browser.cjs`; existing Song-controller/compatibility/K/W/server/copy, W/drum randomisation and X-envelope regressions. Browser tests use Chromium/WebKit; mutating Song fixtures use isolated localhost stores only. Physical Mac listening remains unverified; this is not a claim to resolve the earlier Safari click.

Before-edit backup: `backups/loop-fx-standard-20261025T152959Z/`. Restore individual reviewed changes, never whole older files over unrelated work.

## N space extension — NOISE-SPACE.1

N now mounts the same Stereo Hall Reverb and Tempo Delay controls/presets on
`#noiseCard`. Its canonical lane is `modes.loopFx.channels.N` (also preset.loopFx),
with default dry sends. Missing N in an older snapshot normalises to dry and
bypass; the server accepts both the original 17-channel set and the new optional
N extension, with the same strict numeric bounds. Existing version-one format
and source audio remain unchanged. No production Songs are converted.

N retains its own multi-pass filter, drive, LFO level and driven envelope. The
standard FX filter controls are not mounted for N; normalization and subtle
randomisation force that additional filter bypassed. N's output gain feeds the
shared space graph directly, without adding an EQ stage or using a source-track
return. Wet sends, global BPM updates, global FX controls and Stop/Panic share
the existing host lifecycle. N disposal detaches its source route. Explicit
context ownership keeps live and isolated OfflineAudioContext render graphs
separate and preserves render-deck managed-node cleanup.

Verification: `tests/noise-n-space-browser.cjs` exercises the actual N output
through the shared FX graph in Chromium/WebKit: hall tail/stereo, tempo delay at
120 vs60BPM, dry attack unchanged, native controls/presets/off, state/preset and
old-snapshot recall, and mobile layout. Existing standard FX and native N tests
are retained. `tests/test_song_fx_conversion.py` covers optional legacy N and
malformed new settings. Existing cached Song WAVs are not rewritten.

Backup: `backups/noise-n-space-20261025T175217Z/`; evidence in workspace
`output/mygrain-noise-space-20261025/`.

## Loop and grain pan — PAN.1

Missing loop-card Pan sliders now sit above Filter & space. Their canonical
optional `pan` field defaults to 0 (centre), clamps to −1…1, and pans the complete
dry/wet return with smoothed StereoPanner updates. K and M+ retain their existing
controls, with no second visible slider. Q keeps its legacy internal pan on
recall; the new card control pans its full shared return.

Grain A/B have independent −100…100 Pan controls beside their quick Stereo Width
controls, saved through the existing slider/preset/Song paths. Pan is independent
of width; width creates symmetrical grain spread around the selected centre,
reducing that spread towards hard left/right. Old snapshots with no grain pan
reset to centre rather than inheriting the current device's slider value.

Full Patch / Mega / Sparse randomisation resets shared loop pans, all five native
K pans, M+ pan, Q's legacy internal pan and Grain A/B pans to centre. No samples
or existing production Songs are rewritten. The version-one format remains
compatible; server validation accepts absent pan on legacy channels and rejects
out-of-range/non-numeric new values.

Verification: `loop-grain-pan-browser.cjs` checks native loop and production-grain
left/centre/right PCM in Chromium/WebKit, UI controls, state/preset round-trip,
no duplicate K/M+ controls and centred randomisation. Unit/server tests cover
normalization, optional legacy data and invalid pan. Backup:
`backups/loop-grain-pan-20261027T191316Z/` (workspace root).

## Filter resource defaults and generation cleanup (2026-11-10)

A genuinely new workspace starts card LFO Filters Off. Explicit saved settings
and historical version-one/legacy implicit defaults retain their existing
meaning; manual filter edits and patch recall are not silently pruned. No
snapshot schema or render compatibility revision is required.

Ordinary/Mega/Sparse, per-card generation and applied AI recipes finish by
bypassing filters on muted, zero-level, unloaded or solo-excluded cards. The
eligibility check uses the card's configured playable state, not an instant
voice meter, so rhythmic rests and stopped transport do not erase useful
filters. A neutral filter (LP at 18 kHz or higher / HP at 20 Hz, neutral Q,
no extra highpass, zero LFO depth and no L/X filter envelope) is also bypassed.
Useful static filtering, LFO motion and note-filter envelopes remain enabled.
Other effect settings and filter parameters are retained.

Cleanup runs inside the generation history transaction, before AI fingerprints
and saved snapshots are captured. Existing graph crossfade/retirement releases
old filter stages and LFOs; disabled graphs do not retain running LFOs. Current
and legacy Song jobs use these same normalized saved settings and DSP; warm
render caches and original source ZIPs are retained.

Regression coverage: loop-card-fx.test.cjs, wasp-phone-startup.test.cjs,
wasp-filter-resource-browser.cjs, loop-filter-generation-browser.cjs and
wasp-filter-song-browser.cjs.

## Explicit generation effect switches (2026-11-10 follow-up)

Randomisation finishes by explicitly disabling Filter, Reverb and Delay on
every muted, unloaded, zero-level or solo-excluded shared lane, including
each K track and N's shared space. On eligible lanes, a zero reverb/delay mix
also forces its switch Off; an unselected effect stays Off even if a previous
patch left nonzero parameters behind. Current full-patch generation selects
subtle filters and optional V/L hall only, not card delays. All numeric effect
settings remain available for subsequent manual editing.

FX randomisation now waits for final layer selection before pruning. History
recognizes the explicit `Mega / Sparse patch` label (which does not contain
“random”), flushes deferred controls before evaluating eligibility, and cleans
up partial non-AI patches even when source acquisition throws. Failed AI
recipes still roll back without pruning the restored manual patch. Native
Noise N's separate filter is explicitly Off when N is muted at the generation
boundary. Focused checkboxes synchronize canonical flags too: Safari can keep
a checkbox focused when a randomisation button is tapped.

The regression `tests/muted-card-effects-browser.cjs` keeps the audio context
running and exercises actual ordinary/Mega/Sparse selection, history, native
graph retirement, all mounted card effect switches, source-acquisition failure,
focused shared/N checkboxes, ZIP recall and AI Undo. Only external source
acquisition is replaced with bounded local audio fixtures. The earlier
no-audio generation test did not expose the missing Mega/Sparse label.

Saved/manual normalization and steady-state DSP are unchanged, so old source
ZIPs and render caches remain compatible. Real current/legacy server jobs,
warm-cache playback and final WAV export are verified in an isolated store by
`tests/muted-card-effects-song-browser.cjs`.

## Dropbox Sample — 2026-11-10
The shared FX key is `sample`, matching the existing EQ/audio route (not the generated sample lane). Its panel uses the exact same builder and DSP as the other cards. Its existing per-voice pan stays authoritative; the shared panel does not add another pan. Missing legacy sample settings normalize to explicit filter/reverb/delay Off. An otherwise standard archive missing only this new dry channel is not migrated or rewritten by convertSnapshot. Ordinary/AI/Sparse/Mega cleanup includes loaded, enabled, nonzero-volume and solo eligibility for Dropbox. Muted generation flags become explicitly false and native filter/LFO/hall/delay are retired by the shared graph.

Verification: `node tests/mutilator-dropbox-browser.cjs` exercises all seven native strains, live Dropbox graph flags/retirement, its existing pan, shared controls, populated audio-running Ordinary/Sparse/Mega, partial failure, UI focus, ZIP recall, history and AI Undo in WebKit/Chrome phone/desktop contexts. Optional `MYGRAIN_BEFORE_D` points at a pre-expansion loop-d.js to compare the original three strain PCM outputs exactly. `node tests/mutilator-dropbox-song-browser.cjs` creates three real isolated server jobs (new strain, old D snapshot missing Dropbox FX, Dropbox LFO/hall/delay), checks audible finite PCM, source hashes/revisions, warm reuse, released memory, phone playback and WAV export. Backend/unit commands: `node --test tests/loop-card-fx.test.cjs`; `PYTHONPATH=tests python3 -m unittest test_d_mutilator test_dropbox_loop_fx`. All browser commands require a disposable authenticated fixture; never use production user stores.

## Post-card specialised-effect routing — CARDFXROUTE.1

The card source first traverses its shared LFO filter, hall and tempo delay
(and pan), then enters the character-effect group and downstream source selectors.
Bass Face and Mutilator no longer precede the local card processing. D uses this
same post-card path instead of its old raw-source Mutilator/Pot shortcut.
Cooking Pot input provenance is retained: post-card processing does not change
which source a restricted effect receives. Whole-mix buses, card power/levels,
local recipe controls and independent effect-return switches remain canonical.

Loop FX owns one persistent bridge per card/context/destination. Character FX
registers its downstream connector with that host; it must never reconnect via
the public Loop FX wrapper or the filter/space graph would run twice. Persistent
bridges carry local delay/reverb tails even after individual source voices end.
Native D Mutilator now shares the same post-card, pre-specialised-effect level
as other cards. Source level therefore controls its excitation consistently.

Song unifiedInputsVersion 2 marks affected character/local-FX combinations and
the migrated native D Mutilator path; untouched dry legacy sources retain their
old revision/signature. Both render admission and decoded client compatibility
check this capability. Source ZIP/WAV hashes and Song revisions are untouched.

## Four-band EQ before all card-effect taps — EQROUTE.1

The previous chain placed four-band EQ at the end of the selected-effect
wrappers: independent effect returns and detector/excitation taps could therefore
bypass it. Every one of the 28 EQ-equipped card/lane keys now enters through:

`card output → four-band EQ → shared card filter/hall/delay → character FX → selected effect taps/inserts → output`

Generated/Dropbox sources, loops and instruments, K1–K5 and every drum lane all
use the same input adapter. N retains its existing native processing; it has no
four-band channel-EQ key. Whole-mix and external-host effect inputs are not card
EQ channels and do not acquire a duplicate stage.

`channel-eq.js` exposes `connectInput` for the actual EQ and enables pre-effects
routing only when the full app adapter installs. Standalone EQ remains compatible.
The captured legacy downstream entry becomes a direct output-gated edge rather
than applying EQ a second time. `character-fx.js` shares a pre-EQ bridge per
key/context/destination across simultaneous voices; source end/disconnect releases
its source references without truncating the persistent EQ ringing or downstream
local delay/hall tails. Persistent
selected-effect taps retain their source identity. Existing EQ bands, bypass,
Read/Write automation, UI meters, source levels and saved schema are unchanged.

Song `unifiedInputsVersion:3` selectively requires fresh audio when active EQ
(including enabling Read curves, except explicit manual bypass) coexists with active
specialised processing or the channel's local FX. EQ-only dry and EQ-bypassed
legacy renders retain the previous requirement. Client compatibility, upload
capability admission, part content signatures and server preparation all use the
same numeric revision. Sources/ZIPs and arrangement revisions are never rewritten.

Verification:
- `eq-before-effects-browser.cjs`: 28 keys × native/Pot × Chromium/WebKit,
  112 actual wet-output routing comparisons.
- `eq-all-effects-browser.cjs`: eight specialised effects × native/Pot in desktop
  Chromium/phone-sized WebKit; held-source EQ changes affect wet returns, and
  diagnostics confirm exactly one EQ route (not one per return).
- `eq-before-effects-song-browser.cjs`: legacy dry plus native/Pot EQ→Mutilator,
  three actual isolated server jobs, warm reuse, phone playback, released playback
  memory and unchanged hashes/revisions.
- `eq-before-effects-render.test.cjs` and `test_song_backend.py`: revision-three
  stale rejection, dry/bypass reuse, Read/manual precedence and backend admission.
- `eq-input-tail-browser.cjs`: source-end EQ ringing, stable voice reuse and
  complete context cleanup.
- Existing EQ bypass/Read UI regressions, card filter/delay/hall routing and
  source-isolation/resource-stability regressions remain part of verification.

Backup/evidence: workspace `output/mygrain-eq-routing-20261112/`. Physical device
and DAW hardware listening are not implied by browser PCM checks.
