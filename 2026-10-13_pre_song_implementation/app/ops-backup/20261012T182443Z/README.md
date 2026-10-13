MYGRAIN live project support backup

Created: 2026-10-12T18:24:43Z
Rollback tag: `rollback-20261012T182443Z-live-mygrain`
App commit at snapshot time: `2b8a5f5`

This snapshot backs up the live support code and runtime config that sit
outside the `sandboxGRANULAR` app repo but are used by the public `/mygrain/`
deployment.

Included source copies:

- `fs7300-documenter/server.py`
- `fs7300-documenter/serve.sh`
- `scripts/sync_mygrain_source_mirrors.sh`
- `scripts/mygrain_vst3_host.py`
- `scripts/setup_mygrain_vst3_host.sh`
- `cron/openclaw-mygrain-source-sync`
- `systemd/fs7300-documenter.service`
- `caddy/mygrain-routes.conf`

Related in-repo rollback artifact:

- `backups/index-rollback-20261012T182443Z-2b8a5f5.html`

Related project-state artifacts intentionally backed up in Git:

- current patch ZIPs in `patches/`
