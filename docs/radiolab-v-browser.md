# RadioLab browser → Loop V

Build `v2026.10.27.RADIO-V.1` fixes the cold V → Use RADIOLAB path:

- The entrypoint binds the V button immediately, demand-loads RadioLab, and opens its sample browser directly with V selected. Do not bind the button only in the lazy module or scroll to the RadioLab card.
- Fetching the station catalogue is independent of browser actions; an unavailable catalogue must not silently block private saved recordings. Other active RadioLab operations still report a visible busy error.
- Download/decode/load stages and elapsed time appear inside the sample browser. Requests and V decoding have 30-second deadlines, failures preserve the previous V buffer, and retry remains available.
- Keep the RadioLab script URL identical in `demand-ui.js` and the entrypoint to avoid duplicate execution. Bump the demand loader URL and both visible build badges.

Regression: `node tests/radiolab-v-import-browser.cjs`, then repeat with `MYGRAIN_NOTE_DESKTOP=1`. Covers WebKit/Chromium, held station startup, 503/retry, and real decoded non-silent PCM/source identity in V without autoplay. Private API is fixture-only; real user recordings are untouched. Physical iPhone remains unverified.
