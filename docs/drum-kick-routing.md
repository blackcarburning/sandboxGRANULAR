# Kick routing

Build `v2026.11.11.KICK.1` fixes the former unconditional `SC Kick` bypass.

The kick follows the same drum bus, sends and processing as the other lanes.
Its exception requires **all** of: `SC Kick`, SC Amount > 0, Bus Comp > 0,
and FX not muted. Selecting a key alone is not an enabled sidechain.
LFO sidechain behavior is unchanged. Whole-drum Direct Out remains a shared
drum routing choice, and Filter Playground's explicit kick override remains
respected. The bypass rejoins before the shared final bus compressor.

`playDrumMachineHit` gives kick voices a stable destination,
`drumMachineKickRoutingNode`. `syncDrumMachineKickRouting` switches only its
owned downstream edge between the ordinary and sidechain buses. This handles
already-playing tails without restarting voices, rebuilding per-lane EQ or
source-fed effects, or duplicating the drum sends. A separate pre-FX per-voice
gain applies SC Kick Level only during active kick sidechain and restores held
voices when it is disabled. Context/transport reset releases both owners.

There are no new patch controls or saved-setting migrations. JSON, ZIP and VST3
project state continue to use the existing compressor/sidechain/drum controls.

## Saved Song audio

`kickRoutingVersion: 1` identifies corrected renders. Current renders upload
`kickrouting=1`. Client compatibility and backend content signatures apply the
requirement only to audible legacy kick settings affected by the routing/trim
or compressor-zero ducking correction. Unchanged normal drums, active kick
sidechain, direct drums without affected trims, silent lanes and non-drum legacy
parts keep their cache identities. Old metadata is inspected before trusting
an unmarked freeze. Source ZIPs, source hashes and Song revisions are not edited
by cache preparation.

## Verification

- `tests/kick-routing-browser.cjs`: actual startup, Chromium/WebKit desktop and
  iPhone-sized live final-output PCM, filter path versus active SC bypass,
  amount/compressor/key/FX/Direct/Playground switching with one held voice,
  pre-FX trim and return to unity.
- `tests/kick-routing-wav-browser.cjs`: real final WAV exports on both phone
  browser engines; normal routing, zero sidechain and compressor bypass agree,
  with finite nonzero PCM and exact one-pattern frame counts.
- `tests/test_kick_routing.py`: affected/unchanged legacy cache matrix; set
  `MYGRAIN_BASELINE_BACKEND` to the pre-change backend for exact hash comparison.
- Task evidence in `output/mygrain-kick-routing-20261111T093544Z/`: six real
  pre-fix Song server jobs followed by selective current-engine rebuilds,
  unchanged neighboring renders/source hashes/revisions, warm reuse, exact
  output frames and phone PCM playback. Production account/Song stores are
  never used for fixtures.

Physical iPhone hardware is separate from WebKit/browser emulation.
