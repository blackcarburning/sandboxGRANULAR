# Source jumps and routed-effect Solo

Build: v2026.11.13.ROUTE-SOLO.1

The three acoustic Layers shortcuts say Jump; their accessible names still name
the destination. Other navigation palettes retain their original presentation.

Cooking Pot input rows use the shared `MygrainEffectInputs.jumpTarget` mapping.
The small J button precedes In (or the object/route number). Whole mix and DAW
input have none. All eight drum lanes target the Drum Machine; all five K tracks
target K. Canonical input synchronization refreshes the target after route edits,
Stir/randomisation, history and saved recall. No input/button state is duplicated
in patch JSON or ZIPs. Normal navigation handles lazy cards and phone scrolling.

`soloSources` converts existing saved source masks to excitation keys;
`routedEffects` derives effect ownership without touching power/recipe settings.
The output controller unions manual effect selections with source-owned ones.
Removing one source recomputes the set, keeping other sources and manually pinned
effects. Clicking an automatically selected effect Solo pins its manual ownership.
The shared controller gates native and Pot returns and bypasses excluded inserts.
Pot reconcile synchronizes routing first so a changed recipe cannot leave a stale
monitor mask. The saved source mask, not the transient effect set, is authoritative
for offline decks and server Songs.

Only source masks with active matching effects need effectOutputVersion 5.
Backend classification mirrors the shared registry; source ZIPs and Song
revisions are never migrated for arming. Manifest inspection and render GET/POST
admission prevent stale v2-v4 PCM reuse. Unaffected parts keep prior identities.

Regression scripts:

- `tests/routed-solo.test.cjs`: all destinations, 2,970 JS/Python route cases,
  manual/derived ownership, native/Pot gates and offline behavior.
- `tests/route-jumps-solo-browser.cjs`: linked routes, all four Chromium/WebKit
  desktop/touch profiles, 320/390/844/960/961/1440 widths.
- `tests/route-source-navigation-browser.cjs`: actual J navigation, every target,
  BIG STIR refresh.
- `tests/route-solo-audio-browser.cjs`: final PCM through actual DSP and both
  output-routing modes, Chromium desktop and WebKit phone emulation.
- `tests/route-solo-song-browser.cjs`: nine real server fixtures, legacy/current
  audio, selective stale-v2-to-v5 rebuild, warm reuse, playback and source/revision
  isolation. Existing Pot inputs regression checks Undo/Redo and JSON/ZIP reload.

Browser emulation does not certify a physical iPhone or a native DAW session.

The older global Solo browser regression is now a negative control with all
effects routed to A while D is soloed; D-routed effects are tested by the new
positive PCM test. Its pointer helper completes canonical navigation, then
scrolls the actual control into view before tapping, so lazy/virtualized mobile
card headers are not mistaken for already-visible controls. The old Song entry
point delegates to the current routed-Solo expectations.
