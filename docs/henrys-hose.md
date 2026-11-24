# Henry’s Hose

Added 2026-11-13. `henrys-hose-dsp.js` is the shared processor for live worklets, native app FX and offline/server Song rendering. This is a **physically informed musical model**, not a measured vacuum-cleaner or branded microphone emulation.

## Signal model

1. A bidirectional fractional-delay tube carries the input. Hose length (0.25–8 m), bore (10–160 mm), corrugation, passive wall losses and open-mouth reflections shape resonances. The low-frequency open-end correction is approximately 0.6133 radii at each end. Corrugation adds an explicitly approximate effective-length adjustment; this is not a resolved finite-element corrugated wall.
2. Three passive shelves approximate the thermoviscous attenuation trend proportional to `sqrt(f) × length / radius`. Mouth reflection is frequency dependent and its magnitude stays below unity. No sample files, autonomous oscillators, noise generators or motor recording are mixed in.
3. A rotating outlet follows a 0–2 m orbit. Free rotation spans stationary–12 Hz; locked rotation spans four turns per beat to one per eight 4-beat bars. Shared transport origin and scheduled BPM history determine locked phase, including offline rendering. Direction and starting angle are portable settings.
4. Each receiver uses its own retarded source position, distance delay (343 m/s), distance gain, microphone orientation, proximity term and frequency/angle-dependent outlet radiation. Six fixed-point iterations estimate emission position. Geometry is updated every 16 samples with samplewise interpolation; delays use passive linear interpolation. This is a bounded, efficient approximation, not an exact aeroacoustic solver. A stationary receiver on the rotation axis has constant path length: rotation alone does not create direct-path Doppler there.
5. Seven modelled mic characters: modern cardioid condenser; pressure omni; signed figure-eight vintage ribbon; band-limited old broadcast; presence-shaped snare dynamic; bass-shaped kick dynamic; supercardioid/upper-band interference-tube rifle. Rifle uses eight virtual ports over 28 cm and angle-dependent delays, not simply a static narrow pan. These generic responses are inspired by the cited principles, not copied calibration curves or claims of exact product emulation. Pattern and proximity models remain approximations.
6. Mono reception uses the left mic and duplicates it to both output channels. Stereo uses independent L/R mic position, height, aim and type; M/S width then narrows the pair. At width zero, the stereo pair is summed to mono. The input Stereo control blends a physically mono-summed bore with two co-located virtual bores preserving stereo input. That second option is an intentional musical extension rather than a literal single mono pipe. There is no binaural head/HRTF or simulated room reverberation.
7. Optional Singing Hose is a **source-excited** resonant mode inspired by corrugated-tube mode selection. Its flow/rib-spacing relation is heuristic: it does not simulate vortex shedding, spontaneous whistling or fluid-structure interaction. Silence remains silent.

Geometry coordinates cover ±4 m horizontally and 0–3 m in height. Aim is 0° right, 90° up, 180° left, 270° down in the top view. Minimum receiving distance is 12 cm to keep gain and proximity bounded. Orbit is an independent creative geometry control, not constrained by the nominal resonant pipe length.

## UI and ownership

- Red card with code-native vacuum-and-eyes header and matching compact icon. Display order is last in the app, after Master Baker; **audio** Master Baker stays pinned last after the main/return sum.
- 100 deterministic presets, previous/next wrap, input and power retained on preset change.
- Two draggable receiver positions; aim/height and all geometry also have normal labelled controls. A drag commits one canonical history edit on release; pointer cancel restores the view. No duplicate map-owned audio settings.
- Canonical `modes.henrysHose`, shared AcousticFx host. Layers and Cooking Pot power/source controls call the same setter. Card Solo, additive source/effect Solo, main mute and Through main output reuse EffectOutput.
- App section, Mixer and Layers Jumps; Cooking Pot row Jump and return Jump; selected Source Jump where a source card exists. No separate navigation implementation.
- Both Stir actions include Hose; ordinary Stir keeps its recipe and BIG STIR chooses a recipe/input from the normal eligible active loaded-source pool. Bubble Chamber is included in randomisation; Master Baker remains off in randomisation/Stir.
- Memory estimate includes all six fixed-size delay lines. Worklets are disposed at zero return/power off/context release. No per-sample buffer/object allocation, animation timer or offscreen render loop is added.

## Compatibility

Hose settings schema is version 1, **acoustic render capability 3**. Existing WireWorld/Sonic Crystal remain revision 1 and Bubble Chamber revision 1/2 unchanged. Missing/off/zero-return/external-only Hose is excluded from acoustic content identity. Cooking Pot accepts both the legacy nine-stage order / ten-power memory and the new ten-stage order / eleven-power memory. Inactive Hose is pruned from serial content identity, preserving pre-Hose content hashes.

Do not shift old Cooking Pot audio ports: wet inputs 1–9, coefficient inputs 10/11, correction inputs 12/13 retain their assignments. Hose uses **input 14, output 10**. Native companion panel protocol remains nine legacy entries/bit positions; group power still includes Hose through the canonical app switch. This web release does not rebuild native installers or add an extra row to their fixed native panel.

Server GET and POST rendering inspect the original saved source as well as advertised metadata, rejecting stale acoustic renders. Audio renders never rewrite original ZIPs, source hashes or Song revisions.

## Research basis

Primary research and manufacturer technical material consulted:

- [Serafin & Kojs, 2003: physical modelling of rotating corrugated tubes](https://www.dafx.de/paper-archive/2003/pdfs/dafx57.pdf) — travelling waves, resonances, physical/expressive parameters.
- [Smith, Serafin, Abel & Berners, 2002: Doppler simulation and the Leslie](https://dafx.de/paper-archive/2002/DAFX02_Smith_Serafin_Abel_Berners_doppler_leslie.pdf) — variable propagation delay and moving-source/listener geometry.
- [Nakiboğlu, Rudenko & Hirschberg, 2012: Aeroacoustics of the swinging corrugated tube](https://research.utwente.nl/en/publications/aeroacoustics-of-the-swinging-corrugated-tube-voice-of-the-dragon/) — real corrugated-tube whistling, airflow and mode selection; motivates the optional, deliberately simplified singing mode.
- [Abel, Smyth & Smith, 2003: A Simple, Accurate Wall Loss Filter for Acoustic Tubes](https://musicweb.ucsd.edu/~trsmyth/pubs/dafx2003.pdf) — frequency-dependent tube wall losses. The present shelves approximate the trend, not the full published fitted filter.
- [Scavone, 1999: Modeling Wind Instrument Sound Radiation using Digital Waveguides](https://caml.music.mcgill.ca/lib/exe/fetch.php?media=publications%3Aicmc99_scavone.pdf) — radiation filtering and observation position.
- [Silva et al., 2009: Approximation formulae for the acoustic radiation impedance of a cylindrical pipe](https://arxiv.org/abs/0811.3625) — passive open-end reflection and end correction.
- [UNSW musical acoustics FAQ](https://www.phys.unsw.edu.au/jw/musFAQ.html) — pipe resonances and end correction.
- [DPA: Microphone technology, the essentials](https://www.dpamicrophones.com/mic-university/technology/microphone-technology-the-essentials/) — pressure/pressure-gradient patterns and proximity.
- [Shure: Choosing a shotgun microphone](https://www.shure.com/en-EU/insights/choosing-a-shotgun-microphone-the-long-and-short-of-it) — interference-tube frequency dependence; directivity is not extra distance gain.
- [Shure SM57 guide](https://www.shure.com/en-US/docs/guide/SM57), [Beta 52A guide](https://www.shure.com/en-US/docs/guide/BETA52A) — qualitative drum-mic response families.
- [Royer R-121 manual](https://www.royerlabs.com/pdf/manuals/R-121manual.pdf) — figure-eight polarity, proximity and stereo arrangements.
- [Sennheiser MKH 416/418 manual](https://docs.cloud.sennheiser.com/en-us/mkh-416-mkh-418-s/mkh-416-mkh-418-s_instruction_manual_02_2026_en.pdf) — qualitative interference-tube pickup/response reference.

## Verification

See `tests/henrys-hose*.cjs`, updated acoustic/Cooking Pot tests and release evidence under `output/mygrain-henrys-hose-20261113T201934Z` in the private workspace. Tests cover deterministic stereo PCM, every applicable control, silence/bypass, mono, on-axis geometry, scheduled clocks, all 100 presets at 44.1/48 kHz, extremes at 96 kHz, old-engine byte equality, canonical recall, actual final-output PCM, source isolation, Song renders/cache and mobile layouts. The release receipt records which runs completed, rather than implying physical microphones or DAW hosts were directly measured.


## Doppler-led revision (HOSE.2)

The initial default produced only about ±25 cents of direct-path pitch motion. New version-2 defaults use a 1.2 m spin radius, one turn per beat (2 Hz at 120 BPM), offset stereo microphones and 2.5× Doppler depth: approximately −192/+187 cents. The first preset, **Henry’s fly-by**, uses 3× depth. Existing version-1 snapshots retain their original defaults, engine PCM and render identities, including their original factory recipes stored in patches. Choose a new preset or adjust Doppler depth to opt into revision 2.

Doppler is a variable propagation delay, not a pan or volume LFO. For a stationary receiver and moving source, solve the emission-time path and use `f_received / f_source = 1 / (1 − v_toward / 343)`. Equivalently the variable-delay output has `f_received / f_source = 1 − dD/dt`. Each receiver has its own emission path. The approach raises pitch and recession lowers it.

The Doppler depth control is 0–4× (normalized 0–1; 0.25 = physical 1×). It scales the time-varying part of the path about its closest physically possible distance; it does not scale pickup-pattern tremolo or distance attenuation. 0× stops rotational propagation pitch sweeps but retains changing microphone/radiation colour; that changing filter phase can produce sub-cent residual pitch motion. A stationary on-axis mic or zero radius has no direct rotational Doppler. Faster rotation and larger radii increase depth; centring a microphone can remove it. Solo the effect return to hear the sweeps without an unshifted dry signal. No extra redundant dry/wet or mixer gain is introduced.

Above 1×, depth is a deliberate musical exaggeration, not literal air propagation. Twelve retarded-position iterations improve the new path solution. At extreme speed/depth combinations, a subsonic geometry-dependent depth ceiling and read-slew bounds (0.15–4× playback rate) prevent read reversal; rapid manual/tempo changes can temporarily slew. Two 80 ms propagation buffers replace the two 40 ms buffers for version 2 only; memory admission includes the increase. Legacy tube, damping, microphone models and version-1 path arithmetic are unchanged.

Version-2 audible non-DAW Hose requires acoustic render capability **4**; version 1 remains **3**. Missing/off/zero/external-only Hose still does not invalidate old audio. Server rendering accepts the new capability and checks original snapshots for both stale render GET and POST. Source ZIPs and Song revisions are not rewritten by re-arming.

Verification includes actual 1 kHz PCM zero-crossing pitch measurements at 44.1/48 kHz (off, physical, exaggerated), agreement with radial-velocity physics, stationary/axis/radius controls, causal extreme parameters, all mic types up to 96 kHz, legacy PCM and content identity, actual slider taps on desktop Chromium/iPhone-UA WebKit, Undo/Redo and JSON/ZIP/reload, native/Pot routes and isolated server Song jobs. Browser phone emulation is not a physical-device test.

## Preset sensitivity rebalance (2026-11-14)

The 100 factory presets now set their own Doppler depth instead of mostly
inheriting the 2.5× demonstration default. Only Doppler depth is recalibrated;
IDs, names, geometry, speed, mic character and other recipe controls stay intact.
Henry’s fly-by now uses 0.8× rather than 3×. Fast-spin and singing families retain
their motion/resonances with much lower pitch depth; microphone/drum/compact
families keep the source’s pitch more firmly.

A factory-only cap uses the preset’s actual radius and free speed (or sync speed
at a reference 120 BPM). With source speed v, the maximum retarded-path slope
is v/(343−v); constrain its scaled slope to 1−2^(−budget/1200). Family budgets
are 90/25/120/40/30/55/65/40/55/18 cents, respectively. These are conservative
direct-path bounds, not measured full-spectrum pitch claims: directional mic,
resonance and singing filters can still change the perceived sound. Tempo edits
can increase sync-mode motion beyond the reference bound. No runtime limiter,
extra smoothing, delay or gain is added.

Manual 0–4× range, v1/v2 normalization/defaults and DSP are unchanged. Existing
saved settings (including an old preset’s explicit depth) retain their exact
sound. Reselect a factory preset to use the rebalance. All stored values remain
ordinary canonical settings, so the unchanged server/render path renders them
without a compatibility bump or rewriting any existing Song source.
