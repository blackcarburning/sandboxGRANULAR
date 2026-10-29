# X module investigation / tracing — 2026-10-25

Trace format: **X-TRACE.2**. Current app: **v2026.10.25.X-ENVELOPE-RESTORE.1**. Original sample envelopes are restored; tracing remains available. No account, patch, Song, audio-buffer or export schema changes.

## Capture on the affected Mac/iPhone

1. Reload and confirm the build badge above.
2. On the X card or inside its sequencer, click **X Trace: Off** to turn it On.
3. Reproduce the clicking using the usual sample/pattern. Exercise suspect sliders, sample selection, keybed and scrolling normally.
4. Click **Mark X Click** when the click occurs (the global **Mark Crackle** button also marks X). Wait roughly three seconds, then **Submit Log**. Playback is not stopped or restarted by either marking action.
5. Turn X Trace off when finished. It automatically stops after fifteen minutes. The completed trace remains in the current diagnostic export until cleared, a new trace starts, or the page reloads; existing saved diagnostic checkpoints use the existing recovery workflow.
6. If tracing itself changes the sound, capture a comparison with it off. No trace can prove a physical speaker fault from browser data alone.

## Coverage and ownership

`audio-diagnostics.js` exposes `MygrainXTrace.create`; the HTML constructs `window.mygrainXDebug` with X-specific read-only state/node providers. X function wrappers cover the current module, plus an explicitly labelled shared repository-codec wrapper. Call IDs and parent IDs correlate nested synchronous work; promise completion retains its initiating call ID without replacing the returned promise. Thrown errors retain message/stack and summarized arguments and are rethrown, never swallowed.

Captured areas:

- Real scheduler tick count/cost, scheduled indices/lookahead, voice start/pitch/region/envelope, filter values, callback time relative to planned end, early ends/context changes, cleanup-handler cost, voice/held-key counts.
- Sample source/load/decode/apply/restore metadata and errors, sample rate/channels/length, root, region, and small numeric start/end discontinuity measurements. No PCM arrays, response bodies or recorded microphone data.
- Source selection, transport, grid editing/rest/accent/slide/ratchet, transpose/copy/randomisation, synth switching, sample trim/length/attack/decay/tune, LFO and delay setup/updates, MIDI actions, GUI rendering costs.
- X-card, sequencer and V-mixer controls plus the shared sample browser when its target is X. Capturing passive listeners for pointer/key/touch/cancel/click/input/change/scroll; input and scroll throttled, movement/wheel counts aggregated. Applied values are recorded in a microtask after handlers run. No preventDefault, pointer capture or layout mutation in the diagnostic controller.
- RAF gaps, DOM mutation totals, timer lateness, audio-clock advance, foreground/background state and supported Long Task events.
- A 16384-frame analyser leaf on **X's pre-delay input after voice filters/EQ**. RMS/peak/adjacent-delta are sampled every 250 ms. It has **no audible return**, does not replace the existing mixer meter and cannot continuously detect every click. Synth mode uses the shared OSC3 graph, so this sample-bus probe is not labelled as synth output. Full module/OSC settings remain in the ordinary marked diagnostic state.

Default off: no controller timer, RAF loop, observers, GUI listeners or analyser taps. Function wrappers take the disabled fast path. Enabling starts a new bounded trace; disabling detaches all owned resources but retains data. Clear Log clears the X rings without touching playback. Node/context replacement is noticed by the sampling probe, which detaches old taps.

Retention: 600 events, 120 quarter-second samples, eight X marks with up to 48 prior events and 24 subsequent events within three seconds. Dropped-item count and limits are explicit. X rings live at `phoneDiagnostics.application.loopX.trace` in submitted JSON and Copy Debug text. Ordinary incident snapshots reference that current ring rather than recursively copying it. The saturated export regression remains well below the existing 4 MiB server/client limit.

## Confirmed defects corrected alongside tracing

The shared 8 ms rhythm callback was calling the complete X editor renderer even when no step advanced. Every cell read also normalized all 64 cells. In a 125-idle-tick controlled test this produced **272,000 normalizations and 9,125 DOM mutations** in both engines; the corrected path produces **zero of each**. Capacity checks remain when needed and requested cells still normalize on read. Actual advances queue one lightweight RAF playhead paint; explicit edits still refresh the editor.

The X sample keybed used `touch-action:none` and blocked touchstart, preventing native vertical scroll. Only X now permits `pan-y pinch-zoom`; existing pointer-cancel handling releases its held note. L behavior is unchanged. Native Chromium touch injection moved the scroller 152 px after the fix, versus no movement against the prior HTML. Desktop wheel scrolling works in Chromium and WebKit and survives playhead painting. WebKit's narrow touch-layout/style is verified, but actual native touch-drag injection is Chromium-only, not proof on a physical iPhone.

These are confirmed UI workload/scroll defects, **not proof that all physical Mac clicks are fixed**.

## Latest starting evidence

Submitted log `audio-20261025T120442Z-096cc3e817671371` is build X-CLICK.1. X used original SAMPLES_ALTBASS `Pulse Bass-49-64.aif`, C#3 root, 44100 Hz, region .0028798–1.0681179 s, attack/start-trim 0, length/decay 100%, Click Guard 12, lowpass-24 cutoff 50, envelope 14, LFO amount 0. X EQ included a 202 Hz +12.8 dB bell. No logged clock-stall counter establishes the reported regular click. Source assets/tuning were not changed.

Exploratory headless native captures of that source/config through the real 8 ms scheduler, editor open/closed, rendered non-silent output in both engines without the large transients seen in one pre-created-voice Chromium experiment. These are controlled captures, not physical Mac reproduction. One initial WebKit diagnostic exercise threw “Events are overlapping”; a staged rerun and isolated controlled tests passed. Do not claim a root cause from that intermittent exception; error stacks/arguments and nested IDs are now captured for recurrence. No extra envelope or filter changes were made speculatively.

## Verification

Read-only production-static fixtures mock account/API reads, abort writes/off-origin traffic and use disposable browser stores. Do not use real accounts or production audio/Song writes for these regressions.

- `node --test tests/x-trace.test.cjs tests/audio-diagnostics.test.js`: 27 tests; disabled resources, leaf-tap cleanup, bounds, fifteen-minute auto-expiry, clear, receiver/results/errors/promise identity and stale completion isolation.
- `node tests/x-trace-browser.cjs`: Chromium/WebKit native scheduled audio, sample decode success/failure, slider events, marks/pre/post windows, sampled X signal, wrapped scheduler, cleanup, stopped trace, JSON/text export and saturated report size.
- `node tests/x-editor-idle-browser.cjs`: 125 idle ticks, zero normalizations/DOM mutations, tracing off.
- `node tests/x-editor-scroll-browser.cjs`: keybed touch pan/cancel release in Chromium, narrow WebKit layout, desktop wheel and stable scroll during playhead paint in both.
- `node tests/x-sample-edges-browser.cjs`: 40 existing native sample-tail/pitch/slide/preview cases.
- `node tests/x-sample-onsets-browser.cjs`: 12 existing native 44.1/48 kHz onset/filter-route cases.
- Parse every inline script and changed external JS; `git diff --check`; verify HTTPS 200 and exact bytes for HTML/diagnostic module/release notes.

Internal task evidence/backups: `output/mygrain-x-periodic-20261025/` in the parent workspace. These logs/artifacts are not public downloads.


## Extended periodic-click capture — X-TRACE.2

For the regular Mac-only click, enable X Trace once, leave playback running for 2–3 minutes, mark at least five separate audible clicks, and submit. Trace auto-stops at 15 minutes, not 5. Switching it off preserves the capture; switching it on again starts a fresh session. Do not refresh or re-enable it before submission.

Long retention is separate from the recent raw rings:

- `history.columns` + `history.rows`: up to 900 compact one-second rows across the session. Counts include scheduled notes, ended/cleaned voices, full X UI syncs, LFO attaches/ensures/resets, delay updates and explicitly labelled shared save/UI/modulation calls. Rows also retain maximum timer/frame delays, mutation totals, voice counts, sampled X signal statistics, cleanup cost, slow calls/errors and the diagnostic probe's own cost. Empty/throttled seconds are not invented.
- `health`: up to 180 snapshots spaced at least five seconds apart. Includes effective LFO depth/rate, four representative voice gain/filter/depth/offset values, X EQ route/filter counts, overall EQ totals and an available output timestamp. EQ totals are shared-system context, not X-only counts.
- `clickTimeline`: up to 128 compact markers with wall/audio-clock intervals, nearby scheduled note starts/expected endings and last-call ages for selected repeating tasks. Mark timestamps include human reaction time and do not establish causality.
- Each wrapped function now includes first/last call time, min/max call spacing and one bounded initial caller stack, exposing who is repeatedly refreshing X. Shared hooks are explicitly named `(shared)` and preserve arguments, receiver, result/exception and promise identity.
- The signal probe still reads numeric statistics only and has no audible return. Its 16384-frame windows overlap at a normal 250 ms cadence at 44.1/48 kHz. Reports include mean/DC, count of samples at or above full scale and the approximate audio-clock position of the largest adjacent-sample delta. These are mixed analyser windows, not hardware measurements or exact/automatic audible-click detections. Long timer gaps can still leave coverage gaps.
- Manual-mark handler cost is recorded separately, so checkpoint/console overhead after a click marker is not mistaken for the original fault.

Outer diagnostic upload schema remains version 1; X's internal trace format is version 2. No account, audio, patch or Song schema changed. No synthesis, scheduling, envelopes, cutoff, LFO or playback-cleanup behavior changed in this extension.

Latest analysed submission: `audio-20261025T125323Z-610f1a7a747b4d4b`, Safari on Mac, Pulse Bass-52-64.aif, E3 root played C2, highpass-48 at 50 Hz, envelope 0, LFO amount 94 but effective depth 0 at that cutoff. One marked click; no captured X exception or clock stall. A 220 ms GUI frame gap followed the mark and is not evidence of its cause. The earlier capture used another sample and lowpass-24, so the fault is not confined to that filter mode.

An isolated 40-note/8-second native offline render of this sample/settings compared normal cleanup with callbacks disabled in Chromium/WebKit: maximum PCM difference about 2.4e-7 in both. This weakens an immediate-disconnect truncation theory for that controlled render, but neither reproduces nor excludes real-time Mac audio-graph/driver faults. Source conversion used the app's existing repository codec, not a modified sample. No production state or files were written by the fixture.

Verification artifacts/backups for the extension: `output/mygrain-x-long-trace-20261025/`. Tests include a simulated complete 15-minute session, raw-ring rollover, marker eviction/intervals, health retention, disable/clear cleanup and the actual report builder with saturated long histories. Browser fixtures are disposable and block production API writes/off-origin requests.
