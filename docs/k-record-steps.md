# Keyboard-to-K recording length — K.9

## Use

The keyboard and Bastardloop K card have linked **Record to K · Steps / Record
Length · Steps** number fields. The default is the current pattern length and
continues following later pattern changes. Enter a positive whole number for a
custom take; it may be shorter, longer, or a non-multiple of the pattern. There
is no fixed musical step maximum. **Use Pattern Length** returns to automatic
following. The fields are disabled during count-in, capture and processing.

A step is one sixteenth note: `duration = steps × 60 / BPM / 4`. The four-beat
count-in is not included in the recording. The selected step count/BPM are fixed
for the armed take. Keyboard instrument, held chord/arp, exact audio-thread
capture/downbeat, backing restart, metering/gain, K handover, cancellation and
account/Song history guards retain their existing behavior. Metadata identifies
the recorded step count; the stored source audio contains the full take.

## Persistence and compatibility

The additive `modes.bastardLoopKRecordingSteps` setting is `null` for pattern
following or a positive safe integer for a custom length. Normal browser state,
editable Song capture/recall and Save Amendment preserve it. Existing patches
with the old `sliders.performanceBastardLoopKRecordLength` 1–8 loop multiplier
migrate after restoring their pattern length: one loop becomes the automatic
default; two through eight loops become the equivalent number of steps. Missing
or malformed settings default to pattern following. The old range control was
removed rather than reinterpreting stored loop counts as individual steps.

K's old 180-second take-acceptance check is removed for keyboard captures only;
other sample-import/mic duration checks are unchanged. This is not infinite
physical storage: the browser must allocate the recording and its rendered
buffers, browser storage can fill, and existing saved-Song ZIP upload limits
remain in effect. Unrepresentable frame counts fail without accepting a take.

The new control changes recording duration, not Song arrangement duration.
Standalone K playback uses its full recorded cycle; Song parts retain their
existing pattern/cycle length and their existing warning when K extends beyond
that part. Increase the part/pattern length as needed for Song playback.

## Verification

Disposable localhost stores only (never production Song/account test writes):

```sh
python3 tests/song-beta-test-server.py 18897
node tests/k-record-steps-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18897/mygrain/ MYGRAIN_ARP_RECORD_SOURCES=osc node tests/k-arp-recording-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18897/mygrain/ node tests/k-record-history-browser.cjs
node --test tests/k-record-steps.test.js tests/song-beta.test.js tests/song-beta-storage.test.js tests/song-beta-locks.test.js
```

The new browser regression tests Chromium/WebKit desktop and touch-phone
contexts, actual 8/3/73-step audio captures and exact frames/non-silent PCM,
linked inputs/invalid-value recovery, automatic pattern following/custom
independence, full Song recall, running saved-Song amendment with a new 19-step
take and Save/recall, browser reload persistence, and phone portrait/landscape.
The existing Arp/history regressions cover count-in/downbeat, handover,
cancellation/failure, exact PCM Undo/Redo and process restart, and foreign-device
Song reservations. Tests emulate browsers, not physical phones. A unit checks
over-180-second take acceptance; real-time three-minute captures were not run.
