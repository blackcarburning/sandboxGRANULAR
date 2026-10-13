## 2026-10-13 pre_song_implementation

Created: 2026-10-13T12:40:11Z

App repo commit at snapshot time:

- `ca4d0919d631c8198a628225b6641c673069238a`

Contents:

- `app/` is a copy of the current `sandboxGRANULAR` repo tree, excluding `.git/`, the live `backups/` folder, and this snapshot folder itself.
- `backend/` contains the current MYGRAIN deployment support files copied from the live workspace and system config.

Live backend sources copied into `backend/`:

- `/root/.openclaw/workspace/fs7300-documenter/`
- `/root/.openclaw/workspace/scripts/mygrain_vst3_host.py`
- `/root/.openclaw/workspace/scripts/setup_mygrain_vst3_host.sh`
- `/root/.openclaw/workspace/scripts/sync_mygrain_source_mirrors.sh`
- `/root/.openclaw/workspace/docs/mygrain-vst3-host.md`
- `/etc/cron.d/openclaw-mygrain-source-sync`
- `/etc/systemd/system/fs7300-documenter.service`
- the current MYGRAIN route block extracted from `/etc/caddy/Caddyfile`

Intentional Git exclusions:

- `sandboxGRANULAR/backups/` was left out of this dated Git snapshot to avoid duplicating the large historical backup pile inside the repo again.
- sensitive or unrelated backend files were not copied into Git, including `fs7300-documenter/data/auth.json` and `fs7300-documenter/data/customer_chat.json`.

Coverage note:

- the separate Spectrum Protect backup for this request is intended to cover the whole live area, including the large local backup/history tree that is not duplicated inside this Git snapshot.
