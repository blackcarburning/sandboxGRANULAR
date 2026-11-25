# Scratchpad · SCRATCH.1

The first two Jump actions are **Scratchpad** (capture) and **Scratch Browser**
(browse). There is no card. The ruled-paper browser has a notebook icon and Done.
It is available in ordinary browser and hosted CEF plugin modes; no native binary
update is needed. Existing WAV Repository, Loop Store and Parts Bin are unchanged.

## Frozen, editable ideas

Capture asks for a name, honors the existing Export Bars / shorter-pattern choice,
then uses `renderPatternWithOptionalSnapshot` with `includeSnapshot:true`.
Canonical `mygrainSongBetaAdapter.capture()` freezes the editable source ZIP and
original sounds before the ordinary WAV render. Both assets must succeed before
one atomic upload is committed. Cancel/account change never uploads a half idea.
The browser previews the original WAV; Load patch verifies SHA-256 and byte count
then uses the ordinary app-owned import/progress/history path. Undo/Redo retains
the existing patch behavior. No browser folder or navigation state enters patches.
No DSP, Song render compatibility or source-format version is changed.

Each row has Preview, Load patch, Rename, Move and Delete. Folder creation, Unfiled,
All ideas, search and pagination are separate from patch state. Names are text,
not HTML or filesystem paths. Rename and Move update metadata only; WAV and source
ZIP bytes/hashes remain exact. Delete requires confirmation plus the current
revision; private recovery retains both assets while normal APIs stop serving them.

## Private, unbounded library

`backend/mygrain_scratchpad.py` is dispatched under the authenticated
`/api/plugin-library/scratchpad` prefix, but uses its own account-private SQLite
store in `<users-root>/<account-id>/scratchpad/ideas.sqlite3` (directory0700,
DB0600). There is **no item count, folder count or aggregate byte quota**. Existing
Parts Bin and Loop Store quotas are not changed. Normal safe per-transfer limits
remain:128MiB ordinary editable source ZIP and256MiB PCM WAV. Pagination limits
one response, never the library size. Physical available disk still applies.

Every request is identity-pinned by the account fetch wrapper and server session.
Mutations retain same-origin protection. Foreign IDs are404; storage is outside
static roots. Lists/assets are private/no-store. Both assets are validated and
stored transactionally; metadata writes/deletes use revision compare-and-swap.
Account lock/change aborts requests, stops/revokes previews and clears names,
folder options and rows. No account-independent browser cache is written.

CEF-safe HTML dialogs replace native prompt/confirm. Preview fetches authenticated
bytes into a Blob URL, as the browser cannot attach the identity header to a native
`audio src` request. The URL is revoked on stop/close/account change.

## Verification

Use the disposable `tests/source-grid-test-server.py` account store only.
`tests/test_scratchpad.py` covers real HTTP pairing/integrity, private ownership,
CSRF, malformed uploads, folders, paging beyond32 ideas/16 folders, compare-and-swap
and recoverable deletion. `tests/scratchpad-browser.cjs` exercises Chromium/WebKit
render, audible HTML audio preview, folder actions, editable recall/Undo/Redo,
reload persistence, phone/desktop layouts and stale response clearing in CEF query
mode. Query-mode UI checks do not establish a physical Windows/macOS host test.
