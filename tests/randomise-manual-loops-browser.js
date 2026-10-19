const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:8765/mygrain/';
const baseline = process.env.MYGRAIN_BASELINE_DIR;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const results = [];
    const errors = [];
    const writes = [];
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            page.on('pageerror', error => errors.push(error.stack));
            page.on('dialog', dialog => dialog.accept());
            await page.route('**/*', route => {
                const request = route.request();
                const url = new URL(request.url());
                if (!['GET', 'HEAD'].includes(request.method())) {
                    writes.push(request.method());
                    return route.abort();
                }
                if (url.origin !== new URL(base).origin) return route.abort();
                if (baseline && [new URL(base).pathname, `${new URL(base).pathname}q-card.js`].includes(url.pathname)) {
                    const name = url.pathname.endsWith('.js') ? 'q-card.js' : 'index.html';
                    return route.fulfill({ body: fs.readFileSync(path.join(baseline, name)), contentType: name.endsWith('.js') ? 'application/javascript' : 'text/html' });
                }
                return route.continue();
            });
            await page.goto(`${base}?randomise-manual-mutes-check=1`, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                setBastardLoopMEnabled(false, { silent: true });
                setBastardLoopMPlusEnabled(false, { silent: true });
                mygrainQ.setEnabled(false);
            });
            const mutedStyle = await page.evaluate(() => {
                const style = id => {
                    const button = document.getElementById(id);
                    const computed = getComputedStyle(button);
                    return { background: computed.backgroundColor, color: computed.color, border: computed.borderColor, muted: button.classList.contains('layer-muted') };
                };
                return { q: style('performanceBastardLoopQGlobalToggleBtn'), m: style('performanceBastardLoopMToggleBtn') };
            });
            assert.deepEqual(mutedStyle.q, mutedStyle.m);
            const toggle = page.locator('#performanceBastardLoopQGlobalToggleBtn');
            await toggle.scrollIntoViewIfNeeded();
            await toggle.tap();
            assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
            assert.equal(await toggle.evaluate(button => button.classList.contains('layer-muted')), false);
            await toggle.tap();
            assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
            assert.equal(await toggle.evaluate(button => button.classList.contains('layer-muted')), true);
            await page.evaluate(() => {
                generateSourceWithPlaybackRestart = async () => {};
                buildMegaRandomBastardLoopTaskSpecs = () => [];
                loadBastardLoopLSampleFromSource = async () => {};
                loadBastardLoopXSampleFromSource = async () => {};
                loadDropboxSampleLayerFromSource = async () => {};
                loadRandomDrumMachineSamples = async () => {};
                window.manualLoopFixture = audioContext.createBuffer(1, 4410, 44100);
                bastardLoopMBuffer = manualLoopFixture;
                bastardLoopMPlusBuffer = manualLoopFixture;
                bastardLoopKBuffer = manualLoopFixture;
                bastardLoopKRawBuffer = manualLoopFixture;
                bastardLoopKMetadata = { summary: 'K randomise regression take', durationSeconds: manualLoopFixture.duration, bpm: 120 };
                window.manualKFixture = JSON.stringify({ metadata: bastardLoopKMetadata, samples: [...manualLoopFixture.getChannelData(0)], reverse: bastardLoopKReverse, preserveDuration: bastardLoopKPreserveDuration });
                mygrainQ.state.sequence[0] = MygrainQTheory.normalizeStep({ notes: [60, 64, 67], velocity: 90 });
                window.manualChordFixture = JSON.stringify(mygrainQ.state.sequence);
                const patch = runPatchRandomization;
                const mega = runMegaRandomization;
                runPatchRandomization = async () => { try { return await patch(); } finally { window.patchChecksDone = (window.patchChecksDone || 0) + 1; } };
                runMegaRandomization = async options => { try { return await mega(options); } finally { window.megaChecksDone = (window.megaChecksDone || 0) + 1; } };
            });
            const modes = [];
            for (const [mode, buttonId] of [['patch', 'performanceRandomizeBtn'], ['mega', 'sectionJumpMegaRandomBtn'], ['sparse', 'sectionJumpSparseRandomBtn']]) {
                const initialK = await page.evaluate(mode => {
                    stopAllPerformancePlayback({ silent: true });
                    setLoopLayerSolo([], { silent: true, skipSave: true });
                    setBastardLoopMEnabled(true, { silent: true });
                    setBastardLoopMPlusEnabled(true, { silent: true });
                    setBastardLoopKEnabled(true, { silent: true, skipSave: true });
                    setBastardLoopKLevelPercent(75, { skipSave: true });
                    const started = startBastardLoopK(audioContext.currentTime);
                    setLoopLayerSolo(mode === 'patch' ? 'bastardk' : (mode === 'mega' ? 'bastardm' : []), { silent: true, skipSave: true });
                    mygrainQ.setEnabled(true);
                    window.patchChecksDone = 0;
                    window.megaChecksDone = 0;
                    return { started, enabled: bastardLoopKEnabled };
                }, mode);
                assert.deepEqual(initialK, { started: true, enabled: true });
                await page.evaluate(id => document.getElementById(id).click(), buttonId);
                await page.waitForFunction(mode => mode === 'patch' ? window.patchChecksDone > 0 : window.megaChecksDone > 0, mode);
                const state = await page.evaluate(() => ({
                    enabled: [bastardLoopMEnabled, bastardLoopMPlusEnabled, mygrainQ.state.enabled, bastardLoopKEnabled],
                    gains: [getBastardLoopMOutputGain(), getBastardLoopMPlusOutputGain(), getBastardLoopKOutputGain()],
                    muted: ['performanceBastardLoopMToggleBtn', 'performanceBastardLoopMPlusToggleBtn', 'performanceBastardLoopQGlobalToggleBtn', 'performanceBastardLoopKToggleBtn'].map(id => document.getElementById(id).classList.contains('layer-muted')),
                    kStopped: bastardLoopKSource === null,
                    kPreserved: bastardLoopKBuffer === manualLoopFixture && bastardLoopKRawBuffer === manualLoopFixture && JSON.stringify({ metadata: bastardLoopKMetadata, samples: [...bastardLoopKRawBuffer.getChannelData(0)], reverse: bastardLoopKReverse, preserveDuration: bastardLoopKPreserveDuration }) === manualKFixture,
                    qToggles: [...document.querySelectorAll('[data-q-action="toggle"]')].every(button => button.classList.contains('layer-muted') && button.getAttribute('aria-pressed') === 'false'),
                    preserved: bastardLoopMBuffer === manualLoopFixture && bastardLoopMPlusBuffer === manualLoopFixture && JSON.stringify(mygrainQ.state.sequence) === manualChordFixture,
                    warning: /failed|warnings/i.test(statusDiv.textContent)
                }));
                assert.deepEqual(state.enabled, [false, false, false, false]);
                assert.deepEqual(state.gains, [0, 0, 0]);
                assert.deepEqual(state.muted, [true, true, true, true]);
                assert.equal(state.kStopped, true);
                assert.equal(state.kPreserved, true);
                assert.equal(state.qToggles, true);
                assert.equal(state.preserved, true);
                assert.equal(state.warning, false);
                modes.push(mode);
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            results.push({ viewport, mutedStyle, modes, preserved: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
