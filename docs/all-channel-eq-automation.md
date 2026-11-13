# All existing channel EQ automation (2026-11-03)

The existing one-pass R/W/Delete system now covers the 28 `MygrainChannelEq.KEYS`: A/B/C/D/V/W/P/O/L/X/Q/M/M+, generated/sample, K1–K5, and the eight drum lanes. No EQ or audio route was added to cards without EQ.

- W waits for the next sequence boundary, captures one pass, simplifies curves and enables R. Stopping early or changing sequence length cancels the take and retains previous automation. Touch overrides, delete and existing manual EQ behavior remain unchanged.
- X/L keep their own sequence clocks. Q uses its own playback length/rate/origin while playing independently. Other lanes use shared pattern audio time. No wall-clock musical phase or new per-lane scheduler is used.
- One shared scheduler maintains an active-key set (Write armed or Read with points). Inactive lanes do no clock/interpolation work, and disabling the last reader removes the timer immediately. Unchanged effective values skip coefficient messages; DSP modules are shared by context, existing worklets retain filter history, and unconnected channels create no processing or analyser nodes.
- Existing version-1 automation/saved EQ JSON is unchanged. Newly audible automation outside X/L is described by part `eqVersion:3` and requires `channelEqVersion:3` in the render. Static EQ/X/L still accept existing corrected version-2 freezes; bypassed/no-read legacy parts remain unaffected. Source archives and arrangement revisions are never rewritten for cache refresh.
- The isolated Song deck preloads the context-wide EQ worklet once before capture. It uses the same automation engine and clocks as the editor.

Verification:
- `tests/eq-automation.test.cjs`: all keys, one-pass recording, interpolation/reduction, transient read, cancellation, restore, JSON preservation, active-key work bounds and single timer/zero idle timers. `EQ_AUTOMATION_BASELINE` accepts the old backed-up module to demonstrate failures for missing lanes and idle work.
- Existing channel EQ and persistent-worklet response/sweep tests remain unchanged.
- `tests/all-eq-automation-browser.cjs`: authenticated isolated Chromium/WebKit, all 28 card controls, representative popup controls, simultaneous real-clock takes, saved points, R/Delete, no DSP for unconnected lanes, and narrow/portrait/landscape/desktop width checks.
- `tests/test_eq_automation.py` and `test_channel_eq.py`: all-channel backend roundtrip and selective render-capability enforcement.
- `tests/all-eq-automation-song-browser.cjs`: actual isolated server jobs for A automation whose static EQ is bypassed versus a pre-EQ archive. Measured attenuation proves the new lane reader affects exported PCM. Warm cache, original ZIP hashes/revisions, phone-sized playback/audition, and legacy cache acceptance are checked in Chromium/WebKit. No physical iPhone profiling is claimed.

## Explicit EQ Off takes priority (EQ-AUTO.2)

The popup and card EQ On switches now set an optional `manualBypass:true` channel field when explicitly switched off, and clear it when switched on. This pauses Read without deleting its curve or clearing R. Recorded on/off points cannot defeat explicit bypass. Existing saved curves with a historically disabled base EQ but no explicit bypass marker retain their original playback behavior.

The scheduler excludes bypassed readers, the EQ runtime refuses their transient automation writes, and the existing short output crossfade then releases the persistent processor and spectrum analysers. EQ On resumes at current sequence phase. Write can still capture an off/on gesture without losing the take; its resulting curve does not cancel explicit bypass.

Browser/backend codecs preserve the optional flag without changing legacy defaults. Backend audible/content/render checks exclude explicitly bypassed channels, so saved Songs render dry and can reuse otherwise identical bypassed legacy audio. An explicit bypass survives patch save/reload and Song archive restore.

Verification: `eq-read-bypass-browser.cjs` measures actual live post-EQ PCM in Chromium/WebKit, checks Off with R retained, processor/analyser cleanup, On/resume, preserved points and reload. `eq-read-bypass-song-browser.cjs` compares real server WAVs for active Read, explicit Off with R, and a legacy no-EQ archive, including warm cache and phone playback. Unit/backend tests exercise all 28 channels. Optional `EQ_CHANNEL_BASELINE` plus `EQ_AUTOMATION_BASELINE` loads backed-up modules to demonstrate the original failed Off assertion.

## Drum Write count-in — 2026-11-03

All eight drum EQs (Kick, Snare, Hat, Perc, Clap, Cymbals, Etc and Roll) now skip
the first eligible start boundary after W is armed. That loop is a count-in;
the following boundary starts the normal one-pass recording, then switches to R.
When armed while stopped, the first sequence after transport start is the
count-in. When armed mid-loop, the next full loop counts in. Status and Write
tooltips state this timing. Other EQ channels retain their existing timing.

Stopping during the count-in rearms a fresh count-in on restart. W cancellation,
Delete and patch restore discard the pending arm without replacing an earlier
curve. The count-in is transient, not exported or restored from patches.

No saved format, curve playback, interpolation, audio clock, DSP or Song render
compatibility changed. Server render decks never arm Write, so existing current
and legacy readers/PCM and caches are unchanged; no render-version bump or
server migration applies. Backend codec regressions remain the compatibility
check for this Write-only editor change.

Verification: focused runtime regressions cover all channels, stopped and
mid-loop arming, full-loop completion, existing-curve preservation, cancellation,
stop/restart and restore. The all-channel Chromium/WebKit short-pattern test
allows non-drum writers to finish before drum recording starts.
Before-edit backup: parent workspace
`output/mygrain-drum-eq-count-in-20261103T145318Z/`.
