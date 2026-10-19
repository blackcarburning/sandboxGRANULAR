const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium, webkit } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:18915';
const source = process.env.RANDOMISE_VARIATION_SOURCE || path.join(root, 'index.html');
const evidence = process.env.RANDOMISE_VARIATION_EVIDENCE;

for (const engine of (process.env.RANDOMISE_VARIATION_ENGINES || 'chromium,webkit').split(',')) {
    test(`${engine}: actual Randomize, Mega and Sparse buttons produce fresh audible choices`, { timeout: 120000 }, async () => {
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium' ? {
            executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        const results = { engine, cases: [], errors: [], writes: [] };
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            page.on('dialog', dialog => dialog.accept());
            page.on('pageerror', error => results.errors.push(error.message));
            await page.route('**/*', route => {
                const request = route.request();
                const url = new URL(request.url());
                if (!['GET', 'HEAD'].includes(request.method())) {
                    results.writes.push(url.pathname);
                    return route.abort();
                }
                if (url.origin !== origin) return route.abort();
                if (url.pathname.endsWith('/account-context.js')) return route.fulfill({ body: 'window.mygrainAccountContext={user:{username:"variation-fixture"}};', contentType: 'application/javascript' });
                if (url.pathname.includes('/api/')) return route.fulfill({ json: { ok: true, authenticated: true, user: { username: 'variation-fixture' }, samples: [], files: [], sources: [], stations: [], patches: [], songs: [], favourites: [], shares: [] } });
                const relative = decodeURIComponent(url.pathname.replace(/^\/mygrain\//, '')) || 'index.html';
                const filename = relative === 'index.html' ? source : path.resolve(root, relative);
                if (!filename.startsWith(`${root}/`) && filename !== source) return route.abort();
                if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return route.fulfill({ status: 404, body: '' });
                return route.fulfill({ body: fs.readFileSync(filename), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(filename)] || 'application/octet-stream' });
            });
            await page.goto(`${origin}/mygrain/`);
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            results.startupErrors = [...results.errors];
            await page.evaluate(async () => {
                syncPatternLengthControls(16);
                applyGlobalBpm(123);
                const fixture = audioContext.createBuffer(2, audioContext.sampleRate, audioContext.sampleRate);
                for (let channel = 0; channel < 2; channel += 1) {
                    const data = fixture.getChannelData(channel);
                    for (let index = 0; index < data.length; index += 1) data[index] = Math.sin(index * 2 * Math.PI * (channel ? 330 : 220) / audioContext.sampleRate) * .15;
                }
                window.variationFixture = fixture;
                window.variationWave = audioBufferToWav24bit(fixture);
                requestGeneratedBastardLoopAudio = async () => ({ metadata: { bpm: 123, sampleNames: ['isolated-fixture.wav'] }, arrayBuffer: variationWave.slice(0) });
                loadBastardLoopLSampleFromSource = async () => { bastardLoopLBuffer = variationFixture; };
                loadBastardLoopXSampleFromSource = async () => { bastardLoopXBuffer = variationFixture; };
                loadDropboxSampleLayerFromSource = async () => applyLoadedDropboxSampleLayerBuffer(variationFixture, { fileName: 'isolated-fixture.wav' });
                loadDrumMachineSample = async kind => applyLoadedDrumMachineSampleBuffer(kind, variationFixture, { fileName: `${kind}-fixture.wav` });
                const patch = runPatchRandomization;
                runPatchRandomization = async () => { const result = await patch(); window.variationPatchDone = (window.variationPatchDone || 0) + 1; return result; };
                const mega = runMegaRandomization;
                runMegaRandomization = async options => { const result = await mega(options); window.variationMegaDone = (window.variationMegaDone || 0) + 1; return result; };
                window.variationAnalyser = audioContext.createAnalyser();
                variationAnalyser.fftSize = 2048;
                finalAmplifierNode.connect(variationAnalyser);
                window.variationPlayedNotes = [];
                const playNote = playOscillatorNote;
                playOscillatorNote = (note, time, velocity, options) => {
                    if (options?.role === 'sequencer') variationPlayedNotes.push(note);
                    return playNote(note, time, velocity, options);
                };
            });
            let patchCount = 0;
            let megaCount = 0;
            for (const [index, button] of ['performanceRandomizeBtn', 'performanceRandomizeBtn', 'performanceMegaRandomBtn', 'performanceSparseRandomBtn'].entries()) {
                await page.evaluate(seed => {
                    Math.random = MYGRAIN_UTILS.createSeededRandom(seed);
                    variationPlayedNotes.length = 0;
                }, `browser-take-${index}`);
                await page.locator(`#${button}`).click();
                patchCount += 1;
                if (index >= 2) megaCount += 1;
                await page.waitForFunction(({ patchCount, megaCount }) => window.variationPatchDone === patchCount && (window.variationMegaDone || 0) === megaCount && !megaRandomizeInFlight, { patchCount, megaCount });
                await page.evaluate(() => { variationPlayedNotes.length = 0; });
                const snapshot = await page.evaluate(async () => {
                    const data = generatedLoopBaseBuffer.getChannelData(0);
                    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))).map(value => value.toString(16).padStart(2, '0')).join('');
                    let peak = 0;
                    const frames = new Float32Array(variationAnalyser.fftSize);
                    for (let attempt = 0; attempt < 16; attempt += 1) {
                        await new Promise(resolve => setTimeout(resolve, 75));
                        variationAnalyser.getFloatTimeDomainData(frames);
                        for (const value of frames) peak = Math.max(peak, Math.abs(value));
                    }
                    return { hash, bpm: getSharedBpmClockValue(), steps: getPatternLengthSteps(), duration: generatedLoopBaseBuffer.duration,
                        pitches: sequencerSteps.map(step => step.enabled ? step.pitch : '-'), hats: drumMachineHatPattern.map(Number).join(''),
                        playedNotes: [...variationPlayedNotes],
                        sourcePeak: Math.max(...data.slice(0, 32000).map(Math.abs)), livePeak: peak,
                        status: document.getElementById('status').textContent };
                });
                assert.equal(snapshot.bpm, 123);
                assert.equal(snapshot.steps, 16);
                assert.ok(Math.abs(snapshot.duration - 240 / 123) < 1 / 8000);
                assert.ok(snapshot.sourcePeak > .05);
                assert.ok(snapshot.livePeak > .00001, JSON.stringify(snapshot));
                assert.ok(snapshot.playedNotes.length > 0, JSON.stringify(snapshot));
                assert.ok(snapshot.playedNotes.every(note => snapshot.pitches.includes(note)), JSON.stringify(snapshot));
                results.cases.push({ button, ...snapshot });
            }
            assert.equal(new Set(results.cases.map(entry => entry.hash)).size, 4);
            assert.equal(new Set(results.cases.map(entry => entry.pitches.join(','))).size, 4);
            assert.notEqual(results.cases[2].hats, results.cases[3].hats);
            assert.equal(results.writes.length, 0);
            assert.deepEqual(results.errors, results.startupErrors);
            await page.setViewportSize({ width: 844, height: 390 });
            assert.equal(await page.locator('#performanceRandomizeBtn').isVisible(), true);
        } finally {
            if (evidence) {
                fs.mkdirSync(evidence, { recursive: true });
                fs.writeFileSync(path.join(evidence, `${engine}-button-results.json`), JSON.stringify(results, null, 2));
            }
            await browser.close();
        }
    });
}
