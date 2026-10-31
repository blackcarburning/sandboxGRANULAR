# iPhone scroll lifecycle — SCROLL.1 (2026-10-31)

Mark reports progressive slowdown specifically while scrolling, eventually stopping audio.
The preceding viewport-release code paused drawing, but IntersectionObserver callbacks
still immediately measured/parked cards, released canvas backing stores and refreshed
observers during scrolling. Lazy module mounts also ran as their targets crossed view.
This establishes scroll-time lifecycle churn, not a proven native memory leak or a
reproduction of the physical iPhone audio halt.

Changes in demand-ui.js:
- Coalesce card visibility decisions per element while the scroll/jump budget is busy.
- Defer connected canvas backing-store release until the budget settles. A canvas
  that leaves and returns during the burst avoids teardown/reallocation entirely.
- Flush final card decisions before final canvas paints/releases after settling.
- Defer automatic lazy module starts until scrolling/jumps settle. Explicit Jump
  readiness still runs immediately; controls, bindings and audio state remain intact.
- Remove detached cards from the deferred queue during existing DOM cleanup.

No DSP, note scheduling, source buffers, saved-part schema or audible render changes.
Server render decks still skip display setup. No freeze invalidation is required.

Verification: ui-activity regression fails against exact pre-task demand-ui.js at
scroll-time canvas teardown, and passes with the fix. Focused unit coverage includes
meter scheduling and mixer jumps. viewport-release-browser.cjs covers repeated whole
page sweeps, stable DOM/card/canvas counts and height, offscreen backing release,
nonblank waveform restoration and real AudioWorklet PCM. Its scroll-lifecycle wrapper
also asserts unchanged releases/redraws/parked-card counts throughout continuous page
motion, in Chromium/WebKit portrait 390x844 and landscape 844x390. Mixed audio checks
cover 402x768 and 768x402 in both engines, native Chromium touch scrolling, no skipped
steps, zero height-only keyboard/waveform rebuilds and real PCM.

Evidence outside public app tree: output/mygrain-scroll-lifecycle-20261031/.
Live cache key: demand-ui.js?v=20261031-scroll-lifecycle-1.
Visible badge (start overlay and performance area): v2026.10.31.SCROLL.1.
Physical iPhone confirmation remains outstanding; browser checks do not prove a cure.

## Popup and browser extension — SCROLL.2 (2026-10-31)

- WAV previews and G/INSTAREEL previews share a bounded 10Hz progress clock,
  replacing independent continuous animation-frame loops. The clock has no
  pending timer during nested scrolling, hidden-page or offscreen/closed views.
  Stop/dispose disconnects its observer and removes its listeners. Page lifecycle
  pauses display work without stopping preview audio; no source is recreated.
- WAV row batches pause until the global scroll burst settles. Cancelling/closing
  clears the pending batch. Feedback textarea measurements use the same coalesced
  display queue, including sample browsers; detached controls are not measured.
- Reel library population waits for settling and rejects superseded requests.
- Drum, L and X popup indicators honour document-captured scrolling from any
  nested surface, not only the editor's main scroll area. Busy cancels visual
  RAFs/obsolete display events, never the musical scheduler or voices.
- EQ spectrum and live mastering meters also honour the shared activity budget;
  account disposal/dialog close removes added display listeners.
- Scroll-time CSS animation/transition suppression covers body-level popups too.

Display-only change: no source buffers, DSP, sequence timing, saved patch schema,
server Song freeze compatibility or render worker changes are needed. Server
render decks already skip these displays.

Evidence: output/mygrain-popup-scroll-20261031/ (outside public app root).
Focused unit tests cover pause/resume, disposal, nested scroll and viewport queues.
The older WAV responsiveness unit fixture has nine pre-existing failures, reproduced
against the exact before-task index.html (missing wavRepositoryBrowserSection).
Live cache key: 20261031-popup-scroll-2; badge v2026.10.31.SCROLL.2.
Physical iPhone confirmation remains outstanding.

SCROLL.2 verification completed: 10 focused unit checks, all 77 inline script
parses and external JS syntax checks pass. Eight mobile browser cases pass:
Chromium/WebKit at 390×844 and 844×390 for WAV/reel previews and real drum audio.
The actual WAV listing creates no audio rows during the burst, then fills its
bounded 40-row page on settling. WAV and reel progress writes stay at zero while
scrolling; the same source keeps playing, real WAV PCM remains nonzero, and
progress resumes afterward. Hidden preview display writes stop. Drum tests retain
nonzero mixed PCM, zero skipped steps, zero late hits and stop/close cleanup.
Public HTML contains the new badge and all five changed external assets return
HTTP 200 with bytes exactly matching the checkout.

## Remaining native touch/compositing work — SCROLL.3 (2026-10-31)

Mark still reports progressive scrolling slowdown with partial recovery at rest.
Submitted audio-20261031T155823Z confirms SCROLL.2, 1,277 scroll/height events in
seven bursts, zero canvas backing bytes, inactive meters and stable known PCM.
The captured live engine is stopped; preview audio was not represented separately.
Its running audio clock and zero skipped live steps cannot disprove preview/output
glitches. iPhone Safari supplies no native heap or hardware-underrun counter.

Further concrete paths removed:
- All three non-passive keyboard touch handlers were on document, making even
  unrelated popup gestures participate in main-thread touch dispatch. They now
  bind only the actual .keyboard-section surface; key/range double-tap and press
  semantics are unchanged. Passive global cancellation bookkeeping remains.
- All modern popups now use CSS overscroll containment, not the per-touchmove
  ancestor style/geometry boundary walk. Older browsers retain the fallback.
  Modern touchstart also no longer rescans every dialog on each gesture.
- Touch devices permanently disable remaining backdrop blur (including WAV,
  sample browsers and popup descendants), use opaque browser overlays and omit
  large card/shell shadows. This avoids toggling compositing layers per burst.
- Diagnostics now explicitly include direct WAV/reel preview source/buffer/display
  state and native-popup containment, separate from the live sequencer engine.

The native-popup unit regression fails against the exact SCROLL.2 HTML because
blocking popup handlers are attached. Chromium/WebKit baseline browser checks
also confirm blur(10px) on the actual WAV overlay. Synthetic touch events do not
reproduce its per-move style walk (zero reads in both builds), so they are not
claimed as a measured physical-device performance comparison.

No DSP, source audio or render compatibility changes. Existing server display
exclusions remain valid. Physical iPhone improvement remains unconfirmed.
Evidence: output/mygrain-native-popup-20261031/ (outside public app root).

Verification completed: 24 focused scroll/lifecycle/tap unit checks plus the
keyboard touch-control regression pass; all 77 inline scripts parse. The broad
keyboard fixture retains the same 10 pre-existing failures against before-task
HTML, with unchanged failing test names. Four final browser cases pass in
Chromium/WebKit at 390×844 and 844×390: native Chromium WAV swipes move the dialog,
WAV/reel progress writes remain zero during bursts, real PCM remains nonzero,
same-source audio continues, displays resume and drum popup cancellation works.
Four baseline cases retain WAV blur; final cases show none. These are regression
and removed-cost checks, not a physical-iPhone underrun reproduction.
Visible badge and URL marker: v2026.10.31.SCROLL.3 / 20261031-native-popup-3.

## SCROLL-TRACE.1 — diagnostic capture, not a performance cure

The 16:04 submitted report was a saved SCROLL.2 capture from 15:58. It records
an audio/wall clock ratio as low as 0.6314 despite responsive JavaScript timers
(maximum delay 99ms). This establishes audio-clock slowdown, not its cause;
zero canvas backing bytes at capture is not evidence of a native-memory leak.

The existing 1Hz monitor now retains 180 compact tuple rows: audio/wall progress,
AudioContext output timestamp (when available), scrolling target/phase, viewport,
display counters, preview ownership, playback and scheduling counters. Tuple
column names ship in JSON/text exports; marked incidents retain the preceding
20 rows. Clear releases the ring. No new timer, RAF, audio node, analyser,
permission prompt, sample data or scroll-time geometry read is introduced.

Submit Current Log explicitly selects the current session. Saved/current choices
show their build; successful receipts include captured build/time. The existing
upload timeout now aborts its fetch instead of invoking unrelated undefined WAV
preview names. Previous saved sessions remain available and are not deleted.

Verification: 35 focused diagnostic/activity checks pass, including slowdown
and recovery correlation, one-timer ownership, retention/clear and bounded
long-session exports. All 77 inline scripts parse. A disposable authenticated
server tests current submission and nested-scroll metadata in Chromium/WebKit,
portrait and landscape; upload receipts are intercepted locally. No production
account or diagnostic records are created by these tests. Evidence remains in
output/mygrain-scroll-trace-20261031/ outside the public app root.

For the next physical-iPhone capture: reload SCROLL-TRACE.1, reproduce for
30–60 seconds, Mark Crackle while slow, allow ten seconds at rest, then Submit
Current Log before refreshing. No claim that this diagnostic build fixes audio.

## KEYS-TRACE.1 — sampled-key lifetime visibility

The next submitted SCROLL-TRACE.1 capture is current and records an active arp:
5-second progress drops to 0.834, with individual late samples near 0.76 even
while scrolling is idle. L/X/drum counts remain modest and there are no missed
steps. This does not isolate the sampled keyboard: its voices and PCM were
missing from both the generic voice counts and the known-buffer inventory.

Added a small scalar keyboardSamples snapshot to each 1Hz timeline and the full
phone report: current instrument, active/keyed/pending/released/future/overdue
voices, arp/retired ownership, per-instrument counts, sample bytes/duration,
Q keyboard cache bytes, output bus count, hold and decay. The full deduplicated
PCM inventory now includes the selected keyboard sample, keyboard Piano/Strings
atlases/caches and active/retiring sample sources. There is no PCM duplication
per voice and no new probe timer. Counters distinguish a shared large buffer
from many simultaneous voices; overdue means scheduled end >250ms behind the
current audio clock, not a hardware CPU measurement.

No audible engine, note scheduling, source cleanup or saved-state change is
made: existing KeyboardPlayer has a 64-voice ceiling, reuses the selected sample
and removes/disconnects voices on native ended callbacks. Browser stress checks
exercise 1,000 real sample notes per case across five cycles, low pitches,
scheduled notes, deliberate 120-note pressure, the actual arp retirement path,
and explicit Stop. They wait beyond the scheduler horizon plus retirement grace
before asserting retired ownership is empty. This is not proof that a physical
iPhone cannot suffer native DSP pressure or another retaining path.

Evidence: output/mygrain-keyboard-lifetime-20261031/ outside the public app root.
Server Song compatibility is unchanged because this is diagnostic metadata only.

Verification: 69 focused checks pass; all 77 inline scripts parse. All four
Chromium/WebKit cases at 390×844 and 844×390 complete 1,000 sample notes each
with at most six transient voices, zero after each settled cycle, 64 under
intentional held-note overload, and zero active/retired voices after arp Stop.
Those findings do not confirm or exclude the physical iPhone symptom.
