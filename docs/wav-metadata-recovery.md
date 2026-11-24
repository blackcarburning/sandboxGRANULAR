# WAV metadata identity and recovery

On 2026-11-23, owner WAV Browser refresh deleted notes after `st_dev` changed
from64513 to64512. Recent WAV/paired-ZIP inodes, sizes and nanosecond mtimes
were unchanged. Provenance invalidation called `delete_mygrain_repository_feedback`
and `begin_file_change`, then relearned signatures, obscuring the original drift.
Paired pattern sidecars still had the old device and their strict identity
comparison hid intact ZIPs. Earlier JSON-read hardening did not cover this path.

`Accounts.signatures_match` and `mygrain_wav_patterns.signatures_match` now
compare the retained inode/size/mtime fields, ignoring only volatile device IDs.
No stored schema, file bytes, source recipe, PCM or Song identity is migrated.
Real replacement still invalidates stale private attribution/notes/pairs; actual
patch downloads continue verifying SHA-256.

Each repository-feedback write now saves its exact preceding nonempty store
under account-local `.repository-feedback-history/<sha256>.json`, mode0600 in
a mode0700 directory. Reads never create history; archival failure stops the
write. These snapshots stay outside public assets, patch ZIPs and Song exports.

Recovery restored235 feedback records/178 nonempty comments from IBM Storage
Protect's 2026-11-23 00:14:22 copy, merging under a stopped app service so no
concurrent note writes could be lost. Current state, full paired ZIPs and
sidecars were preserved independently before recovery. All seven recent
editable ZIPs from DronePITCHLFO onward passed live exact SHA-256 downloads;
Chromium/WebKit verified restored notes and actual Restore Patch buttons.
The separate mastered WAV copy has no independent source sidecar by design.

Evidence: `output/mygrain-wav-recovery-20261123T164621Z/` in the workspace.
Regression suites: test_mygrain_accounts.py, test_wav_patterns.py,
test_repository_feedback_safety.py; live read-only check
`tests/wav-metadata-recovery-live.cjs` expects a private temporary session
from its caller, which must revoke it. Never place session values in evidence.
