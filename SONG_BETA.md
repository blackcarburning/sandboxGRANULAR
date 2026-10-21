# Song beta

## Recover a crashed same-name editor — 21 October 2026

Build `v2026.10.21.LOCK.2` adds **Clear Lock & Edit** beside the editing
controls when the selected song is locked by the same name as **This device**
(ignoring case and leading/trailing spaces). Choose it and confirm after a
crash. It replaces the observed lock atomically with a fresh session credential;
it does not reload sounds, cancel an amendment, save a part or change the song.
The abandoned session can no longer save, renew or release the new lock.

Other device names remain blocked. Ordinary Edit Song never takes over a lock.
Recovery still requires access to the same account/library, a matching current
song revision and the exact lock shown at confirmation. A replacement lock is
not cleared by an older confirmation. Device names are a deliberate recovery
choice within that library, not device identity: Undo/Redo remains scoped to
the original exact account/device ID, never to the shared display name.
No Song Access, song-part, audio, history or export schema changes are required.

## Familiar Song workflow with copy/paste — 15 October 2026

Build `v2026.10.15.COPY.4` keeps the existing Song controls and adds only
**Copy From Part** and **Paste Part** alongside them. Recall, Amend and the
original Save Amendment / Cancel Amendment controls work normally. There are
no duplicate amendment buttons, Clear Copy button or extra editing-state panel.

The automatic editing access fix from COPY.3 stays in the background: there is
no separate **Edit Song** prerequisite
from Amend, New Part, Save Amendment, Paste, Reuse, Rename, Colour, Repeats,
Delete and arrangement changes. Press the action you need; it requests the
normal server editing lease automatically. Edit Song remains available to
reserve access in advance, and Finish Editing releases it for another device.
Another device's lock, paused connections and exact revision checks still
protect every save. Cancelling a rename/delete/paste prompt requests no lease.

During an amendment, use the original **Save Amendment** and **Cancel Amendment**
controls above the list. Saving commits the live pattern; cancelling keeps the
saved part unchanged. Stop Song before amending/copying.

After copying, a small status line names the source and copied Bastardloop.
Choose **Paste Part** on the destination. The paste button keeps its usual label.
Copy/paste replaces one Bastardloop, not the whole Song part. No save format,
audio engine or diagnostic-storage changes are required for this update.

## Copy a Bastardloop between saved parts — 15 October 2026

Build `v2026.10.15.COPY.1` adds **Copy From Part** and **Paste Part** to each
part's expanded controls. Stop song playback and finish any unsaved amendment
first. Open the source part's controls, choose **Copy From Part**, then choose
**A, B, C, V, P, O, L, X, Q, M or M+** from the popup. Open the destination
part's controls and choose **Paste Part**, then confirm replacement.

This copies the **saved revision**, not unsaved live edits. Only the selected
Bastardloop is replaced: its original sample audio, settings, local sequence,
level, tuning, FX, modulation assignments, source metadata and captured controls.
M and M+ include both original and rendered audio; Q includes its sequence and
sample bank. Empty source lanes clear the corresponding destination audio
rather than leaving its old sound behind. Source settings such as mute/enable
and level are retained, so a muted or quiet copied loop remains muted or quiet.

The destination keeps its other loops, master/shared effects and solo context,
tempo, global pattern length, name, colour, repeats and order. A loop from a
different tempo or pattern length therefore plays within the destination's
existing timing. **Every reused occurrence of the destination shared part
changes together**, just like Save Amendment; the confirmation warns about this.
The previous destination revision is retained in server history. A paste does
not overwrite the live editor's pattern; use Recall to inspect the updated part.

Copy/paste uses the original immutable archives on the server, so it does not
need to decode/unfreeze every source sound on the iPhone or upload a full live
capture. The source part is not changed. The clipboard pins that saved revision,
even if the source is subsequently amended or deleted. It can be pasted more
than once and into another song in the **same Song Access library**. It lasts
only for the current page session; reload or opening a library clears it.

Copy is available read-only. In `v2026.10.15.COPY.2`, Paste becomes available as
soon as a loop has been copied. After confirming replacement, it requests Edit
Song if this device is not already editing. Another device's lock is never
overridden: the operation reports who holds it and keeps the clipboard to retry.
A paused existing lease must be verified before saving; failed connections do
not bypass the lock. Cancelling confirmation does not acquire a lease or save.
Paste still requires a valid destination editing lease and exact song/part
revisions, and is blocked during recording or an
unsaved amendment. Source/destination archive integrity and the normal upload
limits are checked before publication. Other libraries cannot be used as copy
sources. Rejected pastes leave the saved destination unchanged and keep the copy
available to retry. After a lost network response, Refresh Songs before retrying:
the connection can fail after a save has reached the server. Revision checks
prevent retrying an old destination over a newer saved part.

If the song was armed before pasting, its cache is re-armed automatically;
unchanged audio is reused and only changed parts need rendering. Otherwise
choose **Arm Cache** before Song playback. A cache failure after a successful
save explicitly says that the paste is already saved and only Arm Cache needs
retrying. Microphone recording is not automatically armed or started.

`node tests/song-beta-copy-browser.js` with `SONG_BETA_TEST_URL` pointing at the
isolated test server checks phone portrait/landscape, complete editable recall,
audible regenerated audio and single-changed-part re-arming at 44.1/48 kHz.
`test_song_loop_copy.py` covers all eleven lane mappings, legacy snapshots,
shared/reused parts, pinned revisions, access/lease checks and corrupt archives.
Physical iPhone/Safari verification remains separate.

## Song editing locks — 15 October 2026

Build `v2026.10.15.LOCK.1` allows one editing session per song. Existing songs
open without reserving editing. Since COPY.3 the first editing action requests
access automatically; **Edit Song** can also reserve it in advance. **Finish Editing**
releases the lock immediately without stopping playback or clearing the live
pattern. New Song acquires its own lock automatically. Switching songs or
libraries releases the previous lock. A normal page close attempts a small
keepalive release; a crash, lost connection or suspended browser expires
**600 seconds after the last successful renewal**. Connected editors renew
every 30 seconds. There is no force-unlock button.

**This device** is an optional friendly label, stored locally alongside a random
browser-installation ID. It is not a hardware identifier. Each page/tab gets a
new in-memory session ID and a secret server-generated lease token, so two tabs
on one computer cannot share editing ownership accidentally. Song Access still
grants library access and remains separate from these identifiers. Clearing site
data resets the browser ID and can remove library access; do not clear it.

Other devices can read, recall, audition, Arm Cache, play and export the song.
They cannot save parts/amendments, rename, recolour, reuse/delete parts or change
order/repeats. Read-only cache preparation may publish derived WAVs for an
unchanged source hash; it never changes snapshots, arrangement or song revision.
The instrument's live controls remain usable, but only a valid editor can commit
their state to the shared song.

Every content mutation checks the lease's token, session, device and expiry on
the server, plus an exact quoted `If-Match` song revision. Long uploads recheck
permission immediately before publishing the manifest. Conflicting saves fail
instead of overwriting. A song's additive `revision` defaults to 1 for old
manifests and advances on each content write; cache uploads and lease renewals
do not advance it. Existing ZIP snapshots, audio, access keys and render formats
are unchanged. Older open app builds can still read songs, but must reload to
obtain a lock before editing.

Lock metadata lives in each song's private `.edit-lock.json`, separately from
`song.json`. Tokens are hashed on disk and never returned in song lists/status.
A process mutex plus a filesystem lock serializes lease checks and writes;
locks survive service restarts. Lock routes remain scoped to the Song Access
library: `GET /api/songs/<song>/lock` and `POST` to
`/api/songs/<song>/lock/acquire`, `/renew` or `/release`. Lease conflicts return
423; stale song revisions return 409. Both leave saved content unchanged.

Connection failures pause saving while attempting renewal. An expired editor
must explicitly obtain a new lease; it never silently regains ownership.
Unsaved amendments and live patterns remain local. If another editor changed
the song, **Refresh Songs** asks before cancelling an unsaved amendment and then
loads the server version; it does not replace the live pattern or part-name
field. Renewals update only the lock status, not the parts DOM, while ownership
is stable, so they do not steal focus from the control being edited.

**Current default rollback:** Mark explicitly selected the immediately
pre-locking `v2026.10.15.MIX.4` build. Its exact sources, checksums, verification
and restore commands are in
`backups/mygrain-before-song-locks-20261015T113126Z/verification/SUMMARY.md`.
This supersedes the historical default below; separately named older rollback
points remain available. Restore code only and retain all saved song/audio data.

M and M+ are independent vocal lanes. Part snapshots bind raw and rendered
audio for both (`bastardM`, `bastardMRender`, `bastardMPlus`,
`bastardMPlusRender`), plus each lane's metadata/settings. Older snapshots
without M+ recall it empty, muted and with neutral settings; they never inherit
the previous part's backing vocal. Saving parts is blocked during either lane's
recording. The global vocal workspace is not captured, replaced or cleared.
Song renders still capture one pattern: long multi-loop vocal takes do not
advance across frozen repeats. Use a pattern long enough for the full phrase.
The operator walkthrough is in `manual.html#song-mode`.

## Portable freeze and recall

Build `v2026.10.14.PortableFreeze.1` captures settings directly, without using
localStorage as an intermediate snapshot. Pending slider callbacks are flushed
before capture and before recall finishes. Saved drum level, individual clock
rates, hat ratchet counts and numeric/checkbox/radio controls survive recall;
restoring global BPM no longer replaces saved per-effect rates in song mode.
The snapshot also contains all range/select controls, mode fields, six LFO/INV
routing maps, sequencer steps, selected/held keys and source metadata.

The audio registry contains 29 slots: generated/base loops; main, A and B grain
sample sources; main/A/B microphone sources; A/B/C/V/P/O/L/X loops; raw and
rendered M and M+ vocals; raw and rendered Dropbox audio; all six drum lanes;
and Q's packed piano or strings multisample bank, including string sustain loops.
Q's instrument, chords, arpeggios, velocity, filters and dotted/triplet delays,
X's filter LFO settings, and V's cut/repeat settings travel with the snapshot.
Every available slot is stored in the server part ZIP, including disabled
sources. `extra.freezeStateVersion: 1` and `extra.audioSlots` explicitly record
which slots are present and which are empty. Inventory or WAV-dimension
inconsistencies are rejected rather than filled from a phone's samples. Recall
clears absent slots and the legacy source alias, then restores saved audio again
after control callbacks so vocal/generated buffers cannot be replaced by
temporary control-driven rerenders. Source WAVs retain the existing PCM16
format; this is not lossless floating-point sample storage.

Frozen playback uses the hash-verified server WAV, not the live phone's grain,
vocal, effect or mixer settings. Browser render storage is an optional cache;
unavailable localStorage/IndexedDB does not prevent capture/recall once a library
is selected, or playback of a prepared server render. The isolated rendering
engine uses snapshot-only state and a separate temporary audio database.
`portableVersion: 1` marks renders prepared with these fixes. Reload and **Arm
Cache** after updating: older affected renders are regenerated once from their
stored snapshots. Source archives are not rewritten by this upgrade. A newly
generated freeze can capture a different random variation; subsequent phones
reuse that saved freeze instead of regenerating it.

Build `v2026.10.15.Song.1` adds **Back Up Song Access** and **Open Song Access**
beside the saved-song controls. Download the small access JSON once and keep it
private: it grants read/write access to every song in that library. On a new
device, open MYGRAIN, use Open Song Access, and choose the file. The original
song list and selected arrangement load from the server; Recall downloads the
editable snapshot and original samples, and Arm Cache downloads hash-verified
server freezes or prepares any missing ones. The access file contains only the
library credential and selected song ID, not samples, patches or cached audio.
Opening it does not upload, copy, delete or rewrite any server song. Switching
away from a non-empty library asks for confirmation; back up its access first.
Malformed files or a failed server request leave current access unchanged.

Browser credential/selection writes now have an in-memory fallback if storage
is blocked or full, and an inaccessible IndexedDB property also falls back to
server renders. An unguarded startup preference read no longer aborts the app
when localStorage is denied. The isolated renderer can prepare a first server
freeze from saved sources with IndexedDB denied too; inaccessible temporary
database cleanup cannot invalidate an otherwise completed render.
Without persistent storage, reopen the access file after each
reload. This is credential portability, not a public or merged song library:
unrelated keys still cannot access one another's songs. Do not clear site data
until the access file has been saved safely. Old
snapshots cannot recover parameters/audio that were never saved, and freezing
still captures one pattern rather than advancing a long vocal take through
successive repeats.

`tests/song-beta-portability-browser.js` runs only against the isolated localhost
test server. It exercises all current 371 ranges, 66 selects, 227 mode fields,
non-default LFO/INV routing, numeric/checkbox/radio controls, source metadata and
29 mono/stereo audio slots (including Q). Fresh 48 kHz and 44.1 kHz contexts open
the downloaded access file without a seeded library key, then have conflicting
settings/samples and deliberately unavailable browser storage. Both verify the
same saved render SHA-256 without allowing a new render; empty-slot capture and
recall additionally prove that stale grain/vocal/drum/legacy sources are cleared.
These are Chromium clean-context tests, not physical iOS/Android hardware tests.

A read-only production archive audit on 2026-10-14 checked three songs, 20
occurrences and ten unique active source archives/renders. All source/render
SHA-256 hashes, declared WAV files and WAV dimensions passed, covering 74 saved
grain-related assets and 28 saved vocal assets. All ten source snapshots predate
the portable inventory marker and their renders need re-arming. Missing newer
fields are confined to later M+/vocal-cut/extra-drum additions; these use their
compatibility defaults. One part has both vocal lanes enabled but no vocal audio
or metadata in its snapshot: it must remain empty, not borrow a phone's takes.
No production archives, manifests, renders or vocal takes were edited by the
audit or by integration tests.

This feature is isolated to the Song card, `song-beta.js`, `song-beta-adapter.js`,
`song-beta-clock.js`, `song-beta-capture-worklet.js`, `song-beta-render-deck.js`,
`song-beta-export.js`,
`song-beta.css`, and `backend/mygrain_songs.py`. Existing patch import/export
formats and existing application controls remain unchanged.

## Workflow

### Reuse an existing part

Expand a saved part and select **Reuse Part** to append another occurrence at
the end of the song. Use its move arrows to place it later in the arrangement.
This adds a small reference in the song manifest, not a copied snapshot,
sample bundle, server render, browser-storage render, or decoded audio buffer.
The existing armed cache stays armed when the shared audio is already ready.
Cards show **Shared: N uses** when a part appears more than once.

Each occurrence has its own position and repeat count. Pattern/settings/audio
amendments, names and colours are shared across all occurrences of the part.
**New Part** still creates an independent snapshot if separate edits are wanted.
**Delete** removes only the selected occurrence, including when it was the
original: remaining references retain access to their source audio. Playback,
**Play Song From Here**, and WAV export follow occurrence order and repeats;
cache preparation runs once per unique source. Existing songs load unchanged.

The `POST /api/songs/<song>/parts/<occurrence>/reuse?sha256=<source hash>`
endpoint adds a reference under the same library ownership and stale-source
checks as other part edits. References use unique `id` values plus
`sourcePartId`; sources whose original occurrence was removed remain private
in `sharedParts` while still referenced. The public song resolves complete
source metadata for each occurrence and never exposes private recovery data.

### Save and play

Layer **V → Loop Cut** opens a waveform timeline with draggable Start/End
handles, keyboard arrows, and time fields. **Snap** can be disabled or set to
1/32 and 1/16 increments through one bar. The selection gates the vocal at its
existing position: the original sample, full loop duration, tempo and shift
remain unchanged, with silence outside the window and short edge fades.
**Full Loop** disables the cut. **Vocal + Metronome** auditions from the full
loop start without other playback; **With Bastardloops** starts the existing
enabled loop layers together from that same origin. Stop/close cancels the
audition and metronome without changing saved layer levels or mutes.

**New Part** and **Save Amendment** include the cut and snap settings. Recall,
song playback, Loop Song/Loop Part and WAV export apply the saved cut, not the
currently edited window. Reused occurrences share the same cut; old snapshots
without this field recall with the cut off. Original vocal PCM remains in the
snapshot, while full-duration cached renders include the silence. Cut-enabled
renders carry `vocalCutVersion: 1`; incompatible older renders are rejected.

**Play Song**, **Export Song to WAV Folder** and **Stop Song** sit immediately
above the loading/live status line and saved-part list. All help text and the
cache summary are below the parts in **Notes and Instructions**, closed by
default. Select **+** to open it and **−** to close it; keyboard activation
also works. Opening notes does not change playback, saved data or cache state.

1. Enter a song name and select **New Song**. A named, collision-safe directory
   is created under `/srv/sftp/mark_sftp/files/mygrain-songs/`.
2. Configure the current pattern, sounds, levels, mutes, and effects. Enter a
   part name and pattern repeat count, then select **New Part**. The button is
   created only after the server has successfully stored the complete bundle.
3. Change the live patch and save more named parts. Editing the live patch does
   not alter saved parts unless an explicit amendment is committed.
4. Select **Arm Cache**. Only pending parts are fetched and integrity-checked
   without applying their settings to the live patch. Source samples are decoded
   only when rendering is needed; identical WAV assets within a part share a
   decoded buffer. Missing song renders are
   captured in a muted, isolated MYGRAIN engine and saved to the song folder.
   First preparation takes real time (one pattern per uncached part), with up to
   two parts prepared concurrently by default. **Cache preparation** accepts
   1–10 workers and remembers the choice in this browser across reloads. Ten
   workers are experimental, not a guaranteed speed improvement. **Sequential
   (1 part)** reduces load on slower devices.
   High concurrency can starve live scheduling and introduce gaps/crackles in
   real-time renders. Lower the count if needed; the default remains two.
   A lower count applies to future renders, not already frozen audio. A saved
   render is replaced only when an actual audio/settings amendment is committed.
   Later preparations reuse integrity-checked browser/server renders and unchanged
   playback audio already in memory. Reordering, renaming, repeats and refreshing
   the same song retain that audio; amendments discard only the changed part.
   Ready parts are skipped entirely, not sent through the preparation queue.
   Identical amendments retain their renders even when capture timestamps,
   ZIP ordering or JSON key ordering change. The card shows ready/pending
   counts and each part shows Ready, Saved (load existing audio), New or Changed.
   Sources are decoded only for an active renderer or the recalled editable
   part, and released after rendering. Memory-weighted admission automatically
   reduces concurrent heavy preparations below the selected 1–10 maximum.
   Large individual snapshots run alone instead of failing a song-wide limit.
   Frozen WAV renders are cached in `mygrain-song-renders-v1` IndexedDB, keyed
   by browser library, song, part, content hash and render hash. The server
   remains authoritative; missing/corrupt browser copies are verified and
   retrieved from the server. Full/unavailable browser storage falls back to
   server reads with a status warning, without discarding saved parts.
   Decoded playback renders use a 96 MB hot cache, not a song-size limit.
   Stop cancels and cleans up all active renderers before another UI operation can run.
   Preparation failures retain complete, unchanged renders for a targeted retry.
5. Select **Play Song** to play the displayed order and stop after the last part.
   Each part uses its saved BPM and shared pattern length, multiplied by its
   repeat count. The clock is the audio context's clock, not elapsed wall time.
   Small songs are scheduled completely before playback. Larger render sets
   preload the first two parts, then read one part ahead from browser storage
   while keeping only current/future sources scheduled. Every adjacent
   stop/start uses the same cumulative audio-clock sample boundary. No live
   engine reconstruction is needed at handoffs. A missed storage deadline
   stops with an explicit error instead of dropping a part or silently
   shifting the beat. Render/sample tails do not extend a part; UI timers
   only update the current-part highlight. Export reads stored renders one
   part at a time and keeps the existing 64 MB WAV-upload limit.
6. Parts start collapsed for a compact arrangement: their name, editable repeats,
   and move arrows stay visible. Click a name to expand/collapse other controls; this does
   not recall or start audio. Expanded state follows the part when moved and
   survives display refreshes during the current page session. Expand a part
   and press **Audition** to recall its full snapshot and audition it live.
   Manual recall exits automatic song order and loops that part until stopped
   or replaced. **Stop Song** also cancels queued transitions and pending loads.
   **Play Song From Here**, beside Audition in each expanded part, starts that
   part and continues through the rest of the current order using saved repeats
   and tempos. If the cache is not armed, it asks **Arm Cache?**; confirm to
   prepare the cache and automatically play from that part, or cancel to leave
   the cache and playback unchanged. It uses the same frozen-render playback and
   storage lookahead as Play Song, not live Audition, so transitions match the
   arrangement. Clicking another part's button restarts from that part; the
   ordinary Play Song button still starts at the beginning. No parts, repeats,
   cache contents or saved arrangement are changed. Pending amendments must be
   saved or cancelled before starting song playback.
7. **Recall** loads the complete saved pattern, settings, and sounds with
   transport stopped. Edit the usual controls and use **New Part** for a separate
   copy. Recall needs no arming, including after loading the song again.
8. **Amend** loads and selects the saved part for editing. **Save Amendment**
   captures the edited full live state and atomically replaces that part in its
   existing position. Old revisions remain on the server; its render is
   invalidated only if the saved content changed. **Cancel Amendment** leaves the server copy unchanged.
   If that part is already recalled, Amend keeps its current live edits rather
   than loading over them. Recall/edit/Amend/Save is therefore safe as well.
9. **Delete** removes a part from the order after confirmation. Its files and
   metadata are retained for server-side recovery, not erased.
10. Each song row has a **Repeats** box (1–64 whole patterns). Changes save to
   the server when you leave the box or press Enter; the displayed duration
   updates after saving. **Rename** changes names; **↑/↓** changes order. These
   changes do not overwrite the audio/settings snapshot or stored render. Arm
   again afterwards; existing renders are reused. Repeat boxes are disabled
   during playback, other song operations, and pending amendments.
11. Expand any part to choose its **Colour** or **Clear Colour**. Changes save
   automatically to server metadata, including on previously saved songs. The
   tint and colour stripe stay with its ID through moving, renaming, repeat
   changes, amendments and reloads. Colour changes do not invalidate the armed
   cache or interrupt playback, and remain available during an amendment.
   Existing parts without a colour retain their original appearance.
12. Select **Rename Song** to change the selected song's name. Its server ID,
    folder, parts and cached audio are retained. The updated name appears in
    the library and becomes the default name for future song WAV exports.

On mobile, **Jump** sits higher and projects further out than the quick tabs.
The light-green **Song** tab immediately below it jumps to the arrangement.

## Captured content

- Existing complete settings state: synth/effects, LFOs, sources, levels, mutes,
  pattern length, drum patterns/ratchets, and the Loop L/X note sequences.
- Additional main sequencer notes, step enable/rest states and volumes,
  sequencer grain enable, selected/pressed keyboard notes (including with Hold
  off), source-layer solo state, and
  checkbox/number/radio settings not covered by the existing persistence format.
- Actual WAV audio for generated sources and the untransposed base; all grain
  sample/mic sources; rendered A/B/C/V/P/O loops; L/X samples; raw and rendered
  M and M+ recordings; raw and rendered Dropbox samples; all six drum samples.
- Audio metadata. Missing assets are cleared on recall, not inherited from the
  previous part. Cached audio is cloned before live use, so live edits cannot
  modify an armed part's original sound.

Keyboard chords are included automatically by **New Part** and **Save Amendment**.
**Arm Cache** starts all saved keyboard notes in the isolated renderer, using
the saved Grain A/B sources, envelopes, tuning, layer mutes and effects. Muted
layers remain silent; source samples and configurations are still preserved.
**Recall** restores the chord and highlights its keys without starting audio;
**Audition** (or the ordinary Play Keys/Loop control) plays it live again.
Arpeggiator selections keep their saved arp behavior, not an extra sustained chord.
Older parts with saved held notes automatically refresh their first-generation
renders on the next arm. Old snapshots without keys remain unchanged/reusable.
Keys that were not captured by an older snapshot cannot be reconstructed;
recall, select the missing chord, and Save Amendment to store it.

Inactive sequencer sliders and the Song library selector are excluded from
song-state replay. The authoritative main sequencer snapshot is stored
separately; replaying hidden out-of-range sliders would otherwise trigger the
legacy UI's nonexistent-step handlers on shorter patterns.

The browser's ordinary audio persistence is updated in a serialized background
queue after recall. The server archive, not IndexedDB, is the authoritative
saved part. An IndexedDB failure does not remove or corrupt the server part.

## Server integration

The deployed `/root/.openclaw/workspace/fs7300-documenter/server.py` imports
`backend/mygrain_songs.py` using `importlib.util` immediately before
`DocumenterHandler`. Its GET and POST handlers delegate `/mygrain/api/songs`
requests to that module before continuing with their existing routes. No Caddy
or service configuration changes are required.

- `GET/POST /mygrain/api/songs`: list/create songs.
- `GET /mygrain/api/songs/<song-id>`: retrieve song metadata.
- `POST /mygrain/api/songs/<song-id>/rename`: save `{ "name": "New song name" }`
  atomically without moving the folder or changing part IDs.
- `POST /mygrain/api/songs/<song-id>/parts?name=...&repeats=...`: store a part ZIP.
- `GET /mygrain/api/songs/<song-id>/parts/<part-id>`: retrieve a part ZIP.
- `POST /mygrain/api/songs/<song-id>/arrange`: atomically save names/repeats/order.
- `GET/POST /mygrain/api/songs/<song-id>/parts/<part-id>/render`: retrieve/store
  stereo PCM16 audio trimmed to exactly one saved pattern. Keyboard-aware writes
  add `keyboard=1`; metadata records `keyboardVersion: 1` so older silent
  keyboard renders are refreshed without discarding non-keyboard caches.
- `POST /mygrain/api/songs/<song-id>/parts/<part-id>/save`: commit an amended ZIP
  snapshot, retaining the previous archive and revision metadata.
- `POST /mygrain/api/songs/<song-id>/parts/<part-id>/delete`: remove the part
  from the active order while retaining recovery files and metadata.
- `POST /mygrain/api/songs/<song-id>/parts/<part-id>/colour?sha256=...`: save
  `{ "colour": "#rrggbb" }` (or `null` to clear) without changing audio/snapshots.

Render/save/delete/colour writes require the expected current snapshot `sha256` query
parameter. Conflicts return 409 rather than overwriting a newer part. Renders
are tied to snapshot hashes. New snapshots also have a server-computed
`contentSha256` covering settings, patterns, selected keys and sample bytes,
excluding only capture timestamps. Audio-changing amendments invalidate their
render; identical content retains the render and updates its archive hash.
Archives remain byte-for-byte integrity checked with their original `sha256`.
Previously saved parts without a content hash remain supported; an amendment
compares their original archive on the server. Save also accepts `name` and
`repeats` query parameters.

Each request requires the 256-bit `X-Mygrain-Song-Key` generated and remembered in
browser local storage (`mygrain-song-library-key-v1`) when available. **Back Up
Song Access** preserves that credential outside browser storage; **Open Song
Access** reconnects the same server library on another device. Only its hash is stored
in server song metadata; other browser libraries cannot list, fetch, or modify
those songs. Do not clear the browser's site data without preserving that key.
This beta uses a private transferable library credential, not an account/login system. There is
no public static route to the song folder and no external
CORS access added. Folder names are sanitized and suffixed to avoid collisions.

Saves use temporary files, fsync, and atomic replacement. Archives are
stored/uncompressed, have bounded sizes, and are checked for invalid paths,
duplicates, missing audio, and truncated WAV files before publication.

## Song WAV export and grain fades

**Export Song to WAV Folder** prompts for a filename and saves the complete
displayed arrangement to the existing rendered WAV repository (`/mygrain-wavs`).
The postfix is added automatically: `My-name.song.120.wav`. For mixed tempos it
lists the distinct saved tempos in order, e.g. `My-name.song.120-90.wav`.
Very long tempo lists use the first tempo followed by `-mixed` to keep filenames
within filesystem limits.
Existing repository rename/download/collision handling remains available.

Unarmed parts are prepared first. Export reuses the armed final mixes, preserves
part order/repeats/tempo and rounds cumulative boundaries just like song playback.
It writes stereo PCM24 without another real-time performance, changing live
settings, overwriting snapshots or normalizing the mix. PCM24 does not restore
precision already lost in the PCM16 cache. The WAV folder's existing 64 MB limit
is checked before arming; reduce repeats or export a shorter arrangement if needed.
Stop cancels building/uploading. Export is unavailable during song playback or
an unfinished amendment. Full-scale audio produces a level-check warning.

Audition recalls the editable live engine, not a cached WAV. Low-level browser
testing reproduced abrupt source cutoffs even below clipping. Grain envelopes
now finish within the actual source playback duration, including source tuning,
using one continuous attack/decay/sustain/release curve instead of a release
scheduled beyond the source end. The same fix applies to live audition and
isolated song rendering. Grain renders carry `grainVersion: 1`; re-arming refreshes
old granular caches once without changing samples/settings/keys. This addresses
the reproduced cutoff clicks, not all possible clipping or device overload.

## Beta limits

- Up to 64 parts per song and 128 MB per stored part. No whole-song decoded
  audio ceiling: source preparation is memory-weighted and playback renders
  spill to browser/server storage beyond the 96 MB decoded hot cache.
- Repeats are 1–64 repetitions of the **shared pattern length**, not bars.
- Ordered playback uses frozen final-output pattern renders, repeated for each
  part's count, including its captured random/LFO sound. Live sliders do not
  rewrite scheduled song audio. Recall/Amend still restores the original editable
  sounds and settings, not a flattened replacement patch. Part tempos are honored.
- Rendering uses a separate muted graph and isolated browser storage, sharing
  only the audio clock. AudioWorklet capture selects exact PCM frames without
  MediaRecorder codec padding, onset guessing, or sample-tail waiting.
- Keep the page foregrounded while preparing missing renders. Stop Song, Stop
  All, Panic, resets, or a suspended/replaced audio context cancel the
  remaining automatic order rather than unexpectedly resuming later parts.

## Historical rollback: version immediately before Song beta

The exact deployed originals are preserved in:

`/root/.openclaw/workspace/backups/mygrain-before-song-beta-20261013T131859Z/`

It contains `index.html`, `server.py`, `SHA256SUMS`, and `app-commit.txt`.
The original app commit is `b1024ea`, including the existing dated
`2026-10-13_pre_song_implementation/` snapshot. Neither snapshot was modified.

Only when Mark explicitly asks for the **pre-Song beta** version, restore these
originals, not the older separately named "Working with side menu" checkpoint.
An unqualified rollback now means the pre-locking MIX.4 checkpoint above:

```sh
checkpoint=/root/.openclaw/workspace/backups/mygrain-before-song-beta-20261013T131859Z
cp -p "$checkpoint/index.html" /root/.openclaw/workspace/sandboxGRANULAR/index.html
cp -p "$checkpoint/server.py" /root/.openclaw/workspace/fs7300-documenter/server.py
systemctl restart fs7300-documenter.service
```

Verify the restored hashes and both served routes. Reload already-open app tabs.
The added song files become dormant; retain saved song data and checkpoint
files. Do not delete or reset unrelated files or the old untracked backups.

## Verification

```sh
node --test tests/song-beta.test.js tests/song-beta-clock.test.js
node --test tests/song-beta-keyboard.test.js
node --test tests/song-beta-export.test.js
python3 -m unittest discover -s tests -p 'test_song_backend.py'
node tests/grain-fade-browser.js
SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node tests/song-beta-browser-smoke.js
SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node tests/song-beta-arm-benchmark.js
SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node tests/song-beta-keyboard-browser.js
SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node tests/song-beta-export-browser.js
```

Start `python3 tests/song-beta-test-server.py 18765` in a separate terminal before
the browser commands. It isolates both song and WAV storage in a temporary folder.
The browser command requires an isolated test backend (temporary `SONGS_ROOT`)
and intentionally refuses public URLs. It checks 24 audio bindings, complete
recall, shared cache, stale-audio clearing, cache immutability, order/completion,
stop cancellation, reload persistence, and 390px layout without page errors.
The boundary regression uses a 3-second source in a 0.4-second saved pattern,
records the actual scheduled song output, and compares samples on both sides
of the handoff. It remains sample-contiguous during a 650 ms main-thread stall.
Tests also cover server-render reuse, recall without arming, amend/save/cancel,
independent copies, deletion, reload persistence, and interrupted-recall cleanup.
Colour checks cover retrospective edits, clearing, reorder/amend/reload
persistence, stale/foreign/failed writes and keeping armed audio/edit drafts.
Mobile checks also cover the higher/protruding Jump and green Song navigation.
The benchmark prepares two 2-second constant-tone parts, checks renderer
concurrency, non-silent/gap-free capture, source deduplication and cleanup,
and reports cold/warm sequential/parallel and in-memory re-arm timings.
On the server's headless Chromium test, the warmed-engine two-part preparation
took 7.24s sequentially versus 4.58s concurrently (about 37% less time).
The complete UI warm re-arm took about 12–14ms with no network requests or new
decodes. These are fixture measurements, not guaranteed device/song timings;
no real iPhone hardware was benchmarked. Playback remains real-time and the
shared AudioContext is not claimed to distribute work across CPU cores.
The keyboard browser regression checks A/B polyphonic output, muted-layer
silence, source/configuration/key recall, non-Hold pressed-key capture, B mic,
amendments, legacy-cache refresh, reload reuse and source clearing. Late grains
keep their envelope events on a single guarded future timestamp, avoiding
browser-clamped overlapping gain curves that could delete a chord voice.
The cache-browser regression exercises twelve real renders with ten active
workers, preference reload, song renaming, timestamp-only amendments, one-part
changes, metadata-only reuse, server reuse after reload and mobile layout.
Run with `SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node
tests/song-beta-cache-browser.js` against the isolated test server.
Set `SONG_BETA_CACHE_WORKERS=2` for the same lower-load comparison. High-count
tests report long silent spans as experimental warnings; the 1–2-worker test
requires no silence longer than 50 ms in this fixture. A twelve-part, 0.4s-pattern
desktop stress run at ten workers produced two roughly 130–150ms silent spans;
the corresponding two-worker run had no spans longer than 34ms. This is not a
claim of device-independent performance, nor a speedup from using ten workers.
The reuse browser regression exercises reference-only storage, shared memory and
IndexedDB identity, independent repeats/order, shared renames and amendments,
playback from a specific occurrence, storage-backed playback, WAV export,
removal of the original placement, reuse of a remaining reference, reload,
source recall, and desktop/mobile layouts. Run with
`SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node
tests/song-beta-reuse-browser.js` against the isolated test server.
There are 118 controller/clock/capture/keyboard/export/storage/restore tests and 42 backend tests. Device/OS audio
interruptions are not eliminated by this scheduling change.

The song-selection regression creates a populated song followed by an empty
song, then uses the dropdown to switch between them on desktop and phone
layouts. It checks placeholder clearing, failed-load rollback, selected-song
reload persistence, library-key continuity and unchanged saved parts. Selection
handlers must capture the chosen ID before entering the busy renderer, which
rebuilds the dropdown and restores the currently loaded song's value. Run
`SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node
tests/song-beta-selection-browser.js` against the isolated test server.

The notes-layout regression verifies transport/status/parts ordering, help-text
containment, default-closed notes, plus/minus indicators, mouse and keyboard
toggling, redraw stability, and desktop/mobile overflow. Run
`node tests/song-beta-notes-browser.js` for a read-only live check, or set
`SONG_BETA_TEST_URL` to the isolated localhost route. Its sample part cards are
temporary browser-only fixtures; it never writes server song data.

Song recall requests the original exception from the shared settings restorer
instead of replacing it with an undiagnosable false return. The status line
includes the actual error message, while the debug console retains its stack.
If restoring fails, audio remains stopped, the prior persisted browser patch
is restored, and server snapshots are unchanged. Ordinary startup restoration
keeps its existing logged-error/false-return behavior. This does not establish
the cause of a device-specific failure: all seven existing source snapshots
restored and rendered in isolated Chromium checks, so a new detailed error is
needed if the reported failure recurs. The unit and browser smoke regressions
cover original-error propagation, missing state, persistence rollback and retry.

Settings restoration establishes the saved pattern length before dispatching
sequencer slider events, so restoring a longer part into a shorter live pattern
does not address missing steps. Stale hidden sliders beyond the saved pattern
length are skipped. Restore-generated toggle/tab events do not queue
deferred autosaves, and autosaves queued before a source change are discarded.
This prevents delayed UI callbacks from overwriting the prior browser patch
after a failed recall. These targeted guards do not change song formats, stored
audio or cache behavior, and do not establish the cause of the original reported
failure. Repeated live-pattern changes and next-frame failure recovery have
unit and isolated browser regression coverage.

### Writing loops and sequencer editor transport

Layer V's Loop Cut editor has a `Section Repeat` toggle. With the cut enabled,
it repeats the selected Start–End audio from its original Start position to the
existing loop end. A five-sixteenth section starting at zero in a sixteen-step
loop plays 5 + 5 + 5 + 1; the last repetition is truncated. Audio before Start
stays silent, and the original sample and overall loop length do not change.
Each repeated section has a short internal fade, including the truncated tail.
Turning repeat off returns to the ordinary cut; Full Loop / Reset clears both.
The repeat setting follows browser saves, patch ZIPs, New Part, Save Amendment,
Recall, live auditions and cached song playback. Older cuts default to repeat off.

The drum editor has Clap (`SAMPLES_CLAP`) and Cymbals (`SAMPLES_CRASH`) lanes,
using the existing local-mirror sample browser. Cymbals is intentionally not
restricted by crash filename, so WAV rides and open hats added to that folder will
appear after the regular mirror refresh. Both lanes have sample browsing and
random selection, independent steps and ratchets, pitch, level, decay and length,
plus Random Pattern and Clear. Random Drums/Random Samples includes both sources.
New lanes default to empty in older patches and parts so existing beats remain
unchanged. Their original samples travel with patch ZIPs and song snapshots;
saved patterns/settings and IndexedDB audio are restored on reload and Recall.
Both lanes feed the shared drum routing/effects and are included in drum MIDI.

Renders containing these features require `vocalRepeatVersion: 1` and/or
`drumLanesVersion: 1`; incompatible old renders are rebuilt rather than silently
losing repeat or new drums. Source snapshots and shared reused parts stay intact.
Feature regressions: `node --test tests/drum-extra-lanes.test.js
tests/vocal-loop-cut.test.js tests/song-beta.test.js`, backend unittest discovery,
and `SONG_BETA_TEST_URL=http://127.0.0.1:18766/mygrain/ node
tests/vocal-repeat-drums-browser.js` against the isolated song test server.

`Loop Song` is a stopped-playback toggle beside Play Song. When enabled, Play
Song repeats the full arrangement until Stop Song. Play Song From Here starts
at that occurrence, then wraps to the first part and continues in song order.
Each expanded part has `Loop Part`, which plays only that occurrence repeatedly;
press it again (Stop Part Loop) or use Stop Song to stop. An unarmed cache prompts
before preparation. These are temporary playback options, not changes to saved
parts, repeat counts or WAV exports. Reused parts still share their audio.

Loops use the existing audio clock and rolling storage scheduler, keep two
occurrences queued ahead, and release completed sources and timeline entries.
A single-part loop retains one decoded buffer; complete-song loops use the
existing bounded render cache. Stop, Panic and audio interruptions cancel queued
audio; a missed storage deadline stops with an error instead of drifting beats.

L and X sequencer editors have a green play arrow and red stop square immediately
above the note grid. Play stops an active cached song and the other Bastardloops,
then runs only that editor's sequence from step one without starting the shared
Bastardloops transport. Stop stops that sequence; Stop Bastardloops stops all
Bastardloop layers. Stop cancels a pending editor start during sample loading.
Existing Start Bastardloops controls and saved sequence formats are unchanged.

Regression commands:
`node --test tests/sequencer-editor-transport.test.js tests/song-beta-clock.test.js tests/song-beta.test.js`
and, against the isolated test server,
`SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node tests/song-beta-loop-browser.js`.

## Q custom arpeggiator and grid accents

Q state remains schema version one, with additive `performanceVersion: 6` and
`arpSteps` fields. `arpPattern: "custom"` reads 1–32 integer note-order pulses:
zero is a gap, and 1–8 select sorted chord notes, wrapping to the chord size.
An accent-only cell is `{kind: "accent", notes: [], accent: true}`; it adds gain
to voices crossing that cell without adding a chord, retriggering the arp, or
acting as a Rest. Audio gain is independent of capped MIDI velocity.

Part captures embed the full applied pattern and the existing Q sample bank.
Popup drafts and repository selections are excluded from Song controls. New
Q parts require freeze marker `qVersion: 6`. Arming inspects older Q sources
and rebuilds older accented freezes, while still permitting compatible
unaccented legacy audio. Source notes, effects and banks are not replaced.

`GET /mygrain/api/arps` reads a shared, no-store server library;
`POST /mygrain/api/arps` adds a named `{version: 1, steps, division, repeat}`
pattern. The repository is stored in
`/srv/sftp/mark_sftp/files/mygrain-arps/library.json`, independently of browser
storage. Saves use locked, atomic file replacement, strict validation, size
limits and same-origin checks. Duplicate names never overwrite shared presets.
Loading or changing the global library cannot alter patterns already embedded
in Songs. Tests redirect this store along with Songs to temporary directories.

Regression checks: `node --test tests/q-custom-arp.test.js`,
`python3 -m unittest discover -s tests -p 'test_arps.py'`, and against the isolated
test server, `SONG_BETA_TEST_URL=http://127.0.0.1:18765/mygrain/ node tests/q-custom-arp-browser.js`.

The existing broad Node suite has 54 failures in the unchanged pre-song
baseline (90 passing); after this feature the same 54 names
fail, with 114 passing including 24 new song tests. The unrelated customer-chat suite
also has the same two failing tests before and after the backend hooks. No
unrelated tests or app behavior were changed to address these baseline issues.

## K16: additive saved-song compatibility

Arm Cache upgrades portable (`freezeStateVersion: 1`) snapshots that provably
predate a registered optional audio lane. The centralized registry in
`song-beta-adapter.js` covers K, M+, and Q. Every slot belonging to a lane must
be absent, with no corresponding settings, controls, metadata, solo/source
references, or audio assets. Only then are explicitly empty audio slots and
disabled, empty settings added. The historical `q: null` placeholder is also
recognized as having no Q settings; an actual Q settings object is not.
Existing settings, capture timestamps, patterns,
audio manifests, and WAV bytes are preserved. A future optional lane must be
registered with its complete slot group, evidence rules, and muted defaults;
unknown or missing required slots are not blanket-ignored. Pre-portable snapshots
are not assigned an invented inventory.

Short lane names are recognized only in actual routing fields
(`keyboardSoundSource`, `performanceSourceLayerSolo`, and
`performanceSourceLayerSoloSnapshot`), not arbitrary metadata strings. A saved
A sample labelled `K` is not evidence of a K lane. Actual lane settings keys,
control IDs, metadata slots, and assets still prevent an absent-lane upgrade.

Partial inventories, declared audio without its asset, a declared lane even if
disabled, unknown slots, unlisted or missing WAVs, duplicate ZIP entries, bad ZIP
checksums, and mismatched WAV headers/dimensions remain errors. The phone's
current audio is never a fallback. Recall still clears every absent buffer
before applying the saved settings, so a device-local K recording cannot leak
into an older song.

`inspectPart()` returns the normalized snapshot plus an optional
`upgrade: { lanes, entries }`; `upgradePart(info)` builds a replacement ZIP using
the original non-manifest entry bytes. Arm inspects unknown shared sources even
if a saved render is already available. Compatibility saves are serialized,
once per shared source, before parallel render preparation. They request editing
through the existing Edit Song lease workflow and use the existing
`parts/<occurrence-id>/save?sha256=<exact-source-hash>` API with the current exact
song revision. No new backend endpoint, backend source change, or service restart
is required. No direct song-store edits are performed.

Before applying either a save or render-retention response, the controller checks
the operation generation, library, song identity, local revision, occurrence and
source hash. Save responses must also report exactly the next song/source
revision and the SHA-256 of the uploaded normalized archive; retained renders
must retain their original render hash and match the new source. Cancelled or
otherwise stale responses never replace newer song state or invalidate its
caches. If a save may already have committed for the current song, editing is
paused until Refresh Songs reconciles it with the server instead of replaying
the old response.

The normal save creates an immutable archive revision and retains the old
snapshot/render in history. It updates every shared occurrence, including when
the original placement was deleted, without changing order, names, repeats, or
colours. A compatible saved render is integrity-checked, then reattached
byte-for-byte through the existing render API with its original capability
flags and the upgraded source hash; this does not advance the song revision.
Only missing or genuinely incompatible renders require rendering. Completed
upgrades are recognized by their persisted inventory/defaults, so another Arm
or reload does not save them again. A failed later render upload leaves the
already-upgraded source intact and recoverable; retrying Arm need not migrate it
again.

Another editor's lock never grants write access and does not prevent harmless
playback: Arm uses the same normalized, muted defaults in memory and reports
the saved-song upgrade as pending. An outstanding amendment is also left
untouched. A later Arm after the amendment is finished or editing access becomes
available retries persistence. Revision conflicts, integrity errors, and other
save failures are not disguised as successful upgrades.
An existing token whose connection cannot be verified reports
`SONG_EDIT_UNVERIFIED`; compatibility arming treats it as pending/read-only,
without bypassing the lease or hiding changed-part/revision errors.

Focused checks (all backend storage uses temporary directories):

```sh
node --test tests/song-beta-compatibility.test.js tests/song-beta.test.js tests/song-beta-restore.test.js tests/song-beta-locks.test.js tests/song-beta-keyboard.test.js
python3 -m unittest discover -s tests -p 'test_song_*.py'
node --check song-beta-adapter.js
node --check song-beta.js
```

The visible build badges and startup cache marker are `v2026.10.16.K.16` /
`2026-10-16-bastardloop-k-16`; affected Song controller and adapter script URLs
use `20261016-song-compatibility-k16`.
