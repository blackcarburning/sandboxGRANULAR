# L/X sequence rotation

The `<` / `>` buttons in each L/X editor call `shiftBastardLoopSequence(layer, delta)`.
They rotate the entire active pattern one step, irrespective of marked copy or
transpose sections. Every step carries its rest, accent, slide and ratchet state.
Steps outside the active pattern length are retained unchanged. Copy content is
retained, but positional copy/transpose selections are cleared.

Rotation reuses `saveState()` and the existing `modes.bastardLoopLSequence` /
`modes.bastardLoopXSequence` fields; it requires no saved schema or render version
change. Server Song capture/restore renders the edited step order normally.

Regression: `tests/lx-sequence-shift-browser.cjs` against the disposable
`tests/song-beta-test-server.py` server with `MYGRAIN_TEST_ADMIN_PASSWORD` set.
The test uses native mobile taps in Chromium/WebKit and checks both directions,
wrap, inverse rotation, step flags, inactive tails, storage and phone geometry.
