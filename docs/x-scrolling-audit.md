# Playback / scrolling audit — 2026-10-25

Build: `v2026.10.25.SCROLL-AUDIO.1` (live `/mygrain/`).

## Confirmed defects and fixes

1. `playOscillatorNote` called `ensureSynthVoicePathAudible` before checking whether a backing OSC note could play. Its full `syncPerformanceControlState` refreshed every loop card on every note attempt, even when muted. Check audibility first, then refresh audio gains without global UI sync. Settings/transport actions retain their normal UI synchronisation. Q's explicitly supplied independent destination remains supported with the backing OSC layer disabled.
2. L's shared 8 ms rhythm-clock callback always refreshed the whole editor, normalising all 64 steps on repeated cell reads. Normalise only the requested cell; queue a lightweight RAF playhead paint only after an actual step advances, matching X's existing policy.
3. L's sample keybed blocked vertical touch panning. Both L and X now allow pan-y/pinch-zoom and do not prevent the touch pointer's default panning. Existing pointercancel/lostcapture/touchcancel release logic prevents stuck keys. Mouse and keyboard behaviour is preserved.

No audio envelope/filter/EQ/pitch settings, sample data, persistence keys, import/export formats or log schemas changed. X Trace 2 remains opt-in with its existing 15-minute history.

## Before / after, native browser tests

Disposable Playwright contexts, mocked identity/API reads, all server writes and off-origin requests blocked. Baseline main HTML is the exact pre-edit backup, not an old Git revision.

- Both Chromium and Linux WebKit: eight muted backing notes previously caused 8 full GUI syncs / 9,004 mutations with zero voices; now 0 syncs / 0 mutations / zero voices.
- Audible OSC and independent Q still create eight native voices each; no full GUI syncs. Visible voice indicators may still update for audible OSC.
- L's 125 idle scheduler calls: 272,000 normalisations / 9,125 mutations before; zero / zero after. X remains zero / zero.
- Real X and L sample playback alongside the actual backing sequencer, repeated desktop wheel scrolling: scroll position preserved; 0 global GUI syncs after setup; one current playhead cell; no late scheduled voices in either engine.
- Native Chromium touch drags across L/X keybeds scroll and release held keys. Desktop wheel and computed touch policy checked in WebKit. Native touch-drag injection is not available for this Linux WebKit harness.
- X sample endings, pitched playback, slides and previews pass 40 native offline-audio cases across 44.1 / 48 kHz and both engines.
- Q OSC/Grain/Sample audition, switching and cleanup pass in both engines.
- A/B/C/V/W/P/O/M/M+ all start their native loop sources, preserve those source identities during backing-sequencer activity and cause no per-note global UI refresh in either engine.

## Other-card code audit

- Drums: already separate step visual callbacks; no full editor redraw on idle shared-clock ticks.
- A/B/C/V/W/P/O/M/M+: native looping buffer sources, not 8 ms editor renderers. They were victims of the shared OSC-triggered refresh, removed above.
- Q: independent 25 ms scheduler and its own playhead; independent OSC routing is covered above. Explicit live-recording cursor reveal is intentional and not changed.
- K: source/track-host sync is not invoked by the 8 ms shared rhythm clock; no equivalent L idle-render pattern found. K was code-audited, not exhaustively retested here.

## Evidence / rollback

Exact backup: workspace `output/mygrain-scroll-fix-20261025/before-20261025T131412Z/`.
Evidence in the parent directory: baseline/fixed-card-repaint.json, active-loop-scroll.json, other-loop-playback.json, fixed-step-keyboard-scroll.json, x-sample-edges.json, q-sources/, live-verification.json and index-changes.patch.

57 inline scripts parse successfully; changed external script parses; git diff whitespace check passes. Public HTML, load notes and diagnostics return HTTP 200 with exact deployed bytes.

## Unresolved physical-device boundary

These tests verify the repaint/scrolling fixes, not that the reported periodic click has disappeared on the physical MacBook's Safari/audio device. Chrome/Windows/phone did not exhibit that report. The submitted Safari trace shows excessive shared GUI refreshes but does not prove the click's cause. Do not describe a clean Linux WebKit run as a physical Safari reproduction or a confirmed cure. Retain X Trace 2 for a recurrence.

## Follow-up observation

Mark reports the same Safari click when X uses OSC3 as its sound source, not only samples. Therefore sample decoding/trimming cannot be the sole explanation. `scheduleBastardLoopXSingleVoice` branches to `playBastardLoopXSynthVoice` before creating any sample source/filter/delay nodes. The synth branch calls `playOscillatorNote` with role `bastardloopx`; it is not the same sample-specific FX graph. Common transport/global processing and Safari/device behaviour remain investigation candidates, not established causes. No additional envelope/filter changes were made based solely on this observation.

The parameterised `tests/active-loop-scroll-browser.cjs` was run with `MYGRAIN_LOOP_SOURCE=synth`: X and L create real native OSC voices while wheel scrolling; both engines preserve scroll position, report zero full-card refreshes and no late note scheduling in this fixture. This checks scheduling/DOM behaviour, not physical MacBook output or the absence of audible clicks. Evidence: `output/mygrain-global-fx-20261025/active-loop-scroll-synth.json`.
