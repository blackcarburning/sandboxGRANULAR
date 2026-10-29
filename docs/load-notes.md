# Load tips and release notes

`mygrain-load-notes.js` is the shared, durable release record. Its `CHANGES` array
is newest first, with a unique ID, ISO date, build and short user-facing note for
each release. Retain existing entries and prepend a new one whenever a MYGRAIN
change is deployed. Update the script version and both build badges in
`index.html` for the release. Do not depend on chat memory or a particular
browser's localStorage to remember app changes. The opening screen displays “Latest feature changes” with the five newest substantive
updates, followed by the random tip and an earlier-change highlight. The performance
header keeps its compact random notes. The highlight pool uses the next
10 entries after those five, excluding entries marked `highlight: false` (historical minor
revisions or notes-panel housekeeping). Keep older history. The initial pool
contains the 10 most recent substantive committed changes, from `82efba8`
through `0a17b35`, with summaries checked against their actual releases.

The helper loads before account gating because it contains only public usage
tips and release notes. Its filename must stay in `backend/mygrain_accounts.py`
`PUBLIC_FILES`. Private audio, Song data and account APIs stay protected.

`mygrainStartup.reveal()` calls `refresh()` after the real opening screen is
installed, including the guest screen cloned from the inert account template.
Hidden audio render decks skip notes. Both the opening screen and performance
header display the same tip and change highlight, selected once per document.
The 10 earlier changes are shuffled into a bag; one is shown per document and
none repeats until the whole bag has been shown. A fresh bag avoids repeating
the final item of the previous bag. Store only the tip index, bag identity,
remaining change IDs and last change ID locally. A changed pool resets the bag.
Blocked or corrupt storage must not prevent display (but without storage,
cross-reload non-repetition cannot be guaranteed). Release history is read from
the shipped array, including on a new device or after clearing browser data.

Run `node tests/load-notes-browser.cjs` for read-only live static-page checks
with disposable browser contexts and mocked account/API data. This covers guest
and remembered-account startup, Start, reload, storage failure, phone portrait,
landscape and desktop, plus a complete 10-load cycle and its boundary, in both
Chromium and WebKit. It does not use real account sessions
or write to production audio/Song stores.

## Compact phone opening screen (2026-10-25)
At widths up to 960px the account controls and Start precede the notes.
The five latest titles stay visible; full descriptions and random notes are
collapsed into “Details & random tips”. The notes have their own capped scroll
area so expanding details cannot push login off-screen. Short landscape hides
the logo and further caps the notes. Desktop and performance notes stay detailed.
Run `node tests/startup-compact-browser.cjs` for read-only live Chromium/WebKit
login geometry, expand/collapse and login-dialog checks at five viewport sizes.
