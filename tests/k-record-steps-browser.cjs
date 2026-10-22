// Actual keyboard capture, native step inputs, disposable local Song accounts only.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18897/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({chromium, webkit})) {
        const browser = await type.launch(engine === 'chromium' ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
        try {
            for (const mobile of [false, true]) {
                const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900}, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce'});
                assert.equal((await context.request.post(base + 'api/auth/register', {data: {username: `ksteps_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-k-record-steps'}})).status(), 200);
                const page = await context.newPage(), errors = [];
                page.on('pageerror', e => errors.push(e.message));
                await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
                const press = s => mobile ? page.locator(s).tap() : page.locator(s).click();
                async function start() {
                    await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                    await page.evaluate(() => mygrainCardHistory.ready);
                    await press('#start-btn');
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                }
                async function setSteps(value, selector = '#performanceKeyboardKRecordSteps') {
                    await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab');
                }
                await page.goto(base); await start();
                await page.evaluate(async () => {
                    stopAllPerformancePlayback({silent: true}); setArpeggiatorEnabled(false, {skipSave: true}); setHoldEnabled(true);
                    applyGlobalBpm(300); syncPatternLengthControls(8, {skipSave: true}); setBastardLoopKRecordingSteps(null);
                    const source = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                    for (let i = 0; i < source.length; i++) source.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * 220 * i / source.sampleRate);
                    bastardLoopBuffer = source; bastardLoopSourceBpm = 300; bastardLoopEnabled = true;
                    setDrumMachineEnabled(false, {silent: true, skipSave: true});
                    setFxMuted(true, {silent: true}); syncBastardLoopKUi();
                });
                await press('#performanceKeyboardSoundSwitch [data-keyboard-sound="osc"]');
                await page.evaluate(async () => {await prepareKeyboardSound('osc'); heldNotes = new Set(['C4', 'E4']); setHoldEnabled(true);});
                assert.equal(await page.locator('#performanceKeyboardKRecordSteps').inputValue(), '8');
                assert.equal(await page.locator('#performanceKeyboardKRecordSteps').getAttribute('max'), null);
                await setSteps(19);
                assert.equal(await page.locator('#performanceBastardLoopKRecordSteps').inputValue(), '19');
                await page.evaluate(() => syncPatternLengthControls(16, {skipSave: true}));
                assert.equal(await page.locator('#performanceKeyboardKRecordSteps').inputValue(), '19');
                await setSteps(0); assert.equal(await page.locator('#performanceKeyboardKRecordSteps').inputValue(), '19');
                await press('#keyboardRecordingLengthCard [data-k-record-pattern]');
                assert.equal(await page.locator('#performanceKeyboardKRecordSteps').inputValue(), '16');
                await page.evaluate(() => syncPatternLengthControls(8, {skipSave: true}));
                const takes = [];
                for (const steps of [8, 3, 73]) {
                    if (steps !== 8) await setSteps(steps);
                    const input = page.locator('#performanceKeyboardKRecordSteps');
                    await input.scrollIntoViewIfNeeded();
                    await page.screenshot({path: `/tmp/mygrain-k-steps-${engine}-${mobile ? 'phone' : 'desktop'}-controls.png`});
                    await press('#performanceKeyboardToKRecordSurfaceBtn');
                    await page.waitForFunction(() => bastardLoopKRecordingState === 'countin');
                    assert.equal(await input.isDisabled(), true);
                    await page.waitForFunction(expected => bastardLoopKRecordingState === 'idle' && bastardLoopKMetadata?.recordingSteps === expected && !mygrainCardHistory.busy, steps, {timeout: 20000});
                    const take = await page.evaluate(() => {
                        const b = bastardLoopKRawBuffer; let sum = 0;
                        for (const value of b.getChannelData(0)) sum += value * value;
                        return {steps: bastardLoopKMetadata.recordingSteps, frames: b.length, rate: b.sampleRate, seconds: b.duration, rms: Math.sqrt(sum / b.length), following: bastardLoopKRecordingSteps === null};
                    });
                    assert.equal(take.frames, Math.round(steps * 60 / 300 / 4 * take.rate));
                    assert.ok(take.rms > .0001, JSON.stringify(take));
                    assert.equal(take.following, steps === 8); takes.push(take);
                    assert.equal(await input.isEnabled(), true);
                    await page.evaluate(() => stopAllPerformancePlayback({silent: true}));
                }
                // The actual long take and custom length must survive saved-Song recall.
                const song = await page.evaluate(async () => {
                    const c = mygrainSongBeta; document.getElementById('songBetaName').value = 'K steps fixture'; await c.newSong();
                    await c.newPart({name: '73-step keyboard take', repeats: 1});
                    setBastardLoopKRecordingSteps(null); await c.recall(c.song.parts[0], {start: false});
                    return {steps: getBastardLoopKRecordingSteps(), configured: bastardLoopKRecordingSteps, frames: bastardLoopKRawBuffer.length, metadata: bastardLoopKMetadata.recordingSteps};
                });
                assert.equal(song.steps, 73); assert.equal(song.configured, 73); assert.equal(song.frames, takes[2].frames); assert.equal(song.metadata, 73);
                // A real recording during a saved-part amendment must remain
                // permitted by its verified lease and commit only on Save.
                await page.evaluate(async () => {
                    const c = mygrainSongBeta;
                    await c.run(() => c.amendPart(c.song.parts[0]));
                    if (!c.editing) throw new Error(document.getElementById('songBetaStatus').textContent);
                    restartAllTransport({silent: true});
                });
                await setSteps(19);
                await press('#performanceKeyboardToKRecordSurfaceBtn');
                await page.waitForFunction(() => bastardLoopKRecordingState === 'idle' && bastardLoopKMetadata?.recordingSteps === 19 && !mygrainCardHistory.busy, null, {timeout: 15000});
                const amended = await page.evaluate(async () => {
                    const c = mygrainSongBeta;
                    await c.run(() => c.savePart());
                    if (c.editing) throw new Error(document.getElementById('songBetaStatus').textContent);
                    await c.recall(c.song.parts[0], {start: false});
                    return {steps: getBastardLoopKRecordingSteps(), frames: bastardLoopKRawBuffer.length, rate: bastardLoopKRawBuffer.sampleRate, metadata: bastardLoopKMetadata.recordingSteps};
                });
                assert.equal(amended.steps, 19); assert.equal(amended.metadata, 19);
                assert.equal(amended.frames, Math.round(19 * 60 / 300 / 4 * amended.rate));
                // Browser reload persistence, then explicit Pattern default persistence.
                await page.evaluate(async () => {await mygrainSongBeta.finishEditing(); saveState({force: true}); await mygrainSongBetaAdapter.whenPersisted();});
                await page.reload(); await start();
                assert.equal(await page.locator('#performanceKeyboardKRecordSteps').inputValue(), '19');
                await press('#keyboardRecordingLengthCard [data-k-record-pattern]');
                await page.evaluate(() => syncPatternLengthControls(32));
                await page.reload(); await start();
                assert.equal(await page.locator('#performanceKeyboardKRecordSteps').inputValue(), '32');
                assert.equal(await page.evaluate(() => bastardLoopKRecordingSteps), null);
                if (mobile) {
                    await page.setViewportSize({width: 844, height: 390});
                    await page.locator('#performanceKeyboardKRecordSteps').scrollIntoViewIfNeeded();
                    assert.equal(await page.locator('#performanceKeyboardKRecordSteps').isVisible(), true);
                }
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
                assert.deepEqual(errors, []);
                results.push({engine, mobile, takes, song, amended});
                fs.writeFileSync('/tmp/mygrain-k-record-steps-results.json', JSON.stringify(results, null, 2));
                console.log('PASS', engine, mobile ? 'phone' : 'desktop', JSON.stringify(takes));
                await context.close();
            }
        } finally {await browser.close();}
    }
})().catch(e => {console.error(e); process.exitCode = 1;});
