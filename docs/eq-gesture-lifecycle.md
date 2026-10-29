# EQ gesture lifecycle regression (2026-10-27)

A history admission check can throw synchronously after the EQ handle has captured a pointer and installed its shared drag session. Previously only promise rejections were caught; an admission failure permanently retained `drag` and blocked all subsequent handles and Q sliders.

`channel-eq-ui.js` now funnels synchronous and asynchronous gesture failures through the same rollback/cleanup, releases automation touch and pointer capture, and clears the session. Pointer release also has an owning-pointer window fallback. Lost capture and cancellation still roll back. Recording, loading and Song lease guards are unchanged. No DSP or saved-state changes.

Run `node tests/eq-touch-amend-browser.cjs` against the disposable test server on 18929 with admin password `isolated-edit-fixture`. Covers saved-part Amend, rejected handle and Q gestures, repeated all-band drags stopped and with L playback running, lost-capture cancellation, native Chromium touch moves, and Save/Amend exact settings in phone Chromium/WebKit. Native iPhone hardware remains untested.

The existing channel-eq unit suite has an unrelated stale 26-channel count (current engine has 27); 14 other EQ/automation units pass. Those tests import only unchanged DSP modules, not the edited UI.
