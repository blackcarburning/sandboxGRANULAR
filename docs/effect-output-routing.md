# Shared effect output routing — FXOUT.1

Master Vol (including its mirrored card sliders) now controls a dedicated dry gate at the end of the regular output path, after excitation taps and inserts. Its previous master, kick and drum-return locations are unity, preserving excitation at zero. All audible audio still crosses finalAmplifierNode: panic, render capture and DAW output remain authoritative.

`effect-output.js` owns one context-scoped output sum, one dry gain, and lazily created per-effect wet-return gains. `modes.effectOutput = {version:1, throughMain:{effectKey:true}}` stores only opt-in main-following switches. Missing settings default to independent returns. The existing source gain, mute, solo, wet amount and processor power still govern each effect. Switch/volume changes ramp; there are no extra audio timers. UI mirrors have no IDs or canonical state, are excluded from generic randomization and link to the existing volume control. Every mirror and the original main slider has the red app-wide control note.

Resonator and the three acoustic processors connect actual wet outputs to the common sum. Bass Face and Mutilator split their existing native wet branches, retaining normal dry branches before Master Vol. D retains its original pre-volume distortion input; an identically scheduled wet-card gain keeps the independent return aligned with D level, mute and transport retirement. Wasp's desktop and phone master processors expose dry, Wasp-wet and Playground-wet outputs; together they reconstruct the existing master output at unity. A one-output caller retains the original processing contract. Playground's own wet amount determines the dry/wet decomposition. Turntable is fully wet: its mix insert stays serial and uses the shared main dry gate as its independently controllable output; drum-only record inserts send their processed output to the Turntable return while unrelated dry sources retain main control.

Saved patches, undo/redo, local snapshots and source ZIPs retain switches. Current-engine isolated decks, server-arm-worker and WAV/DAW captures use the same routing. Renderer disposal clears router-owned nodes and no transient monitoring state enters the routing settings.

Backend/frontend `effectOutputVersion:1` selectively refresh active effect snapshots missing this capability. Active snapshots include effectOutputEngineRevision 1 in content identity; disabled effects discard neutral routing state so unchanged legacy dry content keeps its old hash. Existing source ZIPs, source hashes and Song revisions are not modified by Arm. Old uploads are never falsely marked.

Checks: tests/effect-output-browser.cjs (Chromium/WebKit, desktop/phone final PCM, nine default and following paths, linked sliders, button history, snapshot/reload), tests/effect-output-song-browser.cjs (real isolated server jobs, native D, silent following, all-source excitation, WAV, warm-cache, metadata refresh, phone PCM playback, source/revision integrity), tests/test_effect_output.py (validation and legacy identity), tests/effect-output-visual-browser.cjs (rendered controls and Turntable drum routing) and tests/effect-output-d-song-browser.cjs (native D volume invariant and main-following silence).

## Optional ordered serial routing

[The cooking pot](cooking-pot.md) adds mutually exclusive original and ordered
sums. Its serial decomposition preserves independent per-card wet returns and
main-following switches without removing upstream excitation. Pot Off retains
the original routing and legacy render identity.


## Shared effect Solo monitoring — SOLO.1

Resonator, Wire World, Sonic Crystal, Bubble Chamber and Filter Playground use
one exclusive transient monitor selection in `mygrainEffectOutput`. Selecting
another effect releases the earlier Solo (including Resonator Source/Graph
monitoring). Clear All Solos clears this selection too. Disabling the selected
effect, zeroing its active slots or wet mix, account lock and context teardown
restore the full mix. A restart starts with Solo cleared.

Both native and Cooking pot sums mute their final dry bus and every *other*
semantic wet return, with the existing short gain ramps. Upstream excitation,
modulation and serial routing remain running; Solo does not turn off or rewrite
other effect cards. The selected return retains its existing Through main output
policy. The native fully-wet Turntable mix bus is part of the dry-bus mute, so
it cannot escape Solo. Pot mode changes preserve the selected monitor. Resonator
Source/Graph audition is forwarded to its ordered processor as well.

The earlier hosts muted only their local dry passthrough (and, for acoustics,
their own three returns). Independent returns introduced later bypassed those
local gates. A local dry mute could also remove a downstream Playground input.
Central post-excitation output gates fix both problems.

No monitor field is serialized, randomized or added to content identity.
`__mygrainSongRenderDeck` and native OfflineAudioContext gates ignore live Solo;
server Song preparation uses the current isolated deck and preserves the full
saved patch. Live-output WAV recording deliberately captures what is heard,
including any current Solo; this pre-existing recording contract is retained. No render-version bump is needed: ordinary patch audio is unchanged.

Regression: `tests/effect-solo-browser.cjs` uses final output PCM with eight
competing semantic returns in both native/ordered sums, five Solo targets,
exclusive actual controls, touch/keyboard, power Off, Clear All and restart.
Its WAV comparison checks that live-output recording reflects the monitored
mix in both routing modes (clear Solo to record the full mix).
`tests/cooking-pot-song-browser.cjs` captures an all-nine-effect part while live
R Solo is active, checks the source ZIP contains no monitoring state, and runs
12 real server fixtures, selective stale-render rebuild and warm phone-style
playback without changing original source hashes/revisions.

## Cooking Pot main output controls (2026-11-11)

The Pot has a **Main output volume · linked Master Vol** slider and **Mute main
output / Unmute main output** button. The slider mirrors the existing `volume`
control, not an extra Pot gain. Mute is a separate saved post-excitation switch
in `modes.effectOutput.mainMuted`. It preserves fader level, all Master Vol LFO
assignments and source/effect settings. Unmute reopens the main gate at the
existing (possibly modulated) level. Changing a fader does not clear the mute.

Independent wet returns remain audible; returns explicitly set to **Through
main output** also mute. Native whole-mix Turntable is itself a fully wet return
and retains its independent/following policy. Source excitation and routing are
untouched in Pot On and Off modes. There is no force-to-independent override.

`effect-output.js` mounts and synchronises the ID-less
`data-effect-master-proxy="cookingPot"`; generic saved-control inventories exclude
this proxy. `cooking-pot.js` supplies the shared history-wrapped mute edit. JSON,
local, ZIP and Song/native/WAV use the canonical volume plus optional true mute.
Absent/false mute normalises away, retaining old hashes and PCM for all unchanged
patches. True mute alone requires `effectOutputVersion:3`, including dry-only
patches, and is retained in content hashes. Backend validation, render admission
and current client/server rendering use this capability. No global invalidation
or stored-source rewrite; legacy versions 0/1/2 keep their existing meaning.
