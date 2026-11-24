# Protected loop and drum clock dividers — 21 November 2026

Build `v2026.11.21.DOWNLOAD-CLOCK.1`. Top → Loop clock ÷ controls the shared
sequencer/loop clock; Drum Machine → Drum clock ÷ additionally divides drums.
Values: 1, 2, 3, 4, 6, 8, 12, 16. Both default to ×1 and randomisers never own
these values. Saved patches, history and plugin/Song source captures retain them.
The displayed/global/DAW base BPM stays unchanged. Dividers compose: at 240 BPM,
loop ÷2 + drums ÷3 gives 120 BPM shared and 40 BPM drums. BPM-linked Q, Ember,
Resonator, LFOs, drum EQ automation and MIDI/WAV export follow their clocks.
Native retained Bridge renders report the expanded host beat count.

Canonical state adds `modes.clockDividers={loop,drums}` only when non-default.
Portable presets use the same optional object. Missing values restore ×1.
Do not add these select controls to generic UI-state capture or randomisation.
Old ×1 state/content identity remains unchanged. Non-default snapshots add
`clockDividerEngineRevision:1`; only these require `clockDividerVersion:1`
(`/render?...&clockdividers=1`). Server admission rechecks raw source snapshots,
not merely optional part metadata. Source ZIPs and Song revisions remain immutable
during render preparation; phone/warm playback reuses prepared PCM only.

The direct server-arm worker bypasses the ordinary UI run() busy wrapper. It must
mark the controller busy throughout preparation/capture so the eight-second idle
sleeper cannot suspend long renders. Do not disable idle sleep globally.

Verification: 62 existing backend tests + 2 strict/capability tests (all 64 divider
pairs), Chromium/WebKit controls/history/ZIP/reload/random protection and exact
WAV/FTP/Parts Bin download bytes. Real server Song WAVs at loop/drum (1,1), (2,1),
(1,3), (2,3) measured 1/2/3/6 seconds and .25/.5/.75/1.5-second hit spacing.
Existing original-source ZIP and ×1 render remained byte-identical and reused
without rendering. Native CEF Downloads were independently exercised on real
Windows/macOS CI hosts, run 44924998221; this is not physical customer DAW testing.
Evidence/rollback: workspace `output/mygrain-download-dividers-20261121/`.
