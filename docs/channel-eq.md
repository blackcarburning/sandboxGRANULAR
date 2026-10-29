# Independent channel EQ — v2026.10.24.EQ.2

## Controls

Every loop card (including Q, Generated and Sample), all eight drum lanes
(including Roll), and K1–K5 have a **4-band EQ** popup and **EQ On** switch:
26 independent inserts. All are initially bypassed.

Drag numbered handles left/right for 20 Hz–20 kHz frequency and up/down for
±24 dB gain. Each band has its own On, shape and Q (0.1–18). Outer bands default
to low/high shelves; middle bands default to bells. Any band can be a bell,
low/high shelf, or low/high cut. Cut slopes are 12, 24, 36, 48, 72 and 96 dB/oct.
**96 dB is a cut slope, not shelf gain**; shelves have ±24 dB gain and resonant Q.
Cut shapes disable the inapplicable gain control; shelves/bells disable slope.
Arrow keys edit a handle; Shift+Up/Down edits Q. Wheel over a handle edits Q;
Shift makes wheel/frequency adjustments finer. Every band also has a logarithmic Q
slider across the full 0.1–18 range, with one undo step per drag. Numeric controls
remain available. Song EQ-only copy and mapped global paste are documented in
`song-eq-copy.md`.

The shaded spectrum is the selected channel's output at its EQ insert, **not**
the whole mix. It uses −100 to 0 dBFS, independent of the EQ response's ±24 dB
scale. L/R are analysed separately and the louder bin is shown, so anti-phase
stereo does not disappear. Close stops metering but leaves enabled EQ sounding.
Some existing downstream effects can further change the final output spectrum.

## DSP and lifecycle

`channel-eq.js` provides a shared codec, RBJ coefficient/response calculations
and lazy native Web Audio routing. Each destination/context gets one filter
chain per channel, shared across overlapping voices. Custom IIR shelves use
Q meaningfully (native Biquad shelf Q is ignored). Cuts are cascaded biquads
with Butterworth sections at default Q, up to eight sections / 16th order.
A 12 ms crossfade changes settings without restarting a source or its clock.

Settled bypass connects the original tail directly to its original destination:
**no EQ filters, EQ gains, analyser or recurring metering task**. Temporary
crossfade nodes are disconnected within 26 ms. The enabled, visible popup alone
allocates a stereo splitter/two FFT2048 analysers and a 15 Hz spectrum redraw.
Closing, bypassing, hiding, context suspension or account lock stops metering.
Source-ended and existing voice cleanup release route membership and filters.

`channel-eq-ui.js` is skipped in hidden Song render decks. It uses existing
Card History transactions: one drag is one undoable change; cancelled drags
restore their original settings. The global popup's anonymous form inputs are
excluded from generic patch control capture.

Routing is after each existing loop/drum/track chain, except OSC3 L/X where the
isolated insert precedes the existing synth drive/filter bus. Q and each K
track own their independent route. Roll has its own EQ despite sharing Snare's
source sample.

## Persistence / older versions

EQ metadata is additive, schema `version: 1`, keyed by all 26 channel IDs.
Browser state and Song snapshots use `state.modes.channelEq`; legacy preset
JSON uses `channelEq`. Every current ZIP capture includes all EQ settings.
Legacy presets/Song sources without this field normalize to all bypassed,
including when recalled after a patch with active EQ. Existing audio, schema
versions, tempo, pattern steps, asset paths and unrelated settings are retained.
Import validation rejects future EQ schemas and invalid band counts.

Server `backend/mygrain_channel_eq.py` matches the browser defaults. Existing
Song ZIPs are normalized in memory as they are prepared, not bulk rewritten.
No production Song, patch or source-audio migration is run by deployment.
Bypassed EQ metadata is excluded from audible-content fingerprints, allowing
unchanged older freezes to be reused. An active-EQ part requires `eqVersion:1`
and an EQ-aware upload (`channeleq=2`); corrected renders are marked
`channelEqVersion:2`. Active-EQ version-one freezes refresh once on Arm Cache;
legacy parts with bypassed/missing EQ retain their compatible saved renders.
The backend still accepts version-one uploads from older clients, but the current
client does not reuse them for active EQ.
Server preparation uses the same native app engine as the browser renderer.
Loop/K/drum-lane copy transfers only those channels' EQ; copying a legacy lane
resets that lane to bypass and preserves all unselected channels.

## Verification

Start the isolated server from a separate copy of both app and sibling host:

```
MYGRAIN_TEST_ROOT=/tmp/mygrain-channel-eq/test-store python3 tests/song-beta-test-server.py 18948
node --test tests/channel-eq.test.cjs
python3 -m unittest discover -s tests -p 'test_channel_eq.py'
node tests/channel-eq-browser.cjs
node tests/channel-eq-routing-browser.cjs
node tests/channel-eq-patch-browser.cjs
```

Browser fixtures refuse non-loopback origins, register disposable users, and
never use production credentials. Chromium and WebKit cover desktop/phone
popups, native offline PCM for all 26 channels, shelf Q/cut responses,
anti-phase stereo metering, clock preservation, undo/redo, full audio routing,
all five K tracks, noise/sample hats, L/X sample/OSC3, bypass cleanup, current
and old ZIP import, plus actual **server-rendered** EQ/legacy Song recall.
No physical iPhone test was performed. Additional existing Song backend suites
and focused JS suites are run before deployment. Known stale mocks in the
broader restore/extra-lanes/Roll/reverb-send tests fail identically on the pre-EQ rollback;
they are not counted as passing checks for this release.

## Exact rollback

Pre-change snapshot:
`/root/.openclaw/rollback/mygrain-channel-eq-20261024T080146Z/`

Includes exact app files and original dirty Git state, complete host/account
store with consistent SQLite backup, all MYGRAIN songs, patches and audio
libraries/source mirrors. Historical backup directories were left in place,
not duplicated. A changing `.edit-lock.json` is a transient editing lease,
not a song source; it must not be restored over a current editor's lease.

`DEPLOYMENT.json` records only this release's changed paths, original hashes and
deployed hashes. `rollback.py` previews by default; `python3 rollback.py --apply`
restores these code paths and restarts `fs7300-documenter.service`. It refuses
later-changed files, keeps a recoverable copy of the deployed build, and moves
new release files aside. It does **not** overwrite newer songs, databases or
user audio. Full data snapshots are available for deliberate recovery, not an
automatic destructive store reset. No Caddy/OpenClaw restart is required.

## X/L sequence automation — 2026-10-27

X and L have independent **R**, **W** and **Delete automation** controls on
both their cards and EQ popups. W arms a replacement take at the next sequence
start (or start the stopped sequence). It records all four bands for exactly one
sequence cycle, then disarms W and enables R. Clicking W again cancels the take;
stopping early or changing sequence length cancels it without deleting the old
automation. Delete removes only that channel's automation, retaining the EQ.

Captures run at a nominal 100 Hz, independently of musical step subdivision.
R reads interpolated sequence-phase positions: logarithmic frequency/Q, linear
dB, with per-sample coefficient glides in a stateful stereo AudioWorklet. The existing native crossfade remains a fallback if AudioWorklet is unavailable. Timing follows
the lane's own step duration/pattern length and audio context, not wall time.
The open popup redraws the moving band handles on its animation clock; closing
it does not stop playback. Manual handle/Q drags temporarily override R until
release. No automation timer runs when neither lane has R data or W armed.

Optional `channelEq.channels.X/L.automation` metadata is additive version 1:
`{version:1,read,steps,points:[{phase,enabled,bands}]}`. Points span 0–1; R repeats
across the current sequence length, so tempo/length changes stretch the curve.
W is transient and is never exported. Browser state, preset JSON and Song/patch
ZIP snapshots retain completed takes through the shared EQ codec; Python uses
the identical bounds and format. Old patches default to no automation. Read
playback uses a transient runtime EQ override: export retains the manual EQ
settings and the recorded curve, not a randomly sampled playback position.

Verification: `node --test tests/eq-automation.test.cjs` and
`node tests/eq-automation-browser.cjs`. The browser fixture uses only mocked API
responses, disposable browser state, and loopback static GETs—no production
song, account, sample or patch writes. Existing channel-EQ JS/Python suites
still have a stale assertion of 26 channels (the pre-change build has 27).

Stored curves are reduced with at most 0.1% frequency/Q and 0.01 dB gain error;
discrete shape/on/slope transitions are retained. This removes redundant held
points without reducing playback resolution or quantising to sequence steps.

Background playback also receives the existing 20 ms AudioWorklet clock pulses,
so EQ reading does not depend on throttled background UI timers.

`eq-automation-worklet.js` keeps biquad delay states alive while RBJ coefficients
interpolate every sample over 20 ms; it does not rebuild a filter per data point.
Bells, resonant shelves and all cut slopes retain the shared RBJ response.
It loads for every enabled channel, including manual handle movements, so continuous edits do not rebuild native IIR graphs. Bypassing an already prepared channel glides to identity in the same processor. Unused/bypassed channels do not load a processor.
`tests/eq-automation-worklet.test.cjs` checks response agreement, stereo polarity
and adjacent-sample continuity through a rapid frequency sweep.

## EQ crackle correction (2026-10-27)

The persistent processor now uses direct-form I signal histories rather than
transposed direct-form II coefficient-dependent delay states. With time-varying
coefficients, the old form generated transients even on DC through a bell with
unity DC gain. The regression alternates +/-24 dB at 30 Hz: old peak error
0.3717, corrected error below 1e-6. Frequency/Q/gain automation retains its full
resolution and 20 ms per-sample glides; stored patch/automation formats do not
change. Async module readiness is checked again after awaiting to avoid duplicate
processor transitions. Native IIR crossfades remain the unsupported-worklet fallback.

`node tests/eq-live-sweep-browser.cjs` checks manual sweeps on A/X/L in Chromium
and WebKit, zero graph transitions after preparation, bypass/re-enable and cleanup.
This is a deterministic PCM/routing check, not a physical phone listening test.
