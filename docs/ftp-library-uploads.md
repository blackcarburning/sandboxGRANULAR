# FTP library uploads (2026-11-04)

Build: v2026.11.04.FTP-LIBRARIES.1

RadioLab and VideoLab have Upload take to FTP beside Save. A stopped, audible
selected interval and recording name are required. Upload uses the current
selection and existing normalization state without modifying or saving the take.
Saved-sample rows also offer Upload to FTP.

Embedded and standalone FTP browsers provide Upload from MYGRAIN, with RadioLab,
VideoLab, Reels, Masters and WAV browser source libraries. Select files, choose a
destination folder (including navigation and folder creation), then Upload selected.
Saved files copy on the server, avoiding a phone download/re-upload. Originals
remain unchanged; existing destination names cause a conflict, never overwrite.

GET /mygrain/api/ftp/library?source=radio|video|reels|masters|wav exposes private
source IDs, filenames, sizes and versions, never filesystem paths. POST library-copy
accepts source, id, version and folder. The canonical server resolves the source
catalog under the authenticated account lock. Pinned account headers, CSRF checks,
regular-file/no-follow checks, source versions and exclusive atomic FTP publication
apply. A failed batch retains the remaining selection. Closing/cancelling or
changing/locking accounts aborts outstanding UI work.

No audio engine, Song snapshot or render-cache compatibility changes are involved:
these operations only copy existing audio, or encode the already-selected lab PCM.

Verification:
- tests/test_private_ftp.py: real isolated account libraries for all five sources;
  exact source/destination bytes, other-account refusal, stale versions, traversal,
  duplicates and unchanged originals, plus existing FTP isolation/security checks.
- tests/ftp-library-browser.cjs: Chromium/WebKit, embedded/standalone, all five
  source choices, destination navigation/creation, account-lock closure, responsive
  widths 320/390/844/1440.
- RadioLab/VideoLab browser current-take tests exercise both new upload APIs and
  selection bytes in Chromium/WebKit; RadioLab saved-row regression covers the
  additional action and phone layout.
- Existing VideoLab PCM and capture unit/browser tests retained.

Backup: output/mygrain-ftp-libraries-20261104T165114Z/
