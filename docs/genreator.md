# G — GENREator (GENRE.1)

Genre-led random patch generation through the existing fixed
`openai/gpt-6.1-sol`, `thinking: low` one-shot model bridge. No autonomous model
tools, DSP forks, continuous drawing loops or generated-code execution. Genre
profiles are musical briefs and source exclusions, not parameter presets. Each
button calls the model again; there is no programmatic fallback patch.

15 buttons: D&B, Jungle, House, Deep House, Tech House, Techno, Trance,
UK Garage, Breakbeat, Electro, Dub Techno, Ambient Electronic, IDM/Glitch,
Industrial and Experimental Electronic. Auto BPM is selected by the model within
the profile range. The BPM box overrides that range (60–180); the server verifies
exact agreement. Canonical genre definitions live in `genre-presets.json`.

G has its own header/icon and scoped CSS. Quick/drawer jump links immediately
follow AI on desktop and phone and use the existing jump handler. The existing AI
progress/cancel/Undo mechanism is reused. Existing cards, render/viewport logic,
FX graphs and DSP implementations are untouched. The new W level/transpose/
legacy-cutoff contract uses existing live handlers; shared FX settings are not
rewritten. Recorded M/M+/K audio is preserved but disabled in fresh genre recipes.

Experimental profiles require fresh W `samples_modular` and L `samples_terra`
with notes, and explicitly disable P/O/Q. D&B excludes P/O/Q; house can choose
piano/strings. AI must explicitly choose enabled/off for every supported loop,
preventing previous piano/orchestra settings from bleeding into a genre result.
Invalid replies fail before applying; loader errors/cancel restore the prior
patch through the existing bounded transaction and account-scoped history.
Dropbox is not auto-loaded or randomised: that optional lane is outside this AI
contract and no model may claim to have changed it. User recordings are never
invented or overwritten.

## Song compatibility

W generation and Terra L notes use the existing buffers, original-source metadata
and Song snapshot audio slots. The AI rollback bindings already include W PCM,
metadata and source BPM; L repository is part of normal saved state. Generated
patches use the same engine in server capture. No DSP change or render-version
bump; old parts keep their sources/cache identities. Real isolated Song jobs
check that generated modular/Terra parts render audibly with unchanged source
hash and Song revision. Saved-part load/arm uses the existing compatibility path.

## Verification

- `python3 -m unittest discover -s tests -p test_ai_patch.py`
- `python3 -m unittest discover -s tests -p test_ai_catalogue.py`
- `python3 -m unittest discover -s tests -p test_genreator.py`
- `MYGRAIN_TEST_URL=http://127.0.0.1:18967/mygrain/ node tests/genreator-browser.cjs`
  uses isolated test admin auth and synthetic PCM, not production accounts.
  Phone 390×844 and desktop 1280×844, Chromium and WebKit; checks jump order,
  header/icon, no horizontal overflow, Auto/exact BPM, real source loading,
  P/O/Q exclusion, unchanged shared FX, Undo and rejected-request rollback.
- Three actual Sol 6.1-low calls returned valid experimental 113 BPM (L/W), D&B
  174 BPM (L/X/drums), house 124 BPM (Q/X/drums). Those are observed trials,
  not deterministic expected outputs or guarantees of musical quality.
- Isolated evidence: `output/genreator/` (ignored, not shipped).
- A broad unrelated suite includes pre-existing missing `yt_dlp` imports and an
  old RadioLab registration fixture that omits the now-required approval email.
  Focused AI/genre suites are the task's required checks.
- Physical iPhone/controller testing is not claimed.
