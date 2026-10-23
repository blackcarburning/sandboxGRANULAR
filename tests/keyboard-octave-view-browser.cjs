// Real touch/pitch/Song regressions with isolated localhost accounts only.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.KEYBOARD_VIEW_EVIDENCE || '/tmp/mygrain-keyboard-octave-view';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            for (const mobile of [true, false]) {
                const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
                assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `keyview_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-keyboard-view' } })).status(), 200);
                const page = await context.newPage(), errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
                const press = selector => page.locator(selector)[mobile ? 'tap' : 'click']();
                const key = note => `#keyboardContainer .key[data-note="${note}"]`;
                async function tapNote(note) {
                    const locator = page.locator(key(note)); await locator.scrollIntoViewIfNeeded();
                    const r = await locator.boundingBox(); assert.ok(r && r.width > 0, `${note} is visible`);
                    await locator[mobile ? 'tap' : 'click']({ position: { x: r.width / 2, y: r.height * (note.includes('#') ? .4 : .85) } });
                }
                async function selected(expected) {
                    assert.deepEqual(await page.evaluate(() => [...heldNotes].sort()), [...expected].sort());
                    assert.deepEqual(await page.locator('#keyboardContainer .key.active').evaluateAll(keys => keys.map(key => key.dataset.note).sort()), [...expected].sort());
                }
                await page.goto(base); await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.evaluate(() => mygrainCardHistory.ready); await press('#start-btn');
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                await page.evaluate(() => {
                    stopAllPerformancePlayback({ silent: true }); setHoldEnabled(false); setArpeggiatorEnabled(false, { skipSave: true });
                    clearAllPerformanceSoloStates({ silent: true, skipSave: true }); setFxMuted(true, { silent: true });
                    const b = audioContext.createBuffer(1, 48000 * 12, 48000), a = b.getChannelData(0);
                    for (let i = 0; i < a.length; i++) a[i] = .15 * Math.sin(2 * Math.PI * 261.6255653005986 * i / 48000);
                    setKeyboardSampleBuffer(b); keyboardSampleMetadata = { fileName: 'Absolute C4 fixture', rootMidi: 60 };
                    octaveOffset = 0; updateOctaveDisplay();
                });
                const layouts = [];
                for (const [width, height] of mobile ? [[390, 844], [320, 640], [844, 390], [390, 844]] : [[1280, 900]]) {
                    await page.setViewportSize({ width, height }); await page.locator('#keyboardContainer').scrollIntoViewIfNeeded();
                    const layout = await page.evaluate(() => {
                        updateKeyboardGeometry();
                        const keys = [...document.querySelectorAll('#keyboardContainer .key:not([hidden])')];
                        return { width: innerWidth, notes: keys.map(k => k.dataset.note), whites: keys.filter(k => k.classList.contains('white')).length,
                            bad: keys.flatMap((k, i) => {
                                const r = k.getBoundingClientRect(), black = k.classList.contains('black');
                                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height * (black ? .4 : .85));
                                const errors = hit?.closest('.key') === k ? [] : [k.dataset.note + ': hit'];
                                if (black && Math.abs(r.x + r.width / 2 - keys[i + 1].getBoundingClientRect().left) > 1) errors.push(k.dataset.note + ': boundary');
                                return errors;
                            }), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
                    });
                    assert.equal(layout.notes.length, 25); assert.equal(layout.whites, 15);
                    assert.equal(layout.notes[0], 'C2'); assert.equal(layout.notes.at(-1), 'C4');
                    assert.deepEqual(layout.bad, []); assert.equal(layout.overflow, false); layouts.push(layout);
                    await page.screenshot({ path: `${evidence}/${engine}-${width}x${height}.png` });
                }
                const instruments = [];
                for (const instrument of ['sample', 'piano', 'strings']) {
                    await page.evaluate(async instrument => {
                        setHoldEnabled(false); stopKeyboardSounds({ immediate: true });
                        octaveOffset = 0; updateOctaveDisplay(); setKeyboardSoundSource(instrument, { skipSave: true });
                        await prepareKeyboardSound(); setHoldEnabled(true);
                    }, instrument);
                    await tapNote('C2'); await tapNote('C4'); await selected(['C2', 'C4']);
                    await page.waitForFunction(() => keyboardSamplePlayer.voices.has('keyboard:C2'));
                    await page.evaluate(() => { window.originalBassVoice = keyboardSamplePlayer.voices.get('keyboard:C2'); });
                    await press('#octaveUpBtn');
                    assert.equal(await page.locator(key('C2')).isVisible(), false); await selected(['C2', 'C4']);
                    assert.deepEqual(await page.evaluate(() => {
                        const v = keyboardSamplePlayer.voices.get('keyboard:C2');
                        return { same: v === window.originalBassVoice, midi: v.midi, mapped: getKeyboardNoteMidi('C2'), label: document.querySelector('#keyboardContainer .key[data-note="C4"]').getAttribute('aria-label') };
                    }), { same: true, midi: 36, mapped: 36, label: 'Play C4' });
                    // C4 overlaps the two windows: tapping it must deselect C4,
                    // not select a transposed C5 in the same physical slot.
                    await tapNote('C4'); await selected(['C2']);
                    await tapNote('F#4'); await press('#octaveUpBtn'); await tapNote('G5');
                    await selected(['C2', 'F#4', 'G5']);
                    assert.deepEqual(await page.evaluate(() => getArpeggiatorNotes().map(getKeyboardNoteMidi)), [36, 66, 79]);
                    await press('#octaveDownBtn'); await press('#octaveDownBtn'); await selected(['C2', 'F#4', 'G5']);
                    assert.equal(await page.locator(key('C2')).getAttribute('aria-label'), 'Play C2');
                    await tapNote('C2'); await selected(['F#4', 'G5']);
                    await press('#octaveUpBtn'); await tapNote('F#4'); await selected(['G5']);
                    await press('#octaveDownBtn'); await selected(['G5']);
                    instruments.push({ instrument, notesAcrossViews: ['C2', 'F#4', 'G5'], bassRetained: true });
                }
                const history = await page.evaluate(async () => {
                    setHoldEnabled(false); stopAllPerformancePlayback({ silent: true });
                    const select = notes => {
                        heldNotes = new Set(notes);
                        document.querySelectorAll('#keyboardContainer .key').forEach(k => k.classList.toggle('active', heldNotes.has(k.dataset.note)));
                    };
                    select(['C2', 'G5']); octaveOffset = 0; updateOctaveDisplay();
                    mygrainCardHistory.runDraftEdit('multi-octave selection fixture', () => {
                        select(['C-1', 'B6']); octaveOffset = 3; updateOctaveDisplay();
                    });
                    if (mygrainCardHistory.undoLabel !== 'multi-octave selection fixture') throw new Error('History step missing');
                    await mygrainCardHistory.undo();
                    if (JSON.stringify([...heldNotes]) !== JSON.stringify(['C2', 'G5']) || octaveOffset !== 0) throw new Error('Absolute Undo failed');
                    await mygrainCardHistory.redo();
                    if (JSON.stringify([...heldNotes]) !== JSON.stringify(['C-1', 'B6']) || octaveOffset !== 3) throw new Error('Absolute Redo failed');
                    return { undo: ['C2', 'G5'], redo: ['C-1', 'B6'] };
                });
                const song = await page.evaluate(async () => {
                    setHoldEnabled(false); stopAllPerformancePlayback({ silent: true });
                    setKeyboardSoundSource('sample', { skipSave: true }); setBastardLoopKEnabled(false, { silent: true, skipSave: true });
                    applyGlobalBpm(300); syncPatternLengthControls(8); octaveOffset = 2; updateOctaveDisplay();
                    const c = mygrainSongBeta; document.getElementById('songBetaName').value = 'Absolute multi-octave keyboard'; await c.newSong();
                    heldNotes = new Set(['C2', 'F#4', 'G5']); setHoldEnabled(true);
                    document.querySelectorAll('#keyboardContainer .key').forEach(k => k.classList.toggle('active', heldNotes.has(k.dataset.note)));
                    await c.newPart({ name: 'Across windows', repeats: 1 });
                    if (!c.song?.parts.length) throw new Error(document.getElementById('songBetaStatus').textContent);
                    await c.recall(c.song.parts[0], { start: false });
                    const recalled = [...heldNotes].sort(), midi = getArpeggiatorNotes().map(getKeyboardNoteMidi);
                    if (JSON.stringify(recalled) !== JSON.stringify(['C2', 'F#4', 'G5'])) throw new Error(`Recall ${recalled}`);
                    await c.run(() => c.amendPart(c.song.parts[0]));
                    octaveOffset = -1; updateOctaveDisplay(); await c.run(() => c.savePart()); await c.recall(c.song.parts[0], { start: false });
                    if (JSON.stringify([...heldNotes].sort()) !== JSON.stringify(recalled)) throw new Error('Amendment transposed a selection');
                    // Simulate a genuine old snapshot, preserving its raw JSON.
                    const deck = await mygrainSongBetaAdapter.capture({ liveOnly: true });
                    deck.snapshot = structuredClone(deck.snapshot); delete deck.snapshot.state.keyboardNotesVersion;
                    deck.snapshot.state.octave = 1; deck.snapshot.extra.heldNotes = ['C2', 'F#4'];
                    const original = JSON.stringify(deck.snapshot);
                    mygrainSongBetaAdapter.recall(deck, { start: false });
                    const legacy = [...heldNotes].sort();
                    const backingFrequency = getPerformanceNoteFrequency('C2', 'bastardLoopX');
                    if (keyboardLegacyBackingOctave !== 1 || backingFrequency !== getNoteFrequency('C3')) throw new Error('Legacy backing tuning lost');
                    octaveOffset = -2; updateOctaveDisplay();
                    if (getPerformanceNoteFrequency('C2', 'bastardLoopX') !== backingFrequency) throw new Error('View transposed legacy backing');
                    if (JSON.stringify(legacy) !== JSON.stringify(['C3', 'F#5'])) throw new Error(`Legacy pitches ${legacy}`);
                    if (JSON.stringify(deck.snapshot) !== original) throw new Error('Legacy source mutated');
                    const converted = await mygrainSongBetaAdapter.capture({ liveOnly: true });
                    if (converted.snapshot.state.keyboardLegacyBackingOctave !== 1) throw new Error('Legacy backing compatibility flag missing');
                    if (converted.snapshot.state.keyboardNotesVersion !== 2) throw new Error('Missing absolute marker');
                    mygrainSongBetaAdapter.recall(converted, { start: false });
                    if (JSON.stringify([...heldNotes].sort()) !== JSON.stringify(legacy)) throw new Error('Legacy conversion applied twice');
                    if (keyboardLegacyBackingOctave !== 1) throw new Error('Legacy backing flag not restored');
                    await c.finishEditing();
                    // Restore the real saved part and verify rendered Song output.
                    await c.recall(c.song.parts[0], { start: false });
                    if (keyboardLegacyBackingOctave !== 0) throw new Error('New part gained legacy transpose');
                    await c.arm();
                    if (!c.armed) throw new Error(document.getElementById('songBetaStatus').textContent);
                    const render = c.renders.get(c.song.parts[0].id), samples = render.getChannelData(0);
                    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
                    if (!(rms > .001)) throw new Error(`Silent keyboard Song: ${rms}`);
                    return { recalled, midi, legacy, marker: converted.snapshot.state.keyboardNotesVersion, rms };
                });
                await selected(['C2', 'F#4', 'G5']);
                // View navigation during actual held/Arp playback must preserve
                // the absolute note pool, including notes outside the current view.
                await page.evaluate(() => { setArpeggiatorEnabled(true, { skipSave: true }); keyboardPlaybackAuthorized = true; keyboardArpTransportPlaying = true; startArpeggiatorPlayback(); });
                await page.waitForFunction(() => [...keyboardSamplePlayer.voices.values()].some(v => v.key.startsWith('arp:')));
                await press('#octaveUpBtn'); await selected(['C2', 'F#4', 'G5']);
                assert.deepEqual(await page.evaluate(() => getArpeggiatorNotes().map(getKeyboardNoteMidi)), [36, 66, 79]);
                const arp = await page.evaluate(() => [...keyboardSamplePlayer.voices.values()].filter(v => v.key.startsWith('arp:')).map(v => ({ key: v.key, midi: v.midi })));
                assert.ok(arp.length); for (const voice of arp) assert.equal(voice.midi, { 'arp:C2': 36, 'arp:F#4': 66, 'arp:G5': 79 }[voice.key]);
                await page.evaluate(() => { stopKeyboardArpTransport(); setHoldEnabled(false); });
                assert.deepEqual(errors, []); results.push({ engine, mobile, layouts, instruments, history, song, arp });
                fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
                console.log(JSON.stringify({ engine, mobile, instruments: instruments.length, history, song, arp }));
                await context.close();
            }
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
