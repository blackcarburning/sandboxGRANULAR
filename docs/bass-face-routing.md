# Bass Face and routable Mutilator

Bass Face is a non-destructive insert inside X, with its own face icon/header and navigation jump. It defaults to X input, bypassed. It has 30 bass-focused circuits and 100 named recipes in ten banks, from valve/tape warmth to folding, octave harmonics, fuzz and crushed textures. The drive band is limited before shaping, with DC cleanup, a tone filter and separately blended clean bass foundation. Rhythm uses an audio-clock buffer, not UI timers. Controls are Drive, Tone, Wet/dry and Clean bass body.

The patch selector and −/+ buttons use the visible sorted bank order, wrap at either end, skip Custom and preserve input/power. Edits are history-aware and guarded during concurrent work. Only normalized controls are stored; no factory ID is needed to recall a patch.

Mutilator defaults to D. The original D pre-gain DSP path and implicit-default saved schema remain unchanged. Choosing any other input moves Mutilator to that card's channel insert, independent of D's own power. The dropdown includes individual cards, K/drum group choices and DAW / FX plugin input. Bass Face exposes the same sources. N enters through its exported loop-FX route as well as the channel-EQ path. Only matching source buses are processed; there is no duplicated source or summed feedback route. Non-D inserts run Mutilator → Bass Face → existing card FX → Wasp → channel EQ. D retains its earlier inline Mutilator before the shared route.

For the FX plugin select DAW on the desired character effect and choose a processed plugin input route. Direct deliberately bypasses effects. The external insert disables added waveshaper oversampling, retaining the existing FX latency contract. No native binary update is needed.

Ordinary Randomise includes Bass Face; Mega chooses character inputs from eligible sources and uses independent effect lotteries. Sparse bypasses both. Final cleanup follows musical availability (including stopped cards, drum patterns and generated audio), not a momentary note/rest. Manual selection can remain armed on a stopped or disabled source.

Mega asks whether to randomise tempo for this run: Yes draws an inclusive integer 60–180 BPM; No retains the tempo; Cancel/Escape changes no patch controls. The prompt precedes generation resets and history capture. Sparse and ordinary Randomise retain their existing tempo policy.

## Persistence and Songs

`modes.bassFace` stores version 1, enabled, input, strain, amount, tone, mix, body and rhythm. `modes.loopD.mutilator.input` is optional; absent means D. Proxy controls are excluded from generic inventories. Patch ZIP, reload and history use the canonical modes. Song lane-copy X includes Bass Face; D includes Mutilator.

The current engine renders both effects in server Song preparation. Only active non-DAW character inserts require `characterFxVersion:1` and an engine content-signature revision. Missing-version affected freezes are rebuilt without changing source ZIPs or Song revisions. Disabled/zero-effect Bass Face does not alter old render keys; explicit D routing normalizes to the legacy implicit route. DAW input processing is live external audio, not a portable Song source. The adapter budgets bounded insert DSP separately from decoded source PCM.

## Verification

Focused browser tests cover all 100 recipes, −/+ wrapping, native keyboard/touch interaction, power/input preservation, Undo/Redo, archive recall/reload and narrow-screen per-control bounds in Chrome/WebKit. Two sample rates exercise all recipes with finite, audible PCM. Routing tests compare dry/bypassed/unselected/selected/DAW/N channels. Backend tests compare optional/off and legacy content signatures and reject malformed new controls. Isolated server jobs cover X/A Bass Face, routed Mutilator with D off, default D and pre-feature snapshots, warm reuse, selective stale rebuilding and phone PCM playback. Physical DAW/iPhone use is not claimed by browser fixtures.
