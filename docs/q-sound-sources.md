# Q sound sources — 2026-10-24

Q has independent Piano / Strings / OSC / Grain / Sample selection on its card and in the sequencer Tools drawer. OSC and Grain use the keyboard's synthesis engines and shared sound settings; Jump opens their existing control cards. Q retains its own gain, pan, effects, channel EQ and sequencer.

Choose Q sample opens the existing browser with all sample folders, preview and Load into Q. Random sample follows the keyboard's established six-folder random policy. Q sample audio is independent of the keyboard sample. C4 is its native pitch; other notes play at the matching chromatic rate.

Persistence: `q.soundSource` is additive, with legacy fallback to `q.instrument`. `qSourceSample` is an appended Song/history audio slot and patch audio entry; IndexedDB uses `qSourceSampleBuffer`. Its metadata lives in Q state. Old parts acquire an explicitly empty new slot and do not borrow a phone's current Q sample. Source loads have account, history, Song, context and Q-generation cancellation guards.

OSC/Grain/Sample parts require Q render capability 9. They have no piano atlas. Sample parts require their own embedded Q sample, and Grain parts require embedded grain sources. Source archives remain editable and are not bulk-rewritten. Q layer copy includes its sample audio. The server public-asset allowlist includes the new source module.

Verification scripts:
- `tests/q-sound-sources-browser.cjs`: actual oscillator, grain and sample PCM through Q; voice cleanup; Chromium/WebKit.
- `tests/q-source-song-browser.cjs`: disposable-account source picker, portable Song Amend/Save/recall, frozen audio, patch restoration, reload and picker stacking.
- `tests/test_q_sound_sources.py`: server validation, legacy fallback, render capability and Q sample copy.

Mobile browser emulation is not a physical iPhone test.

Render timing: the isolated deck prepares Q and its graph before choosing the capture deadline. The initial buffered chord is queued immediately instead of relying on a later UI timer; this prevents first-onset loss when several decks initialize concurrently. `q-source-start.test.cjs` exercises the buffered-start regression.

Set `MYGRAIN_STRESS_Q_START=1` on the disposable-account Song browser test to block the UI thread for 700 ms immediately after each fixed-deadline start. Frozen first chords must remain audible even though ordinary timer scheduling would miss their complete gate.

Live switching (2026-10-25): Piano and Strings now start Q at a fresh audio deadline after their samples finish loading, matching OSC/Grain rather than seeking into the previous source's old loop origin. Stop during preparation still cancels restart. Regression coverage: `q-source-start.test.cjs` (cold-load deadline/cancellation) and `q-sound-sources-browser.cjs` (real Piano/Strings repositories, repeated running source changes in desktop/phone Chromium/WebKit).
