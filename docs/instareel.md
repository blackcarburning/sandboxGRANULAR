# G · INSTAREEL

G-only controls create a flattened 30–60s WAV from a portable snapshot of the
current editor. No additional AI request is made. The editor is never recalled,
randomized, stopped or replaced. Targets round to complete source cycles within
30–60s (the actual duration is shown while queued and when ready).

- `genreator.js`/`.css`: duration, Subtle/Moderate/Extreme, Make/Try Another, cancellation,
  buffered preview with Loop checkbox, naming/save and INSTAREEL WAV Browser.
- `backend/mygrain_instareel.py`: authenticated/account-pinned bounded jobs and
  private library. `deploy/instareel-server-hook.patch` adds only the dedicated
  route/module hook to the existing documenter server, before account locks.
- `scripts/instareel-worker.cjs`: fresh loopback Chromium, existing
  `mygrainSongBetaAdapter` snapshot validation/decoding and `MygrainSongClock`
  isolated render deck. The worker cannot make any HTTP write. No existing Song
  source, saved part, render version or compatibility policy changes.
- `scripts/instareel-plan.cjs` and `scripts/instareel-arrangement.cjs`: seeded source-cycle/bar-aligned development.
  Active layer levels and master-filter brightness recede and return on bar-aligned
  sections, including when only one or two source cycles fit. A bounded selection
  of loaded-but-disabled sample layers can enter (one quiet layer in Subtle, up to
  two in Moderate), using normal enable/wake setters in the disposable deck; missing
  sources are never enabled. All additions leave again for the original boundary. A loaded,
  enabled hat lane can gain occasional offbeats. No new samples, key or
  tempo are introduced.
- Warm one source cycle before capture, return to the original groove for the
  final bar-aligned section, and blend the actual continuation into the first 50ms. Retains
  exact duration and audio at the join rather than fading to silence. Peak-only
  attenuation prevents output clipping; silence is reported, not saved as success.

All rendering shares the existing serialized server-render executor. At most
three reels are pending globally and one per account. Snapshot upload <=96MiB;
phone source-encoding preflight <=48MiB; server admission <=512MiB, decoded-source
cache <=192MiB; output <=24MiB. These are feature-local limits, not increases to
existing app/Song budgets. Browser retains only one decoded preview <=64MiB,
using the existing fast-preview AAC encoding and shared AudioContext; it registers
with the existing `wavIphonePreviewActive` guard so idle sleep cannot cut it off.
Loop uses AudioBufferSourceNode.loop with explicit original duration. The existing
WAV Browser and its iPhone playback code are unchanged.

Temporary sources and renders live in account WAV root `/.instareel/job-<id>`;
source ZIPs are removed after worker completion/cancellation. Unsaved scratch
expires after one hour and is cleaned on later requests. Save exclusively creates
`INSTAREEL-<name>-<id>.<bpm>.wav` inside account-private `.instareel/saved/`
and adds only the dedicated G library entry; the normal WAV browser excludes it. Repeated Save is idempotent.
Original WAV downloads stay lossless PCM; only the listening copy is AAC.
Private routes enforce existing session and account-header checks, never expose
filesystem paths, reject changed/missing originals and use private/no-store.

## Checks / rollback

Use `tests/song-beta-test-server.py` with a dedicated `/tmp` test root and
`MYGRAIN_TEST_ADMIN_PASSWORD=instareel-fixture` on port 18936.
`tests/instareel-browser.cjs` tests real server renders, untouched editor, PCM,
loop wrap/toggle, save/library, account rejection and phone portrait/landscape in
Chromium/WebKit. `INSTAREEL_ENGINE`, `INSTAREEL_SECONDS`, `INSTAREEL_VARIATION`
and `INSTAREEL_HATS` select a focused extra run. `tests/instareel-cancel-browser.cjs`
checks saved playback past eight seconds and actual job cancellation.
Unit tests: `tests/instareel-plan.test.cjs`, `tests/test_instareel.py`.

Before-edit files and measured evidence: workspace
`output/mygrain-instareel-20261030/`. To roll back, restore only the G assets/index
script versions and remove the exact server hook, then restart documenter. Do
not remove saved WAVs, account state or unrelated current server changes.

## Variation repair · 2

G reads Target seconds and Variation on every Make/Try Another click. The old
preview is hidden and stopped during replacement so it cannot be mistaken for
the new result. Both requested seconds and actual variation are displayed.
Regression coverage retries 30s/Subtle as 60s/Moderate on the same page and checks
the server plan, output duration and untouched live disabled layer settings.
The existing preview/loop transport and all Song audio compatibility remain unchanged.

## Optional note and drum development · 3

G adds two unchecked-by-default options: X/L root-note variations and Drum
variations + Roll fills. Every Make/Try Another request reads both checkboxes,
duration and strength again; the authenticated server validates and records them
in the canonical plan. Controls are excluded from patch/history serialization.

With Notes selected, only used/playable X/L lanes with an existing sequence are
developed: one cell per Subtle section or two per Moderate section. Notes stay
around each lane's existing root/fifth/octave, retain the root setting, and reset
to the original sequence before the loop join. No scale's major/minor third is
assumed, no samples are replaced, and no unused empty lead sequence is invented.

With Drums selected, existing hats/backbeat accents develop while kick/snare
placements stay intact. Short quiet Snare Roll fills occur at phrase boundaries
(roughly eight bars Subtle / four bars Moderate), not every bar. They require
enabled drums, a loaded Snare and an audible Roll lane; lane solos are respected.
The full independent Roll timeline is compiled before start, because the existing
Song-deck scheduler queues Roll two seconds ahead. The timeline stays within its
existing 1024-step limit, preserves original Roll notes/dips/ratchets, and contains
no added fills at the opening or closing section. No shared scheduler/DSP changes,
Song compatibility invalidation, new Jump controls or preview transport changes.

`INSTAREEL_MUSICAL_TEST=1 INSTAREEL_RETRY_TEST=1` extends the real browser test
with used X/L samples and drums: first render both options on, then rerender the
same page with both off at a different duration/strength; compare source/settings
identities and the actual server plan. Unit tests cover off-state preservation,
root-related sparse note changes, boundary restoration and precompiled Roll hits.

`tests/instareel-musical-evidence.py` measures both X/L fifth-note energy and
Roll fill transients in paired on/off WAVs, plus independent wrap-step checks.

## Evolving development and saved preview · 4

Notes and drum detail now carry forward from the previous section rather than
starting from the source each time. The changed-note footprint is capped at a
quarter of the sequence in Subtle (three eighths in Moderate); subsequent changes
develop those cells around the original root rather than drifting in register.
Hats gain at most two/four offbeats and then evolve their accents. Short Roll
fills grow from one to two Subtle hits (two to three Moderate hits). The final
section restores the source groove.

With Drum variations selected, one playable hat step occasionally gains a
double ratchet (triple in Moderate), then loses the added ratchet in the next
section. These bursts recur every third developed section, respect Hat audibility,
preserve manual ratchets, and stop early enough for the existing two-second
drum scheduling horizon before the closing section. No shared scheduler changes.

Saved INSTAREEL Browser Preview now selects **and starts** the existing G preview
from the same trusted tap; previously it only selected the file and focused Play.
The buffered player, loop behavior and main WAV Browser/iPhone code are unchanged.
`INSTAREEL_RATCHET_TEST=1` adds a distinctive 5kHz hat to the musical browser
fixture. Both browser engines assert audible one-tap saved preview; the
cancellation fixture also checks it past the idle threshold.

`tests/instareel-ratchet-evidence.py EVIDENCE_DIR [ON_WAV ...]` detects
actual 62.5ms double-hit spacings in the 5kHz hat fixture: recurring burst sections,
intervening withdrawal, untouched opening/closing and no doubles with Drums off.
`instareel-musical-evidence.py EVIDENCE_DIR [ON_WAV]` supports a selected on-render
paired against the same-page Chromium options-off retry.

## Saved library management · 5

Each saved G-browser row now has Rename, Delete and Upload to FTP alongside
Preview/Download. Rename changes both its display name and WAV filename, retains
its ID, PCM hash and AAC preview.
Creation is exclusive: no other WAV can be overwritten. Delete requires a visible
confirmation, stops a selected reel's G player and removes it from the G browser;
WAV/preview/metadata recovery copies remain beneath the account-private
`.instareel/trash/` directory. Uploaded FTP copies are independent and never
removed by this action. Account locks protect library operations, and metadata
write failures roll the source file back.

FTP uses the existing private folder picker (including folder creation) and
existing authenticated `/api/ftp/upload` endpoint; it asks for a destination
before downloading the lossless saved WAV. Transfers retain exact WAV bytes,
are capped at the existing 24MiB reel size, reject overwrites normally and abort
on account lock/change. No FTP credentials, shared storage, audio engine or main
WAV-player changes. There are no extra Jump buttons.

`tests/instareel-library-browser.cjs` follows a real `instareel-browser.cjs` fixture
in the same isolated test server. Both Chromium and WebKit test rename, one-tap
preview, folder-picker cancellation, exact-byte FTP upload, conflict recovery,
delete cancellation/confirmation, retained FTP copy, rejected cross-account
writes, untouched live patch and portrait/landscape controls. Python tests also
verify recovery copies, collisions, invalid names and metadata-write rollback.

## N, re-cuts, Extreme and private storage · 6

N participates in development even when originally disabled: quiet filtered pink
noise enters and leaves in interior sections, with original settings restored at
the boundary. Existing enabled N retains its source and filter character. Solos
remain authoritative. Native L/X synth sources and loaded K multitracks qualify
as dormant layers without requiring a selected sample-buffer alias.

Audible V/W use their existing crossfaded cut setters, never source replacement:
Subtle alternates sparse gaps with 75% region repeats, Moderate uses half-region
repeats, Extreme quarter-region repeats. Original cut settings return for closure.
Optional X/L notes remain bounded to root/fifth/octave. Extreme permits three
changed cells per section, up to half a sequence, stronger layer development and
denser but still sparse drum detail. Every retry rereads all current controls.

Saved WAVs now live only in `.instareel/saved/`, outside the normal root-only WAV
listing. On authenticated library load, legacy library records migrate only when
their audio hash matches; unrelated or replaced WAVs are untouched. Migration
preserves exact audio bytes and IDs. Rename/delete, AAC preview, lossless download
and existing private FTP upload use the dedicated library endpoints. No normal
WAV-browser, shared playback, DSP or Song compatibility code changes.

`INSTAREEL_EVOLUTION_TEST=1 INSTAREEL_MUSICAL_TEST=1` supplies distinct
four-note V/W sources and initially disabled N with intentionally inaudible
settings. Paired Chromium Subtle, WebKit Extreme and same-page 60s Extreme
notes/drums-off retry WAVs are measured by
`tests/instareel-evolution-evidence.py EVIDENCE_DIR`: broadband N entry/withdrawal,
actual W note-order changes, protected unselected V, L/X transposed-note energy and independent seams.
The library browser test also verifies normal `/mygrain-wavs/api/list` exclusion.

## Recurring signature and fresh lane repeats · 7

G adds an unchecked **Re-cut V · original phrase every other repeat** option,
read on every Make/Try Another and validated in the canonical server plan.
Off leaves V's original cut untouched. On alternates fresh cuts with exact
original cut settings, preserving the signature phrase throughout the reel.
A/B/C/W receive a fresh bounded cut every audible repeat without intermediate
original resets. All lanes restore for the final closure, retaining loopability.

Dedicated disposable-deck callbacks follow each lane's original native cycle,
including warm-up phase, rather than the independent arrangement section size.
No source replacement, duration/tempo change or global randomise/power toggle is
used. Each new cut derives from the immutable original region and retained gaps;
a seeded generator and duplicate guard prevent repeating the previous developed
cut. Subtle uses 75–87.5%, Moderate 50–75%, Extreme 25–50% regions, using existing
normal crossfaded setters. Sub-120ms imports group native cycles to cap callbacks
at 512 per lane over a reel. Solos and current audibility remain authoritative.

`INSTAREEL_RECUT_TEST=1 INSTAREEL_RETRY_TEST=1` supplies distinct four-note sources
for all five lanes: 30s V-on then 60s V-off in the same page. Both browser engines
verify original live source identities/settings, preview/loop controls, save and
phone layouts. `tests/instareel-signature-evidence.py EVIDENCE_DIR` measures the
actual source-tone profiles for every repeat, V original returns, fresh successive
cuts, V-off equality and independent wrap continuity. Shared Song/DSP/playback
and the normal WAV library are unchanged.

## Noise tone and filter motion · 8

N now uses seeded occasional entry/withdrawal rather than a fixed third-section
pattern, whether initially enabled or disabled. Every entry changes filter EQ
(cutoff, pass type and resonance), at a quiet 3–7% level, four poles and a tight
35–85ms decay, zero sustain. Its filter envelope is driven by drums or an
amplitude-only sum of current mix taps (continuous follower with 35ms release), explicitly excluding N to prevent
feedback. The mix copies exist only in the disposable reel deck, follow newly
created voices, and disconnect on withdrawal/capture. No shared noise DSP changes.

Occasional master low-pass movements use four poles and a slow sine LFO
(4/8/16 beats); X/L filter envelope amounts vary independently of optional pitch
changes. All original parameters return for closure. Every successive developed
A/B/C/V/W cut now changes width as well as its seeded position; V retains its
optional alternating-original signature behavior. Worker-owned timers stop with
the deck. Song rendering, saved source compatibility and live playback are
unchanged: all changes are inside the dedicated server INSTAREEL arrangement.

## Explicit current-patch action · 9

**New reel with current patch** sits directly below Make Reel / Try Another.
Both buttons share the existing fresh live snapshot and bounded render path;
no previous reel snapshot is reused. Duration/variation/options are reread, and
both buttons obey the same busy/history/account guards. The focused
`tests/instareel-current-patch-browser.cjs` inspects actual portable submission
ZIPs before and after a BPM change, checks the live patch stays unchanged, and
checks the button placement in Chromium/WebKit portrait and landscape.

## Conventional Roll fills · 10

When Drum variations is checked, phrase endings now receive a four-sixteenth
Roll-lane fill: two straight steps followed by two ratcheted steps (doubles in
Subtle, triples in Moderate, quadruples in Extreme). The usual 8/4/2-bar spacing
is shortened only when needed to fit an interior fill in a short/slower reel.
Opening/closing sections, lane audibility, loaded-Snare requirements and existing
manual Roll events remain protected. Shallow original Dip no longer suppresses
new ratchets; a 100% Dip does not silence newly generated notes. All changes
remain inside the server reel deck using the shared Song engine; saved Song
compatibility and live editor sequences/DSP are unchanged. New canonical plans
are version 7; existing WAVs remain intact.
