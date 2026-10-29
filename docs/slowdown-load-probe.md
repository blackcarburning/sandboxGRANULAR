# LOAD-PROBE.1 — 29 October 2026

The submitted IDLE-SLEEP.1 log captured a running audio clock at 0.883 audio seconds per wall second. The main-thread probe had no delays over 120 ms (maximum 52 ms). At onset the meter clocks were off; known live PCM stayed at 32,993,904 bytes, with 8,026,304 additional retained Undo bytes. No context suspension occurred in this run. This does not establish native DSP CPU, thermal throttling, total memory or underruns.

This build adds diagnostics, not an audible-engine fix: bounded historical idle ownership, low-power state, actual loop-FX graph/source/node counts and enabled branches, impulse frame counts, final effect routing/shaper settings, and cumulative modulation callback calls/cost. Two monotonic clock reads per running callback; no extra timers, audio nodes, PCM copies or changes to scheduling/settings. Native DSP CPU remains unavailable. App graph counts must not be described as proof all nodes are processing.

Preserves eight-second owned idle sleep and playing while locked. No render compatibility bump or source/freeze invalidation: sound and server rendering algorithms unchanged. Verify actual iPhone outcome separately; next submitted log can correlate these counters with the clock slowdown.
