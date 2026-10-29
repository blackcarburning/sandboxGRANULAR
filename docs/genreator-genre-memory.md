# GENREator musical memory — version 1

Authoritative musical reference for MYGRAIN generation. This entire document is
injected server-side into EVERY AI patch request, including every G button press;
it is not optional retrieval or a browser hint. The selected canonical genre
profile and explicit tempo override take precedence over general patch defaults.

## How to use this memory

Choose a recognisable musical identity BEFORE choosing parameters: actual clock
BPM, kick/snare grammar, bass role, harmonic pace, foreground/background density.
Then realise it with the writable card contract. Read the selected genre section
on every request. For free-text requests use the matching section(s); for a new
patch an explicitly named genre overrides the generic Q/X/drums suggestion and
its source exclusions apply. In Refine
or Song Section mode preserve the existing tempo/sources unless that mode allows
the requested change: genre advice never overrides mode or capability limits.

The common BPM choices below are practical production starting points, NOT a
statistical claim from a measured catalogue. Ranges describe this generator's
intended interpretation, not immutable boundaries of a whole musical culture.
Experimental styles have no universal most-common tempo. Choose freely WITHIN
the canonical automatic range, favouring the common choices when unsure. Never
inherit the previous patch's tempo merely because it is supplied as current.
A populated user BPM override is deliberate and authoritative, even out of genre;
without it, do NOT substitute half/double tempo. Drum & bass at 174 BPM can feel
like 87 BPM, but its actual project clock MUST remain 174. Do not call 90 BPM
180-BPM D&B. A slow sample's detected BPM is not the desired project tempo.

### Grid, patterns and density

All examples use ONE bar of 4/4, 16 sixteenth steps, numbered **1–16**.
Beats 1/2/3/4 = steps **1/5/9/13**. Offbeat eighths = **3/7/11/15**.
Backbeat on beats 2 and 4 = **5/13**. Examples are grammar, not mandatory presets:
AI chooses a new coherent variant. Convert positions to 16-element 0/1 arrays;
use null rests in melodic arrays. Do not confuse 1-based musical positions with
0-based array indexes. In 32/64-step arrays repeat the bar foundation, then vary
only a few pickups/fills. A 16-step bar repeats over the existing grid; do not
claim a unique 8-bar arrangement when only one bar was supplied.

Density below means active kick/snare/hat hits per 16 steps and sounding melodic
steps, NOT automatically more volume or more simultaneous sample lanes. Work
with 2–4 purposeful audible layers, including drums as a role. Dense drums often
need SPARSE bass/melody. Leave real rests, frequency separation and headroom.
Never fill every lane or all 16 bass notes just to sound energetic. Do not invent
velocity, swing, microtiming, automation, effects or per-note envelopes that are
absent from the allowed API. Approximate swing via skipping/alternating step
placement; do not claim real swing. Normal generation uses straight steps, not
ratchets; longer section rolls only when that mode explicitly permits them.

### MYGRAIN instrument and source translation

- Drums: the existing kick/snare/hat tracks. Use a suitable snare to imply a clap
  if appropriate; do not invent a fourth clap, rimshot, shaker or tom track.
  If drums enabled, provide all three patterns (all-zero track is a valid rest),
  useful bus/track levels and sensible short decay/length. Match timbre to genre.
- X: tuned mono bass notes, samples_bass or the retained protected repository;
  samples_altbass is clean Juno saw/pulse, not automatically a distorted Reese.
  Respect the user's remembered X library unless explicitly asked to change it.
  Bass mainly MIDI 28–48, with octave movement when useful. Keep transpose at 0
  when writing sounding MIDI notes. Avoid very low indistinct notes and constant
  long bass under every kick. Never claim unavailable synthesis/effect controls.
- L: pitched lead/sampler notes; samples_leads for a hook, samples_terra for unusual
  electronic/organic Terra timbres. Prefer one compact motif, not random pitches.
- W: samples_modular, good for modular, granular, noise, metallic and evolving
  material. Source identity and slicing supply texture; shared FX stay unchanged.
- V: vocal source fragments when musically useful, not compulsory in every style.
  P: piano phrases; O: orchestral phrases; Q: piano/strings chords. Q is NOT a
  generic synth chord oscillator. If P/O/Q excluded, do not use Q as a loophole.
- A/B/C: use only the actual supplied source/capability description and compatible
  already-loaded material. Never assume an unavailable source or a hidden synth.
- M/M+/K: preserve recordings, disabled for fresh genre patches. Dropbox is not a
  writable generator operation; do not promise to load or alter it. Choose at
  most three fresh loop sources plus the permitted drum hits; no URL/path output.
- Source catalogue metadata is evidence of names/estimated features, not proof of
  listening. Prefer compatible keys and tempo-scalable phrases. No unrequested
  global/shared FX, render, transport or GUI changes. This document is musical
  guidance, NOT permission to extend the schema.

## dnb — Drum & Bass

**Clock:** automatic 170–180 BPM; common choices 172, 174, 175, 176; 174 is a
strong starting point. Historical/slower variants exist, but this button targets
recognisable modern full-speed D&B. Never choose 85–90 absent an explicit override.
**Beat:** fast broken two-step, not house. Start from snare 5/13, kick 1/11;
alternatives kick 1/7/11 or 1/10/15, keeping enough room around the snare. Hats
can use 1/3/5/7/9/11/13/15, or selected sixteenths. Small ghost-like extra snare
placements can imply breaks but the API has binary dynamics, so use restraint.
**Density:** kick 2–4, snare 2–4, hats 6–12 hits/bar. Bass 3–8 sounding steps,
with held/resting spaces and call-and-response; lead 0–4. Fast does not mean
all-on grids. Strong kick/snare transient contrast and bass are the identity.
**Instruments:** tight electronic/acoustic-derived drums, deep sub/rolling bass,
Reese-like material only if the catalogue actually supplies it; L short dark lead
or W electronic texture optional. Minor/modal, one/two root centres and tension
notes generally work; bass and texture should agree in key. Fresh patch excludes
P, O AND Q, even though piano/liquid variants exist in the wider genre. Do not
load orchestra/piano to represent generic warmth. Limit foreground to bass plus
one contrasting motif. Distinguish liquid (smoother/sparser), rolling (stable
propulsion), neuro-influenced (short angular bass phrases) without pretending to
synthesize unavailable processing. Preserve 174 actual BPM even for halftime feel.

## jungle — Jungle

**Clock:** automatic 160–175 BPM; useful/common choices 160, 165, 170, 174.
Choose 165–170 for classic break-led identity, faster for contemporary energy.
**Beat:** chopped syncopated funk-break logic rather than D&B's tidier repetition.
Snare anchors 5/13, kick 1/7/11 is one scaffold; add/remove a kick pickup at 16,
or snare at 12/15 on alternate bars, not every fill everywhere. Hats 8–14 with
intentional holes. The three-track engine approximates a break; do not claim an
actual Amen recording unless a supplied source genuinely contains one.
**Density:** kick 3–5, snare 2–5, hats 8–14. Breaks are busy, sub is spacious:
2–6 bass entries/bar, lead/vocal 0–3. Use a sparse second-bar variation where the
existing grid allows it; no constant wall of retriggers.
**Instruments:** round dub/sub bass, noisy or acoustic-like snare, short hats,
optional V vocal chop or W atmosphere. Keep bass roots simple and let rhythmic
recombination supply complexity. Dark/modal or uplifting minor material both
work. P/O/Q disabled for this app's jungle brief. Avoid a house kick on every
quarter, huge sustained lead stacks, or writing 85 BPM because the break source
was originally funk at half speed. Classic dub space matters as much as busy tops.

## house — House

**Clock:** automatic 118–128 BPM; common starting choices 120, 122, 124, 125, 126.
**Beat:** stable four-on-floor kick 1/5/9/13, snare/clap role 5/13, offbeat hats
3/7/11/15. Add occasional closed-hat-style steps or one pickup; do not replace the
foundation with a random broken pattern. Slight syncopation belongs mainly to
bass/chords. Real swing cannot be requested via unsupported timing controls.
**Density:** kick 4, snare 2, hats 4–8; bass 3–7, chords 2–4 events/bar or slower
harmonic rhythm. Aim medium density and an inviting repeating groove.
**Instruments:** rounded kick, short clap-like snare, clean hats, warm X bass and
Q/P piano chords/stabs are appropriate. Q extended seventh voicings can share
common tones; Q is optional, not required. P phrases or a rare O colour must fit
key and leave room; don't stack P/Q/O simply because permitted. Bass roots connect
chord changes and complement kick rather than mask it. Vocal V optional. Two to
four chords over a phrase, compact voicing and brief hooks beat continuous scalar
lead running. Choose one house identity (piano-led, soulful, jackin-influenced)
instead of mixing all subgenres. Do not call an all-off drum pattern house unless
specifically asked for a breakdown.

## deep-house — Deep House

**Clock:** automatic 112–124 BPM; common starting choices 116, 118, 120, 122.
**Beat:** kick 1/5/9/13, soft snare/clap 5/13, hats 3/7/11/15 with a few skipped
or additional quiet-feeling placements (binary hits require timbral restraint).
**Density:** kick 4, snare 2, hats 3–7; bass 2–6 entries; chord changes every bar
or longer rather than four unrelated chords per beat. Low-to-medium density,
longer spaces, less aggressive top-end activity than tech house.
**Instruments:** warm rounded bass, subdued electronic drums, Q mellow piano
sevenths/ninth-like compact voicings within available note limits or P electric/
soft piano source if catalogue supports it. Gentle L motif optional. O isn't
categorically forbidden, but not a default orchestral pad bed: use only genuinely
appropriate sparse material. Harmonic sophistication means voice-leading, not
maximum note count. Minor seventh/dorian colour or warm major seventh flavours
work. Keep bass low and simple while upper chords have extensions; use rests to
suggest depth without changing shared reverb. Avoid big-room trance arpeggios,
constant fills, harsh modular clutter or fast rolling 16th bass throughout.

## tech-house — Tech House

**Clock:** automatic 124–130 BPM; common choices 125, 126, 127, 128.
**Beat:** kick 1/5/9/13, short snare/clap 5/13, hat 3/7/11/15 plus a few short
syncopated tops at 8/14/16. Backbone must stay steady, not random breakbeat.
**Density:** kick 4, snare 2, hats 5–10; bass 4–8 short entries with holes around
kick, one stab/vocal hook 1–3 entries. Medium rhythmic density, LOW harmonic and
melodic density. Leave space for the groove and implied vocal.
**Instruments:** punchy dry-feeling drum selection, rolling X bass, optional tiny
V vocal fragments or L/W short electronic one-shots. Bass repeats a small root/
octave/fifth vocabulary; variation comes from rhythmic placement. P/O/Q are
excluded by this brief. Do not interpret 'house' in the name as mandatory piano.
No cinematic strings, busy chord progression or constant long leads. A distinctive
repeating bass rhythm plus a sparse hook is more convincing than loading every
possible layer. Do not fabricate sidechain/compressor settings; achieve space by
notes and levels in the existing API.

## techno — Techno

**Clock:** automatic 128–145 BPM; useful/common choices 130, 132, 135, 138, 140.
This is driving techno, not every historical or hard-techno tempo variant.
**Beat:** kick 1/5/9/13, hats 3/7/11/15 or eighths with selected sixteenth details;
snare 5/13 can be restrained, or fewer/no snares for hypnotic/minimal variation.
Avoid randomising away the quarter-note engine.
**Density:** kick 4, snare 0–2, hats 4–12, bass 2–8 repeated pulses; one modular
motif 2–6 accents or sustained evolving source. Medium/high percussion density,
low harmonic movement. Change one small rhythmic feature, not the whole groove.
**Instruments:** machine drums, repetitive X bass, W modular rhythm/texture or
L focused electronic motif. P/O/Q off. One root, fifth or modal tension is enough;
movement can be timbral/source-driven rather than melodic. Available W source
slicing can imply mechanical patterns; it is not access to arbitrary synthesis.
Separate kick/bass pitch and note length. Dark warehouse, hypnotic and acid-like
SOURCE choices are different variants; only claim acid character if material
supports it. Avoid trance chord lifts, lush piano, frenetic soloing and excessive
bass sustain. High energy does not require every lane at full volume.

## trance — Trance

**Clock:** automatic 132–142 BPM; common choices 134, 136, 138, 140.
**Beat:** kick 1/5/9/13; snare/clap 5/13; hats 3/7/11/15 with optional eighths.
Offbeat bass at 3/7/11/15 is a clear starting grammar. Rolling bass may use selected
intervening sixteenths but should leave kick space, not overlap every step.
**Density:** kick 4, snare 2, hats 4–8; bass 4–10; lead 4–8 or a slower memorable
hook. Medium/high rhythmic density with one main melodic foreground. Arrange
fewer overlapping layers when both bass and lead are busy.
**Instruments:** driving X bass, suitable bright L lead, optional airy electronic
W/V atmosphere. Q/P are permitted, not compulsory: Q is literal piano/strings,
not a supersaw synth. Choose it only for that genuine acoustic-ish role. Long
orchestral phrases should not swamp the pulse. Minor/modal uplifting tension,
2–4 related chords and small arpeggio note sets can work; keep bass aligned with
harmonic windows. The contract cannot program an unavailable arpeggiator or
supersaw oscillator, so express an arpeggio as L notes. Avoid writing random
high notes over unrelated bass or selling unsupported filter/FX automation as a
build/drop. A patch is not a complete multi-minute trance arrangement.

## garage — UK Garage

**Clock:** automatic 128–138 BPM; common choices 130, 132, 134, 135, 136.
**Beat:** this button mainly means 2-step garage, not generic house or rock.
Snare/clap 5/13; kick can be 1/7/11 or 1/8/12, with deliberate empty quarter
beats. Hats 3/6/7/11/14/15 is one skipping framework, not a timing-swing command.
A 4x4 garage variant is possible if clearly chosen, but default to broken two-step.
**Density:** kick 2–4, snare 2, hats 5–10; bass 3–7 entries, short vocal/chord
accents 1–4. Medium density, syncopation and AIR rather than continuous drum spray.
**Instruments:** deep or bouncy X sub/bass, short crisp snares, skipping hats,
V chopped vocal or L hook; Q/P short soulful chords optional. Bright piano can
work, but not every garage take needs it. Major/minor seventh warmth with simple
bass motion; avoid huge sustained orchestral layers and clinical techno ostinati.
Keep vocal or chord stabs away from every snare attack. Recreate implied lilt via
rests and uneven step spacing only; do not claim shuffle offsets the engine
cannot express. Make bass rhythmic, not a generic held low note across the bar.

## breakbeat — Breakbeat

**Clock:** automatic 125–145 BPM; common choices 128, 130, 132, 135, 140.
**Beat:** a solid broken groove with snares 5/13 and kick 1/7/11, or 1/4/9/12.
Hats eighths with a few sixteenth pickups. Change the second kick/bar tail for
variation while keeping backbeat recognisable. Do not default to four-on-floor.
**Density:** kick 3–5, snare 2–4, hats 6–12; bass 3–8; lead/sample hook 1–4.
Medium/high rhythmic density, clear bass/drum call-and-response.
**Instruments:** punchy electronic or sampled-sounding drums, X electronic bass,
L hook, optional V fragments or W texture. P/Q permitted only for a specifically
coherent piano-breaks flavour; O excluded. Keep melodic elements brief and in key.
Compared with D&B use slower actual clock and weightier spaces; compared with
jungle use less densely recombined ghost-like breaks. Compared with electro it
may feel more sample-heavy and less rigidly robotic. No fixed sample-lane source
assumptions outside catalogue. Avoid every track hitting all 16 steps and avoid
adding many sustained harmony layers over an already busy break.

## electro — Electro (not electro house)

**Clock:** automatic 115–135 BPM; common choices 120, 125, 128, 130, 132.
**Beat:** syncopated drum-machine funk: kick 1/7/11 or 1/4/9/12, snare 5/13,
hats 1/3/7/9/11/15 or selected sixteenths. Four-on-floor is not the default;
'electro' here means broken robotic electro, not big-room electro house.
**Density:** kick 3–5, snare 2, hats 6–10; bass 4–8, lead/stab 1–4. Tight
medium-density machine interlock, sharp rests and clear patterns.
**Instruments:** 808-like electronic kick/snare/hat material where available,
X short syncopated synth bass, L robotic single-note hook or W machine texture.
P/O/Q excluded. Robot/vocoder-like V allowed only if such source exists; do not
promise a vocoder effect. Minor/modal motifs, octave/fifth jumps and repeated
short cells work. Clean Juno bass can fit if already selected. Avoid automatic
four-on-floor, orchestral drama or warm piano progressions; put identity into
broken kick/bass placement and electronic source character. A sparse hook with
lots of silence is preferable to a constant high-register solo.

## dub-techno — Dub Techno

**Clock:** automatic 110–125 BPM; common choices 115, 118, 120, 122.
**Beat:** restrained kick 1/5/9/13; hats 3/7/11/15, optionally omit one/two;
snare 5/13 quietly implied through subdued sample/level, or no snare.
**Density:** kick 4, snare 0–2, hats 2–6; bass 1–4 entries; chord-like source
accents 1–3. Low density, long negative spaces, repetition with small changes.
**Instruments:** deep rounded X bass, muted electronic W/L material with chord
or resonant character if the library actually contains it, subdued machine drums.
P/O/Q excluded, so do NOT use Q piano and call it a dub synth stab. A pitched
single-note motif or existing chord-like sample is a valid bounded approximation.
Minor/modal or harmonically ambiguous one/two root centres work; avoid busy chord
changes. Delay/reverb are part of the broader genre vocabulary, but this generator
must leave shared FX unchanged: seek spatial character in sources and spacing,
never invent/send unavailable effect controls. Avoid over-bright hats, melodic
trance leads, dense drum fills or describing an unchanged delay as newly applied.

## ambient — Ambient Electronic

**Clock:** automatic 65–95 BPM; useful choices 70, 75, 80, 85, 90. These are
convenient internal clocks, not a claim that beatless ambient has one common BPM.
**Beat:** drums optional and preferably absent for a beatless take. If present,
use kick 1 or 1/9, snare none or one distant accent, hats 0–4 dispersed events;
not a full house beat merely slowed down. Beatless still needs a valid clock.
**Density:** 0–2 kicks, 0–1 snare, 0–4 hats; melodic entries 1–4, substantial
rests and slowly changing note centres. Low event density does not mean silence:
choose sustained/evolving SOURCE material or enough gate from supported controls.
**Instruments:** W evolving modular texture, L gentle electronic notes, optional
already available compatible atmosphere or very restrained bass. P/O/Q excluded
for this electronic button, despite their use in other kinds of ambient music.
Choose a small consonant/modal pitch set or one drone centre, avoid densely
stacked detuned sources and unrelated harmonic phrases. No claim to extended
reverb, granular automation or endless pad sustain outside the writable API.
One foreground texture plus quiet countertexture often suffices. Do not let
every generator create a kick/snare/bass song regardless of genre.

## idm — IDM / Glitch

**Clock:** automatic 85–150 BPM; useful starting choices 95, 110, 120, 130, 140.
No statistically universal favourite; choose a coherent rhythmic idea first.
**Beat:** broken asymmetric placement over the supported 4/4 grid: kick 1/6/11,
snare 5/12/15, hats 2/4/7/10/14/16 as one example; vary selectively. This can
IMPLY displacement/polyrhythm but isn't a new time-signature/clock feature.
**Density:** kick 2–5, snare 1–4, hats 4–12; L notes 3–8, W punctuation or texture.
Contrast clustered bursts with empty areas, not maximum random density everywhere.
**Instruments:** REQUIRED fresh W samples_modular plus L samples_terra with notes;
X optional as the third source if it serves the idea. P/O/Q excluded. Drums
optional; if used choose terse/found-machine-like timbres from actual sources.
Small angular interval cell, repeating pitch anchors, sparse chromatic tension
or clear modal motif. Make a recognisable repeating rule, then disrupt it a
little. Do not send unsupported ratchets, probability, per-step velocity, swing
or meters just because the genre is experimental. Use explicit rests and written
steps. The three-reload budget makes careful source selection essential.

## industrial — Industrial Electronic

**Clock:** automatic 105–145 BPM; useful/common starting choices 110, 120, 125,
130, 140. EBM-like, slower grinding and techno-adjacent approaches differ.
**Beat:** choose a mechanical spine: kick 1/5/9/13 for stomping, or 1/7/9/15 for
broken EBM-like tension; snare 5/13, hats 3/7/11/15 with selected extra machine
accents. Repeat the rule firmly instead of randomising every beat.
**Density:** kick 3–5, snare 2–4, hats 4–10; bass 3–8; metallic motif 1–4.
Medium/high impact, not necessarily many simultaneous layers. Leave low-end room.
**Instruments:** REQUIRED fresh W modular and L Terra; choose abrasive/metallic/
mechanical catalogue character, not automatic full-volume clipping. Optional X
bass is the third source. P/O/Q excluded. One/two note bass ostinato or tritone/
minor tension can fit with anchored tonal centre; no need for lush harmony.
Distortion/noise are descriptive source qualities, not permission to alter shared
FX or invent a saturator API. Avoid filling the spectrum with constant noise,
long orchestral rises or a jaunty piano progression. Heavy timbre and sparse
repetition can be more effective than an all-on sequencer.

## experimental — Experimental Electronic

**Clock:** automatic 60–170 BPM. No meaningful most-common BPM: choose e.g. 72/90
for sparse texture, 110/123 for irregular interlock, 145/160 for fractured energy.
Explain the chosen pulse in the short description. Unusual is not automatically
fast, atonal, loud, or maximally dense.
**Beat:** optional. Choose one internal constraint: displaced accents, alternating
busy/empty bars, a sparse asymmetric pulse, or tonal call-and-response. Example
kick 1/8/12, snare 6/15, hats 3/7/10/16 is a seed for invention, not a required
pattern. For no drums explicitly disable them; do not inherit the previous beat.
**Density:** intentionally choose LOW (0–4 top events), MEDIUM (5–9) or brief HIGH
clusters (10–14), then contrast it with rests. L 2–8 sounding steps; W fills a
different role. A sustained texture and sparse melody can be fully experimental.
**Instruments:** REQUIRED fresh W samples_modular and L samples_terra with notes;
P/O/Q off. X optional if low end is missing, but do not add bass by reflex.
Optional already-loaded atmosphere only when the contract permits it; no Dropbox
load claims. Use a compact pitch family, a drone with irregular intervals, or
purposeful limited dissonance; avoid unrelated random MIDI values. One unusual
relationship is enough to define the patch. Keep source budget, sound levels,
existing effects, recordings and UI untouched. Distinct takes must come from AI
choices of sources, written patterns and density, not a fixed random preset bank.

## Sources and editorial scope

Consulted 2026-10-29. This is an original MYGRAIN-specific synthesis, not copied
production lessons. Genre boundaries vary by period and substyle. The exact
app ranges, hit-density suggestions and illustrative step placements are our
editorial generation policy, not measured popularity statistics or quotations.

- TC, producer's DnB Academy: full-speed 174 BPM centre, older jungle 165–170.
  https://www.tcdnb.com/academy
- Ableton Learning Music, tempo/genre: typical ranges are guidance, not identity.
  https://learningmusic.ableton.com/make-beats/tempo-and-genre.html
- Ableton Learning Music, backbeats: four-on-floor and beats 2/4 backbeat grammar.
  https://learningmusic.ableton.com/make-beats/backbeats.html
- Native Instruments, house production: four-on-floor with kick/clap and bass roles.
  https://www.native-instruments.com/blogs/blog/house-music-101
- Native Instruments, electronic music: broad rhythm/harmony vocabulary.
  https://www.native-instruments.com/blogs/blog/electronic-music
- Attack Magazine, Basic Channel-style dub techno: sparse pulse/offbeat foundation.
  https://www.attackmagazine.com/technique/beat-dissected/basic-channel-style-dub-techno/

## Mandatory preflight for the AI

Before returning JSON, check selected genre and clock (NOT half-time), kick/snare
identity, appropriate sources/exclusions, fresh required modular/Terra pair,
melodic key relationship, density/negative space and useful levels. Follow the
strict writable schema. Mention actual BPM, rhythmic character and instrument
roles briefly in description. A genre label alone is not evidence of a match.
Never ignore this memory because the previous patch has a different BPM or
because the generic default suggests Q piano. Explicit mode restrictions and
user tempo override remain authoritative. If an operation isn't supported,
choose a musically honest approximation rather than inventing a control.
