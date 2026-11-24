# Shared MYGRAIN server render workers

## Runtime contract

The native app and isolated On Demand engine share **ten heavy-render slots**.
This is a single host-wide budget, not ten workers per service. Native live
browser synthesis and Cooking Pot processing remain in the user's browser.

`backend/mygrain_worker_pool.py` coordinates admission through
`/var/lib/mygrain-workers/queue.sqlite3` (SQLite WAL, group `mygrain-workers`).
The queue contains only credential-free job metadata, hashed scope, PID/start
identity, boot identity and heartbeats. Cookies stay in memory and worker stdin.
Admission is FIFO, capped at 64 waiting render tasks. Dead processes are marked
interrupted; credentials are never stored for automatic replay after restart.
Existing per-service recovery retains completed samples/purchases and offers retry.

| Work | Shared slots | Parallel coordinator |
| --- | ---: | --- |
| Dfeeder / On Demand batch | 1 per active loop, up to 10 | Up to 32 queued/running batches; one per owner; extra loops borrow idle slots only |
| Native saved Song preparation | 1 | Ten executor threads, each with its own warm Node/Chromium process |
| Native Robot natural speech | 1 per active phrase | Two reusable CPU/CUDA speech processes; idle workers hold no lease |
| Native DAW export | 1 | Ten executor threads; one active export per owner |
| On Demand DAW checkout | 2 | Ten coordinator threads; two simultaneous dry-stem decks only within existing PCM budgets |
| Public checkout orchestration | 0 | Four account-private coordinators; heavy exports are admitted above |

A single batch can render up to ten loops concurrently when capacity is idle,
matching the standard ten-loop shop batch. Smaller batches use only their loop
count. Native and On Demand share those same ten slots; simultaneous batches
compete fairly for the available budget, not ten workers each.
The first/sole loop waits in the normal FIFO; additional loops use a transactional
non-queuing admission that refuses to pass any queued task (including two-deck
checkout). Every loop releases its slot after rendering/publication, so new
waiting work gets priority at the next loop boundary; running loops are not
preempted. No extra helper tasks accumulate in the shared waiting queue.
Out-of-order results wait on scratch and publish as a contiguous original-index
prefix, preserving loop IDs, names, BPM mappings and existing browser URLs.
Each deck keeps the original BPM plan and per-index random seed; full-quality
DSP, bounded retries and source retention are unchanged. Genre requests still
share the engine-host batch-plan cache rather than making extra model calls.
A failed deck cancels siblings, retains already published samples and releases
all leases; service shutdown also cancels queued admissions. Job JSON records
active/peak worker count, retry count, first admission and completion timestamps.
The ten-minute On Demand cooldown is per account, starting at actual
render admission for new jobs. Queued time does not consume it. Earlier jobs keep
their original creation-time policy. Failed/interrupted jobs remain exempt.

No full-quality DSP, generation mode, BPM naming, audio normalization, source
snapshot, account boundary, saved Song format or download route is replaced.
Native Song and generation workers reuse browsers only with a fresh account
context and a verified zero-context idle acknowledgement. On Demand checkout still requires
confirmed RTX 3070 CUDA final assembly; there is no silent CPU fallback.

## Storage and resource boundaries

- Native intermediates: `/scratch/mygrain/app/` (root, 0700).
- On Demand intermediates: `/scratch/mygrain/on-demand/`
  (`mygrain-renderer`, 0700).
- Short `tmp/` directories hold randomized Chromium profiles; avoid nesting
  Chromium's singleton sockets beneath long job paths (Unix socket path limit).
- Dfeeder pending WAV/source ZIPs, DAW extracted PCM and package assembly use
  scratch. Cross-filesystem publication copies into a destination-local temporary
  file, fsyncs, then atomically renames; library ACLs are inherited at destination.
- Existing libraries, browser WAVs, Songs, user stores, baskets and completed
  purchases stay at their original persistent paths. Scratch is never their only
  copy. Losing the striped scratch volume loses in-flight work, not published WAVs.
- Both render services require `/scratch` mounted and fail closed without it.
  Service pre-start cleans only its own abandoned scratch intermediates, after
  systemd has stopped the previous service cgroup. Never run `startup` manually
  against an active service's scratch root.
- `mygrain-render.slice` bounds the **combined** native and On Demand services:
  MemoryHigh=24G, MemoryMax=27G, TasksMax=8192. Each service has TasksMax=4096,
  MemoryMax=27G, CPUWeight=100 and no CPU quota. systemd G means GiB.
- New heavy work waits while host MemAvailable is below 2 GiB. Scratch admission
  requires at least 8 GiB free. These are admission guards, not audio quality cuts.

Production feature flags are `MYGRAIN_WORKER_DB`, `MYGRAIN_SCRATCH_ROOT`,
`MYGRAIN_PARALLEL=1`, and a direct `MYGRAIN_CHROMIUM` binary path. Without the
shared DB flag, legacy serial behavior and existing test fixtures remain valid.

The native service is `fs7300-documenter.service`; its worker sources are here.
On Demand's separate deployment is `/opt/mygrain_demand_engine/`, with backend
and worker-script snapshots. Public checkout is `/opt/mygrain_public/`.
Apply scheduler/backend/worker changes consistently to both render deployments.

## Operations and backup

```sh
systemctl show mygrain-render.slice -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax
systemctl status mygrain-demand-engine fs7300-documenter mygrain_public
MYGRAIN_WORKER_DB=/var/lib/mygrain-workers/queue.sqlite3 python3 backend/mygrain_worker_pool.py
systemctl list-timers mygrain-sp-hourly.timer --no-pager
cat /var/lib/mygrain-hourly-backup/last-run.json
```

The private engine's authenticated `/shop/diagnostics` includes shared capacity,
used units, queue and job kinds. Never print the engine key to inspect it.

`mygrain-sp-hourly.timer` runs at minute17 each hour, with Persistent=true. Its
oneshot service cannot overlap itself; an initial baseline longer than an hour
must finish before a later invocation can run. The existing broad 30-minute SP
backup is unchanged. The hourly runner is `/usr/local/sbin/mygrain-sp-hourly`,
maintained as workspace `scripts/mygrain_sp_hourly.py` (install mode0750).

It creates 0700 consistent, integrity-checked standalone SQLite snapshots and
service/configuration recovery metadata under
`/var/lib/mygrain-hourly-backup/current/`, then backs up that snapshot and the
full configured live persistent/deployed MYGRAIN roots recursively. Temporary
scratch PCM/profiles are regenerated, not backed up. All snapshot source paths
are recorded in `manifest.json`. SQLite snapshots are individually consistent;
the live filesystem backup is **not an atomic whole-system snapshot**.

Logs and per-batch exit files are outside the snapshot in
`/var/log/mygrain-hourly-backup/<UTC-run>/`. DSM_LOG and the working directory
must be writable for the client. Each SP command has at most eight root arguments.
The runner restores a backed-up canary and compares exact bytes on every run.
Do not declare a full backup successful until all batch summaries and exit codes
have been collected. Exit4 means warnings, not a clean completion.

For recovery, stop the relevant services, restore the persistent roots and
deployment/configuration files, then restore each consistent SQLite snapshot to
its recorded source path. Remove incompatible live WAL/SHM sidecars only with
services stopped. Recreate/mount scratch, restore permissions/groups, then start
services; do not replay interrupted credentials. Keep the immutable source ZIPs,
private original/processed WAVs, finished DAW packages and user/account stores.

## Verification evidence

Implementation evidence is in workspace
`output/mygrain-four-workers-20261121T1410Z/`: real four-mode concurrent
generation, four simultaneous persistent Song workers, unchanged saved source
hashes/revisions, native pattern and tempo-changing Song DAW exports, actual RTX
PCM parity and checkout, eight-process admission/crash/cancel tests, legacy
regressions, and exact-byte existing HTTPS WAV/purchase downloads before/after.
Physical iPhone behavior and maximum-capacity production load were not measured.


## Single-batch measurement — 21 November 2026

A production private-owner batch of ten 120 BPM Loop/Minimal/Random Cooking Pot
loops completed in **112.85 seconds** using four concurrent decks. The preceding
one-worker run took 343 seconds (observed ~3.04x speedup / ~67% shorter wait).
Both runs needed two automatic retries. These were different random materials
with the same settings, not a controlled identical-seed performance guarantee.
Combined render-slice peak was **4.663 GiB**, averaging 3.23 CPU core-equivalents
over the measured run, with zero memory-high/max/OOM events. All ten PCM24 WAVs,
source ZIP CRCs/manifests, canonical indices/BPMs and exact-byte audio responses
passed; cross-owner audio was denied. Cooldown remained first admission +600s.
Ten existing On Demand WAVs and five existing HTTPS downloads (two native WAVs
and purchased original/processed/DAW) remained byte-identical. Global slots were
released to zero. Scheduler/pool/account/cooldown regressions passed.

Evidence and pre-change rollback copies:
`output/mygrain-batch-parallel-20261121T143835Z/` (workspace-relative, private).
The test used an unlinked private owner, not an existing user account or basket.

## Eight-slot expansion — 21 November 2026

Mark authorized eight shared slots with no more than four workers for any single
generation. Both deployments use eight for queued and borrowed admission and
diagnostics; Dfeeder/On Demand explicitly caps both its executor and in-flight
leases at four, independently of pool size. FIFO priority, one generation per
owner, two-deck checkout reservation, scratch guards and 24/27 GiB combined
memory limits are unchanged. Legacy operation without the shared DB stays serial.

Verification: 54 focused tests passed. Two real concurrent ten-loop 120 BPM
Minimal/Random Pot batches each peaked at four workers; shared observed peak
was eight. They completed in 180.7 / 152.81 seconds with 2 / 1
automatic retries (different random audio, not a speed benchmark). All twenty
normalized PCM24 WAVs, source ZIPs and owner-scoped HTTP bytes passed; cross-owner
audio was denied. Combined slice peak 8.409 GiB, no pressure/OOM events, final
probe slots/queue zero. Supplementary pre-existing WAV comparison verified 9
exact byte matches in current/recovery storage; 1 recorded path was no longer
available, so no all-ten or unchanged-URL claim is made. No user state restored.
Evidence/rollback: `output/mygrain-eight-workers-20261121T145324Z/`.

## Protected divider renders — 21 November 2026

Direct Song server-arm preparation sets controller busy through capture to retain
the existing idle-audio guard for slower/longer divided loops. No pool capacity,
per-generation limit, scheduling, memory, cooldown or ownership changes. See
`clock-dividers.md` for selective render capability and PCM evidence.

## Restructure post-effects drum-reference balance — 22 November 2026

New app Dfeeder and On Demand Loop generations that select Restructure now
include a separate `balance.restructure` family, independent of whether D or
Ember was selected. The worker isolates analysis families before shared nonlinear
inserts, taps the final source-owned output (including spring, channel EQ and
local/Pot effects), then applies a fixed post-insert trim. Comparisons use the
post-effects drums after any existing drum makeup, never pre-effects source
levels. The target is no louder than drums in integrated K-weighted LUFS and
sample peak, downward only; new start levels stay at or below 70%. Saved-cycle
auditing rejects a source over +0.15 LU / 2% peak against its recorded drums,
using the existing bounded retry rather than publishing an unmeasured result.
Optional analysis appears in the public Generation balance details. Legacy
internal `dropbox` source IDs remain compatibility keys, not display labels.

Native ordinary/Mega/Sparse and per-card Generate compare Restructure when drums
are enabled. The observer reads actual post-effects routes, waits for queued bar
changes to become audible, and remeasures after canonical level adjustments (up
to four trims). This handles the source limiter/spring instead of assuming a
linear fader-to-output ratio. Missing/silent/ambiguous analysis fails closed;
Stop/abort/account lock releases observer taps and must not restart playback.
A randomisation requested before Start sets only an in-memory deferred analysis,
completed after source restoration. Existing patch startup never sets that flag.
No permanent AGC, saved-state migration, render-version bump or load-time volume
clamp was added. ZIP/Undo/Song use canonical source levels; existing source ZIP
identities stay unchanged. The frozen public Cooking Pot editor does not generate
loops and was not rebuilt or migrated. Shared render capacity remains unchanged.

Verification and rollback copies: workspace-relative
`output/mygrain-restructure-balance-20261122T100846Z/`. Real isolated native eight-lane and private
legacy-PCM workers retained WAV/source ZIPs and verified post-FX metrics; native
Restructure was processed through Bass Face. The private Loop run reduced R by
2.66 dB and passed recorded-cycle loudness/peak checks. Actual native audio with
R but no D passed post-effects balancing and exact canonical ZIP recall.
Chromium/WebKit legacy/source/ZIP/Undo/K regressions passed; real Song preparation,
playback and warm-cache reuse passed at unchanged capability 31. Node metering
tests include independent FFmpeg LUFS comparisons at 44.1/48 kHz, R-only and
E+R families, nonlinear source PCM, quiet no-boost, source isolation and fresh
analysis windows. Six publication/account tests passed, including invalid-R
analysis rejection. The worker now waits for initial Song-library busy state;
the pre-task worker reproduced that unrelated startup race before the wait fix.
Live public UI checks used real-render metadata as a browser-only fixture, blocked
all production POSTs, checked 320/390/1440 widths and preserved actual items.

## Warm generation workers / ten-slot budget — 22 November 2026

Mark requested warm worker reuse and two additional shared slots, matching the
shop's ten-loop batch. The shared budget is now ten; a generation can borrow up
to its loop count / ten idle slots without jumping any queued work. The previous
four-per-generation cap is superseded. Historical measurements above retain the
capacity used at the time and are not ten-worker speed guarantees.

Generation retains Node/Chromium processes in a bounded service-local idle cache,
not pages or audio graphs. Every attempt uses a fresh context; the backend waits
for an explicit `idle:true, contexts:0` after WAV/source capture and context close
before publication/reuse. Credentials travel through stdin only and are never
stored in cache metadata. Workers can be reused across batches/accounts; no
account cookies/storage, AudioContexts, DSP graphs or generated PCM survive in a
browser context. Keep the strict POST/network guard unchanged.

Cached transports are retired after 45 seconds at checkout, before Node's
60-second idle exit, and Chromium is recycled after eight loop jobs. Failure,
malformed responses, missing/dirty idle acknowledgements, cancellation and service
shutdown discard affected transports; cancelled batches retain completed loops.
Idle workers hold no heavy-render lease. Every active loop still takes/releases a
shared lease, and existing combined 24/27 GiB limits and memory/scratch admission
guards apply. Cache size is capped at shared capacity per service. Browser reuse
reduces process startup, not real-time capture duration or per-context sample/DSP
preparation; full warm-up, post-FX analysis, PCM24 and source ZIP policies remain.
Job diagnostics add credential-free `warmWorkerStarts` / `warmWorkerReuses`.

Verification evidence: `output/mygrain-warm-workers-20261122T111448Z/`. Eight real-child lifecycle/
parallel tests, six cross-process pool tests, seven Dfeeder API/publication tests
and 41 shop admission/cooldown/checkout regressions passed. A persistent renderer
completed three real cross-store cold/warm jobs with one browser launch and zero
contexts between jobs; matching native cold/warm seeds kept identical recipes.
The entire per-loop generation/DSP/capture callback matched the pre-change file.

Two isolated ten-loop Drone batches through the real shared admission DB reached
ten active workers each. Native cold completed in 25.40s, private-editor warm in
23.80s; the second reused all ten transport PIDs, with zero new worker starts.
Both had zero retries. All twenty PCM24 WAVs and retained source ZIPs passed the
canonical publication, checksums and archive CRC checks. Host MemAvailable stayed
at/above 11.49 GiB. These are short 178 BPM Drone tests using distinct editor
builds, not a controlled general speedup claim or heavy Cooking Pot stress test.

Both render services restarted only with the shared queue idle. Authenticated
private live diagnostics reported capacity10/used0/queued0; authenticated native
editor and four unchanged DSP/Song assets returned exact bytes; public On Demand
shell returned200. Probe session revoked. Public service/assets and existing saved
WAVs, Songs, source snapshots and purchased downloads were not rewritten.

## Robot natural speech — 22 November 2026

The main app's Robot now admits neural synthesis as `robot-speech` through this
same ten-slot scheduler. At most two speech subprocesses are reused in the native
service; there is no extra capacity, change to FIFO, generation borrowing,
checkout reservation, cooldowns or saved audio. Children use RTX3070 CUDA when
available and report the actual device. Idle models are released after45s;
active synthesis has a90s deadline, and all success/failure paths close leases.
No cookie/text/audio is stored in scheduler metadata. The stateless authenticated
route does not hold the account-file lock while waiting for synthesis. Existing
Songs use their saved speech PCM and require no new render identity. See
`robot.md` and `backend/mygrain_speech_workers.py`. On Demand has no Robot UI or
speech API; its deployment and shared pool implementation are untouched.
