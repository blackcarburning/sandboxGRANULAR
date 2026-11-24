# Dfeeder: server-generated loop review

Dfeeder is an authenticated shared candidate library, separate from the working
patch, general WAV repository and Loop Store. The bottom card and final Jump
entry use the pyramid/hopper icon. Blank BPM means a fresh integer 68–178 for
each run; an override uses that BPM throughout. The card requests 10; the server
accepts 1–100 per batch and the CLI chunks any positive count into batches.

## Generation contract

- Use Drums plus a random 2–6 of A, B, C, D, W and Dropbox. No Osc, granular
  keyboard/Grains, generated Sample/Loop, N, V/P/O/L/X/Q/M/M+/K or held keys.
- Generate actual source audio through the existing stateless sample endpoints.
  A/B/C/W retain their assigned repository defaults; D uses SAMPLES_LOOPS.
  Generated sample cuts are only 2 or 1 bars. Drums retain 80% lane /40% cymbals.
- Choose 1–3 of the eleven reorderable effects, with only permitted inputs.
  Master Baker stays Off. Use canonical recipe setters and await preparation.
- Each candidate uses a fresh disposable authenticated browser context. Network
  writes are restricted to the two stateless source endpoints: no user patch,
  Song, account, upload or AI writes. Account/device Low Power is untouched in
  the user's profile; the worker is full quality and asserts divisor 1.
- Render with `renderLiveOutputBarsBuffer`: four bars/64 steps, one discarded
  warmup cycle and exact sample-grid cut. Force only loop and drum transport,
  never keyboard/granular sequencing. Use the existing stereo-linked 0 dBFS
  peak normaliser and canonical PCM24 writer. No LUFS target, second pass,
  trimming, added tail, new fade or resampling.
- Independently validate actual stereo PCM24, exact frames, non-silence, peak
  and SHA-256 before publication. Source powers are inspected immediately
  before capture. Save provenance/recipes and actual PCM metrics in metadata.
- Retry a failed run at most three times with a fresh context/seed. Retain
  completed candidates on failure; do not count retries or partial WAVs.

## Storage and review

Production root: `/srv/sftp/mark_sftp/files/SAMPLES_DFEEDER`.
The existing shared Loop Store root is the approval destination. The HTTP
fixture redirects both roots into its disposable test store.

The queue is readable to signed-in members; only a contributor or admin can
approve/reject their item. Approval verifies the recorded hash and atomically
moves the **original WAV bytes**, retaining ownership/provenance and avoiding
name collisions. Reject immediately removes the row and audio from the active
queue; a private `.trash` recovery copy retains the original WAV and metadata.
No further confirmation is needed for the explicitly labelled Reject action.
Neither action changes independently saved copies or the current patch.

Only authenticated range-capable API audio is served, with native media pinned
to the active account. Job/control responses are private/no-store. Backing
files, pending audio, metadata and worker scripts are not static public assets.
Atomic metadata precedes complete audio publication; inherited SFTP ACLs on
candidate WAVs remain usable. Cookies are stdin-only and never persisted/logged.

One batch runs at a time across accounts, under a process-wide queue lock.
`.jobs` persists progress. A restart marks unfinished jobs interrupted while
retaining completed audio. Closing a tab does not own/cancel the server job.
A removed or expired account session can stop later source loads; failure is
reported in the durable job. The CLI revokes its ephemeral official session
only after its batches settle.

The card polls only while a batch is active and visible, refreshes from the
server after reviews, and clears preview/pending fetches on account lock.
Its one preview player loops candidates without changing editor transport.

## Operations

```sh
python3 /root/.openclaw/workspace/sandboxGRANULAR/scripts/dfeeder.py --count 10
python3 /root/.openclaw/workspace/sandboxGRANULAR/scripts/dfeeder.py --count 25 --bpm 137
```

Use an existing active account via `--user` when attribution matters. The CLI
uses the official account session API; do not edit account SQL or disclose its
token. An existing running batch returns conflict; inspect/wait for it rather
than launching parallel workers. Candidates remain unreviewed by default.

Verification in a staged sibling app/backend checkout:

```sh
PYTHONPATH=/root/.openclaw/workspace/fs7300-documenter python3 tests/test_dfeeder.py
node --test tests/loopstore-normalise.test.cjs tests/iphone-low-power.test.cjs
BASE=http://127.0.0.1:19315/mygrain/ OUT=/path/to/evidence node tests/dfeeder-browser.cjs
```

The browser test needs at least four disposable candidates and no active batch.
It uses actual authenticated APIs and native previews in Chromium/WebKit phone
portrait/landscape; only its two Generate button payload checks are intercepted.
Exercise actual worker generation separately, including 68 and 178 BPM, and
verify peak, frames, source whitelist and distinct hashes. No production
candidates may be auto-approved/rejected as a test.

This adds a generation destination, not a DSP or saved-state migration. Preserve
Solo, Low Power, Cooking Pot, Song render versions, source ZIPs and prior PCM.

## Explicit On Demand profiles (2026-11-20)

The ordinary card/CLI defaults to `mode: native` and the generation contract above
is unchanged. The approved-login On Demand shop calls this same backend/worker,
with a fixed batch count of ten and one of these explicit modes:

- `loop`: ordinary layered drums + 2–6 sample loops, plus native Ember 2 at
  a starting level `0.4` (Loop mode is then loudness-balanced to drums at 100%); Enemy Drone is excluded and the cymbal lane is always zero.
  D starts at 100%, with a fixed downward-only LUFS/peak trim against drums
  during the existing warm-up cycle. Other drum lanes retain 80%. One to three random effects may use these sources.
- `ember`: only a fresh native `mygrainEmber.generatePatch()` at a starting level `0.4` (Loop mode is then loudness-balanced to drums at 100%);
  no drums, other loop sources or external randomised effects.
- `drone`: only the native Enemy whole-swarm randomiser, including its own FX.
  `key: random` retains native random notes. A named key (`C`…`B`, sharps accepted)
  sets **every** voice note to that pitch class, in random octaves (MIDI36–83),
  zero fine tuning and zero transpose. This is a unison/octave constraint, not
  a chord or scale; native timbral detune and drift remain sound controls.

The shop requires an explicit numeric BPM68–178 or literal `random`, translated
into the native optional-BPM plan. Blank/null is not an implicit random choice.
A non-random key is valid only for Drone. Publication verifies mode/source/drum
membership, Ember level, muted cymbals, and all fixed-key note values.

Ember and Drone are autonomous native engines: the disposable worker starts
these via the canonical `setBastardLoopPlaying` transport on the **same**
`withBufferedTransportStart` frame as the live recorder, retaining native master
gating as well as source scheduling. It restores its callback afterwards, marks the capture as
output recording to prevent idle suspension, and records actual source output
peak/RMS (rejecting silence). No editor/Song/DSP source has been modified. Every
mode still uses four bars, one discarded warmup, exact PCM frames and the same
normaliser/writer. The full app's legacy jobs without mode/key remain valid.

Shop state, audio ownership and basket storage remain separate from the full
app/shared candidate review queue. The frontend exposes no Dfeeder terminology.


### Explicit shop tonal and per-track Cooking Pot steering

Optional `tone` is `minimal` (default) or `tonal`; tonal is valid only in Loop
mode. Tonal adds native L and X and exactly one seeded choice of P or O. Set
L/X pattern length to 64 before the native Mega envelope/sequence randomiser.
P/O retain native generators and 2/1 divisions. Actual group output metering
uses `mygrainLoopFx.groups` L/X bridges and P/O gain nodes, not retired delay
input globals. These sources must be audibly present; whitelist-only state checks
are insufficient. No Song, synth, DSP or saved-state version changes apply.

Optional `pot` is `legacy` (default, preserving full-app/native old behaviour),
`off`, or `random`. Native mode accepts legacy only. Shop Off adds no external
FX. Shop Random chooses three distinct active sources other than D and drums in
Loop mode, and one source for Ember/Drone-only modes. Each chosen source gets a
distinct random processor from the ten non-Wasp effects. Source recipes,
Resonator slots and Playground inputs are explicitly scoped to the chosen card.
The publisher rejects protected/whole-mix/duplicate targets independently of the
worker. Wasp remains fully available in the separate whole-loop browser editor.
Full-app native/legacy effect generation is unchanged. Existing source intrinsic
effects remain unchanged.
The native normalize/exact-four-bar capture/write path is shared without forks.

The public shop's separate editor uses the native browser effects UI/DSP against
one complete source-A loop. It never calls the native synthesis backend while
users tweak. Browser-baked normalized PCM24 editions and recipes are stored only
in the public service's private shop state, not the native candidate library.
See `mygrain_public/README.md` for publication, purchase and deployment details.

### Optional shop-only native Genre steer

An optional `genre` from the canonical genre-presets.json is accepted only with
`mode:loop`. With no genre, native/full-app and existing shop random generation
are unchanged. Random BPM intersects the genre's range with 68–178; manual BPM
remains authoritative. Private shop orchestration obtains one validated native
GENREator LLM plan, then the same native AI adapter applies its samples, notes,
drums and parameter values in each isolated variation. Explicit shop tonal policy
overrides genre instrument exclusions before model generation; all native publish
source/normalisation guards remain active. The public app cannot call the model
bridge directly; a renderer-only Unix broker protects Gateway credentials.
No DSP, render capability, legacy Song or saved-source migration is involved.
See ../mygrain_public/README.md for the private bridge and verification process.

## Shop post-FX drum reference (2026-11-20)
Shop Loop generation opts into analysis-only source-family isolation for E, D and the drum leaves. The default/native graph grouping and all saved audio are unchanged. `analysisRoutes` exposes actual terminal paths plus raw drum taps; a single multi-route worklet measures post-insert PCM with the terminal/main-fader scales. It calculates bounded drum makeup only when an active drum insert attenuates the source (never lowers the 100% fader), then derives Ember/D fixed trims from the corrected post-FX drum reference. E targets -6 LU (bounded makeup); D is downward-only. The existing discarded warm-up is reused, with no extra render/cut/model pass.
The exact saved cycle is audited: reject silent/non-finite sources, Ember above -3 LU relative to drums or excessive peak, and D above the drum LUFS/peak limits. This catches evolving-effect growth after the warm-up decision. Final mix remains stereo-linked peak-normalised PCM24. `balance` retains post-FX tap labels, route families/effect stages/scales, drum makeup and saved-cycle metrics. Existing random-Pot exclusions for D/drums and cymbals-off policy are unchanged. New private workers require the aligned `cooking-pot.js`, `turntable.js` and all three `scripts/dfeeder-{worker,balance,balance-worklet}.cjs` files; activate the worker last. No server restart is needed for those per-job modules/static files.
Checks: `node sandboxGRANULAR/tests/dfeeder-balance.cjs` plus real native dry/random/slow/native cases and a forced shared attenuating Playground return; evidence `output/mygrain-postfx-balance-20261120/`. Forced effects are fixture-only, never added to the production random pool.
