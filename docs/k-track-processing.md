# K track processing and keyboard decay — KFX.1

## Controls

The keyboard has one **Keyboard Decay · All Sounds** control: Off, or 10–8000 ms.
It fades each new Osc / Grain / Piano / Strings / Sample note toward silence,
including Arp notes and the signal recorded into K. Existing sound attacks,
source lengths and key-release envelopes still apply; a short source is not
extended. Off retains the previous native envelopes. Already-recorded K audio
is not re-enveloped. Old Songs and presets missing this field default to Off.

Each of five coloured K tracks has On, Mute, level, pan, independent loop length
and record select. Selecting a track (or changing the keyboard K destination)
updates the waveform and the single colour-matched processing editor:

- Tuning: semitones, fine cents, preserve duration, reverse.
- Filter: bypass; low/high pass 12/24/48/96 dB; band-pass; notch; resonance;
  envelope depth/decay; tempo-synced LFO waveform, depth, division, inversion.
- Effects: drive, tempo-synced delay mix/feedback/tone, reverb mix/decay.

Only **K Master Volume** is shared. Independent tracks still join the original
music route, sidechain and common final bus compressor. Filter envelope is a
start/rejoin transient, matching the old K envelope behavior. Local delay and
reverb tails stop with that track, including mute/On-off and transport stop.

## State and existing-Song conversion

`state.modes.kMultitrack.version` is now 2. Five track objects retain the old
level/mute/pan/length/metadata fields and add `enabled` and `processing`.
`k-multitrack.js` owns canonical defaults, finite clamps and enum validation.
The generated selected-track controls are not generic global slider/select or
checkbox state: the versioned K object is their only persisted authority.
Keyboard decay is `state.sliders.performanceKeyboardDecay`, default 0 (Off).
Browser state, presets, card Undo/Redo and Song Save Amendment retain both.

Version-one multitrack settings migrate all five takes and apply the previous
shared tuning/filter settings to each track. Unversioned single-K Songs migrate
the take to K1 and leave K2–K5 empty. Original audio asset paths and WAV bytes are
unchanged. New drive/delay/reverb default to Off; enabled defaults true. A null
filter-envelope decay preserves the old cycle-relative envelope. Legacy Ramp
LFO maps to Square because the former native-waveform mapper actually used
Square for that stored setting. New Ramp uses falling saw polarity.

`convertSnapshot` is non-mutating and idempotent; normal inspection/recall
supports the old formats in memory. The existing **Convert K** Song-editor
action saves compatibility metadata under the normal editing lease/revision
guards. It does not automatically Arm. No production Song is rewritten merely
by deploying this update.

## Bounded processing and ownership

- Muted, disabled, zero-level and master-off K tracks create no sources, filters,
  LFOs or wet graphs. Re-enabling rejoins the common transport position.
- One-track parameter edits replace only that voice, not its four peers. Live
  level/pan changes update existing nodes. Tempo changes update existing nodes;
  delay capacity grows only when required, by rebuilding its own voice.
- Each audible voice owns its filter/drive/FX graph. End, mute, stop, clear and
  account lock dispose that graph; retired nodes release after their short fade.
  No new UI animation loop was introduced. VUs retain viewport/document gating
  and now tap post-FX/pan output.
- Delay storage is sized for its current division, capped at 12 seconds. Reverb
  uses four short bounded feedback combs rather than five large convolution IRs.
  Drive/LFO/delay/reverb nodes are absent at zero/bypass settings.
- Tuning renders lazily for audible tracks or explicit audition. Only the current
  processed take is retained per track. K bypasses the general 48-variant pitch
  cache, while using the same pitch-shift algorithm and 25-cent quantization as
  before. Reverse copies are privately owned, not globally cached. Muting or
  disabling releases processed/padded copies; original takes remain editable.
- Existing 96 MiB coarse-pointer / 192 MiB desktop K admission remains in place
  before copy/padding/capture allocations. Detailed audio diagnostics include
  all five raw/current-render/padded K buffers. These checks are accounted audio
  memory bounds, not a claim about total browser/process RAM.

## Verification

Use a disposable localhost account/Song store, never production data:

```sh
python3 tests/song-beta-test-server.py 18919
node tests/k-track-processing-browser.cjs
K_ENGINE=chromium K_MOBILE=true node tests/k-multitrack-browser.cjs
K_ENGINE=webkit K_MOBILE=true node tests/k-multitrack-browser.cjs
node --test tests/k-multitrack.test.js tests/k-track-meters.test.js tests/q-keyboard-player.test.js tests/keyboard-note-mapping.test.cjs
python3 -m unittest discover -s tests -p test_k_multitrack_backend.py
python3 -m unittest discover -s tests -p test_mygrain_accounts.py
```

The processing browser regression exercises real offline DSP attenuation and
wet tails; all five native and decayed keyboard signals; worklet-recorded decay;
independent tuning, colours, peer continuity, repeated mute/unmute/master-off and
zero surviving graphs; real Save/recall/Amend/Arm; lossless old five-track ZIP
conversion; desktop/320/390 portrait/844 landscape layouts. The original recorder
regression covers five real takes with unequal loop lengths, saved audio reload,
Amend recording and single-K archive conversion. Browser phone runs are emulated,
not physical iPhone measurements.
