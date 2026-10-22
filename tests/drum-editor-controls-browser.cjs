// Disposable localhost accounts; real playback, mouse and phone touch input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.EDITOR_EVIDENCE || '/tmp/mygrain-drum-editor-controls';
fs.mkdirSync(evidence, {recursive: true});
const message = 'stop the drum machine to change roll pattern length';
(async () => {
    const results = [];
    for (const engine of ['chromium', 'webkit']) {
        const browser = await ({chromium, webkit}[engine]).launch(engine === 'chromium'
            ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
        try {
            for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}, {width: 844, height: 390}, {width: 320, height: 640}]) {
                const mobile = viewport.width !== 1280;
                const context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile});
                assert.equal((await context.request.post(base + 'api/auth/register', {data: {
                    username: `ed_${engine[0]}_${viewport.width}_${Date.now()}`, password: 'isolated-editor-check'
                }})).status(), 200);
                const page = await context.newPage(), errors = [];
                page.setDefaultTimeout(30000);
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
                const press = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await press('#start-btn');
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                await page.evaluate(async () => {
                    stopAllPerformancePlayback({silent: true}); applyGlobalBpm(300);
                    syncPatternLengthControls(16, {skipSave: true});
                    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * .08, audioContext.sampleRate);
                    const values = buffer.getChannelData(0);
                    for (let i = 0; i < values.length; i++) values[i] = .2 * Math.sin(2 * Math.PI * 433 * i / buffer.sampleRate);
                    await applyLoadedDrumMachineSampleBuffer('snare', buffer, {sourceKey: 'samples_snare', fileName: 'editor-snare.wav'});
                    drumMachineSnarePattern.fill(false); drumMachineSnarePattern[4] = drumMachineSnarePattern[12] = true;
                    setDrumMachineDirectOutput(true, {silent: true, skipSave: true});
                    setDrumMachineEnabled(true, {silent: true, skipSave: true});
                    restoreDrumMachineRoll(); openDrumMachineOverlay();
                });
                await press('[data-drum-jump="roll"]');
                // UI sync must not replace a focused draft or the controls below it.
                await page.locator('#drumMachineRollLength').fill('128');
                const stableDraft = await page.evaluate(() => {
                    const grid = document.getElementById('drumMachineRollGrid'), first = grid.firstChild;
                    const option = document.getElementById('drumMachineRollPage').firstChild;
                    for (let i = 0; i < 20; i++) syncDrumMachineUi();
                    return {value: document.getElementById('drumMachineRollLength').value,
                        grid: first === grid.firstChild, option: option === document.getElementById('drumMachineRollPage').firstChild};
                });
                assert.deepEqual(stableDraft, {value: '128', grid: true, option: true});
                await page.locator('#drumMachineRollLength').press('Tab');
                assert.equal(await page.evaluate(() => drumMachineRoll.length), 128);
                await page.evaluate(() => mygrainCardHistory.undo());
                assert.equal(await page.evaluate(() => drumMachineRoll.length), 64);
                await page.evaluate(() => mygrainCardHistory.redo());
                assert.equal(await page.evaluate(() => drumMachineRoll.length), 128);
                await page.evaluate(() => {
                    window.editorHits = [];
                    const play = playDrumMachineHit;
                    playDrumMachineHit = (...args) => { editorHits.push(args[1]); return play(...args); };
                });
                await press('#drumMachinePlayBtn');
                await page.waitForFunction(() => drumMachinePlaying);
                const origin = await page.evaluate(() => drumMachineTransportStartTime);
                assert.equal(await page.locator('#drumMachineRollLength').evaluate(el => el.readOnly), true);
                await press('#drumMachineRollLength');
                await page.waitForFunction(expected => {
                    const popup = document.getElementById('settlePopup');
                    return popup.classList.contains('visible') && popup.textContent === expected && +getComputedStyle(popup).opacity >= .99;
                }, message);
                const popup = await page.evaluate(() => {
                    const popup = document.getElementById('settlePopup'), rect = popup.getBoundingClientRect();
                    popup.style.pointerEvents = 'auto';
                    const topmost = popup.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
                    popup.style.pointerEvents = '';
                    return {above: +getComputedStyle(popup).zIndex > +getComputedStyle(document.getElementById('drumMachineOverlay')).zIndex,
                        fits: rect.left >= 0 && rect.right <= innerWidth, pointer: getComputedStyle(popup).pointerEvents,
                        bodyLevel: popup.parentElement === document.body, topmost};
                });
                assert.deepEqual(popup, {above: true, fits: true, pointer: 'none', bodyLevel: true, topmost: true});
                await page.screenshot({path: `${evidence}/${engine}-${viewport.width}-popup.png`});
                await page.locator('#drumMachineRollLength').press('ArrowUp');
                assert.equal(await page.evaluate(() => drumMachineRoll.length), 128);
                // Defensive change guard also rejects stale/programmatic input events.
                await page.locator('#drumMachineRollLength').evaluate(el => { el.value = '64'; el.dispatchEvent(new Event('change', {bubbles: true})); });
                assert.equal(await page.locator('#drumMachineRollLength').inputValue(), '128');
                // Only length is locked: pages, step toggles and ratchets remain live.
                await page.locator('#drumMachineRollPage').selectOption('3');
                await press('[data-roll-step="124"]');
                await press('#drumMachineRollGrid .drum-machine-step-cell:nth-child(29) .drum-machine-ratchet-btn');
                assert.deepEqual(await page.evaluate(() => [drumMachineRoll.pattern[124], drumMachineRoll.ratchets[124]]), [true, 2]);
                // Recalling equal data must not leave handlers pointing at old state.
                await page.evaluate(() => restoreDrumMachineRoll(structuredClone(drumMachineRoll)));
                await press('[data-roll-step="125"]');
                assert.equal(await page.evaluate(() => drumMachineRoll.pattern[125]), true);
                // Single completed clicks/taps, under rapid UI refresh, leave audio running.
                await page.evaluate(() => { window.editorRefresh = setInterval(syncDrumMachineUi, 40); });
                for (let i = 0; i < 3; i++) {
                    if (i) {
                        // Respect the existing compatibility-click guard between
                        // separate opens (not extra presses to close one editor).
                        await page.waitForTimeout(700);
                        await page.evaluate(() => openDrumMachineOverlay());
                    }
                    await press('#drumMachineCloseBtn');
                    assert.equal(await page.evaluate(() => document.getElementById('drumMachineOverlay').hidden), true);
                    assert.equal(await page.evaluate(() => drumMachinePlaying && drumMachineTransportStartTime), origin);
                }
                if (mobile) {
                    // A touch release still closes when no compatibility click is delivered.
                    await page.waitForTimeout(700);
                    await page.evaluate(() => openDrumMachineOverlay());
                    const accepted = await page.locator('#drumMachineCloseBtn').evaluate(el => el.dispatchEvent(new Event('touchend', {bubbles: true, cancelable: true})));
                    assert.equal(accepted, false);
                    assert.equal(await page.evaluate(() => document.getElementById('drumMachineOverlay').hidden), true);
                }
                const hits = await page.evaluate(() => editorHits.length);
                await page.waitForFunction(count => editorHits.length > count, hits);
                await page.evaluate(() => { clearInterval(editorRefresh); openDrumMachineOverlay(); });
                await press('#drumMachinePlayBtn');
                assert.equal(await page.evaluate(() => drumMachinePlaying), false);
                await press('[data-drum-jump="roll"]');
                assert.equal(await page.locator('#drumMachineRollLength').evaluate(el => el.readOnly), false);
                await page.locator('#drumMachineRollLength').fill('96');
                await page.locator('#drumMachineRollLength').press('Tab');
                assert.equal(await page.evaluate(() => drumMachineRoll.length), 96);
                // Real saved-part amendment used to silently reject all Roll edits.
                await page.evaluate(async () => {
                    restoreDrumMachineRoll({length: 96});
                    document.getElementById('songBetaName').value = 'Editable Roll';
                    await mygrainSongBeta.run(() => mygrainSongBeta.newSong());
                    document.getElementById('songBetaPartName').value = 'Roll amendment';
                    await mygrainSongBeta.run(() => mygrainSongBeta.newPart());
                    window.editorSourceHash = mygrainSongBeta.song.parts[0].sha256;
                    await mygrainSongBeta.run(() => mygrainSongBeta.amendPart(mygrainSongBeta.song.parts[0]));
                    if (!mygrainSongBeta.editing) throw new Error('Amendment did not start');
                    openDrumMachineOverlay();
                });
                await press('[data-drum-jump="roll"]');
                await page.locator('#drumMachineRollPage').selectOption('0');
                for (const expected of [true, false, true]) {
                    await press('[data-roll-step="0"]');
                    assert.equal(await page.evaluate(() => drumMachineRoll.pattern[0]), expected);
                    assert.equal(await page.locator('[data-roll-step="0"]').getAttribute('aria-pressed'), String(expected));
                }
                await press('#drumMachineRollGrid .drum-machine-step-cell:nth-child(1) .drum-machine-ratchet-btn');
                assert.equal(await page.evaluate(() => drumMachineRoll.ratchets[0]), 2);
                const amendmentUndo = await page.evaluate(() => mygrainCardHistory.counts.undo);
                await page.evaluate(() => mygrainCardHistory.undo());
                assert.equal(await page.evaluate(() => mygrainCardHistory.counts.undo), amendmentUndo, 'Undo must remain locked during an amendment');
                await press('#drumMachinePlayBtn');
                const amendmentOrigin = await page.evaluate(() => drumMachineTransportStartTime);
                await press('[data-roll-step="1"]');
                for (let i = 0; i < 2; i++) await press('#drumMachineRollGrid .drum-machine-step-cell:nth-child(2) .drum-machine-ratchet-btn');
                await page.locator('#drumMachineRollPage').selectOption('2');
                await press('[data-roll-step="95"]');
                assert.deepEqual(await page.evaluate(() => ({steps: [0, 1, 95].map(i => drumMachineRoll.pattern[i]), ratchets: [0, 1].map(i => drumMachineRoll.ratchets[i]), origin: drumMachineTransportStartTime})),
                    {steps: [true, true, true], ratchets: [2, 3], origin: amendmentOrigin});
                await press('#drumMachineRollLength');
                assert.equal(await page.evaluate(() => drumMachineRoll.length), 96);
                await press('#drumMachinePlayBtn');
                const amendment = await page.evaluate(async () => {
                    if (mygrainSongBeta.song.parts[0].sha256 !== editorSourceHash) throw new Error('Live editing unexpectedly changed the saved source');
                    await mygrainSongBeta.run(() => mygrainSongBeta.savePart());
                    const part = mygrainSongBeta.song.parts[0];
                    const saved = await mygrainSongBeta.loadPart(part);
                    const state = saved.snapshot.state.modes.drumMachineRoll;
                    return {changed: part.sha256 !== editorSourceHash, length: state.length,
                        steps: [0, 1, 95].map(i => state.pattern[i]), ratchets: [0, 1].map(i => state.ratchets[i])};
                });
                assert.deepEqual(amendment, {changed: true, length: 96, steps: [true, true, true], ratchets: [2, 3]});
                await page.evaluate(() => saveState({force: true}));
                assert.deepEqual(errors, []);
                results.push({engine, viewport, stableDraft, popup, singlePressClose: 3,
                    touchReleaseFallback: mobile, runningLengthBlocked: true, stoppedLength: 96, transportUnchanged: true, amendment, errors});
                console.log('PASS', engine, JSON.stringify(viewport));
                fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
                await context.close();
            }
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
