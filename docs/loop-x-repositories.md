# Loop X repositories (BASS.1)

The Bass repository select on X and the existing Bass Browser both control one preference:

- `samples_bass`: existing account-owned SAMPLES_BASS.
- `samples_altbass`: packaged, public-domain Juno-6 bass-only library in `SAMPLES_ALTBASS`.

The preference is independent of `bastardLoopXSampleMetadata.sourceKey`: changing repository does not discard the currently playing sound. Choose Bass Sample / Load Random Sample then replaces it. The Sample/OSC3 source-mode button remains independent; browsing a library does not claim OSC3 or defeat L/X's exclusive ownership lock.

`bastardLoopXRepository` persists in account-scoped local state and patch settings; full state/Song/AI snapshots include it in `modes`. Old states use the old sample's source key when valid, otherwise SAMPLES_BASS. Old preset imports without the field leave the current preference alone. No randomiser assigns this preference. Mega/Sparse use X's existing sample loader, which now reads the preference rather than a hard-coded source. Patterns, mix changes and random sample choice cannot randomise the repository.

## Backend

Apply `backend/altbass-host-integration.patch` to the shared documenter server and restart `fs7300-documenter.service`. The existing authenticated `/api/source-sample` list/GET/POST APIs handle both repositories. ALTBASS's trusted configuration maps to the public packaged folder (local-only); original sources retain account-scoped mirrors. This does not expose private account paths or require Dropbox/rclone. The new folder needs no public static allowlist entry.

The backend sample catalogue remains read-only. A bounded six-file Juno shortlist (two sounding bass registers × three tone variants) is added from the checksum-bound manifest; private SAMPLES_BASS candidates still require exact matching account files. Candidate roots and hashes are checked before being offered and again before applying. No production catalogue database is changed.

## AI

X's request inventory adds optional `repository`; old clients default to SAMPLES_BASS. X recipes may include `repository: "samples_bass" | "samples_altbass"` **with `reload:true`**. A catalogue selection must match the existing repository unless the recipe explicitly changes it. Server and browser both enforce this. Instructions tell the model to retain the repository unless the user asks for a library change or clean Juno/analogue bass.

Generate/Regenerate and targeted Refine can change X's repository. Refine permits this narrow X-only explicit-library reload; all other Refine reloads and all progression reloads remain forbidden. A repository operation switches X to Sample mode, uses the existing bounded sequential transaction, and logs the remembered change. Undo or a failed/cancelled load restores the previous repository, source mode and audio. Recording/normal OSC3 ownership rules are unchanged.

## Verification

```sh
python3 -m unittest discover -s tests -p 'test_altbass.py'
python3 -m unittest discover -s tests -p 'test_ai_*.py'
MYGRAIN_TEST_ROOT=/tmp/mygrain-altbass-store python3 tests/song-beta-test-server.py 18831
# Separate terminal, only against the isolated server:
node tests/altbass-browser.js
```

The browser check uses real Juno WAV decoding and native Loop X playback, controlled AI responses, and actual Mega/Sparse orchestration with unrelated source loaders isolated. It checks phone portrait/landscape in Chromium and WebKit, reload persistence, both selects, AI/Refine changes, Undo and failed-load rollback. Do not point writable tests at production.
