const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18930/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Disposable accounts only');
const evidence = process.env.MYGRAIN_GRAIN_EVIDENCE || '/tmp/mygrain-grain-sustain';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const [engine, kind] of Object.entries({ chromium, webkit })) {
        const browser = await kind.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
                const page = await context.newPage(), errors = [];
                page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
                const registration = await context.request.post(base + 'api/auth/register', { data: { username: `gs_${engine[0]}_${viewport.width}_${Date.now()}`, password: 'disposable-grain-sustain' } });
                assert.equal(registration.status(), 200);
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.evaluate(() => mygrainCardHistory.ready);
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(async () => {
                    stopAllPerformancePlayback({ silent: true });
                    const source = audioContext.createBuffer(1, audioContext.sampleRate * 4, audioContext.sampleRate);
                    for (let i = 0, data = source.getChannelData(0); i < data.length; i++) data[i] = .15 * Math.sin(2 * Math.PI * 65.41 * i / audioContext.sampleRate);
                    grainASampleBuffer = source; grainBSampleBuffer = source;
                    await prepareGranularKeyboardFromUi();
                    setKeyboardDecay(0, { skipSave: true });
                    setHoldEnabled(true);
                    window.grainCapture = async notes => {
                        stopAllPerformancePlayback({ silent: true });
                        heldNotes.clear(); notes.forEach(note => heldNotes.add(note));
                        await MygrainSongClock.prepareCapture(audioContext);
                        const frames = Math.round(audioContext.sampleRate * 2.4), at = audioContext.currentTime + .2;
                        const capture = new AudioWorkletNode(audioContext, 'mygrain-song-capture-v1', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { startFrame: Math.round(at * audioContext.sampleRate), frames } });
                        const recorded = new Promise((resolve, reject) => {
                            const timer = setTimeout(() => reject(Error('Grain PCM capture timed out')), 10000);
                            capture.port.onmessage = event => { clearTimeout(timer); resolve(event.data.channels); };
                            capture.onprocessorerror = () => { clearTimeout(timer); reject(Error('Grain capture processor failed')); };
                        });
                        granularOutputGain.connect(capture); capture.connect(audioContext.destination);
                        const started = startHeldKeyboardPlayback(at);
                        try {
                            const channels = await recorded, samples = new Float32Array(channels[0]);
                            let silent = 0, blocks = 0, minRms = Infinity, peak = 0;
                            const size = Math.round(audioContext.sampleRate * .01);
                            for (let offset = Math.round(audioContext.sampleRate * .4); offset + size < samples.length; offset += size) {
                                let sum = 0; for (let j = offset; j < offset + size; j++) { sum += samples[j] ** 2; peak = Math.max(peak, Math.abs(samples[j])); }
                                const rms = Math.sqrt(sum / size); minRms = Math.min(minRms, rms); if (rms < .00005) silent++; blocks++;
                            }
                            return { notes, started, minRms, peak, silent, blocks, pool: getConcurrentGrainSourceCount(), streams: activeGrains.size, cap: MAX_GRAIN_NODES };
                        } finally {
                            granularOutputGain.disconnect(capture); capture.disconnect(); capture.port.close();
                            stopAllPerformancePlayback({ silent: true }); heldNotes.clear();
                        }
                    };
                });
                const captures = [];
                for (const notes of [['C3'], ['C3', 'E3', 'G3', 'B3']]) {
                    const result = await page.evaluate(notes => grainCapture(notes), notes);
                    assert.ok(result.started && result.minRms > .00005 && result.silent === 0, JSON.stringify(result));
                    assert.ok(result.pool <= result.cap && result.streams === notes.length);
                    captures.push(result);
                    assert.deepEqual(await page.evaluate(() => [getConcurrentGrainSourceCount(), activeGrainNodes, keyboardVoiceOutputs.size]), [0, 0, 0]);
                }
                await page.locator('#performanceKeyboardSoundSwitch').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                assert.deepEqual(errors, []);
                await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}-smooth.png`) });
                console.log(JSON.stringify({ engine, viewport, captures })); results.push({ engine, viewport, captures });
                await context.close();
            }
        } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'app-results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
