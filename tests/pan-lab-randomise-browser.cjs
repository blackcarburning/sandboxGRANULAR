const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18940/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Disposable local accounts only');
const evidence = process.env.PANLAB_EVIDENCE || '/tmp/mygrain-panlab-randomise';
const amounts = ['finalPanCenter', 'finalPanWidth', 'finalPanLfoDepth', 'finalPanAudioDepth', 'finalPanOrbit', 'finalPanGravity'];
const manual = { finalPanLfoRate: '180', finalPanLfoPulseWidth: '45', finalPanAudioSmoothing: '79', finalPanLfoWaveform: 'triangle', finalPanAudioDivider: '32', finalPanAudioMode: 'peak' };
fs.mkdirSync(evidence, { recursive: true });

(async () => {
    const results = [];
    for (const name of (process.env.PANLAB_ENGINES || 'chromium,webkit').split(',')) {
        const browser = await ({ chromium, webkit }[name]).launch(name === 'chromium'
            ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
                const registration = await context.request.post(base + 'api/auth/register', { data: { username: `pan_${name[0]}_${viewport.width}_${Date.now()}`, password: 'disposable-panlab-test' } });
                assert.equal(registration.status(), 200);
                const page = await context.newPage(), errors = [], writes = [];
                page.setDefaultTimeout(30000);
                page.on('pageerror', e => errors.push(e.message));
                page.on('dialog', d => d.accept());
                await page.route('**/*', route => {
                    const request = route.request();
                    if (!['GET', 'HEAD'].includes(request.method()) && !new URL(request.url()).pathname.includes('/api/accounts/')) { writes.push(request.method()); return route.abort(); }
                    if (new URL(request.url()).origin !== new URL(base).origin) return route.abort();
                    return route.continue();
                });
                await page.goto(base, { waitUntil: 'load' });
                await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.evaluate(() => mygrainCardHistory.ready);
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(() => {
                    // Only asset fetches/generation are replaced: real randomizers, events,
                    // persistence, pan DSP and async completion paths remain in use.
                    generateSourceWithPlaybackRestart = async () => {};
                    buildMegaRandomBastardLoopTaskSpecs = () => [];
                    loadBastardLoopLSampleFromSource = async () => {};
                    loadBastardLoopXSampleFromSource = async () => {};
                    loadDropboxSampleLayerFromSource = async () => {};
                    loadRandomDrumMachineSamples = async () => {};
                    window.panOriginalSong = JSON.stringify(mygrainSongBeta.song);
                    window.panOriginalContext = audioContext;
                    const patch = runPatchRandomization, mega = runMegaRandomization;
                    runPatchRandomization = async () => { try { return await patch(); } finally { window.panPatchDone = true; } };
                    runMegaRandomization = async options => { try { return await mega(options); } finally { window.panMegaDone = true; } };
                });
                const modes = [];
                for (const [mode, button] of [['patch', 'performanceRandomizeBtn'], ['sparse', 'performanceSparseRandomBtn'], ['mega', 'performanceMegaRandomBtn']]) {
                    await page.evaluate(({ amounts, manual }) => {
                        stopAllPerformancePlayback({ silent: true });
                        amounts.forEach(id => setSliderValue(id, id === 'finalPanCenter' ? -85 : 90));
                        for (const [id, value] of Object.entries(manual)) {
                            const el = document.getElementById(id);
                            if (el.matches('select')) setSelectValue(id, value); else setSliderValue(id, value);
                        }
                        updateFinalOutputPanning(); saveState();
                        window.panPatchDone = false; window.panMegaDone = false;
                    }, { amounts, manual });
                    await page.locator(button === 'performanceRandomizeBtn' ? '#performanceRandomizeBtn' : `#${button}`).evaluate(el => el.click());
                    await page.waitForFunction(mode => mode === 'patch' ? window.panPatchDone : window.panMegaDone, mode);
                    await page.waitForFunction(() => !megaRandomizeInFlight);
                    const state = await page.evaluate(({ amounts, manual }) => ({
                        values: amounts.map(id => document.getElementById(id).value),
                        labels: amounts.map(id => document.getElementById(id + 'Value').textContent),
                        manual: Object.fromEntries(Object.keys(manual).map(id => [id, document.getElementById(id).value])),
                        saved: amounts.map(id => readStoredStateSnapshot()?.sliders[id]),
                        songUnchanged: JSON.stringify(mygrainSongBeta.song) === panOriginalSong,
                        contextUnchanged: audioContext === panOriginalContext,
                        warning: /failed|warnings/i.test(statusDiv.textContent)
                    }), { amounts, manual });
                    assert.deepEqual(state.values, amounts.map(() => '0'), `${name} ${mode}: pan must reset`);
                    assert.deepEqual(state.labels, amounts.map(() => '0%'));
                    assert.deepEqual(state.saved, amounts.map(() => '0'));
                    assert.deepEqual(state.manual, manual, 'inactive rate/shape/tracking preferences must not randomize');
                    assert.ok(state.songUnchanged && state.contextUnchanged && !state.warning);
                    await page.waitForFunction(() => Math.abs(finalPanBaseOffsetSource.offset.value) < .0001 && Math.abs(finalPanAudioDepthGain.gain.value) < .0001);
                    // Pan Lab remains usable retrospectively, and persists when applied manually.
                    await page.evaluate(() => {
                        setSliderValue('finalPanCenter', 70);
                        document.getElementById('finalPanCenter').dispatchEvent(new Event('change', { bubbles: true }));
                    });
                    await page.waitForFunction(() => finalPanBaseOffsetSource.offset.value > .69);
                    assert.equal(await page.evaluate(() => readStoredStateSnapshot().sliders.finalPanCenter), '70');
                    modes.push({ mode, neutral: true, manualPanAfterwards: true });
                }
                // Finish neutral, then check the saved random result survives a new engine.
                await page.evaluate(async () => { await runMegaRandomization({ sparseMode: true }); stopAllPerformancePlayback({ silent: true }); });
                await page.reload({ waitUntil: 'load' });
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                assert.deepEqual(await page.evaluate(amounts => amounts.map(id => document.getElementById(id).value), amounts), amounts.map(() => '0'));
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
                await page.locator('#finalPanSection').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
                await page.screenshot({ path: path.join(evidence, `${name}-${viewport.width}.png`) });
                assert.deepEqual(errors, []); assert.deepEqual(writes, []);
                results.push({ engine: name, viewport, modes, reloadNeutral: true, errors, writes });
                console.log(JSON.stringify(results.at(-1)));
                await context.close();
            }
        } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
