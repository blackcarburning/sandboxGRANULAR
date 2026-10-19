const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const wave = Buffer.alloc(44 + 4410 * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(44100, 24); wave.writeUInt32LE(88200, 28); wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
for (let frame = 0; frame < 4410; frame += 1) wave.writeInt16LE(Math.round(2000 * Math.sin(frame / 30)), 44 + frame * 2);

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const sparseMode of [false, true]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            page.on('dialog', dialog => dialog.accept());
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            await page.goto(`${base}?random-commentary-check=20261015`, { waitUntil: 'load' });
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
            await page.evaluate(({ encoded, sparseMode }) => {
                const pause = delay => new Promise(resolve => setTimeout(resolve, delay));
                const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0)).buffer;
                window.__commentaryEvents = [];
                const originalPopup = showSettlePopup;
                showSettlePopup = (message, options) => {
                    window.__commentaryEvents.push(message);
                    return originalPopup(message, options);
                };
                runPatchRandomization = async () => {
                    setStatus('Loading the main sample: fixture-grains.wav…');
                    await pause(80);
                    return { randomizeState: { bpm: 120 }, generationProfile: {}, audioReady: true };
                };
                randomizeMegaBastardLoopSettings = () => {};
                randomizeMegaBastardLoopLeadAndBassSettings = () => {};
                randomizeMegaDropboxSampleLayerSettings = () => {};
                randomizeMegaDrumMachineSettings = () => {};
                restartAllTransport = () => {};
                applySparseRandomLayerSelection = () => ['A', 'L', 'X', 'Grains'].map(label => ({ label }));
                const originalSpecs = buildMegaRandomBastardLoopTaskSpecs;
                buildMegaRandomBastardLoopTaskSpecs = bpm => originalSpecs(bpm).map(spec => ({
                    ...spec,
                    applyBuffer: async () => { await pause(30); setStatus(`${spec.label}: fixture audio fitted.`); }
                }));
                requestGeneratedBastardLoopAudio = async (payload, options) => {
                    await pause(200);
                    const metadata = { sampleNames: [`fixture-${options.traceLayer}.wav`] };
                    options.onProgress?.(metadata);
                    await pause(100);
                    return { metadata, arrayBuffer: bytes.slice(0) };
                };
                loadBastardLoopLSampleFromSource = async () => {
                    setStatus('Loading fixture-lead.wav…'); await pause(100); setStatus('Loop L ready: fixture-lead.wav.');
                };
                loadBastardLoopXSampleFromSource = async () => {
                    setStatus('Loading fixture-bass.wav…'); await pause(150);
                    if (sparseMode) throw new Error('Fixture bass load failed');
                    setStatus('Loop X ready: fixture-bass.wav.');
                };
                loadRandomDrumMachineSamples = async () => {
                    await pause(800); setStatus('Kick sample loaded: fixture-kick.wav.');
                };
                loadDropboxSampleLayerFromSource = () => new Promise(resolve => {
                    setStatus('Loading the Dropbox sample: fixture-dropbox.wav…');
                    window.__finishDropbox = () => { setStatus('Dropbox ready: fixture-dropbox.wav.'); resolve(); };
                });
            }, { encoded: wave.toString('base64'), sparseMode });
            await page.locator(sparseMode ? '#performanceSparseRandomBtn' : '#performanceMegaRandomBtn').click();
            const popup = page.locator('#settlePopup');
            await page.waitForFunction(() => document.getElementById('settlePopup').textContent.includes('9/10 layers finished'));
            const progress = await popup.textContent();
            assert.match(progress, sparseMode ? /Sparse Randomise/ : /Mega Randomise/);
            assert.match(progress, /Still working: Dropbox sample/);
            if (sparseMode) assert.match(progress, /1 warning/);
            await page.waitForFunction(() => /[3-9]\ds elapsed|[3-9]s elapsed/.test(document.getElementById('settlePopup').textContent));
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(viewport);
                const layout = await popup.evaluate(element => {
                    const bounds = element.getBoundingClientRect();
                    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, whiteSpace: getComputedStyle(element).whiteSpace };
                });
                assert.ok(layout.left >= 0 && layout.right <= viewport.width + 1 && layout.top >= 0 && layout.bottom <= viewport.height, JSON.stringify(layout));
                assert.equal(layout.whiteSpace, 'pre-line');
            }
            if (process.env.RANDOMISE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.RANDOMISE_SCREENSHOT_DIR}/${sparseMode ? 'sparse' : 'mega'}-commentary.png` });
            await page.evaluate(() => window.__finishDropbox());
            await page.waitForFunction(() => !megaRandomizeInFlight && megaRandomCommentary === null);
            assert.equal(await popup.getAttribute('aria-hidden'), 'true');
            assert.equal(await popup.evaluate(element => element.classList.contains('randomise-commentary')), false);
            const events = await page.evaluate(() => window.__commentaryEvents.join('\n'));
            assert.match(events, /building from .* on the server/);
            assert.match(events, /downloading fixture-/);
            assert.match(events, /decoding and fitting/);
            assert.match(events, /fixture-kick.wav/);
            assert.match(events, /10\/10 layers finished/);
            if (sparseMode) assert.match(events, /Picking the four sparse layers/);
            assert.equal(await page.evaluate(() => megaRandomAudioSuppressed), false);
            await page.evaluate(() => showSettlePopup('ordinary popup'));
            assert.equal(await popup.textContent(), 'ordinary popup');
            const fatal = await page.evaluate(async sparseMode => {
                randomizeMegaBastardLoopSettings = () => { throw new Error('Fixture settings failure'); };
                let message;
                try { await runMegaRandomization({ sparseMode }); }
                catch (error) { message = error.message; }
                return { message, inFlight: megaRandomizeInFlight, commentary: megaRandomCommentary, suppressed: megaRandomAudioSuppressed, hidden: document.getElementById('settlePopup').getAttribute('aria-hidden') };
            }, sparseMode);
            assert.deepEqual(fatal, { message: 'Fixture settings failure', inFlight: false, commentary: null, suppressed: false, hidden: 'true' });
            results.push({ mode: sparseMode ? 'sparse' : 'mega', actualBuildDecodeStages: true, elapsedWhileWaiting: true, failedTaskWarning: sparseMode, timerCleanup: true, portraitLandscape: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ results, errors, publicWrites: writes.length, sourceLoads: 'controlled fixtures; production audio not generated', physicalSafari: 'not tested' }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
