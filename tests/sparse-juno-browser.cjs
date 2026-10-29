// Isolated accounts only; the real Juno endpoint/decoder and native X transport are exercised.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18842/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
assert.notEqual(new URL(base).port, '8765', 'Never write test accounts to production');

(async () => {
    for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
        const browser = await browserType.launch(engine === 'chromium'
            ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] }
            : {});
        try {
            for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
                const context = await browser.newContext({ viewport, isMobile: viewport.width < 960, hasTouch: viewport.width < 960 });
                const page = await context.newPage();
                page.setDefaultTimeout(60000);
                const errors = [], sources = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('dialog', dialog => dialog.accept());
                await page.route('**/*', route => {
                    const request = route.request(), url = new URL(request.url());
                    if (url.origin !== new URL(base).origin) return route.abort();
                    if (url.pathname.endsWith('/api/source-sample') && request.method() === 'POST') sources.push(request.postDataJSON().source);
                    return route.continue();
                });
                try {
                    const registered = await context.request.post(base + 'api/auth/register', {
                        data: { username: 'sparse' + Date.now(), password: 'isolated-sparse-bass-fixture' }
                    });
                    assert.equal(registered.status(), 200);
                    await page.goto(base);
                    await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                    await page.locator('#start-btn').click();
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                    await page.evaluate(() => {
                        // Leave patch randomisation, bass sequence generation, Sparse selection,
                        // Juno loading, decoding and transport intact; omit unrelated asset builds.
                        generateSourceWithPlaybackRestart = async () => {};
                        buildMegaRandomBastardLoopTaskSpecs = () => [];
                        loadBastardLoopLSampleFromSource = async () => {};
                        loadDropboxSampleLayerFromSource = async () => {};
                        loadRandomDrumMachineSamples = async () => {};
                    });
                    const runs = [];
                    for (const initialMode of ['sample', 'synth']) {
                        await page.evaluate(mode => {
                            stopAllPerformancePlayback({ silent: true });
                            setBastardLoopLSourceMode('sample', { silent: true, skipSave: true });
                            setBastardLoopXSourceMode(mode, { silent: true, skipSave: true });
                            setBastardLoopXRepository('samples_bass', { skipSave: true });
                            setBastardLoopXEnabled(false, { silent: true, skipSave: true });
                            window.__sparseRunFinished = false;
                            const original = runMegaRandomization;
                            runMegaRandomization = async options => {
                                try { return await original(options); }
                                finally { runMegaRandomization = original; window.__sparseRunFinished = true; }
                            };
                        }, initialMode);
                        const sourceOffset = sources.length;
                        await page.evaluate(() => document.getElementById('performanceSparseRandomBtn').click());
                        await page.waitForFunction(() => window.__sparseRunFinished);
                        const state = await page.evaluate(() => ({
                            enabled: bastardLoopXEnabled,
                            repository: bastardLoopXRepository,
                            sourceMode: bastardLoopXSourceMode,
                            loadedSource: bastardLoopXSampleMetadata?.sourceKey,
                            frames: bastardLoopXSampleBuffer?.length,
                            playable: hasPlayableBastardLoopXTransportSource(),
                            playing: bastardLoopPlaying,
                            level: getBastardLoopXLevelValue(),
                            status: statusDiv.textContent,
                            selector: document.getElementById('performanceBastardLoopXRepository').value
                        }));
                        assert.equal(state.enabled, true);
                        assert.equal(state.repository, 'samples_altbass');
                        assert.equal(state.selector, 'samples_altbass');
                        assert.equal(state.sourceMode, 'sample');
                        assert.equal(state.loadedSource, 'samples_altbass');
                        assert(state.frames > 1000 && state.level > 0);
                        assert.equal(state.playable, true);
                        assert.equal(state.playing, true);
                        assert.doesNotMatch(state.status, /warnings|failed/i);
                        assert.deepEqual(sources.slice(sourceOffset), ['samples_altbass']);
                        const peak = await page.evaluate(async () => {
                            const analyser = audioContext.createAnalyser();
                            analyser.fftSize = 2048;
                            const destination = getBastardLoopXPlaybackDestination();
                            destination.connect(analyser);
                            let peak = 0;
                            for (let i = 0; i < 24; i++) {
                                await new Promise(resolve => setTimeout(resolve, 80));
                                const values = new Float32Array(2048);
                                analyser.getFloatTimeDomainData(values);
                                for (const value of values) peak = Math.max(peak, Math.abs(value));
                            }
                            destination.disconnect(analyser);
                            analyser.disconnect();
                            stopAllPerformancePlayback({ silent: true });
                            return peak;
                        });
                        assert(peak > 0.001, 'Sparse must produce non-silent native Bass X audio');
                        runs.push({ initialMode, ...state, peak });
                    }
                    assert.deepEqual(errors, []);
                    console.log(JSON.stringify({ engine, viewport, runs, errors }));
                } finally {
                    await context.close();
                }
            }
        } finally {
            await browser.close();
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
