'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19342/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);

(async () => {
    for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
        const browser = await browserType.launch(engine === 'chromium' ? {
            executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        try {
            const context = await browser.newContext(engine === 'webkit'
                ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
                : { viewport: { width: 1280, height: 844 } });
            const page = await context.newPage(), errors = [];
            console.log('START', engine);
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            assert((await context.request.post(base + 'api/auth/login', { data: { username: 'admin', password: 'isolated-render-refresh-fixture' } })).ok());
            await page.goto(base);
            await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainMasterBaker);
            await page.evaluate(() => mygrainCardHistory.ready);
            console.log('READY', engine);
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            console.log('ENGINE', engine);
            await page.locator('#wireWorldCard').evaluate(el => mygrainDisplay.reveal(el));
            await page.waitForSelector('#wireWorldRandom', { state: 'attached' });
            const rows = await page.evaluate(async () => {
                const recipe = { enabled: true, preset: 'level', settings: { ...MygrainMasterDSP.PRESETS.level, drive: -11, tape: .3 } };
                const saved = () => JSON.stringify(mygrainMasterBaker.settings());
                const rows = [];
                async function check(name, action, undo = true) {
                    stopAllPerformancePlayback({ silent: true });
                    await mygrainMasterBaker.restore(recipe);
                    const before = saved();
                    await action();
                    while (mygrainCardHistory.busy) await new Promise(resolve => setTimeout(resolve, 10));
                    await mygrainMasterBaker.whenReady();
                    if (mygrainMasterBaker.settings().enabled) throw Error(name + ': Master Baker stayed On');
                    if (saved() !== JSON.stringify({ ...JSON.parse(before), enabled: false })) throw Error(name + ': recipe changed');
                    if (undo) {
                        await mygrainCardHistory.undo();
                        if (saved() !== before) throw Error(name + ': Undo did not restore power/recipe');
                        await mygrainCardHistory.redo();
                        if (mygrainMasterBaker.settings().enabled) throw Error(name + ': Redo did not restore Off');
                    }
                    rows.push({ name, off: true, recipePreserved: true, undo });
                }
                await check('Drum patterns', () => randomizeDrumMachinePatterns());
                await check('OSC3 random sound', () => randomizeSynthPopupPatch());
                await check('Acoustic Randomise button', async () => {
                    document.getElementById('wireWorldRandom').click();
                    while (mygrainCardHistory.busy) await new Promise(resolve => setTimeout(resolve, 10));
                });
                await check('Bass Face Randomise button', () => { document.getElementById('bassFaceRandom').click(); });
                await check('Mutilator Randomise button', () => { document.getElementById('loopDMutilatorRandom').click(); });
                await check('Noise Randomise button', () => { document.getElementById('noiseNRandom').click(); });
                await check('Stir button', () => mygrainCardHistory.runDraftEdit('Stir the cooking pot', () => mygrainCookingPot.stir({ random: () => .27 })));
                await check('BIG STIR button', () => mygrainCardHistory.runDraftEdit('BIG STIR cooking pot', () => mygrainCookingPot.stir({ big: true, random: () => .37 })));
                // Keep network sample selection out of this power-policy test;
                // execute the real patch/Mega/Sparse generators and history.
                generateSourceWithPlaybackRestart = async () => {};
                buildMegaRandomBastardLoopTaskSpecs = () => [];
                requestMegaRandomBastardLoopBuild = async () => null;
                applyMegaRandomBastardLoopBuild = async () => {};
                randomizeBastardLoopWCut = () => {};
                loadMegaRandomGranularSample = async () => {};
                mygrainD.random = async () => {};
                loadBastardLoopLSampleFromSource = async () => {};
                loadBastardLoopXSampleFromSource = async () => {};
                loadDropboxSampleLayerFromSource = async () => {};
                loadRandomDrumMachineSamples = async () => {};
                await check('Ordinary randomise', () => runPatchRandomization());
                await check('Sparse randomise', () => runMegaRandomization({ sparseMode: true }));
                await check('Mega randomise', () => runMegaRandomization({ tempoDecision: false }));
                await mygrainMasterBaker.restore(recipe);
                const before = saved();
                mygrainCardHistory.runDraftEdit('Manual control', () => {});
                if (saved() !== before) throw Error('Manual edit changed Baker power');
                const originalPrompt = promptMegaTempo;
                try {
                    promptMegaTempo = async () => null;
                    await runMegaRandomization();
                } finally { promptMegaTempo = originalPrompt; }
                if (saved() !== before) throw Error('Cancelled randomise changed Baker');
                const old = isRecording;
                try {
                    isRecording = true;
                    try { randomizeDrumMachinePatterns(); throw Error('Rejected action was allowed'); }
                    catch (error) { if (!/Finish recording/.test(error.message)) throw error; }
                } finally { isRecording = old; }
                if (saved() !== before) throw Error('Rejected randomise changed Baker');
                saveState();
                if (!readStoredStateSnapshot().modes.masterBaker.enabled) throw Error('Manual On did not persist');
                return rows;
            });
            assert.equal(rows.length, 11);
            assert.deepEqual(errors, []);
            fs.writeFileSync(path.join(out, 'baker-random-' + engine + '.json'), JSON.stringify({ rows, cancelledAndRejectedUnchanged: true, manualOnPersists: true, errors }, null, 2));
            console.log('PASS', engine, JSON.stringify(rows), 'Cancel/rejected/manual preserved');
            await context.close();
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
