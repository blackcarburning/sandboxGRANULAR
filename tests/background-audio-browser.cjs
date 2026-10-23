// Real Web Audio + synthetic visibility. This does NOT emulate an actual iOS screen lock.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18948/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.BG_ENGINE && process.env.BG_ENGINE !== engine) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `bg_${engine[0]}_${viewport.width}_${Date.now()}`, password: 'isolated-background-audio' } })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin || r.request().url().startsWith('blob:') ? r.continue() : r.abort());
            await page.goto(base); await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => {
                window.__pumpCalls = 0;
                const pump = tickBackgroundAudio;
                tickBackgroundAudio = () => { __pumpCalls++; pump(); };
                window.__hidden = false;
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => __hidden });
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => __hidden ? 'hidden' : 'visible' });
                const timeout = window.setTimeout;
                window.__droppedTimers = 0;
                window.setTimeout = function (callback, delay, ...args) {
                    if (__hidden && typeof callback === 'function' && /scheduleActiveGrains|scheduleSequencer|scheduleArpeggiatorPlayback|runSharedRhythmClock/.test(callback.toString())) { __droppedTimers++; return -777; }
                    return timeout(callback, delay, ...args);
                };
                window.__setHidden = value => { __hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
            });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.waitForFunction(() => backgroundAudioController?.diagnostics.clockReady);
            await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true });
                window.__originalContext = audioContext;
                window.__fixture = audioContext.createBuffer(1, 48000 * 8, 48000);
                const data = __fixture.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(2 * Math.PI * 261.625565 * i / 48000);
                setKeyboardSampleBuffer(__fixture);
                await applyLoadedAudioBuffer(__fixture, 'isolated grain A', 'grainASample');
                await applyLoadedAudioBuffer(__fixture, 'isolated grain B', 'grainBSample');
                const code = `class Witness extends AudioWorkletProcessor {
                    constructor() { super(); this.sum=0; this.count=0; }
                    process(inputs) { for(const value of inputs[0]?.[0] || []) { this.sum += value*value; this.count++; }
                        if(this.count >= sampleRate*.25) { this.port.postMessage(Math.sqrt(this.sum/this.count)); this.sum=0; this.count=0; } return true; }
                } registerProcessor('background-test-witness', Witness);`;
                const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
                await audioContext.audioWorklet.addModule(url); URL.revokeObjectURL(url);
                window.__witness = new AudioWorkletNode(audioContext, 'background-test-witness');
                window.__rms = []; __witness.port.onmessage = e => __rms.push(e.data);
                finalAmplifierNode.connect(__witness); __witness.connect(audioContext.destination);
            });
            const cases = [];
            for (const sound of ['sample', 'grain', 'arp-rhythm']) {
                await page.evaluate(async sound => {
                    __rms = []; stopAllPerformancePlayback({ silent: true }); setHoldEnabled(false); setArpeggiatorEnabled(false, { skipSave: true });
                    if (sound === 'grain') {
                        await prepareGranularKeyboardFromUi(); setKeyboardSoundSource('grain', { skipSave: true });
                        setGranularLayerMuted('B', true, { skipSave: true, silent: true });
                        setSliderValue('grainSynthASize', 200); setSliderValue('grainSynthABlend', 50);
                    } else setKeyboardSoundSource('sample', { skipSave: true });
                    heldNotes = new Set(['C3', 'E3']); setHoldEnabled(true);
                    if (sound === 'arp-rhythm') {
                        setArpeggiatorEnabled(true, { skipSave: true }); playLoopAndHeldKeys({ silent: true });
                        startDrumMachine(null, { silent: true }); startSequencer();
                    } else startHeldKeyboardPlayback();
                }, sound);
                await page.waitForFunction(() => __rms.slice(-2).some(rms => rms > .00001));
                const initial = await page.evaluate(() => ({ rms: Math.max(...__rms.slice(-2)), grains: activeGrains.size, arp: isArpeggiatorPlaying(), recent: __rms.slice(-5), activeKeyCount, nodes: getConcurrentGrainSourceCount(), aSource: document.getElementById('grainSynthASource').value, aPeak: getBufferPeak(grainASampleBuffer), master: masterGain.gain.value, output: finalAmplifierNode.gain.value, granular: granularOutputGain.gain.value }));
                assert(initial.rms > .00001, JSON.stringify({ engine, sound, initial }));
                await page.evaluate(() => { __rms = []; __pumpCalls = 0; __droppedTimers = 0; window.__t0 = audioContext.currentTime; __setHidden(true); });
                await page.waitForTimeout(2500);
                const hidden = await page.evaluate(() => ({ clock: backgroundAudioController.diagnostics,
                    seconds: audioContext.currentTime - __t0, calls: __pumpCalls, dropped: __droppedTimers,
                    rms: __rms.slice(2), arp: isArpeggiatorPlaying(), grains: activeGrains.size,
                    sequencer: sequencerPlaying, drums: drumMachinePlaying,
                    resumeFlags: [restartPerformanceOnFocusReturn, restartBastardLoopOnFocusReturn, restartDrumMachineOnFocusReturn] }));
                assert.equal(hidden.clock.contextState, 'running'); assert(hidden.calls > 20); assert(hidden.seconds > 2);
                assert(hidden.rms.length >= 5 && hidden.rms.every(rms => rms > .00001), JSON.stringify({ engine, sound, hidden }));
                assert.deepEqual(hidden.resumeFlags, [false, false, false]);
                if (sound === 'grain') assert(hidden.grains > 0 && hidden.dropped > 0);
                if (sound === 'arp-rhythm') assert(hidden.arp && hidden.sequencer && hidden.drums && hidden.dropped > 0);
                await page.evaluate(() => __setHidden(false)); await page.waitForTimeout(300);
                assert.equal(await page.evaluate(() => audioContext === __originalContext), true);
                cases.push({ sound, hidden });
            }
            await page.evaluate(() => { __setHidden(true); stopAllPerformancePlayback({ silent: true }); });
            await page.waitForTimeout(400); await page.evaluate(() => __setHidden(false)); await page.waitForTimeout(300);
            assert.deepEqual(await page.evaluate(() => [sequencerPlaying, isArpeggiatorPlaying(), drumMachinePlaying, activeGrains.size]), [false, false, false, 0]);
            await page.evaluate(async () => { __setHidden(true); await audioContext.suspend(); });
            await page.waitForTimeout(400);
            assert.equal(await page.evaluate(() => audioContext.state), 'suspended', 'No background auto-resume after interruption');
            await page.evaluate(async () => { __setHidden(false); await audioContext.resume(); });
            await page.waitForTimeout(250);
            assert.deepEqual(await page.evaluate(() => [sequencerPlaying, isArpeggiatorPlaying(), drumMachinePlaying, activeGrains.size]), [false, false, false, 0]);
            assert.deepEqual(errors, []);
            results.push({ engine, viewport, cases }); await context.close();
        } } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ passed: results.length, results }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
