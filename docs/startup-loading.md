# Initial-page loading

The HTML/account context always revalidate through no-store. Public account-independent assets use content ETags with `public, max-age=0, must-revalidate`: browsers retain bytes but check every visit, so same-URL edits remain visible. Do not apply this policy to account APIs, recordings, source libraries or saved parts. Static responses are handled in `fs7300-documenter/server.py`. Caddy supplies gzip/zstd; localhost timing without compression is not comparable to the deployed route.

The authenticated preload list in index.html fetches scripts and styles earlier without changing their parser execution order. Keep conditional mobile/desktop dependencies exclusive. Account CSS still gates reveal, but decorative logo decode and document-wide fonts do not; missing branding must not disable Start or login. The Start button remains disabled until the existing account/app DOM readiness handlers enable it.

Evidence and exact pre-edit backups: `../output/mygrain-startup-20261028/`. Test cold and warm loads on the same throttled connection, and verify guest/signed-in Chromium/WebKit startup with the logo blocked. Check live public assets return 304 with matching ETags while HTML and account-context remain no-store. No DSP or Song render changes are part of this optimisation.
