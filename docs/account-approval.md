# Owner-approved accounts

Released 2026-10-24. Existing accounts are grandfathered active. New registration requires email, returns HTTP 202 without a session, and stores a pending account. Login, session issuance, existing session validation and user/share lookups require active status. Pending/declined users cannot access protected account storage. No public activation endpoint exists.

## Owner workflow

`mygrain_agent` monitors the durable outbox every minute, with a read-only headless trigger skipping model work when idle. It sends to Mark's existing private Telegram chat (8645802908); normal Telegram routing remains with main. Each notification has Approve and Decline buttons plus username, unverified email, IP and approximate city/region/country if available. The `mygrain-approvals` local plugin claims those callback namespaces before model dispatch, requires trusted Telegram private chat and sender 8645802908 plus sender authorization, and invokes the same local worker. Main-agent forwarding remains a fallback for verified callbacks only. Request-specific random capabilities and owner ID are checked again by the local worker. Decisions are atomic, audited and idempotent; contradictory later decisions are rejected.

### Button routing repair — 2026-10-27

The original explicit callback action wrapper added 12 bytes to 59-byte approval callbacks, exceeding Telegram's 64-byte limit. OpenClaw downgraded them to plain bullet labels. Typing `Approve` then entered main's busy Codex thread and could fail with “claimed by active work”. Notifications now use flat presentation `value` fields (59/56 bytes), and registered deterministic handlers avoid main's thread entirely. A successful decision replaces the notice with a receipt and removes its buttons, reporting email sent versus queued for retry. Wrong sender/chat, groups and malformed callbacks never invoke the worker. No public approval endpoint or new bot polling loop is added.

Plugin: `plugins/mygrain-approvals/` (linked/enabled in Gateway, onStartup). Tests: `node --test plugins/mygrain-approvals/index.test.mjs`; Python approval regressions include callback length and safe notice requeue. `--renotify-pending` requeues only pending owner notices; it never changes account status or queues approval mail. Use it with `--poll` after repairing controls to replace old unclickable notices.

Approval activates the account and queues a TLS-authenticated Office365 email with the login URL and username, never a password. The worker attempts delivery immediately after a decision and retries failures durably. Declining never activates the account or sends an approval email. Email addresses are collected but not verified by this feature.

## Operations

- Worker: `python3 /root/.openclaw/workspace/scripts/mygrain_account_approvals.py --check`, `--list`, or `--poll`.
- Automation: `cd170f48-3cd3-4371-a5f3-b60d1521102f`, agent `mygrain_agent`, interval 60 seconds. Failure alerts route to owner Telegram after two automation errors.
- Mail configuration: existing private `/etc/openclaw/telegram-report-mail.env`; smtp.office365.com only. Never print this file or credentials.
- Account DB: `fs7300-documenter/data/mygrain-accounts/accounts.sqlite3`. Additive users.approval_status plus registration_requests, registration_outbox and registration_audit tables. Current accounts and session tokens are preserved.
- Worker uses a non-overlapping file lock and an outbox unique per request/event. Failed delivery stores exception class only, with bounded exponential backoff. Crash-after-send-before-ack can redeliver (at-least-once); approval email has a stable Message-ID.
- Request IP trusts the rightmost proxy-appended X-Forwarded-For only from loopback Caddy. Other peers cannot override their address via headers. Geo lookup sends only the IP to ipwho.is over HTTPS; lookup failure never blocks review. IP/location never determines approval.

## Backups and rollback

Pre-change code, configuration and consistent account DB snapshot: `/root/.openclaw/rollback/mygrain-account-approval-20261024T124536Z`. Release manifest and test evidence are saved alongside. The agent entry was created before the configuration snapshot; this is not a pre-agent config snapshot.

**Do not restore the old account backend against the migrated database:** it lacks approval checks and old INSERT statements are incompatible. Do not restore the old DB over current accounts, songs/shares/session changes or pending requests. An emergency rollback must retain the approval-aware backend/schema or first close registration and protect pending/declined accounts. The supplied `rollback_ui.py` restores the old UI only and disables registration in a guarded copy of the old host; it retains approval-aware account checks and the delivery worker. Existing approved logins remain available. It never rewinds user data, agent configuration or queued decisions.

Verification: 9 focused approval tests (including mail queue status), 28 existing-account regressions, registration/pending/approve/login workflows in desktop and phone-sized Chromium/WebKit. SMTP TLS/authentication and live agent execution verified. Public index and account JS match deployed bytes. No real applicant email or owner approval click was simulated in production.
