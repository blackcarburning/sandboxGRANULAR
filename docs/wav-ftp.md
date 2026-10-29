# WAV browser → private FTP

Build `v2026.10.26.WAV-FTP.1` adds Upload to FTP alongside each repository WAV's download/share actions. It reads the existing authenticated WAV URL and posts the unmodified blob to `/mygrain/api/ftp/upload?path=<filename>` with the current account pin. Destination is the user's private FTP root, original filename retained; the backend rejects collisions without overwriting. Account lock/change aborts an in-progress transfer. Per-row status reports success, failure, or interruption; existing download/artwork/notes/import/export paths are unchanged.

Verification: inline script syntax, deployed HTTPS byte comparison, five private FTP backend tests, WebKit/Chromium browser flow using mocked endpoints (exact blob bytes, account/path headers, success/conflict/recovery, phone and desktop layouts). No production audio was uploaded by the checks.

Before-edit backup: `output/wav-ftp-20261026/index.before.html` in the workspace root.

## FTP-MOVE.1
Upload to FTP opens a fresh authenticated folder picker first. The WAV is fetched
only after Use this folder is confirmed; Cancel performs no upload. Nested folders
and private home are selectable. Account lock/change closes the picker and aborts
transfers. The transfer timeout starts after folder confirmation.
