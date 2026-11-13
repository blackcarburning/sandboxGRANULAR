# Linked Layers controls

Browser release: 2026-11-10. Native VST state/protocol/binaries are unchanged.

- `performanceDrumMachineEnableBtn` calls `setDrumMachineEnabled`, and `syncDrumMachineUi` mirrors its state. It mutes without clearing samples, patterns or stopping the shared clock.
- `layer-controls.js` uses the 25 existing Layer enable buttons and canonical Mix/FX sliders. There are no duplicate saved fields or new slider inputs. The volume text is the canonical value; the brighter fill is relative to that slider’s existing min/max (Granular supports 0–200%).
- Tap still toggles the existing layer. A 4px touch / 8px mouse horizontal movement starts one `mygrainCardHistory.runDraftEdit` transaction, with live updates through `setSliderValue`. Active buttons declare `touch-action:none` before contact and capture touch immediately without changing focus. Vertical drift cannot pan the page, and vertical-only movement does not mute. Scroll outside active volume buttons; inactive buttons retain native scrolling. Pointer cancellation, blur, hiding, lost capture and account lock restore the initial level and settle the transaction. Arrow keys adjust a step, Shift ten steps, Home/End the existing range.
- `.layer-muted`, `.osc-off`, Solo isolation, zero level, and `.layer-nav-muted` use the same neutral grey and subdued text. Jump controls retain their action and never acquire `disabled` or toggle semantics. Wasp, Turntable and Filter Playground links exist before lazy editor hydration, reuse the standard jump helper and follow independent effect power states via subscriptions. Utilities (Song, export, transport, etc.) keep their normal colour. Sound-section aliases are mapped in the inline host, so both phone and desktop Jump surfaces follow the canonical state and restored solos.
- Meters use the existing `mygrainMeters` owner with `interval:500` and an eligibility predicate. Existing meters retain their 125ms interval. No new context, resume operation, RAF or polling owner exists. No taps or scheduler work are kept for hidden/offscreen/muted/zero-level/suspended controls. Account lock disposes the layer owner.
- Each viewed active button owns at most one splitter and two small analysers, summed into a single mono energy display without opposite-polarity stereo cancellation. K includes all active track outputs; drums include ordinary/kick-bypass and independent wet return. Sample activity taps only live generated-source grain panners, with their existing output/trim gains mirrored on meter-only branches. A visibility-owned stable tap is prepared on scheduler resume and receives grain start/end notifications, so short grains are not connected only at a display tick; it does not borrow unrelated Granular activity. Granular shows its existing aggregate output bus. Only owned tap connections are disconnected; no audible routes are rewritten.
- Song render decks skip the UI module. Gains, enables, patch/Song/project snapshots and render compatibility revisions are unchanged. The extra grain metadata contains read-only node references and is not serialized. Current and legacy server jobs, warm reuse, phone PCM playback and final WAV export are regression gates, not a render-version migration.

## Anchored phone gestures

Touch capture and `touch-action:none` are scoped to enabled, audible Layer buttons, including enabled buttons at zero volume. No body/viewport scroll lock or focus change is introduced. Fresh pointer contact resets only the previous compatibility-click guard; fast consecutive mute/unmute taps remain separate actions. Cold Wasp/Playground links are reused during hydration rather than duplicated. This release changes UI interaction/navigation only, not DSP, saved fields, render signatures or plugin builds.

## Verification

- `node --test tests/vu-scheduler.test.cjs tests/vu-layer-scheduler.test.cjs`
- `MYGRAIN_TEST_URL=http://127.0.0.1:PORT/mygrain/ MYGRAIN_TEST_OUTPUT=/isolated/evidence node tests/layer-controls-browser.cjs` (isolated test account/store only; see test header).
- `MYGRAIN_TEST_URL=http://127.0.0.1:PORT/mygrain/ MYGRAIN_TEST_OUTPUT=/isolated/evidence node tests/daw-bridge-song-browser.cjs`

Keep the explicit canonical-control map in `index.html` in sync if layer buttons are renamed. Do not infer activity from a menu’s own `aria-pressed`, a card’s running clock, or another layer’s bus.

## X and drum transient meters — 20261110-x-drum-meters-1

X taps the current Loop FX X bridges (sample and OSC3 groups), not the bypassed legacy delay bus. OSC3 taps mirror the existing downstream oscillator output level without borrowing other oscillator voices. Drums retain both normal and kick-bypass buses plus the independent wet return. These two 2 Hz meters use a native analyser history covering the preceding 500 ms at 44.1/48 kHz (power-of-two, capped at 32768); other Layers windows remain 512 samples. Visibility resume attaches known taps immediately, before the first display tick. New X groups, drum buses and wet returns notify only the viewed display owner before their first hit, so cold short notes are retained too. No new audio processing owner, timer, playback route, snapshot field, server-render compatibility change or plugin build.

## Safari release lifecycle and effect power — 20261110-safari-powers-1

The Safari branch requires an Apple vendor and Safari UA and explicitly excludes
Chrome/Chromium/CriOS, Edge, Opera and Firefox iOS tokens. Its primary pointerdown
capture cancels an abandoned previous gesture before the new button handles the
contact. Its pointerup/pointercancel listeners use capture, settling the gesture
before WebKit can deliver an implicit lostpointercapture at the target. A release
from outside the owned button cancels rather than forwarding a tap. The original
non-Safari pointer listeners, per-button gesture handlers and finish function are
byte-identical to the pre-edit version; Chrome remains on that path.

Normal WebKit taps passed against the baseline, but controlled omitted-release /
early-capture-release event sequences reproduced M changing on a K tap and a D
tap being discarded. Both sequences pass after the fix. Do not describe these
injected sequences as a physical-device reproduction.

The three added plain On/Off buttons wrap existing Layers jumps and mirror only
`resonatorR.enabled`, `wasp.enabled`, and `wasp.playground.enabled`. They use the
existing history transaction, audio-source preparation, runtime restore and save
functions; they are not volume-gesture buttons or additional saved controls.
Subscriptions and history updates synchronize external changes and Undo/Redo.
Wasp and Playground power remain independent. Busy controls are disabled, and
pending preparation is guarded against account/audio replacement and account
lock before applying power or saving. No engine/DSP, Song render-signature,
server or native-plugin changes are needed; ZIP captures use existing fields.

Verification: `tests/safari-layer-switches-browser.cjs` exercises 64 native
D/M/M+/K taps across Chromium/WebKit phone and desktop, the two injected release
orders in WebKit, all three effect switches, isolation, Undo/Redo, ZIP recall,
landscape containment and zero page errors. Add `MYGRAIN_TEST_POWER_LOCK=1` for
delayed-preparation/account-lock cancellation. Use a loopback isolated backend
with the seeded `isolated-vst3-test` admin fixture; never production accounts.
The existing `tests/layer-controls-browser.cjs` regression separately covers
volume, cancellation, metering, outside scrolling and local/ZIP recall in all
four browser/device cases. Exact backups, source-parity hashes and receipts:
`../output/mygrain-safari-layers-20261110T082725Z/`.

### Consistent effect rows — 20261110-effect-rows-1

All four Layers effect controls (Turntable, Wasp, Filter Playground and Olaf’s Resonator) use `.performance-layer-switch-row--effect`: a canonical On/Off proxy beside a `Jump` button. The mobile rule explicitly uses two columns, not the three-column layer+Jump+Solo grid. All labels remain semantically described via existing Jump aria-labels and destination IDs.

Wasp’s lazy UI must reuse existing Layers jumps **without reparenting**: unconditional append/after moved the links out of their power rows after hydration. Drawer and mixer names remain descriptive; only Layers links read Jump. Turntable uses its existing runtime settings/restore and subscription, the same history/audio-readiness/account guards as the other power mirrors; no new serialized field or DSP.

Evidence/backup: `output/mygrain-layer-layout-20261110T094151Z/`. Verify four paired rows and exact Jump text before and after actual Wasp/Playground navigation, on phone portrait/landscape and desktop in WebKit/Chromium. Power/history/ZIP regression includes Turntable.

## Mutilator and Bass Face power/jump rows — 20261111-character-layers-1

Layers has two additional effect rows with standard On/Off proxies and Jump links, targeting `#loopDMutilator` and `#bassFaceCard`. Both use the existing `layer-controls.js` power owner, history, preparation, account/context guard, busy disabling, neutral-grey Off styling and two-column layout. No new volume gestures or saved proxy fields are introduced.

Mutilator's adapter exposes only `mygrainD.settings().mutilator` and applies through `mygrainD.setMutilator(...,{skipSave:true})`, followed by the shared save. It never restores or enables the D lane. Bass Face uses its existing settings/restore API. The body aria-state observer and history updates mirror card/programmatic changes; neither effect adds a polling owner.

Navigation uses separate `mutilator` and `bassFace` semantic keys so one effect's Off state cannot grey the other's shortcuts. Bass Face retains its previous navigation palette. The two new Layers links reuse the established reveal/scroll handler and remain usable when their effect is Off.

UI-only release `v2026.11.11.LAYERS.1`: DSP modules, canonical modes, presets, WAV/server rendering, native plugins and render compatibility signatures are byte-unchanged. Verification: `tests/character-layer-jumps-browser.cjs` checks all nine paired effect rows, native desktop/touch actions in Chromium/WebKit, independent power (D Off), repeated navigation, card-to-Layers synchronization, independent grey navigation, Undo/Redo, ZIP/JSON/no-proxy capture, reload and 320/390/844px containment. Evidence/backup: `output/mygrain-character-layers-20261111T103745Z/`. `tests/character-layer-keyboard.cjs` separately verifies Enter activation of both Jump links. Physical iPhone is not covered by emulation.


### Cooking pot navigation · POT.2

`performanceLayerCookingPotJumpBtn` is a jump-only, pot-icon Layers entry to
`#cookingPotCard`. It is intentionally absent from power/volume/Solo maps and
saved control inventories. Cooking-pot.js mounts it once through the existing
navigation helper; the rack's effect rows and all nine reciprocal card icons
use the same reveal/lazy-load/transition path.

Verification: Chromium/WebKit desktop and touch/phone-sized contexts passed all
nine effect/return round trips, keyboard Enter, single jump-only Layers entry,
unchanged effect/pot state and keyboard reorder/Undo. Four final visual cases
retain all source icons, readable colours and 320–1440px containment. Physical
phone hardware is untested. Exact audio/state ownership code and all 95 inline
script blocks are retained, apart from the two scoped cache URL changes.
