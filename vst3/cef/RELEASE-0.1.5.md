# CEF Downloads and protected clocks — completed 21 November 2026

Live build: `v2026.11.21.DOWNLOAD-CLOCK.1` at https://openclaw.blackcarburning.com/mygrain/
Installers: https://openclaw.blackcarburning.com/mygrain/cef-setup.html

## Delivered

- CEF instrument 0.1.5 downloads directly into OS Downloads without an external
  browser/Save dialog; completion/error notice; safe numbered duplicate names.
- WAV Browser and FTP use the common download path. Parts Bin Download WAV copies
  its existing immutable preview without rendering, recalling, storing or uploading.
- Top whole-loop and Drum Machine clock dividers: 1/2/3/4/6/8/12/16; both default
  ×1, never owned by randomisers; saved patches/history/plugin/Songs retain them.
  Dividers compose without changing base/DAW tempo. Native retained renders carry
  the expanded host beat count. Existing ×1 source/content/cache identities retained.
- Slower server Song captures remain protected from the ordinary eight-second idle
  sleeper by setting the direct worker busy. No resource budgets or pool changes.

## Verified boundaries

- Native Windows x64 + Apple Silicon macOS CEF: exact WAV downloads into OS
  Downloads, no Save dialog, duplicate safety; SDK validator 47/47 each, existing
  native audio/state/reload/editor-closed storage/Space/login/previews tests passed.
- Native CI source `31da9c940f04c38f41c6b4c28c7ca6a2a61c6858`: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/44924998221
- macOS universal Intel+arm64 plugin/helper/CEF framework inspected; signatures,
  extracted installer and installed validator passed on CI. Ad-hoc signed, not
  Developer-ID signed/notarized. Physical customer DAWs/driver alignment and Intel
  native execution are not claimed.
- Final packages refresh only SETUP/README/VERIFICATION/checksum text after CI;
  all native/runtime/installer/license bytes compare identical to CI output.
- Chromium + WebKit: controls/history/random protection/portable ZIP/reload and
  four exact WAV download routes; controls/Parts Bin fit 320/390/601/768/1440 px.
- 62 existing + 2 new backend tests pass. All 64 divider pairs and strict admission.
- Actual server Song PCM: 1/2/3/6-second loops, .25/.5/.75/1.5-second drum hit spacing;
  old source ZIP + ×1 audio byte-identical, no regeneration; phone warm PCM-only play.
- Ten source-loop rate paths tested across all eight values; real A-source PCM
  follows global ÷2 with two-second duration and .5-second hit spacing.
- Exact live HTTPS bytes for eight assets and current guest build badge. Both actual
  setup download buttons + independent HTTPS full-file hashes/attachment headers pass.
- All 34 pre-existing native archives byte-identical after publication.
- Final deployed HTML: 105 inline scripts syntax-checked. Service active; queue empty
  before restart. No existing Song/source/account files rewritten by verification.

## Install / reload

Close the DAW and replace the entire older CEF instrument with 0.1.5, then rescan.
Hosted features require a fresh app load (Store + reload app after saving work).
CEF FX 0.1.1 and external Bridge/FX packages were not rebuilt or replaced.

## Archives

- `mygrain-cef-windows-0.1.5.zip`: 191469697 bytes; SHA256 `5f4e502a15eb1ccd0c769ea2d0c427cb4726e99080b9757c8549985009aec05e`
- `mygrain-cef-macos-0.1.5.zip`: 267255640 bytes; SHA256 `bc573e97bbc52c5623de815764196a3eb5af02a72ad5e81bc90d54ce6ac28f60`

Private rollback/evidence: `output/mygrain-download-dividers-20261121/`, including exact before/ copies and before-publish/fs7300-documenter/server.py. Native work is committed on mygrain-cef-downloads-20261121; dirty live checkout task-only diffs are retained separately.
