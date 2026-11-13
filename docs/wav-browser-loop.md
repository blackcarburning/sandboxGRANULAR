# WAV Browser loop playback

Build v2026.11.03.WAV-LOOP.1 adds a per-row Loop Off/On button (`aria-pressed`).
The shared decoded preview transport uses one native AudioBufferSourceNode with
loop=true, loopStart=0 and loopEnd=buffer.duration. There is no ended-event
restart or per-cycle scheduling timer. Progress wraps at the buffer duration.
Pause/replay and seeking reuse the active decoded buffer.

Loop playback loads the original WAV. iPhone one-shot playback retains its
existing small/fast preview, but switching that preview to loop releases it and
loads the original, avoiding compressed-preview padding. Desktop keeps its
native streaming audio controls while loop is off and uses the shared Web Audio
player while looping. Turning loop off permits the current pass to finish;
desktop then returns to native controls. No editing of source audio is performed.

Decoding remains lazy and bounded by the existing original-PCM size limits.
Switching rows, closing/filtering the browser or changing/locking accounts stops
playback and releases the source and buffer. Mastering comparison uses the same
helper without new loop controls; its gain/context ownership remains unchanged.

This is repository preview playback only. No patch/Song/DSP/export schema or
server Song rendering path changes, and no saved renders need invalidation.

`tests/wav-loop-browser.cjs` uses disposable localhost accounts and routed WAV
fixtures, Chromium/WebKit and phone/desktop presentation. It captures 32,768
native PCM frames from a 100ms looping fixture: the same source stays active
across multiple boundaries without silent frames. It also verifies lazy loads,
original rather than fast-preview selection, pause/replay reuse, switching rows,
Loop Off, close cleanup and promotion of a one-shot preview to original PCM.
Physical iPhone audio is not measured by these browser-engine checks.

Backup/evidence: parent workspace `output/mygrain-wav-loop-20261103T212119Z/`.

## Loop status styling — Q-READY.2

Only WAV Browser loop controls use a dark red face in both states. A centred
7 px indicator beneath the label is unlit when Off and bright green when On,
driven solely by the existing `aria-pressed` state. There are no new nodes,
handlers, timers or audio changes. `wav-loop-browser.cjs` checks identical red
backgrounds, LED colours and geometry, plus native audio continuity, in
Chromium/WebKit phone and desktop layouts.
Backup: parent workspace `output/mygrain-wav-loop-led-20261103T213547Z/`.

### Stable preview button sizing (2026-11-03)

The custom WAV preview action is labelled `Play` both before loading and after
reset/pause. WAV Browser Play and Loop controls each reserve 108 CSS px with
nonshrinking flex bases, including during Loading/Pause/Play and Loop On/Off.
The existing red background/green LED and native continuous-loop source path
are unchanged. `tests/wav-loop-browser.cjs` checks both button widths and
identical button coordinates before/after pausing, alongside PCM continuity,
in Chromium and WebKit phone/desktop presentations.
