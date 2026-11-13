# N: 100 driven filter presets

The grouped N factory selector has 100 named recipes, sorted alphabetically in
12 sections. The original 50 recipes are unchanged. Another 50 add circuit
percussion (10), mutant individual drum hits (10), whole-mix spectral machinery
(15), X digital debris (5), L dub shadows (5) and V phantom voices (5).

The − / + buttons step through the menu's visible grouped order, skip Custom
and wrap at either end. From Custom, + chooses the first patch and − the last.
Both buttons and the menu share one history edit path, reject edits during
Song playback or suspended saving, and disable during an in-flight preset edit.
Keyboard activation and touch use the same path.
The bank is explicitly width-bounded with a shrinking middle grid column;
this prevents native WebKit select min-content sizing from hiding the + button
at narrow phone widths. Both step buttons retain a 46 px touch target.

Every recipe uses N's existing white/pink noise, multi-pass filter and
source-driven ADSR or follower. The new bank ranges from tiny glitch accents
to dark 16-pole blooms, inverted negative-space textures and longer dub/vocal
tails. It adds no oscillator, DSP algorithm or saved-state field. Some patches
are deliberately subtle; the selected driver must be audible for modulation.

Selecting a recipe is one existing draft-history transaction. It preserves N
power and all driver cards, solos, channel EQ and external N reverb/delay/filter
settings. It does not start playback or turn on a source card. N's internal
multi-pass filter is intentionally on in every recipe. Edits derive a Custom
label; preset Undo/Redo and saved ZIP recall recover the canonical recipe name.
Names and IDs exist only in `noise-card.js`'s `MygrainNoisePresets` catalog;
`modes.noiseN` retains only the existing normalized controls.

## Whole source mix, excluding N

The additive `source: 'all'` option sums the same source-channel amplitude
copies used by existing individual drivers. It includes D, drums, X/L/V and the
other source channels; it excludes N, global LFOs and grouping aliases. It is
not the compressed final-master return. Summing source copies avoids a feedback
loop through N or duplicating audible dry paths. The detector never connects
to an audible output: its output is only cents of N filter detune.

The existing white/pink generator, native cascaded filter, envelope detector,
startup defaults and legacy randomisation choices are unchanged. The old
normalization and deterministic envelope traces are captured in the legacy
fixture. Source `all` is added to the shared normalizer and worklet import;
legacy source selections retain their exact matching behavior.

## Persistence and server Songs

Song capture already stores `modes.noiseN`, including the source key; its
current render deck creates the same N graph and source-channel taps. New
recipes therefore use the existing backend archive boundary without new
manifest fields, preset IDs, memory budgets or schema changes. Their new
control settings/source hashes distinguish renders; no blanket render-version
invalidation is necessary, and legacy/source ZIPs are never rewritten on Arm.

Tests cover all 100 recipes and both sample rates, legacy normalization and
bit-exact envelope traces, driver inventory and exclusion of N, native filter
PCM, Chromium/WebKit desktop/touch controls, plus/minus wrap and section crossings, preset history, ZIP recall, live
filter output, and isolated actual server jobs for mix/drums/X/L/V plus old N
and pre-N snapshots. Server checks include warm reuse, phone PCM playback,
stable source hashes/revisions and released reservations. Hardware listening
and physical phone CPU remain outside automated coverage.
