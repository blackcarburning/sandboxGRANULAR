# Sequencer snapshots

Named per-patch alternatives for Drum Machine, L, X, Q, Restructure and Ember.
The **Sequencer snapshots** panel offers Save snapshot, Recall and Delete.
Names need not be unique; UUIDs identify entries. No snapshot count limit is
imposed. Existing archive/native project byte limits are unchanged.

## Scope

- Drums: all lane patterns, accents, ratchets, Snare Roll, hat timing, drum
  divider and references to the assigned samples.
- L/X: all 64 note/rest/accent/slide/ratchet steps, grid rate, root, tuning and
  Sample/OSC3 source reference. A conflicting OSC3 connection to the other
  sequencer is rejected before recall changes anything.
- Q: full chord sequence including custom notes/identities, scale/chord settings,
  transposition, gate/velocity/accent, source instrument (including dedicated Q sample references), chord hold and ARP.
- E/R: four/eight lane patterns and sample playback settings, deterministic
  corpus/cut references, clock divider, pitch and step-loop range. Filters,
  reverbs, LFOs, cross matrix, output level and power remain untouched.

Recall restores the shared patch pattern length, not BPM. Unrelated
effects, Cooking Pot, Master Baker and source power are preserved. The shared
length determines every sequencer's playback window and uses the usual shared-grid
normalisation when shortened.
OSC3/grain/external sample references point at the shared instrument; they do
not copy its synth preset or replace another card's source.

Snapshots hold **no audio** or additional WAV/archive assets. Repository sounds
are reused or fetched by saved reference before committing; E/R corpus sources
use deterministic recipes. Local sounds without a reloadable path reference the
current patch asset by PCM fingerprints (including portable PCM16). JSON-only asset bindings keep these references valid
when a complete patch is resampled by a different DAW sample rate. Bindings are
only adopted with the patch audio, never by a settings-only JSON preset. A replaced
local asset fails clearly without substituting another sound: reload its original
patch. Referenced repository files/corpora must remain available.

Save, recall and delete use the existing four-level Card History Undo/Redo.
Only accepted Mega/Sparse randomisation clears snapshot lists. Card-local sound,
sample, patch and pattern actions, lane randomisation and ordinary whole-patch
randomisation preserve every list. Cancelled Mega/Sparse also preserves them.
Explicit Clear Patch and loading a patch without metadata still clear the lists.
Local drum sounds/patterns/envelopes preserve lane/bus levels, sidechain trim and
direct routing/sends. Local Restructure Generate patch retains power/output level;
whole-patch generation alone may apply generation mix defaults.
Manual edits retain lists. Account lock aborts pending preparation,
drops lists and clears typed names. Preparation failures do not change sequencers.

## Storage and compatibility

Optional `modes.sequencerSnapshots` is `{version:1,cards:{<card>:[{id,name,data}]},bindings?:{<slot>:[fingerprints]}}`.
Each data payload has version 1, card, patternLength and scoped sequencer/source
references. Empty metadata is omitted. Old patches restore empty lists, not the
previous patch's lists. JSON presets carry the object at `sequencerSnapshots`.
Panel drafts/selectors stay out of generic UI journals. Early startup captures
retain stored metadata until the owner module has loaded.

Complete ZIP/Song, CEF/Bridge/FX project capture and nested Parts Bin source ZIPs
share canonical saveState/source recall. No binary, project envelope, codec or
Parts Bin schema change is needed. Normal **Store now**/auto-store and DAW Save
persist snapshots just like other patch edits. Each bin part keeps its own lists;
no bin is nested inside snapshot metadata. Existing source ZIPs/preview WAVs are
not rewritten. Server validation accepts JSON-only metadata and excludes unused
snapshots from current-audio identity, so no DSP capability/cache bump is needed.

Tests: `tests/sequencer-snapshots-{browser,edges,random,preserve,cancel,song}.cjs` and
`tests/test_sequencer_snapshots.py`.
Whole-patch randomisation tests stub source generation, not lifecycle/history.
The Song check runs real isolated server jobs and verifies warm-cache phone PCM
playback, source immutability and unchanged metadata-only content identity. It
does not assert that separate real-time L freezes are bit-identical.
The browser native-storage check uses the real native project codec/source/bin
restoration with an isolated transport, not a physical CEF/DAW hardware test.
