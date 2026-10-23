# Loop taps and scrolling (TOUCH.8)

Ordinary loop controls must use the browser's completed `click` event, including
native Enter/Space activation. Never run actions on `pointerdown`, `touchstart`,
or `mousedown`; those can begin a scroll. Do not reintroduce the old card-wide
350 ms hold requirement (TOUCH.1–3 made ordinary buttons/Solo unresponsive).

`bindBastardLoopLMobileTap`, L/X step buttons and overlay/sample-browser Close now use clicks.
The document-level `installLoopScrollTapGuard` is passive during touch tracking:
it does not prevent scrolling, capture pointers, replay clicks or require holds.
It cancels only a trailing touch click after at least 10 px movement, a cancelled
or multi-touch gesture, or actual ancestor scrolling during the touch. A fresh
touch resets the guard immediately. Mouse/pen and keyboard/assistive clicks are
not held behind the cancelled touch. The full-height body wrapper allows vertical
scroll chaining to the document; containment stays on the actual document/modal
scrollers, avoiding a Chromium touch-pan trap. Intentional performance keys, waveform
drags and sliders retain their existing direct-manipulation paths.

K `Record select`, `On`, and `Mute` labels are content-width, not tile-width.
Clicking blank tile space/heading/VU selects the corresponding K editor. Actual
inputs and labels own their own events; they cannot also select another track.
Selection uses the existing busy guard, alias, persistence and UI sync paths.
No patch/Song/state schema, audio path, WAV history, heart or comment changes.

## Regression checks

Use the disposable local server (`python3 tests/song-beta-test-server.py 18919`)
and never production Song/account stores. Run:

```
node --test tests/loop-scroll-taps.test.js tests/editor-close.test.js tests/lx-held-keyboard.test.cjs tests/k-multitrack.test.js tests/x-q-roots.test.js
node tests/loop-scroll-taps-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18919/mygrain/ node tests/solo-tap-history-rail-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:18919/mygrain/ node tests/lx-held-keyboard-browser.cjs
```

Browser checks include all five K tiles at 390×844, 844×390 and 1280×900; native
checkbox/radio taps; all 14 card Solo taps; L/X navigation, steps, double-tap
ratchet and Close; mouse/Enter/Space; persisted K settings/selection. Chromium
uses native CDP touch swipes. WebKit uses native taps plus DOM touch/cancel and
compatibility-click regression events because Playwright's WebKit input API
only exposes taps. Neither is a physical iPhone test. Existing held-sample and
Solo suites check actual audio and release behavior.
