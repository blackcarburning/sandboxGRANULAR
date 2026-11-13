# The Parts Bin

Build `v2026.11.12.PARTSBIN.1`. Jade plugin-session patch library, with one
shared HTML audio preview. A full-width desktop Jump shortcut follows Cooking
Pot; the app card sits at the bottom of ordinary sections, before the unchanged
effects group. The header/title is exactly “The Parts Bin”.

## Ownership and storage

- `parts-bin.js` owns the card/dialogs, preview URL lifetime and project-extension
  validation. No localStorage/IndexedDB or account/server library holds the bin.
- Each `MygrainProjectSession` owns its own `partsBin`. Connecting/reconnecting
  starts empty until that plugin’s snapshot is recalled. Account lock/change and
  disconnect drop browser-held references and revoke preview URLs.
- `daw-project.js` captures the current patch independently of the bin. It sends
  new immutable part bodies once per codec cache; `daw-project-codec.js` adds
  `parts-bin.json`, `parts-bin/<id>.zip`, and `parts-bin/<id>.wav` to the plugin
  project ZIP. Unchanged part files participate in the existing delta protocol.
- The native envelope/version and 128 MiB project maximum are unchanged. The bin
  has a visible 32-part / 96 MiB cap. Main patch plus bin must still fit 128 MiB;
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
