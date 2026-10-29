# Sequencer accent audit — LX-ACCENT.1 (2026-10-25)

## Findings / changes

L and X already had note-triggered filter envelopes and retained Filter Envelope
sliders inside the standard LFO Filter section. However, the original per-note
filter envelope opened a filter upstream of the new standard filter, which stayed
at the base cutoff. This masked much of the opening. The standard host also
retained an all-pass per-note stage while selecting a low/high-pass type only
when the old envelope ran. OSC3 source modes bypassed this sample-only hook.

The envelope now schedules native cents automation on the standard filter's
`detune` AudioParams. Its global audio-clock LFO signal adds to those same
parameters. Existing envelope amount, L accent +50 percentage points, X's signed
Filter Accent amount, cutoff headroom, attack/decay calculation and filter bypass
are retained. There is no second tonal filter or new saved-state schema. The old
per-note compatibility nodes remain all-pass. New filter branches replay pending
note envelopes; retriggers preserve the preceding decay using cancel-and-hold or
a calculated fallback before resetting the next note. Event history is bounded.

L/X OSC3 note helpers now trigger the same filter envelope after voice creation.
X's OSC3 velocity had also incorrectly used Filter Accent as a volume multiplier;
that multiplier is removed to match X's documented filter-only accent semantics
and its sample path. L's intended volume accent remains.

## Wider routing audit

| Lane / sequencer | Accent semantics / result |
| --- | --- |
| L sample, ratchet, audition and OSC3 | Volume accent plus filter-envelope boost. Shared cutoff masking and missing OSC3 hook fixed. |
| X sample, ratchet, audition and OSC3 | Signed filter-envelope adjustment; no volume change. Shared cutoff masking, missing OSC3 hook and OSC3 velocity mismatch fixed. |
| Q piano/strings/sample/OSC/grain and arpeggio/grid/chord preview | Gain/velocity accents via q-theory accentGain / voice accentBoost. No promised accent-filter envelope or duplicate loop-filter envelope to repair. |
| Hat (sample or synthetic), Crash and ETC | Dedicated MygrainDrumTone four-stage low-pass envelope receives each hit's accent flag, including repeats. It connects to EQ/output, not the standard loop-FX filter. Native PCM and existing tone tests verify opening/decay. |
| Kick, snare, perc, clap, snare-roll | Their existing pattern/ratchet/dynamics synthesis paths do not expose the Hat/Crash/ETC accent-filter controls. No missing shared-loop filter-envelope connection found; no extra filter added. |
| Generated drum loop / generated A–O audio | Source-hit accent/velocity is rendered into the audio, not a runtime melodic filter-envelope trigger. Playback's user-selected tone filters are intentional. |
| K / M recordings | Recorded audio, not per-step accented melodic sequencers. Native K envelope is independent; no new accent system added. |

Deliberately closed master filters, independent channel EQ cuts or oscillator
sound-shaping filters can still constrain brightness. At an already fully open
L/X cutoff there is little/no upward envelope headroom; lower cutoff to hear a
strong sweep. This is not a missing connection.

## Verification

- `tests/lx-accent-envelope-browser.cjs`: isolated Chromium/WebKit mock-account
  browser, blocks non-read/external requests. Actual sample and OSC3 schedulers
  reach the correct lane's shared filter envelope; X OSC3 velocity stays equal
  for normal/accent steps; signed negative X accent still reduces envelope.
  Native offline PCM shows strong cutoff opening, return to baseline, simultaneous
  LFO movement and preserved pre-retrigger audio; drum accent tone opens normally.
- Existing standard-loop FX native browser suite passes in both engines.
- Original X amplitude-envelope regression: 48 cases across both engines,
  maximum PCM difference zero. Sample amplitude/attack/decay code untouched.
- 86 focused JS tests: shared FX, drum tone, Q theory/accents, Song compatibility.

Backup: `backups/lx-accent-envelope-20261025T175723Z/`.
Evidence: workspace `output/mygrain-lx-accent-20261025/`.
No production Songs or recorded/source audio modified.

An additional 42-test legacy X/held-key set has 36 passing cases and six stale
`window is not defined` fixture failures, identical against the before-edit
backup and current index. These are not claimed passing; the new browser test
exercises the actual shared-filter path and both source modes instead.
