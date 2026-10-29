# DAW export — v2026.10.27.DAW.4

The DAW card replaces the former live-recorded Stem Export card/button. Its blue
and grey header has a monitor/track/export SVG identity. Both Jump surfaces
include DAW. Earlier stem archives remain reachable, without making new exports
in that old repository.

## Package

- ZIP name: `<name>-<tempo(s)>bpm-<pattern|song>-DAW.zip`. Existing names gain a
  numeric suffix; nothing is overwritten.
- `audio/`: named dry stereo PCM24 WAVs at exactly 48,000 Hz. Every track starts
  at sample zero / Cubase bar 1 and has the same full arrangement length plus
  the longest required release tail. Inactive sections are silence.
- One track per enabled independent source, including granular layers, A/B/C/V/W,
  P/O/L/X/Q, M/M+, each populated K1–K5 recording and N. Drums export Kick,
  Snare, Hat, Perc, Clap, Cymbals, ETC and Snare Roll separately. Normal Snare
  excludes cells overridden by Roll; Roll retains its independent cycle/dip.
- `MIDI/Arrangement.mid`: Standard MIDI File type 1, 960 PPQ, named musical
  tracks, tempo and 4/4 time-signature events, arrangement markers and the saved
  repeats/order. Drum tracks use channel 10 and the note map in `drum-map.json`.
  The isolated engine's actual scheduler provides onsets and ratchets rather
  than sampling wall-clock/UI playhead positions. Audio loops, vocals and K
  recordings do not gain invented MIDI transcriptions.
- `samples/`: exact saved WAV source bytes, extracted from each editable source
  archive; this does not invent pre-chop originals absent from a saved source.
- `source-patches/`: unmodified original part ZIPs, retaining settings, sample
  metadata and Q bank mapping. The original sources and song store are not edited.
- Optional `reference/`: stereo reference through the saved effects, explicitly
  separate from dry audio. Never subtract independently randomized wet/dry renders.
- README, manifest (including timing, source metadata, source hashes, peaks and
  release length), drum map and session notes. No individual normalization.

Dry bypasses channel EQ, shared loop insert/send space, vocal insert space and
compression, Wasp inserts and final/master processing. Instrument synthesis,
source tuning, reversal, granular processing and note envelopes remain. N retains
its source/envelope drivers and captures its own pre-insert output in isolation.

## Execution and isolation

Frontend: `daw-export.js`, `daw-export.css`. Song renderer's default path is
unchanged; optional preparation/onset/tail callbacks in `song-beta-clock.js` are
used only by DAW jobs. Rendering occurs through the current authenticated app and
Song render-deck engine, never an obsolete cached wet Song freeze. No audible
compatibility version needs invalidating because existing playback/DSP is unchanged.

Private endpoints are `api/ftp/daw-start`, `daw-status`, `daw-cancel`, dispatched
inside the existing session, approval, account-pin, same-origin and per-account
lock checks. The normal authenticated FTP download endpoint serves completed ZIPs.
Direct download links include the existing native-download `mygrainUser` pin.

`backend/mygrain_daw.py` owns a one-worker queue (three pending max, one per
account), random job capabilities pinned to account ID, 512 MiB preparation/render
admission, 1 GiB staging/package/FTP limits, timeout/cancellation and no-overwrite
publication. Credentials exist only in the worker's stdin payload, never status,
files or argv. Temporary artifacts use a mode-0700 job directory under `/tmp`,
removed after success/failure/cancel. Process groups are killed on cancel/timeout.
Jobs survive a browser reload; job IDs are remembered in account-scoped local
storage. An application-service restart loses in-memory job status; no partial ZIP
is published. Long jobs can be cancelled without changing saved music.
Pattern uploads reserve a bounded queue slot without holding the job-status lock.
Cancelling a queued job immediately removes its source files and credential payload,
even while another account's render is running.

`scripts/daw-export-worker.cjs` launches loopback Chromium at 48 kHz. Network is
same-origin GET/HEAD only, so editor/Song writes, source conversions, leases and
uploads cannot escape this renderer. It checks the saved revision before and
after Song processing, decodes and releases one source variant at a time, exports
real dry PCM and original source ZIPs to the private staging directory, and reports
progress. Python block-mixes repeated parts with silence and overlapping releases,
writes PCM24 without independently normalizing, then streams the final ZIP into
`mygrain_ftp.upload` under the account lock.

The scheduler is gated at the exact musical boundary: no next-cycle notes in the
release window; looping audio stops at that boundary, one-shots release naturally.
Tail capture starts at two seconds and doubles if the last 100 ms remains audible
(approximately -90 dBFS threshold), up to 64 seconds. Remaining audible tails or
memory/package overflow fail clearly rather than silently truncating the handoff.
Noise (continuous by design) receives a 3 ms export endpoint fade.

## Verification

Run disposable localhost stores only; never create fixtures in production:

```
MYGRAIN_TEST_ADMIN_PASSWORD=isolated-daw-fixture MYGRAIN_TEST_ROOT=/tmp/mygrain-daw-regression python3 tests/song-beta-test-server.py 18933
node tests/daw-export-browser.cjs
node tests/daw-card-browser.cjs
node tests/daw-lanes-browser.cjs
node tests/daw-roll-noise-browser.cjs
node tests/daw-cancel-browser.cjs
python3 -m unittest discover -s tests -p test_daw_export.py -v
python3 -m unittest discover -s tests -p test_private_ftp.py -v
node --test tests/song-beta-clock.test.js tests/song-beta-export.test.js
```

Chromium server jobs verify a real ZIP/FTP download with dry L/drums, source bytes,
SMF tracks, song tempo changes/repeats and later-section silent drum lanes. Real
isolated renders cover X ratchets, Q chords, K2, N and Snare/Roll separation. Card
interaction checks cover Chromium/WebKit at 375/390/430/844/1440 widths, folder
picker cancel/start, completed-link account pin and account lock. These are browser
checks, not a physical iPhone or an actual Cubase project-import test.

Before-edit deployed file copies: workspace `output/mygrain-daw-20261027/before/`.
The existing checkout contains extensive unrelated prior uncommitted work. Do not
stage or publish that unrelated baseline just to create a DAW commit.

## DAW.2: folder creation and import guides

The shared folder picker now creates folders using the existing authenticated FTP
mkdir endpoint. A visible inline form avoids native prompt dialogs on phones.
Creation opens the new folder; Use this folder confirms the destination. Invalid
single-component names and duplicate names leave the picker open with feedback.
The controls also benefit the WAV and Move destination pickers. Existing folders
and files are unchanged.

Cubase, Bitwig Studio, Ableton Live and FL Studio instructions appear in the DAW
card. Newly generated ZIP README files include all four workflows and official
documentation links. Guidance covers sample-zero/bar-1 placement, no unintended
warping/stretching/leading-silence removal, MIDI instruments and checking tempo
maps. No playback, DSP, notes, rendering or saved-part compatibility changed.

Verified Chromium/WebKit at 375/390/430/844/1440 card widths, portrait/landscape
picker layouts, real nested mkdir operations, invalid/duplicate names, cancellation
without export, and passing the resulting path to the export request.

## DAW.3: audible-only selection

DAW component discovery applies captured global loop/source/grain solos before
creating render jobs. Multiple solos form the same audible union as playback.
Without solos, enabled/unmuted sources are retained. Drum lane solos are local to
the drum machine; K sub-track enabled/mute flags still apply. Snare-only selection
disables Roll suppression so normal snare notes are not lost. Non-soloed oscillator
support for L/X does not accidentally become an extra Oscillators stem.

The same component discovery is called by the server worker for each saved source
variant in a song, not only the current editor. Existing live playback and Song
freeze DSP have not changed, so no playback compatibility revision is needed.

## DAW.4: render start deadlines

A cold isolated engine could exhaust its explicit transport reservation while
constructing the initial playback graph (the UI showed this as an FTP export
failure even though no upload had started). The shared Song clock now retries
only `Transport deadline expired` failures, with a fresh isolated deck and a
bounded 1.5 / 4.5 / 12 second preparation lead after the initial attempt. Audio,
MIDI, release gates and capture all use the new origin; no partial take is reused.
Capture timers/listeners are cancelled even when synchronous start throws.
Cancellation and unrelated errors remain authoritative, not retryable.

The same clock is used by DAW pattern/song exports and server Song preparation;
no engine DSP or successful render content changed, so existing Song audio caches
remain valid. `tests/daw-deadline-browser.cjs` injects a 900 ms startup stall and
checks recovery, exact frames, audible PCM, no page errors and zero retained decks.
