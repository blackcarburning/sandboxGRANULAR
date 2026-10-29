# VideoLab public Instagram Reels — 2026-10-28

Build: `v2026.10.28.INSTAGRAM.1`; supported host: https://openclaw.blackcarburning.com/mygrain/ .

VideoLab keeps YouTube and adds a Capture source selector for Instagram public
Reel soundtracks. Pasted/bookmarked URLs auto-select their provider. Only direct
HTTPS `/reel/<shortcode>/` or `/reels/<shortcode>/` URLs are accepted; share query
parameters are removed. Profiles, stories, post collections and arbitrary hosts
are not accepted. Both providers share the existing start/duration (max 180 s),
trim, audition, normalise, save and sample-loading workflow. Audio is the mixed
soundtrack, not isolated stems or the full original song. No DSP or Song engine
changes: saved samples remain ordinary existing PCM WAVs.

The anonymous yt-dlp worker permits only explicit Instagram metadata hosts and
subdomains of cdninstagram.com/fbcdn.net in addition to the existing YouTube
hosts. Public-address DNS pinning, HTTPS redirect validation, resource limits,
private temporary jobs, account/session guards and cancellation remain intact.
No account/password/cookie import or login retry is implemented. Login redirects,
access/rate restrictions, unavailable media and Reels with no audio have clear
errors. Failed capture retains the existing take. Instagram format selection
prefers direct audio where present, otherwise one directly downloaded MP4 is
decoded locally through GStreamer; video-only formats are never treated as audio.
If anonymous metadata omits full duration, `sourceDuration` is null rather than
misrepresenting the requested excerpt as the complete Reel.

Verification:
- 80 Python backend/worker tests (system Python plus installed VideoLab runtime
  site-packages in PYTHONPATH; no dependency installation).
- 12 Chromium frontend/browser tests; 5 WebKit browser tests. Existing workflow,
  320/390 portrait and 844 landscape, Reel bookmarks/capture, source switching,
  and login-error preservation.
- Full deployed entrypoint with isolated account/capture APIs and live HTTPS
  JS/CSS: Chromium and WebKit at 390x844 and 1440x1000. Capture/error recovery,
  visible source controls, no page errors or horizontal overflow.
- Live videolab.js and demand-ui.js HTTP 200, exact local byte/hash match.
  The unauthenticated `/mygrain/` response is deliberately a reduced login shell,
  not the full editor; do not mistake that for a deployment mismatch.
- A real public Reel (`CDUMkliABpa`) passed the complete backend supervisor and
  unprivileged worker using isolated job/account storage: 2 s, mono 44.1 kHz
  PCM16, 176444 bytes, RMS 0.21684. A separate real Reel with no soundtrack
  correctly failed without synthesising audio. External retrieval is inherently
  dependent on Instagram's anonymous availability; physical iPhone unverified.

Task backups, live screenshots, byte hashes, real capture evidence and exact
incremental changes: `../output/videolab-instagram-20261028/` at workspace root.
The live server loads backend modules from this checkout; restarted
fs7300-documenter.service after backend changes. Existing unrelated dirty files
were preserved; no broad repository commit/push was made.
