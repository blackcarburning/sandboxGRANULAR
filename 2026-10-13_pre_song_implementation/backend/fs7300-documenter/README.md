# FlashSystem 7300 Documenter

A static web application for documenting an IBM FlashSystem 7300 (`4657-924`) running IBM Storage Virtualize 9.1.x.

Start it with:

```bash
./serve.sh
```

Then open `http://127.0.0.1:8765/` in a browser. From the Capture tab you can either fetch directly from a FlashSystem management IP over SSH, or paste CLI output from the collection runbook.

Direct fetch uses Paramiko from the local OpenClaw server to run selected read-only `svcinfo` commands. The password is used for that single request and is not written into the generated report or JSON export.

## Reference Baseline

The command map is based on the IBM FlashSystem 7x00 CLI reference for 9.1.1, plus IBM Storage Virtualize 9.1.0.x release notes and FS7300 configuration limits checked on 2026-06-26.

The command and limit data lives in `data/reference.js` so it can be refreshed without touching the UI code.

## Capture Tips

- Prefer `svcinfo <command> -delim :` where the command supports it.
- Paste multiple command outputs into the Capture tab.
- Include the command line before each output, for example `svcinfo lssystem -delim :`.
- Export JSON as the raw parsed evidence bundle and Markdown/HTML for customer-facing documentation.

## Direct Fetch

- Enter the storage management IP or DNS name, SSH port, username, and password.
- Select the configuration areas to collect, or use Select All.
- Unsupported commands on a particular code level are shown as warnings while successful command output is still parsed.
- Passwords are cleared from the browser form after each fetch attempt.
