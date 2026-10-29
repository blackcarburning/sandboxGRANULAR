# Song EQ copy and Global Paste — v2026.10.24.EQ.2

## Workflow

Expand a saved part and use **Copy From Part**. Choose full sounds (loops,
individual K tracks, the drum machine or individual drums), individual channel
EQs, or a mixture. The EQ-only section includes all 26 inserts, including
Generated, Sample and Snare Roll. Copy is a reference to the saved source,
not the current unsaved/live pattern.

On the Song card use **Global Paste**. The destination card lets you choose
which copied sounds to include and which channel EQs to replace. A single EQ
can target any combination of channels. Multiple copied EQs default to matching
channels; a source selector at each destination makes remapping explicit.
All-drums copy can be narrowed to individual drum destinations.

Tick the desired song parts in the list, or Select all, and use Paste selected.
Repeated/shared uses stay linked and are saved once per underlying part.
If selected, the copied source is saved last. All destinations use the pinned
original revision; the server can also resolve that exact revision in retained
Song history. No paste silently switches to a newer source revision.
Per-part Paste Part remains a quick matching-channel paste. Pasting does not
replace the live pattern or automatically Arm Cache. Arm once after all edits.

## Persistence and server conversion

The browser sends only source IDs/hashes, selected item codes and optional
`eqMap` (destination channel -> copied source EQ channel). EQ item codes are
`eq:A`, `eq:K1`, `eq:drumKick`, etc. Mapping only permits known destinations
and selected source EQs. Existing clients without mappings retain their
matching-channel behaviour. Existing single-string copy payloads still work.

The server alone opens/converts saved-part ZIPs. EQ-only paste changes only
`state.modes.channelEq` and the edit timestamp, preserving destination audio
bytes and every unrelated snapshot field. It does not perform K conversion.
A source without EQ metadata means default bypass, never inheritance from the
live device. A legacy destination receives normalized EQ metadata server-side.
Mixed sound/K/EQ pastes use the existing canonical server K converter, then
apply explicit EQ mappings. Shared EQ schema remains version 1.

Existing revision/hash checks, ownership, edit leases, history and render
invalidation remain in force. Stale pickers, unavailable source revisions and invalid source hashes cannot
write. Batches are sequential, not globally atomic: a later failure reports
how many earlier destinations were saved and stops without touching the rest.
No browser capture, device conversion or automatic Arm is used during paste.

## Verification

`tests/test_song_eq_copy.py` checks all 26 channels, legacy metadata, byte-exact
audio preservation, mappings, mixed K/drum copying and API validation.
`tests/song-eq-copy-browser.cjs` exercises all popups, native Q gestures/Undo,
multiple saved destinations, old parts, stale pickers and phone layouts in
Chromium and WebKit. Existing multi-copy and failure-path tests remain active.
