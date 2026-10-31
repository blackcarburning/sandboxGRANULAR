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
