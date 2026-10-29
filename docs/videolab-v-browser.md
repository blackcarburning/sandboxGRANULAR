# VideoLab → V browser import — V-BROWSER.1

V's Use VIDEOLAB / SAMPLES_VIDEOLAB Browse action opens the private sample
dialog directly, selects V, and does not navigate to the capture card. A sample's
Load action downloads its saved audio, decodes it and applies it through the
existing V buffer/metadata/persistence path. It does not start playback.

Startup bookmarks formerly held Controller.busy while a cold-open V browser
request used run(), which silently returned when busy. Bookmark loading is now
independent of the browser and does not delay desktop navigation. Explicit
openBrowser calls reject locked/busy state with an actionable message.

Progress / failures:
- V has an inline opening/error status, alongside global app status.
- Lazy VideoLab controls show loading, load errors and Retry; dynamic script
  requests have a 20-second timeout instead of hanging without a result.
- Browser listing shows loading/count/errors; audio import shows download,
  decode and apply/save stages, with elapsed-time updates every five seconds.
- API requests abort at 45 seconds with retry guidance; V decode rejects after
  30 seconds before any V mutation. Existing account/context/browser-close
  guards remain authoritative. Close cancels pending fetches.

Tests: tests/videolab-frontend.test.js (7) and
 tests/videolab-browser.test.js (4) pass. The live-app test
 tests/videolab-v-import-browser.cjs uses isolated account/API fixtures, blocks
 bookmark completion, opens V's browser cold, exercises a 503 audio error and
 retry, verifies the loaded PCM duration/metadata, and closes/reopens for V.
 Native decode resampling may differ by one output frame; compare duration
 and output-rate tolerance, not the encoded input frame count.

Touched assets: index.html, demand-ui.js, videolab.js. Task backups:
 backups/videolab-browser-20261026. No production sample/account API writes.

Live app checks passed in desktop (1440×1000) and phone-sized touch (390×844)
WebKit/Chromium. Chromium additionally verifies visible download progress while
its audio response is deliberately held and checks non-silent decoded PCM.
All changed live asset responses matched local bytes. Physical iPhone remains
unverified; these checks do not exercise external YouTube retrieval services.
