# The Parts Bin

Build `v2026.11.15.PLUGIN-LIBRARY.1`. Jade plugin-session patch library, with one
shared HTML audio preview. A full-width desktop Jump shortcut follows Cooking
Pot; the app card sits at the bottom of ordinary sections, before the unchanged
effects group. The header/title is exactly “The Parts Bin”.

## Ownership and storage

- `parts-bin.js` owns the card/dialogs, preview URL lifetime and project-extension
  validation. No localStorage/IndexedDB holds the bin. Explicit universal snapshots are the account-private server exception described below.
- The card and Jump entry are visible in the signed-in browser as well as FX, CEF instrument and external Bridge. Browser staging is tab-local RAM, not a persistent local library; explicitly save a universal snapshot before closing/reloading. Connected plugins continue to use their own DAW bin, never a fake browser plugin session.
- Each `MygrainProjectSession` owns its own `partsBin`. Connecting/reconnecting
  starts empty until that plugin’s snapshot is recalled. Account lock/change and
  disconnect drop browser-held references and revoke preview URLs.
- `daw-project.js` captures the current patch independently of the bin. It sends
  new immutable part bodies once per codec cache; `daw-project-codec.js` adds
  `parts-bin.json`, `parts-bin/<id>.zip`, and `parts-bin/<id>.wav` to the plugin
  project ZIP. Unchanged part files participate in the existing delta protocol.
- The native envelope/version and 128 MiB project maximum are unchanged. The bin
  has a 32-part count cap but no independent 96 MiB size cap. Universal bins
  share the existing 512 MiB account quota. Main patch plus bin must still fit 128 MiB;
  failed transfers retain the previous completed native snapshot. Unsaved bin
  changes remain visible and can be retried using Store bin in plugin.
- Add captures a complete ordinary editable source ZIP and a full-pattern-cycle,
  one-warm-up-cycle preview WAV. It is not peak-normalized. Interrupted/account-
  changed/edited-during-capture operations do not commit a partial part.
- Load decodes original sounds/settings using the existing patch adapter and
  Undo transaction, stops playback, keeps all bin entries, and stores the loaded
  patch in the plugin. A Rendered Bridge switches to Live so it does not play the
  previous retained render. Delete affects only that part, not the active patch.
- Every add/delete/load requests an immediate completed plugin store. A normal
  **DAW project Save remains necessary** to persist it on disk. Saving while a
  store is underway uses the prior completed snapshot, as before.

## Compatibility

Project restore validates metadata, identities, CRCs, nested ordinary source
ZIPs, WAV lengths and byte limits before replacing the bin. It extracts the
extension before passing the main source ZIP through strict ordinary part
validation. A pre-feature project with no manifest restores an empty bin.
Ordinary source ZIPs, WAV Browser .zip restores, JSON patches, Song captures,
Song render preparation and rendering remain bin-free and use the unchanged
source format, DSP and cache revisions. `song-beta-adapter.js` excludes the new
card/dialog’s UI-only controls from its generic control journal. No new server
Song path or render signature is required for this plugin-only container.

## Verification

The test fixture must be isolated. Browser workflow checks use a fake native
transport but the actual codec worker, real WAV renders/media playback and actual
source decoding/recall, and fresh-document plugin snapshot restoration. Native
checks separately use the Windows VST3 Bridge host under Wine to execute real
project transfers and complete component-state save/unload/reload. Physical DAWs,
Windows/macOS CEF interaction and hardware audio are separate device boundaries.

Tests: `parts-bin-browser.cjs`, `parts-bin-codec.cjs`, and
`parts-bin-native.cjs` under tests. Evidence/rollback is in the timestamped
workspace output directory for this release.

## Universal account bins (updated 2026-11-23)

Universal means private to the signed-in account, available across browser, FX
and instrument instances; it does not publish to other users. Source ZIPs,
original sounds and previews stay editable and byte-exact. FX previews do not
sample external DAW input; external-input-only recipes can preview silently.

The prominent **Open bin: <name>** banner identifies the working universal bin,
with saved/unsaved status, and its server-list row is marked **OPEN NOW**.
Opening a bin leaves the currently loaded patch unchanged. Parts receive fresh
local codec identities; **Load** separately performs canonical Undo-able recall.
The opened-bin association is tab/session RAM, not a new native format: a fresh
DAW recall shows Project / working bin until a universal bin is opened again.

After Add or ZIP upload, **Save added patches to a universal bin?** offers an
existing destination, a new named bin, or **Not now**. **Save to universal bin…**
also works later: update the currently opened bin, append to another without
replacing its parts, or create a new bin. Updating retains its ID/name; a stale
revision is rejected rather than overwriting another instance's changes.

Each part has **Copy to bin…** and **Move to bin…**. Copies preserve the source;
moves save the destination before removing the working part. For parts belonging
to an opened universal bin, destination save and source removal are one server
transaction, checked against the source revision and exact source/preview bytes.
Moving its last part leaves a valid empty bin. Conflict, quota or validation
failure leaves both server bins and the working source intact. Switching bins or
starting **New working bin** offers Save first, Discard working changes or Cancel.

**Rename** updates the server name and active banner. **Delete** removes the
server bin; existing DAW/local copies remain. Deleted open bins can be saved as
new bins. Refresh/focus detects external names/deletion; content changes require
reopening, and optimistic saves prevent silent replacement. Names are unique
case-insensitively. Limits remain 16 bins / 512 MiB per account and 32 parts
per bin; there is no separate per-bin byte cap below that account quota. Plugin mutations still use acknowledged native Store; normal DAW Save
is required for disk persistence. Browser-only working changes disappear on reload.

Authenticated APIs under `/mygrain/api/plugin-library/bins` use existing
same-origin and pinned-account checks. A private identity-based `plugin-library`
directory under the account users root contains `bins.sqlite3` (0600, directory
0700). BLOB transactions avoid partial manifests/orphaned files; secure delete
and FULL auto-vacuum reclaim deleted contents. Source ZIPs are admitted through
the unchanged strict Song-part validator, with no nested bin support. Duplicate,
compressed, encrypted, unlisted, oversized and invalid preview assets are rejected.
No public download/listing endpoint, shared sample library write or browser
persistent library is added. Ordinary patches, JSON/ZIPs and Songs remain bin-free;
no DSP/source schema/cache signature migration is needed.

Tests: `test_plugin_library.py` (isolated authenticated HTTP/account boundaries),
`plugin-library-browser.cjs` + `plugin-library-wire.cjs` (Chromium/WebKit, real
current app, graph, renders, codec and private server; a diagnostic native wire,
not a native callback PCM test). Native Engine transport and FX tests independently
verify retained-loop offline output and live/offline fallback with zero callback
allocation. Physical Cubase Render in Place is not verified by those fixtures.

## WAV download — 21 November 2026

Each entry has Preview, Download WAV, Load and Delete. Download WAV copies the
existing immutable preview bytes; no re-render, patch recall, native store or
account upload occurs. It uses the common download path. CEF instrument 0.1.5
saves directly into OS Downloads; ordinary browsers use their download settings.
Four actions wrap safely; phone actions use a two-column grid.

## Browser upload / Cubase hand-off (2026-11-23)

Jump → The Parts Bin is now exposed without a plugin connection. Use **Upload
patch ZIPs** (multiple files) or drop complete MYGRAIN editable ZIP exports in
the drop area. Original source ZIP bytes are retained exactly. Plain JSON recipes
can be loaded with the normal patch importer and added using **Add current patch**;
Song/project/bin containers and arbitrary ZIPs are not admitted as source parts.

Uploads validate through `mygrainSongBetaAdapter.inspectPart/decode`, then render
a full-cycle 24-bit stereo preview after a warm-up cycle using the existing
isolated Song clock/current-engine render path. Each upload uses its saved BPM,
pattern length and cycle multiplier, not the working editor settings. The live
patch, effects, original PCM and playback state are not recalled or replaced.
The 32-part count cap remains; patches and previews share the 512 MiB account
storage quota, with 128 KiB reserved for archive/manifest overhead. A multi-file batch commits only
after every file succeeds. Account, plugin-context or generation changes abort
stale work. No Song/backend/DSP/schema or native package change is required.

**Save to universal bin…** explicitly saves or appends the working bin using
the private account API. It does not make patches public to other users.
Browser staging has no native Store action and disappears on reload/account lock.
Opening a universal copy into the browser does not load its parts or overwrite
the server original; Load separately uses canonical Undo-able editor recall.
With a plugin connected, additions/uploads still store through the existing
acknowledged native snapshot and require normal DAW Save for disk persistence.

Cubase workflow: save a browser bin universally; in the CEF plugin signed into
the same account, Refresh universal bins → Open a copy → Load a part → save
the Cubase project. The original bin stays available for other projects.

Regression: `tests/parts-bin-upload-browser.cjs` (real source ZIPs, real isolated
preview rendering, private server API, diagnostic project transport + real codec).
Physical Cubase/OS file drag interaction is not established by that browser test.

Preview generation exposes a transient `mygrainPartsBin.rendering` audio-idle
hold. Only bounded preview decode/render work holds the context awake, with
`finally` cleanup on success, rejection and abort. Idle sleep resumes normally
afterwards; universal dialogs/network waits alone do not hold audio awake.

### Mutable-bin verification

`test_plugin_library.py` checks replace/append, stale revisions, empty bins,
transactional exact-byte moves, concurrent appends, quotas and account isolation.
`parts-bin-workflow-browser.cjs` checks real Chromium/WebKit dialogs, source ZIP
uploads and previews, named opened bins, save prompts, cancellation, copy/move,
conflicts, narrow/wide layout and account-lock cleanup. Its diagnostic native
transport uses the actual project codec; it is not a physical Cubase test.


## Bin size policy — 24 November 2026

The former 96 MiB restriction is removed from Add/upload, universal open/save,
project extension restore and the native codec. Universal archives remain bounded
by the existing 512 MiB account storage quota (including container overhead);
account-wide aggregate quotas and transactional checks still apply. No stored
archive is rewritten, no format changes, and unchanged parts still use deltas.

Installed CEF/FX/Bridge binaries independently enforce 128 MiB for the complete
project ZIP: current patch audio plus bin sources, previews and metadata. This is
a compiled transfer/state validation boundary, not an independent bin quota.
Keep it unless making a tested native release. Codec rejection preserves the
previous completed native snapshot and the in-memory working bin, explains the
combined boundary and directs the user to universal storage. Add/upload still
offer universal save when native Store fails; never claim DAW persistence then.
Large universal bins can be opened and edited without being embedded in the DAW;
use a smaller working bin to resume native Store. Reload only after saving any
working changes universally or completing a native Store and normal DAW Save.

Size regressions: `tests/test_parts_bin_size.py` uploads and downloads real
100/140 MiB archives with account/stale-write/body-admission checks.
`tests/parts-bin-size-codec.cjs` checks legacy byte identity, >96 MiB snapshots,
delta reuse and rejected-candidate baseline retention.
`tests/parts-bin-size-browser.cjs` uses real UI/codec and a diagnostic native
transport for 100 MiB Store/fresh-document recall and >128 MiB failure retention.
Chromium also checks that upload still offers universal save after native failure;
WebKit file-chooser automation did not settle in that large diagnostic-wire
fixture, so that interaction is not claimed for WebKit.
`tests/parts-bin-size-native.cpp` exercises the actual native ProjectStore header
against the browser-produced project, including corrupt/oversized replacement.
These are not physical CEF/Cubase host or hardware audio checks.

Run size tests with a dedicated `MYGRAIN_TEST_ROOT` under `/tmp`, an evidence
`MYGRAIN_TEST_OUTPUT`, and the test-only seed passwords used by existing library
fixtures. Start `tests/parts-bin-size-server.py 19357`, then the HTTP size test,
codec test and browser test in that order. The fixture server is loopback-only;
its extra binary fixture GET is never part of production routes. Stop it after
testing. Large project transfers use browser download/files plus HTTP binary
fetch, never JSON arrays or request-interception postData serialization.
