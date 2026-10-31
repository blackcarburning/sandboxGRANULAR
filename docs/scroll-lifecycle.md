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
