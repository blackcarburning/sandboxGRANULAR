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

G has its own header/icon and scoped CSS. The drawer-only jump link immediately
follows AI on desktop and phone and use the existing jump handler. The existing AI
progress/cancel/Undo mechanism is reused. Existing cards, render/viewport logic,
FX graphs and DSP implementations are untouched. The W level/transpose contract uses existing live handlers; shared FX settings
are not rewritten. Legacy loop cutoff IDs are retained as read-only inventory
for client compatibility, not advertised as writable model controls. Recorded M/M+/K audio is preserved but disabled in fresh genre recipes.

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

## Mandatory genre memory

`docs/genreator-genre-memory.md` is loaded by the backend and injected into EVERY
model call, not optionally retrieved. Startup refuses an incomplete reference.
All 15 genres include tempo choices, drum grammar, density, bass/harmony roles,
source mapping and anti-patterns. BPM numbers are production guidance, not a
measured popularity ranking. Auto D&B is 170–180 BPM (174 favoured), never 90;
Jungle is 160–175. Explicit BPM override remains authoritative. The existing
server rejection of out-of-range automatic tempos remains in force. No DSP or
Song rendering implementation changes; generated patches use the same engine.

Memory verification (2026-10-29): 40 focused Python tests passed, including
injection into all 15 genre requests and all other AI modes, every genre's tempo
boundaries, and rejection of 85/87/90/120/160/169 BPM Auto D&B. Explicit 90-BPM
user override still passes. Actual fixed-model low-effort calls starting from
90 BPM chose D&B 174 BPM (broken drums/X bass, no P/O/Q), house 124 BPM
(four-on-floor/Q piano/X), experimental 123 BPM (W modular/L Terra).
These are observed trials, not a guarantee of every patch's musical quality.

## Large-prompt pipe regression (GENRE.3 follow-up)

A real G request failed in `mygrain_model_run.mjs` before contacting the model:
Node 24's synchronous `readFileSync(0)` encountered EAGAIN on the inherited pipe.
The full catalogue + mandatory genre memory request was about 78 KB; small bridge
probes and direct calls without the catalogue did not reproduce it. Read stdin
with the async UTF-8 stream reader in `mygrain_model_input.mjs`, keeping the
250,000-character admission limit. Do not trim or omit the musical reference as
a workaround. `tests/test_model_input.py` sends large multi-byte prompts through
an explicitly nonblocking pipe, verifies exact text preservation and checks empty/
oversized rejection. No DSP, GUI or model/provider changes are involved. Future
AI bridge checks must include an authenticated full HTTP recipe request, not just
a tiny model ping or a mocked browser response.

The full real-model G-button check also exposed retired loop cutoff sliders
being overwritten by the actual shared-FX state during application. Contract v4
marks these 12 values readOnly, keeps all 81 current inventory IDs for older
clients, omits them from model writable controls and rejects proposals that try
to write them before any audio transaction. Shared effects and DSP are unchanged.
