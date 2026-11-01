# Additional sample repositories — 2026-11-01

A, B, C and W each have a Sample folder selector: their historical folder or
`SAMPLES_LOOPS`. Defaults are unchanged. Direct Generate, Mega and AI/GENREator
bindings use the selected folder; global randomisation never changes it.
W Re-cut uses the loaded audio's source identity, not the next-build selector.
A/B/C Re-cut continues to operate on their loaded buffer.

The PERC browser includes `SAMPLES_PERC`; its random sample loader honours the
selected browser folder. ETC's browser offers Crash and Perc, retaining Crash
as the default. ETC remains manual-only and is excluded from random loaders.
Loaded sample metadata and the ETC browser preference persist independently.

The choices are additive in presets and Song state. Missing preferences restore
historical defaults. Existing source keys, formats, archive audio slots, playback
and DSP are unchanged. The server renderer uses these same controls and embedded
PCM through the existing Song restore deck; no render-version invalidation is
necessary for a source-selection-only change. Source files are neither trimmed
nor converted by synchronisation.

Shared-host integration and scheduled mirror additions are captured in
`backend/sample-repositories-host.patch`. Apply only missing hunks on a new host,
then restart fs7300-documenter. The hourly mirror job now includes SAMPLES_PERC,
SAMPLES_TOMS and SAMPLEDROP_RICH with additive copy operations. TOMS/RICH are
mirrored only; no new card options were requested for those libraries.

Verification:

- `python3 -m unittest discover -s tests -p test_drum_sources.py`
- Isolated test server with MYGRAIN_TEST_ADMIN_PASSWORD=isolated-sample-repositories
  and MYGRAIN_TEST_ROOT beneath /tmp; seed short WAVs under its
  admin/source_mirrors/{SAMPLEDROP,SAMPLES_LOOPS,SAMPLES_PERC,SAMPLES_CRASH}.
- `MYGRAIN_TEST_URL=http://127.0.0.1:18982/mygrain/ node tests/sample-repositories-browser.cjs`

The browser regression uses real localhost source-list/sample/generation APIs,
non-silent decoded PCM, Chromium/WebKit phone emulation, preset/old-default
recall, W recut identity, ETC's manual-only protection, real current/old-format
Song archives and server render jobs, warm reuse and phone playback. It never
writes to production accounts, Songs or sample libraries.
