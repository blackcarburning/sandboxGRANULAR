# Randomisation inside a Song amendment

## Fault and scope

The card-history guard considered a non-null `mygrainSongBeta.editing` draft
equivalent to an in-flight Song operation. That rejected normal per-card sample
replacement and pattern/cut randomisation before their handlers ran. The V cut
popup also entered the same generic guard before calling its nested randomiser.

Allow only the named per-card operations to enter history as draft edits:
V cuts; drum samples/patterns; L/X patterns and samples; sample-layer loading;
and generated/re-cut A/B/C/V/P/O sounds. The V editor uses `runDraftEdit` for
manual fields, handle drags and randomisation. Extra drum-lane pattern buttons
use the existing `runPatternEdit` boundary.

These exemptions do not turn off recording, loading, active Song operations,
Song playback, AI/Mega or engine-startup checks. An active amendment must also
have the controller's valid, verified editing lease and no revision conflict.
Global patch/AI/Mega operations and Undo/Redo remain excluded during a draft.
Server lease checks and the Save Amendment path are unchanged. Draft changes do
not overwrite the saved source until the user saves the amendment.

No saved state/ZIP schema, audio encoding, source caching, DSP or timing changes.

## Regression verification

Use only the disposable localhost account/Song server, never production stores:

```sh
python3 tests/song-beta-test-server.py 18895
node tests/song-amend-randomisation-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18895/mygrain/ node tests/vocal-cut-random-history-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18895/mygrain/ node tests/drum-clear-browser.cjs
```

The new regression covers Chromium/WebKit desktop and phone emulation. It saves
a real Song and enters Amend with its editing lease; uses native V card/popup
controls, manual cut fields, V generate/re-cut and random snare; verifies ten
blocked operation/lease/history conditions; saves, recalls and checks changed
cuts/sample metadata, an unchanged other part and the same editing reservation.
Generation is tested stopped and during actual loop-transport playback.

WAV HTTP fixtures supply isolated generated/sample responses. Fetching, decode,
buffer replacement, transport restart and Song capture/recall use real app code;
the test does not exercise the production sample libraries or generation backend.
`MYGRAIN_ADAPTER_OVERRIDE=/absolute/backup/song-beta-adapter.js` routes only the
pre-fix adapter and reproduces the original blocked-card assertion.
