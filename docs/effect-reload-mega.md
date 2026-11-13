# Effect reload and batch randomisation

Current policy, 2026-11-10.

| Entry point | Wasp / Mutilator / Playground / Turntable / Olaf’s Resonator |
| --- | --- |
| Reload | Retain saved controls and power; fresh devices still default off |
| Sparse | All five off |
| Mega | Randomise settings; independent 50% in/out choice per effect |
| Ordinary / per-card / AI | Existing policy retained; no new Mega overrides |

Mutilator power is independent of D. Outside The cooking pot, hearing its
selected source still requires that source to be audible. Mega enables and
stirs The cooking pot before choosing effect powers, so its Mutilator and Bass
Face do not depend on their retained card-input selectors. Wasp never has more than one source row
armed: enabling either row disables the other without discarding its settings.
Factory presets, manual edits, randomisation and legacy recall share the cap.
The existing v1 six-record schema and all 174 Playground patches are retained.

Batch choices are applied after the final layer selection and before history’s
closing snapshot, including the no-audio core branch. Main confirmation text
lists all five effects, and completion reports the actual in/out choices. The
other global Panlab/reverb/delay/filter reset remains intact.

## Verification

- Chromium and WebKit, phone and desktop: enabled reload before/after Start,
  one-source switching, Undo/Redo, actual Sparse/Mega with bounded synthetic
  source acquisition, deterministic on/off extremes, ZIP recall and dialogue.
- Cold no-audio helper preserves deferred settings without starting audio.
  Existing history admission still requires Start for full randomisation.
- Real isolated current/legacy server jobs, finite non-silent PCM, warm reuse,
  phone-style playback and selective legacy two-source stale-render refresh;
  source ZIP/hash/revision and unaffected neighbouring freeze unchanged.
- Backend checks selectively change only the active old two-source content hash.
- Physical phone listening remains untested.

Run browser regressions only against an isolated loopback fixture:

```sh
MYGRAIN_TEST_URL=http://127.0.0.1:19261/mygrain/ MYGRAIN_TEST_OUTPUT=/path/to/isolated-evidence node tests/effect-reload-mega-browser.cjs
MYGRAIN_TEST_URL=http://127.0.0.1:19261/mygrain/ MYGRAIN_TEST_OUTPUT=/path/to/isolated-evidence node tests/effect-reload-mega-server.cjs
```

The fixture must have dedicated `isolated-vst3-test` credentials and account
storage at `<evidence>/isolated-store`; never point these tests at production.
The server regression simulates stale metadata only inside that dedicated store.

### Test inventory update

The original unchanged Wasp suite passes all 118 cases against the pre-task
backup. Against the new implementation, its three random-patch cases fail
because they explicitly require two armed routes and two destinations. Those
assertions are updated to the requested one-source policy; all other assertions
are retained. The updated 118-case suite and three additional single-source
regressions pass. The new reload and source-cap regressions fail against the
pre-task implementation, as expected.

## The cooking pot

Mega shuffles the nine-effect serial order and enables the pot inside the same
history transaction. Sparse bypasses it while retaining its order. Ordinary,
per-card and AI generation leave its order and routing choice unchanged. See
[cooking-pot.md](cooking-pot.md) for source routing and render compatibility.
