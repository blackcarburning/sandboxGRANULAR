// Actual audio regression for exhausted/disconnected keyboard grain voices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18838/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Disposable local accounts only');
const evidence = process.env.MYGRAIN_GRAIN_READY_EVIDENCE || '/tmp/mygrain-grain-ready';
fs.mkdirSync(evidence, { recursive: true });
const results = [];

async function tapKey(page) {
    await page.locator('#keyboardContainer').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const point = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].map(key => {
        const r = key.getBoundingClientRect();
        return { key, x: r.x + r.width / 2, y: r.y + r.height * .8 };
    }).find(p => document.elementFromPoint(p.x, p.y)?.closest('.key') === p.key));
    assert.ok(point, 'A visible native keyboard hit target exists');
    await page.touchscreen.tap(point.x, point.y);
}

async function peakAudio(page) {
    let peak = 0;
    for (let i = 0; i < 10; i++) {
        peak = Math.max(peak, await page.evaluate(() => {
            const samples = new Float32Array(grainReadyAnalyser.fftSize);
            grainReadyAnalyser.getFloatTimeDomainData(samples);
            return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        }));
        await page.waitForTimeout(40);
    }
    return peak;
}

(async () => {
    for (const [name, engine] of Object.entries({ chromium, webkit })) {
        const browser = await engine.launch(name === 'chromium' ? {
            executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
                const page = await context.newPage();
                page.setDefaultTimeout(30000);
                const errors = [];
                page.on('pageerror', e => errors.push(e.message));
                const registration = await context.request.post(base + 'api/auth/register', {
                    data: { username: `gr_${name[0]}_${viewport.width}_${Date.now()}`, password: 'isolated-grain-readiness' }
                });
                assert.equal(registration.status(), 200);
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.evaluate(() => mygrainCardHistory.ready);
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(() => {
                    window.grainReadyCalls = 0;
                    const ready = prepareGranularKeyboardFromUi;
                    prepareGranularKeyboardFromUi = async (...args) => { grainReadyCalls++; return ready(...args); };
                    window.grainReadyAnalyser = audioContext.createAnalyser();
                    grainReadyAnalyser.fftSize = 8192;
                    granularOutputGain.connect(grainReadyAnalyser);
                });
                // Original Ready + Jump and keyboard copy must each run exactly once.
                await page.locator('#performanceGranularKeysBtn').tap();
                await page.waitForFunction(() => !document.getElementById('performanceGranularKeysBtn').disabled);
                assert.equal(await page.evaluate(() => grainReadyCalls), 1);
                await page.evaluate(() => {
                    window.grainReadyOriginalA = grainASampleBuffer;
                    setHoldEnabled(true);
                    setGranularLayerMuted('B', true, { skipSave: true, silent: true });
                    setSliderValue('grainSynthASize', 500);
                    setSliderValue('grainSynthATune', -24);
                    setGranularLayerPreserveDuration('A', false, { skipSave: true, silent: true });
                });
                await tapKey(page);
                await page.waitForFunction(() => getConcurrentGrainSourceCount() === 6);
                const before = await page.evaluate(() => ({ pool: getConcurrentGrainSourceCount(), osc: oscillatorsEnabled }));
                assert.equal(before.osc, false);
                assert.ok(await peakAudio(page) > .0001, 'Real grain output, not an OSC fallback');
                await page.evaluate(() => {
                    window.grainReadyOldEnded = [...scheduledGrainVoices].map(v => v.source.onended);
                    stopAllPerformancePlayback({ silent: true });
                    heldNotes.clear();
                    document.querySelectorAll('.key.active').forEach(key => key.classList.remove('active'));
                });
                assert.deepEqual(await page.evaluate(() => [getConcurrentGrainSourceCount(), activeGrainNodes, keyboardVoiceOutputs.size]), [0, 0, 0], 'Stopped voices free all six slots immediately');
                await page.locator('#performanceKeyboardGrainOnBtn').tap();
                await page.waitForFunction(() => !document.getElementById('performanceKeyboardGrainOnBtn').disabled);
                assert.equal(await page.evaluate(() => grainReadyCalls), 2);
                assert.equal(await page.evaluate(() => grainASampleBuffer === grainReadyOriginalA), true, 'Ready preserves a usable source');
                assert.equal(await page.locator('#performanceKeyboardGrainOnBtn').getAttribute('aria-pressed'), 'true');
                await tapKey(page);
                await page.waitForFunction(() => scheduledGrainVoices.size > 0);
                const idempotence = await page.evaluate(() => {
                    const count = activeGrainNodes;
                    grainReadyOldEnded.forEach(ended => { ended(); ended(); });
                    return { before: count, after: activeGrainNodes, pool: getConcurrentGrainSourceCount() };
                });
                assert.equal(idempotence.after, idempotence.before, 'Late ended events cannot corrupt newly allocated voice counts');
                assert.ok(idempotence.pool > 0 && idempotence.pool <= 6);
                const rms = await peakAudio(page);
                assert.ok(rms > .0001, 'Stopped/exhausted keyboard must sound again');
                // Repeated recovery also reschedules currently held streams.
                await page.locator('#performanceKeyboardGrainOnBtn').tap();
                await page.waitForFunction(() => !document.getElementById('performanceKeyboardGrainOnBtn').disabled);
                assert.equal(await page.evaluate(() => grainReadyCalls), 3);
                assert.ok(await peakAudio(page) > .0001);
                await page.evaluate(() => {
                    stopAllPerformancePlayback({ silent: true });
                    playGrain('C4', null, 1, { role: 'sequencer', layerKeys: ['A'] });
                    window.grainReadyBacking = [...scheduledGrainVoices];
                    stopKeyboardSounds({ immediate: true });
                });
                assert.equal(await page.evaluate(() => grainReadyBacking.length > 0 && grainReadyBacking.every(v => scheduledGrainVoices.has(v) && !v.ended)), true, 'Keyboard cleanup preserves backing voices');
                await page.evaluate(() => stopScheduledGrainVoices());
                const layout = await page.locator('#performanceKeyboardSoundSwitch .keyboard-sound-split').evaluateAll(groups => groups.map(group => {
                    const buttons = [...group.querySelectorAll('button')].map(b => ({ width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height, text: b.textContent.trim() }));
                    return buttons;
                }));
                assert.equal(layout.length, 2);
                for (const buttons of layout) {
                    assert.equal(buttons.length, 2);
                    assert.ok(Math.abs(buttons[0].width - buttons[1].width) < 1);
                    assert.ok(buttons.every(b => b.width >= 44 && b.height >= 44));
                }
                const state = await page.evaluate(() => ({ sound: keyboardSoundSource, osc: oscillatorsEnabled, grain: granularLayersEnabled, playing: isArpeggiatorPlaying() }));
                await page.locator('#performanceKeyboardSynthJumpBtn').tap();
                await page.waitForFunction(() => document.body.classList.contains('synth-popup-open'));
                await page.locator('#oscPopupCloseBtn').tap();
                await page.locator('#performanceKeyboardGrainJumpBtn').tap();
                assert.equal(await page.locator('#grainAWaveformEditor').evaluate(el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), true);
                assert.deepEqual(await page.evaluate(() => ({ sound: keyboardSoundSource, osc: oscillatorsEnabled, grain: granularLayersEnabled, playing: isArpeggiatorPlaying() })), state, 'Jumps navigate without changing sound or transport');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                assert.deepEqual(errors, []);
                await page.locator('#performanceKeyboardSoundSwitch').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
                await page.screenshot({ path: path.join(evidence, `${name}-${viewport.width}-keyboard.png`) });
                results.push({ engine: name, viewport, initialPool: before.pool, restoredGrainRms: rms, idempotence, layout });
                console.log('PASS grain cleanup, real output, six-voice cap, Ready copy, role isolation, paired jumps', name, viewport.width, rms);
                await context.close();
            }
        } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
