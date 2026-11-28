# CEF instrument 0.1.10 — Windows

Published in the full MYGRAIN app VST download card and `cef-setup.html`.
Mac remains 0.1.8; CEF FX remains 0.1.2. Replace the complete Windows bundle
with the DAW closed. Preserve the instrument CID and existing project state.

The four LFO CCs retain channels 1–4 / CC 102–105; notes retain channel 4.
Live CCs have independent pending values and distinct sample timestamps merged
chronologically with notes/expression; tiny blocks defer fairly. Enabling an LFO
no longer immediately resends its siblings. Timestamp separation is a receiver
compatibility change, not a reproduced Cubase/Serum 2 root cause.

Native source: `7e0a35d93f344abdd4ef552cccf0b51c5f1b4573`.
CI: https://github.com/blackcarburning/sandboxGRANULAR/actions/runs/46145967914

Passed 2800 native CC regression blocks, four changing streams at the packaged
VST3 IEventList through real CEF/authenticated socket, each independent disable
stopped/playing with notes and expression, 47 SDK validator tests and existing
native audio/storage/download/recall checks. Cubase/Serum 2 remains unverified.

Public packaging changes only setup/verification documentation and checksums;
all 239 native bundle entries are byte-identical to the tested build.

Archive: `mygrain-cef-windows-0.1.10.zip`

SHA-256: `f708dd528cb7a879b4bec7cb27bc194910150d35189b4775c93d3cfc3261bb75`
