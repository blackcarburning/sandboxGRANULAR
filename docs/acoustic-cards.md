# Acoustic effects cards — 2026-11-11

Build: `v2026.11.12.LIQUID.1`; Bubble Chamber asset revision `20261112-liquid-1`.

## Models and controls

These are creative, research-informed reduced-order models, not full 3D acoustic
simulations or replicas of commercial plugins. Each has its own original inline
SVG artwork and icon, 100 deterministic factory recipes in ten families, and
name-only card/Jump labels.

- **WireWorld**: twenty staggered causal allpass waveguide stages per stereo
  channel, with a damped reflection loop. Dispersion, propagation/travel,
  reflection amount, damping, dispersion direction, stereo spread and return
  level. Integer static stage delays preserve allpass energy; smooth fractional
  transitions avoid reallocating the network while editing. Travel labels are
  nominal model scaling, not measured impulse/group-delay duration.
  [Dispersive systems](https://research.aalto.fi/en/publications/dispersive-systems-in-musical-audio-signal-processing/)
  and [spring-reverb examples](https://research.spa.aalto.fi/publications/papers/jasp-spring/).
- **Sonic Crystal**: a passive bidirectional 1D scattering lattice with 4/8/12
  cells and side resonators. Cell tuning (100–4000 Hz), spacing, coupling,
  deterministic disorder, a central defect, material loss, end reflection,
  stereo spread and return level. It models transmission gaps and defect
  resonances; it is not a spatial finite-element solver.
  [Locally resonant sonic materials](https://sheng.people.ust.hk/wp-content/uploads/2017/08/Locally-Resonant-Sonic-Materials.pdf).
- **Bubble Chamber (Liquid v2)**: 8/16/24 input-driven complex-pole resonators
  per channel. Radius spans 3–60 mm, with bounded base modes at 38–1450 Hz and
  motion capped at 1800 Hz. No droplet or bell excitation selector. The first
  recipe, **Liquid sweet spot**, uses the requested reference: 8 bubbles,
  11.74 mm, 42% variation, 39 ms base decay, 86% pitch motion, 62% stereo and
  88% return. It has no added pressure, damping, fizz or current.
  - **Pressure / resonance**: extends pole decay by up to 7× and increases
    excitation; energy-dependent losses bound the resonant build-up.
  - **Underwater damping**: low-passes both excitation and wet return, moving
    the cutoff from 8 kHz to 208 Hz. It does not alter the dry source.
  - **Microburst fizz**: deterministic smoothed multiplicative source texture
    and faster pole motion, not independent impulses or free-running noise.
  - **Liquid current**: independent slow pole bending and a modulated low-band
    current. Pitch motion controls bending depth; it becomes effective as fizz
    or current is introduced. At zero fizz/current it leaves the reference's
    static resonances intact (as the previous Resonances mode did).
  - Base decay spans 18–3218 ms before pressure scaling. Radius/controls slew
    without rebuilding the graph; populations remain fixed 8/16/24 banks.
  - 100 new recipes across liquid foundations, underwater damping, pressure
    vessels, microburst fizz, low liquid, elastic currents, foam rhythms,
    resonant depths, boiling creatures and gentle immersion.
  - Version-1 recipes remain a recall-only legacy DSP branch, including old
    Droplets/Hybrid patches. Choosing a new preset replaces that branch;
    touching a new physical control upgrades by actual radius/decay units
    (radius below 3 mm clamps to the new lower limit). Power/input/return edits
    alone do not upgrade. Legacy description explicitly identifies this state.


Research links open separate tabs with `noopener noreferrer`. Browser/UI checks
are not physical iPhone listening tests.

## Routing and lifecycle

`acoustic-fx-host.js` observes the existing per-source routing chain, alongside
Olaf's Resonator. Ordinary source taps follow the existing loop-card effects;
N has an explicit Wasp connection observer; VST3 FX has an explicit DAW feed.
All selectors include All, individual loop/source cards, K and K1–K5, Drums and
all eight lanes (including Roll), N, and VST3 FX.

Final flow: original recording bus → R dry/return → acoustic dry + independent
returns → existing Wasp/final amplifier. **All** taps the recording bus before R
and the new returns. The three returns are parallel, not cascaded, and cannot
re-excite each other or themselves. Existing source/dry routing is retained.
VST3 FX registers its gain output only on processed routes; Direct deliberately
bypasses these effects. FX-only mode suppresses internal selected sources.

Worklets load on demand. Each enabled, nonzero return owns one processor;
power Off/zero return level disconnects and disposes it. Source changes clear
old tails. Per-card Silence tails only clears that effect. Effect Solo belongs to the transient additive global mask and is never serialized;
isolated render decks ignore it. No animation/polling loop is added.

Mega selects factory recipes for WireWorld and Sonic Crystal, independently
switches them in/out and chooses All/an eligible active source. Bubble Chamber
is manual-only: all patch/effect randomisation and both Pot Stir actions leave
it Off without replacing its settings. Its card has no Randomise button; manual
controls, 100 presets and saved On patches remain supported. Sparse and ordinary
randomisation leave all three Off. Preset changes retain power and source. Clear
Patch clears all three, and its existing Undo restores them.

## Canonical persistence and rendering

`state.modes.wireWorld`, `.sonicCrystal`, `.bubbleChamber` are complete normalized
objects (Bubble Chamber v2 for new recipes; v1 retained on legacy recall). JSON presets contain the same objects at their top level.
Preset IDs, artwork and Solo are not canonical audio state. All three cards are
excluded from generic slider schemas, imports, state selectors, randomisation
and archive extras. This prevents generic input events from overwriting the
normalized DSP settings.

Browser reloads, real editable ZIP capture/recall, Undo/Redo and native VST3
embedded project ZIPs use these existing persistence paths. The VST3 binary
format is unchanged; no new plugin download is required for these web effects.

Song decoding preloads asynchronous DSP, budgets fixed effect allocations and
isolated decks await readiness before capture. At 48 kHz the three DSP engine
allocations total about 850 KiB plus Web Audio/node/object overhead. They do not
reserve sample-dependent delay memory. DAW input processors are omitted in an
isolated offline deck because no live DAW input exists there.

`backend/mygrain_acoustic_fx.py` validates every mode, source, enum and normalized
parameter. Only enabled, nonzero, **non-DAW** effects enter canonical content
hashing, with `acousticFxEngineRevision: 1` and required part
`acousticFxVersion: 1` for unchanged legacy processing; audible local Liquid v2
requires revision 2. Version-1 mode normalization and PCM remain exact. Missing/Off/zero/DAW modes preserve previous cache keys.
New render uploads advertise `acousticfx=2` only for audible local Liquid v2,
otherwise `acousticfx=1` (including dry renders). Both the browser admission check
and backend upload validator require the current producer revision; the backend
rechecks the source manifest even if stored part metadata is stale. A stale affected
render is rebuilt selectively without touching original source ZIPs/revisions.

## Verification

Tests in `tests/acoustic-*` and `tests/test_acoustic_fx.py` cover:

- 300 unique recipes, actual PCM at 44.1/48 kHz, every physical control, stereo,
  silence, clearing, disposal, energy/passivity checks and extreme edits through
  96 kHz.
- Real Chromium/WebKit worklets and phone/desktop UI, source isolation, Solo,
  independent All, On/Off, preset wrap/source protection, keyboard/touch Jump,
  search and observable return after leaving a card, 320/390/844 px layout.
- Exact JSON/ZIP/browser recall; linked layer power and Undo/Redo; complete
  Mega/Sparse paths (download/generation boundaries replaced by local synthetic
  fixtures, actual effect selection/history retained).
- Real isolated server jobs for dry, all three individually, combined, DAW-only
  and a genuine pre-feature ZIP; warm reuse, one selectively stale rebuild,
  phone PCM playback, released reservations, unchanged source hashes/revisions.
- Phone Chromium/WebKit final-mix WAV exports, exact frames and non-silent PCM.
- Real Windows VST3 DLL under Wine: native project save/reopen in a fresh browser
  context, exact parameters/source audio/FX settings and independent DAW feeds.

Isolated fixture ports/stores and task paths are provided by the maintenance
runner, not product behavior. Production song/account stores are never used by
these tests. Physical iPhone audio and a physical macOS/Windows DAW were not
used in this verification.


## Liquid v2 verification (2026-11-12)

`tests/bubble-liquid*` / `tests/test_bubble_liquid.py` cover the photographed
reference, every added control, hot edits through 96 kHz, silent-source/cleared
fizz, legacy physical-unit upgrade, phone control/slider synchronization and
actual final native/Pot outputs. The existing acoustic suite covers JSON/ZIP/
browser recall, additive Solo, source isolation, generation exclusions and
phone/desktop layout in Chromium and WebKit. Phone WAV exports use the same
worklet. Real isolated Song jobs include pre-feature, version-1 droplets, Liquid
sweet spot, dark immersion, microburst fizz and extreme pressure, warm reuse,
selective stale rebuild and rejected revision-1 upload for a Liquid v2 source.

Paired seeded percussive/sustained/noise captures at 44.1/48 kHz keep the sweet
spot within 2% of reference RMS; normalized high-band energy is checked separately
from gain. These are measured PCM/UI checks, not a physical phone or DAW listening
test. Evidence/rollback: `output/mygrain-liquid-bubbles-20261112T221721Z/`.
