# Shared filter LFO timing — FILTER-CLOCK.1

The native sawtooth previously used for Saw down rose through its first half-cycle, then jumped halfway through the selected period. Ramp up was its negation. Each oscillator also started at graph creation, independently of the shared transport. A nominal 125ms/1/16 cycle at 120 BPM could jump at 62.5ms relative to oscillator start, and at an arbitrary point relative to L/X notes.

Shared card FX now use explicit periodic-wave coefficients. Saw down decreases from +1 toward -1 over phase 0..1; Ramp up increases from -1 toward +1. Their discontinuity is at the cycle boundary, not halfway through. Invert reverses polarity without shifting timing. Sine, triangle and square retain their standard native phase conventions. Band-limited discontinuities can ring briefly as with other native periodic waveforms.

`createGraph(context, destination, settings, bpm, origin, startTime)` aligns each oscillator to the shared beat phase, including late graph creation. `syncClock(origin,bpm,at)` changes the native oscillator at the scheduled audio-clock time (not a UI timer or a smoothed frequency ramp). The host passes the common transport epoch/start reservation at buffered start and lane resolution; live BPM changes use the same scheduled handoff boundary as the lanes. The host respects temporary transport-clock BPM overrides while the old timeline is being scheduled. No note-by-note reset: a 1-bar LFO remains a full bar across sixteenth-note steps.

A phase/wave/rate change replaces the oscillator; cutoff/depth/resonance edits retain the existing oscillator. Old oscillators stop at the exact handoff and disconnect on ended; graph disposal also stops the current oscillator. Filters, accent-envelope automation, shared FX and portable settings schema are unchanged. Fix applies to all cards using common filter FX, including L/X and K lanes; N retains its separate filter driver.

Verification:

- `filter-lfo-clock-browser.cjs`: 40 native Chromium/WebKit cases across 44.1/48kHz and 73/120/167 BPM, saw/ramp directions, inversion, future tempo handoff, late graph creation, and 80s drift. Checks interior phase error and monotonic full-cycle direction; max absolute error <0.016 at sampled positions (Fourier truncation/float error near discontinuities excluded).
- `filter-lfo-host-browser.cjs`: actual L/X FX graphs receive identical transport origins/frequencies from buffered transport and lane starts; editing cutoff/depth does not reset oscillators; saved waveform/division retained.
- Existing loop-card FX and L/X accent native browser suites pass in both engines (routing, all filter slopes, reverb/delay, sample/OSC3 envelopes and retriggers). 26 FX/Song compatibility unit tests pass.

Backup: `backups/filter-lfo-clock-20261025T183238Z/`. Evidence: workspace `output/mygrain-filter-clock-20261025/`. No account API writes or production render/Song changes.
