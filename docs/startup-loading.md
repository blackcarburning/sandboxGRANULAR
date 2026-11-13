# Initial-page loading

The HTML/account context always revalidate through no-store. Public account-independent assets use content ETags with `public, max-age=0, must-revalidate`: browsers retain bytes but check every visit, so same-URL edits remain visible. Do not apply this policy to account APIs, recordings, source libraries or saved parts. Static responses are handled in `fs7300-documenter/server.py`. Caddy supplies gzip/zstd; localhost timing without compression is not comparable to the deployed route.

The authenticated preload list in index.html fetches scripts and styles earlier without changing their parser execution order. Keep conditional mobile/desktop dependencies exclusive. Account CSS still gates reveal, but decorative logo decode and document-wide fonts do not; missing branding must not disable Start or login. The Start button remains disabled until the existing account/app DOM readiness handlers enable it.

Evidence and exact pre-edit backups: `../output/mygrain-startup-20261028/`. Test cold and warm loads on the same throttled connection, and verify guest/signed-in Chromium/WebKit startup with the logo blocked. Check live public assets return 304 with matching ETags while HTML and account-context remain no-store. No DSP or Song render changes are part of this optimisation.

## 2026-11-10: conservative loading-hint update

The late DAW project/remote/Bridge/FX scripts, Bridge/FX styles and Layer controls
are now included in the existing authenticated preload list, using the exact
URLs of their existing parser-blocking loaders. The account-context request also
gets an earlier preload with the same HTTP/render-deck guard as its existing
loader. It is still no-store, executes at its original position, and is fetched
only once per authenticated page navigation. The server-generated guest shell
still embeds its public anonymous context and does not download the editor.

No scripts became async/defer. The inline engine was deliberately **not** split
into a new file: all engine, rendering, persistence and account-check code stays
byte-for-byte unchanged. Only the download hints changed; no backend, public
allowlist, cache policy, DSP signature or stored data changes are required.

Evidence/backups: `../output/mygrain-startup-20261110T014110Z/`. The
`source-parity.json` check proves the remainder of the HTML is unchanged. Run
`tests/startup-benchmark.cjs` against the isolated gzip proxy for cold/repeat
measurements without request interception; use `tests/startup-readiness-browser.cjs`
separately for delayed account assets, missing branding, guest/authenticated
phone portrait/landscape and desktop startup in Chromium/WebKit, plus required
CSS failure/reload. Both accept a loopback-only `MYGRAIN_TEST_URL`, and the seeded
isolated admin password is a test fixture, not a production credential.

The deliberately failed-CSS test records stale asynchronous callbacks separately
from healthy navigation errors. Null-DOM callbacks after the recovery screen
replaces the editor, including WebKit's old-document Q shutdown callback, also
reproduce against the untouched baseline. Recovery/reload and subsequent Start
remain functional; these unrelated callbacks were not changed in this task.

Five-trial medians to the usable Start button with remembered-account Chromium,
gzip, 100 ms latency and 500,000 bytes/s were **3.874 → 3.527 s cold** and
**3.159 → 3.120 s repeat**. Treat the repeat result as effectively unchanged;
DOMContentLoaded was faster but is not the user-facing readiness metric. All
14 startup/recovery cases passed; physical-iPhone timing is unverified. The
published change requires no service restart.
