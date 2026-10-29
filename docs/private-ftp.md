# Account-private FTP browser area

Build: v2026.10.26.PRIVATE-FTP.1.

- Browser URL: `https://openclaw.blackcarburning.com/mygrain/ftp.html`.
- This is an HTTPS file-transfer browser, not a newly exposed FTP/SFTP protocol daemon. Existing `/ftp/` and SFTP TCP 2222 are unchanged.
- Uses the existing MYGRAIN login/session/password and active-account approval checks. No duplicate passwords or password synchronization.
- Root: `/srv/mygrain-ftp/<normalized-username>/`, outside the legacy shared SFTP/web file tree. Both parent and user homes start mode 0700.
- All active accounts are provisioned on backend startup; newly approved accounts are provisioned lazily on first access. Admin is confined to `/admin/` in this API, with no all-users override.
- Module: `backend/mygrain_ftp.py`; routes `/mygrain/api/ftp/{list,audio,file,audio-file,upload,mkdir,move,delete}`. Existing same-origin mutation checks, session checks and username pinning apply to every request.
- Directory-descriptor walks reject symlinks; filenames reject hidden names, traversal, controls and backslashes. Moves/renames never replace an existing item. Uploads publish atomically without overwrite, up to 1 GiB, reserving 1 GiB free storage.
- Delete moves the item to its own home's hidden `.trash/` using a random prefix, retaining recoverable contents. Recovery is an operator action; the browser cannot access hidden storage.
- New uploads and folder changes appear immediately; the private loop source does not use stale shared source caches.
- WAV / AIF / AIFF imports use source `user_ftp`. Build from folder recursively considers up to 256 audio files as the source pool; the existing rhythmic generation algorithm selects chops from that pool (not a concatenation of every file). Individual loop source files are limited to 64 MiB. Whole-file loads use MYGRAIN's existing 180-second limit. AIFF conversion uses FFmpeg's explicit AIFF demuxer and pipe-only protocol, with bounded output/time.
- `private-ftp.js` provides the in-app file card and standalone login/upload page; `window.mygrainFtpAdapter` in index uses existing A/B/C/V loaders and shared transport restart. Original source files stay unchanged; V Re-cut reuses the stored private source paths. Saved patch/song metadata schemas are unchanged.
- Backend served by `fs7300-documenter.service`. Static assets are served directly from `sandboxGRANULAR`; restart backend after Python changes, not CSS/JS-only changes.
- API tests: `python3 -m unittest discover -s sandboxGRANULAR/tests -p test_private_ftp.py -v`.
- Browser tests: start the isolated `tests/song-beta-test-server.py` on 18843 with `MYGRAIN_TEST_ADMIN_PASSWORD=ftp-fixture-password`, then `node sandboxGRANULAR/tests/private-ftp-browser.cjs`. All fixtures live beneath `/tmp`; do not create test users/files in production.
- Deployment backup and evidence: `output/mygrain-private-ftp-20261026/`.

## Simplified in-app card — FTP-TREE.1

On app load the authenticated directory is fetched automatically (no-store).
The embedded card uses an expandable, drawn directory tree with one selected
audio file, browser preview, and direct whole-file Import to A/B/C/V buttons.
Refresh clears the selection and releases preview audio/blob URLs; account
lock/change and page exit also release the preview. Preview uses the existing
bounded audio-file endpoint, including AIFF conversion.
The upload destination follows the last clicked directory (shown above the
tree). Upload files/New folder and the standalone upload-site link remain.
The full HTTPS URL and same-MYGRAIN-credentials explanation are visible; the
standalone site's full file-management controls and private server isolation
are unchanged. Regression: tests/private-ftp-tree-browser.cjs uses intercepted
fixture listings/audio and actual A/B/C/V decoding, with no production writes.

## FTP-MOVE.1
Both embedded and standalone browsers support dragging files onto folders or home.
Phone users drag the ↕ handle (touch-action:none); ordinary file rows still scroll.
Move… is an accessible folder-picker alternative on each file. Moves use the existing
version-pinned no-overwrite API and refresh listings/preview afterwards. Account and
UI epoch are pinned to each file control. No backend, audio or saved-data schema
changes. Backup: output/mygrain-ftp-move-20261026/.
Tests: ftp-move-browser.cjs and wav-ftp-browser.cjs (fixture API interception, no
production writes); phone pointer simulation is not physical iPhone verification.

## FTP-TRASH.1
The first authenticated directory listing creates the user's private 0700 `.trash`
directory (not at account provisioning). Both in-app and standalone browsers offer
Delete on files/folders, confirmation, and an Open Trash button. Removal uses the
existing no-replace move under the per-user lock; original path and deletion time
are saved as private metadata. Trash remains excluded from ordinary listings,
folder pickers, uploads, loop imports, and source audio enumeration.
Authenticated `GET /api/ftp/trash` lists only the active user's deleted entries;
`POST /api/ftp/restore` requires entry ID and current version. Restore never
overwrites, uses original location, and falls back to Home only if the original
parent no longer exists. Prior hidden-recovery entries remain restorable to Home.
No permanent-delete/empty-trash operation is provided.
Standalone file-to-folder mouse drag, phone pointer handles, and external file
drops into a folder are tested alongside embedded behavior. Standalone tests use
the session user without relying on any app-global account object.
Evidence/backup: output/mygrain-ftp-trash-20261026/.
Tests: test_private_ftp.py, ftp-trash-browser.cjs, ftp-move-browser.cjs.

## FTP-UNIFIED.1
The embedded card and standalone site now share the same directory-list renderer
and file-management controls (no separate embedded tree). Folder names are native
buttons: click/tap to open; Open remains available. Embedded audio names select
and preview a file, while checkboxes support multi-file loop builds. Direct
Import to A/B/C/V, whole-file loading, selected/folder loop builds, upload,
rename/move, download, drag handles, Delete and Trash/Restore remain available.
No backend, audio engine, storage keys or patch/song schema changes.
Backup: output/mygrain-ftp-unified-20261026/.
Checks: ftp-unified-browser.cjs, ftp-move-browser.cjs, ftp-trash-browser.cjs and
private-ftp-tree-browser.cjs (updated to cover shared-list navigation and actual
audio preview/A/B/C/V imports). Browser fixtures never write production files.

## FTP-COMPACT.1 — phone layout
Phone portrait/landscape (up to 900 CSS px) uses 32px compact controls, tighter
file rows/toolbars, four direct-import buttons on one row, and hides repeated
explanatory copy. Embedded audio preview uses a small Preview/Stop button linked
to the existing audio element; desktop retains native audio controls. Account
clear, refresh and page exit reset/release that same preview. No API, storage,
import or export schema changes. Both embedded and standalone file layouts tested
in Chromium/WebKit at 375/390/430/844/1440 widths, including actual preview play/
pause and A/B/C/V imports with intercepted fixtures (no production writes).
Regression: tests/ftp-compact-browser.cjs. Original unified test currently has a
pre-existing stale Parent folder label (actual control is ↑ Up).
Backup: output/mygrain-ftp-compact-20261026/ (pre-edit deployed files).
Live cache marker: 20261026-ftp-compact-1. Physical iPhone testing unverified.
