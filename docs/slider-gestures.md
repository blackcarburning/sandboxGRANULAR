# Global range gesture ownership

`slider-gesture.js` is the single delegated touch/pen adapter for every enabled native range, including lazy and nested controls. Run `python3 scripts/sync-slider-gesture.py` after editing it: the native page embeds those exact bytes in an early inline script, with no added startup request. The On Demand builder checks that identity and reuses the same inline owner in its embedded entrypoint. Its first-document CSS sets touch-action:none before interaction. Do not reintroduce per-effect touch handlers in the shop.

A non-passive window-capture touchstart cancels browser scrolling from first contact on a slider. Cancelling pointerdown or waiting for touchmove is not a sufficient iOS fallback. Touchmove follows the initiating touch identifier even outside the original input. Touchend/touchcancel commit a single canonical change and release ownership; blur/pagehide/visibility loss also release it. Pointer capture covers pen and browsers using pointer-only input. Mouse and keyboard remain native. Input values use the real min/max/step sanitisation and dispatch existing input/change listeners, not direct DSP setters.

The listener does not cancel gestures starting on labels, Mod buttons, selects or other non-slider areas, and never locks body overflow. Exception: WireWorld, Olaf’s Resonator and Heavy Lifter expand their range ownership to the containing slider label and small parameter-row gaps, excluding buttons/selects/links/other inputs. Its first-contact CSS covers those same grab areas. WireWorld readouts reserve stable height so changing units/digits cannot move its small slider rows. Heavy Lifter also includes the compact `.heavy-mod-field` gap beside MOD, without claiming the button. Other cards retain their original exact-range hit test. Resonator select/number/checkbox fields, buttons and its drawable excitation graph keep their own gesture handlers. Keep normal swipes native. `mygrainSliderGesture.diagnostics()` reports only active ownership, not user settings.

Run `node tests/slider-first-contact-browser.cjs` from the native checkout for Chromium and WebKit first-contact, dynamic-control, fallback, cancellation and keyboard checks. The regression uses the workspace Chromium executable and the installed WebKit runtime. For the production effect inventory, open every conditional control/model and use Chromium CDP diagonal touch drags, recording all inner/outer scroll offsets, input events and pointer cancellations. WebKit trusted taps must confirm touchstart.defaultPrevented, not just a changed value. Distinguish those tests from physical iPhone dragging.

The native account asset allowlist (`backend/mygrain_accounts.py`) must include the shared script; reload the native web-serving process after an allowlist change. On Demand asset registration is the startup-loaded pot-app manifest: adding this shared asset requires deploying the manifest and restarting only the public account/static service. No audio-engine restart or DSP change is required. Cache marker: 20261120-first-contact-1.

Repeated cold full-app browser loads exposed Caddy upstream TCP dial timeouts
against the main documenter’s default listen backlog of five. The native web
listener now uses DocumenterHTTPServer.request_queue_size=128. This changes only
the pending connection queue, not audio workers, account access or request rules.
Check the active listener with `ss -ltn '( sport = :8765 )'` and wait for it to
listen after restarting the wrapper service before running a browser check.

### WireWorld compact-row follow-up (2026-11-21)

Audit both sides of the phone's one-/two-column breakpoint. At a 430 px outer
viewport the embedded sliders are only 116 px wide: a start 22 px above the
range landed in its label and scrolled the editor 72 px without changing the
value. Direct track grabs were already owned. WireWorld now gives its slider
labels and compact-row gaps to the existing owner (not a second listener), and
reserves readout height. Buttons/selects/links and other cards are excluded.
No audio, presets, stored settings or render engine changes.

`../mygrain_public/tests/wireworld-slider-browser.cjs` checks all eleven ranges
at 390/430 px, track/edge/label contacts, canonical parameters, inner/outer
scroll, release, MOD buttons, keyboard and outside scrolling. It takes a
short-lived approved-account session in WIRE_SESSION; use WIRE_LIVE=1 for
deployed assets. Chromium uses trusted compositor drags; WebKit verifies trusted
initial-contact taps, not physical iPhone continuous dragging. Evidence:
`../output/mygrain-wireworld-touch-20261121/`.

### Olaf’s Resonator follow-up (2026-11-21)

Resonator slider labels and padding now use the same delegated touch/pen owner
as WireWorld. Its pre-contact CSS covers those labels; adjacent selects, number
fields, checkboxes, buttons and the excitation canvas are excluded. No DSP, saved
patch or Song schema changes. The shop adapter seeds only fresh racks with cone
objects, input 1 On / input 2 Off, whole-loop excitation, 20 dB drive, 82% damping,
100% object/return/effect output levels, Bass and 80% insert Wet. Existing per-loop
racks restore without overrides. Native defaults are deliberately unchanged.

`../mygrain_public/tests/resonator-slider-browser.cjs` audits all fifteen slot
ranges across four object models, both slots and narrow/wide phone viewports,
plus output/wet/delay controls, non-slider exclusions and per-loop recall. It
uses read-only account access and blocks all POSTs. Chromium compositor drags
and WebKit trusted first-contact taps are distinct from physical iPhone testing.

### Heavy Lifter six-mode follow-up (2026-11-21)

All six lazy mode tabs use the same scoped expanded ownership: slider labels,
readouts and compact MOD-row gaps. Match pre-contact CSS to those exact regions;
leave MOD buttons, source/preset selectors, research links and tab buttons native.
Direct sliders still dispatch their existing input/change events, including the
coarse Reverse impulse slider. No DSP, defaults, presets or Song/render identity
changes. Shared helper marker: `20261121-heavy-hit-area-1`.

`../mygrain_public/tests/heavy-slider-browser.cjs` checks all six mode tabs,
including pulse-wave LFO width, shared depth/level/width, output/wet/main proxies,
and all six mode parameters at 390/430 px. Each slider is tested on its track,
edge and label; MOD-row gaps receive an extra check. Chromium uses compositor
diagonal drags; WebKit verifies trusted initial-contact cancellation. Canonical
values, nested scroll, release, native neighbours, keyboard and cancellation
are checked with POSTs blocked. Use WIRE_SESSION for a temporary approved account,
HEAVY_LIVE=1 for deployed assets and HEAVY_BEFORE=1 for the original failure probe.
Staged HTML interception preserves production CSP. Native inline and embedded
helper bytes must match. Physical phone continuous dragging is a separate check.
Evidence: `../output/mygrain-heavy-touch-20261121/`.
