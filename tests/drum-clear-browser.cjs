// Native clicks/taps, real AudioBuffers and disposable localhost Song storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.DRUM_CLEAR_EVIDENCE || '/tmp/mygrain-drum-clear';
fs.mkdirSync(evidence, {recursive: true});
const lanes = ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc', 'roll'];
const prefix = kind => `drumMachine${kind[0].toUpperCase()}${kind.slice(1)}`;
(async () => {
    const results = [];
    for (const engine of ['chromium', 'webkit']) {
        const browser = await ({chromium, webkit}[engine]).launch(engine === 'chromium'
            ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
        try {
            for (const mobile of [false, true]) {
                const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900}, isMobile: mobile, hasTouch: mobile});
                assert.equal((await context.request.post(base + 'api/auth/register', {data: {
                    username: `clear_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-drum-clear'
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
                    stopAllPerformancePlayback({silent: true}); applyGlobalBpm(150);
                    syncPatternLengthControls(32, {skipSave: true});
                    for (const [i, kind] of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc'].entries()) {
                        const buffer = audioContext.createBuffer(1, audioContext.sampleRate * .06, audioContext.sampleRate);
                        const data = buffer.getChannelData(0);
                        for (let j = 0; j < data.length; j++) data[j] = .12 * Math.sin(2 * Math.PI * (220 + i * 50) * j / buffer.sampleRate);
                        await applyLoadedDrumMachineSampleBuffer(kind, buffer, {fileName: `${kind}-clear-fixture.wav`});
                    }
                    setDrumMachineDirectOutput(true, {silent: true, skipSave: true});
                    setDrumMachineEnabled(true, {silent: true, skipSave: true});
                    restoreDrumMachineRoll({length: 128});
                    window.clearPatterns = () => ({
                        kick: [drumMachineKickPattern, drumMachineKickRatchetPattern],
                        snare: [drumMachineSnarePattern, drumMachineSnareRatchetPattern],
                        hat: [drumMachineHatPattern, drumMachineHatRatchetPattern, drumMachineHatAccentPattern],
                        perc: [drumMachinePercPattern, drumMachinePercRatchetPattern],
                        ...Object.fromEntries(Object.values(drumMachineExtraTracks).map(t => [t.kind, [t.pattern, t.ratchets, t.accents]])),
                        roll: [drumMachineRoll.pattern, drumMachineRoll.ratchets]
                    });
                    window.seedClearPatterns = () => {
                        for (const arrays of Object.values(clearPatterns())) {
                            arrays.forEach((a, i) => a.fill(i === 1 ? 0 : false));
                            arrays.forEach((a, i) => { a[0] = a[a.length - 1] = i === 1 ? 4 : true; });
                        }
                        syncDrumMachineUi(); saveState();
                    };
                    window.clearSounds = () => ({
                        buffers: [drumMachineKickBuffer, drumMachineSnareBuffer, drumMachineHatBuffer, drumMachinePercBuffer, ...Object.values(drumMachineExtraTracks).map(t => t.buffer)],
                        settings: JSON.stringify({metadata: ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc'].map(getDrumMachineTrackMetadata),
                            controls: [...document.querySelectorAll('#drumMachineOverlay input[type=range], #drumSendEffects input, #drumSendEffects select')].map(e => [e.id, e.value]),
                            enabled: drumMachineEnabled, direct: drumMachineDirectOutput, level: drumMachineLevel,
                            timing: drumMachineHatTimingMode, rollLength: drumMachineRoll.length, length: getDrumMachinePatternLength()})
                    });
                    window.originalClearSounds = clearSounds();
                    window.assertClearSounds = () => {
                        const now = clearSounds();
                        if (now.settings !== originalClearSounds.settings || now.buffers.some((b, i) => b !== originalClearSounds.buffers[i])) throw new Error('Clear changed sounds/settings');
                    };
                    seedClearPatterns(); openDrumMachineOverlay();
                });
                assert.equal(await page.locator('#drumMachineOverlay button').filter({hasText: /^Clear lane$/}).count(), 8);
                for (const running of [false, true]) {
                    if (running) { await press('#drumMachinePlayBtn'); await page.waitForFunction(() => drumMachinePlaying); }
                    const origin = await page.evaluate(() => drumMachineTransportStartTime);
                    for (const kind of lanes) {
                        await page.evaluate(() => seedClearPatterns());
                        const before = await page.evaluate(() => clearPatterns());
                        await press(`[data-drum-jump="${kind}"]`);
                        await press(`#${prefix(kind)}ClearBtn`);
                        const after = await page.evaluate(() => { assertClearSounds(); return clearPatterns(); });
                        for (const lane of lanes) {
                            if (lane === kind) assert(after[lane].every(array => array.every(value => !value)), `uncleared ${lane}`);
                            else assert.deepEqual(after[lane], before[lane], `clearing ${kind} changed ${lane}`);
                        }
                        assert.deepEqual(await page.evaluate(() => [drumMachinePlaying, drumMachineTransportStartTime]), [running, origin]);
                    }
                    await page.evaluate(() => seedClearPatterns());
                    const before = await page.evaluate(() => clearPatterns());
                    const undo = await page.evaluate(() => mygrainCardHistory.counts.undo);
                    await press('#drumMachineClearAllBtn');
                    assert(await page.evaluate(() => { assertClearSounds(); return Object.values(clearPatterns()).flat(2).every(x => !x); }));
                    assert.equal(await page.evaluate(() => mygrainCardHistory.counts.undo), Math.min(10, undo + 1));
                    await page.evaluate(() => mygrainCardHistory.undo());
                    assert.deepEqual(await page.evaluate(() => clearPatterns()), before);
                    // History travel restores audio lazily; assert exact PCM as well as metadata.
                    const pcmKept = await page.evaluate(() => clearSounds().buffers.every((b, i) => b.getChannelData(0).every((v, j) => v === originalClearSounds.buffers[i].getChannelData(0)[j])));
                    assert(pcmKept);
                    await page.evaluate(() => { originalClearSounds = clearSounds(); });
                    await page.evaluate(() => mygrainCardHistory.redo());
                    assert(await page.evaluate(() => Object.values(clearPatterns()).flat(2).every(x => !x)), JSON.stringify(await page.evaluate(() => ({running: drumMachinePlaying, counts: mygrainCardHistory.counts, label: mygrainCardHistory.undoLabel, nonempty: Object.entries(clearPatterns()).map(([k, a]) => [k, a.map(p => p.filter(Boolean).length)]), status: document.getElementById('settlePopup').textContent}))));
                    if (running) await press('#drumMachinePlayBtn');
                }
                // Main-card action is independently reachable by phone and desktop.
                await press('#drumMachineCloseBtn');
                await page.evaluate(() => { originalClearSounds = clearSounds(); seedClearPatterns(); });
                await press('#performanceDrumMachineClearAllBtn');
                assert(await page.evaluate(() => { assertClearSounds(); return Object.values(clearPatterns()).flat(2).every(x => !x); }));
                // Loading and recording protection rejects clear without a partial edit.
                await page.evaluate(() => { seedClearPatterns(); drumMachineLoadInFlight = true; });
                await press('#performanceDrumMachineClearAllBtn');
                assert(await page.evaluate(() => Object.values(clearPatterns()).every(a => a[0].some(Boolean))));
                await page.evaluate(() => { drumMachineLoadInFlight = false; isRecording = true; });
                await press('#performanceDrumMachineClearAllBtn');
                assert(await page.evaluate(() => Object.values(clearPatterns()).every(a => a[0].some(Boolean))));
                await page.evaluate(() => { isRecording = false; });
                // Real saved-part amendment: clear while running, save and decode server archive.
                await page.evaluate(async () => {
                    document.getElementById('songBetaName').value = 'Sequence clear';
                    await mygrainSongBeta.run(() => mygrainSongBeta.newSong());
                    document.getElementById('songBetaPartName').value = 'Sounds retained';
                    await mygrainSongBeta.run(() => mygrainSongBeta.newPart());
                    await mygrainSongBeta.run(() => mygrainSongBeta.amendPart(mygrainSongBeta.song.parts[0]));
                    openDrumMachineOverlay();
                });
                await press('#drumMachinePlayBtn');
                await press('#drumMachineClearAllBtn');
                assert(await page.evaluate(() => drumMachinePlaying && Object.values(clearPatterns()).flat(2).every(x => !x)));
                await press('#drumMachinePlayBtn');
                const saved = await page.evaluate(async () => {
                    await mygrainSongBeta.run(() => mygrainSongBeta.savePart());
                    const decoded = await mygrainSongBeta.loadPart(mygrainSongBeta.song.parts[0]);
                    const snapshot = decoded.snapshot;
                    mygrainSongBetaAdapter.recall(decoded, {start: false});
                    return {empty: Object.values(clearPatterns()).flat(2).every(x => !x),
                        assets: snapshot.assets.filter(x => /^drum/.test(x.key)).length,
                        lengths: [getDrumMachinePatternLength(), drumMachineRoll.length],
                        samples: clearSounds().buffers.every(Boolean)};
                });
                assert.deepEqual(saved, {empty: true, assets: 7, lengths: [32, 128], samples: true});
                await page.evaluate(async () => { await mygrainSongBetaAdapter.whenPersisted(); saveState({force: true}); });
                await page.reload();
                await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                await press('#start-btn');
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                assert.equal(await page.evaluate(() => [...drumMachineKickPattern, ...drumMachineSnarePattern, ...drumMachineHatPattern, ...drumMachinePercPattern, ...Object.values(drumMachineExtraTracks).flatMap(t => t.pattern), ...drumMachineRoll.pattern].some(Boolean)), false);
                if (mobile) for (const viewport of [{width: 320, height: 640}, {width: 844, height: 390}]) {
                    await page.setViewportSize(viewport);
                    await page.evaluate(() => openDrumMachineOverlay());
                    for (const kind of lanes) {
                        await press(`[data-drum-jump="${kind}"]`);
                        await press(`#${prefix(kind)}ClearBtn`);
                    }
                    assert(await page.evaluate(() => document.querySelector('.drum-machine-shell').scrollWidth <= document.querySelector('.drum-machine-shell').clientWidth + 1));
                    await page.screenshot({path: `${evidence}/${engine}-${viewport.width}.png`});
                    await press('#drumMachineCloseBtn');
                }
                assert.deepEqual(errors, []);
                results.push({engine, mobile, lanes: lanes.length, stoppedAndRunning: true, saved});
                fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
                console.log('PASS', engine, mobile ? 'phone' : 'desktop', JSON.stringify(saved));
                await context.close();
            }
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
