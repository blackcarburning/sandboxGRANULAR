# ABC-RECUT.1

A/B/C Re-cut Loaded Sample chops the current decoded lane audio using its cut
resolution selections, global BPM and pattern length. Works without server source
references (FTP uploads, imported samples and vocals). Stereo channels share cut
positions; 3ms edge fades reduce clicks. Uncut/oversized-only selections fall back
to 1/16 chops. Repeated re-cuts operate on the currently loaded loop. Original
uploaded/repository files are never written. Existing Generate/Rebuild still picks
new library samples. Uses existing buffer persistence, metadata, transport restart
and draft-edit Undo/Redo; no saved-data schema change. Selected source metadata is
retained. Backup: output/mygrain-abc-recut-20261026/index.html.
Browser regression: tests/abc-recut-browser.cjs (private imports and decoded PCM,
Undo/Redo round trips and running transport, fixture API interception, no production writes). Physical iPhone unverified.
