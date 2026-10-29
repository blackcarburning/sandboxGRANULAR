# Phone Jump search — PHONE-JUMP.1

The existing desktop navigation search moves inside the mobile Jump panel,
immediately before its grid/AI tile, below 961px. A single input and filter
serve both layouts; desktop docking remains unchanged. Phone font is 16px to
avoid Safari focus zoom. Query matching includes late-mounted navigation
buttons (Noise, Wasp) through a child-list observer. Enter jumps to the first
match after dismissing the keyboard; Escape clears the query. No-result
feedback and hidden-button styling apply on phone. No audio/persistence
changes. Verify with tests/phone-jump-search-browser.cjs.
