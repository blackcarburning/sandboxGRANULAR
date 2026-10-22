const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18835/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Isolated local server only');
const evidence = process.env.MYGRAIN_ARP_RECORD_EVIDENCE || '/tmp/mygrain-k-arp-recording';
fs.mkdirSync(evidence, { recursive: true });
const results = [];
async function setup(page, sound, mode, multiplier, stopped) {
    await page.evaluate(() => {
        stateSaveSuspended = true;
        stopAllPerformancePlayback({ silent: true });
        panicAllNotes({ immediate: true, preserveStatus: true });
        setArpeggiatorEnabled(false, { skipSave: true });
        setHoldEnabled(false);
        for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
        setDrumMachineEnabled(false, { silent: true, skipSave: true });
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        setFxMuted(true, { silent: true });
        applyGlobalBpm(180);
        syncPatternLengthControls(8, { skipSave: true });
        const source = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * 2 / 3), audioContext.sampleRate);
        for (let i = 0; i < source.length; i++) source.getChannelData(0)[i] = .2 * Math.sin(2 * Math.PI * 220 * i / source.sampleRate);
        bastardLoopBuffer = source;
        bastardLoopEnabled = true;
        bastardLoopSourceBpm = 180;
        grainASampleBuffer = source;
        grainBSampleBuffer = source;
        document.getElementById('grainSynthASource').value = 'grainASample';
        document.getElementById('grainSynthBSource').value = 'grainBSample';
        syncLegacyAudioBuffer();
        setGranularLayerMuted('A', false, { silent: true, skipSave: true });
        setGranularLayerMuted('B', true, { silent: true, skipSave: true });
        setBastardLoopKRecordingSteps(getPatternLengthSteps() * 2, { skipSave: true });
        syncBastardLoopUi();
        syncBastardLoopKUi();
    });
    await page.locator(`#performanceKeyboardSoundSwitch [data-keyboard-sound="${sound}"]`).tap();
    await page.waitForFunction(source => keyboardSoundSource === source && keyboardSoundReadiness !== 'loading', sound);
    await page.evaluate(async ({ mode, multiplier }) => {
        await prepareKeyboardSound(keyboardSoundSource);
        setArpMode(mode, { skipSave: true });
        setArpClockMultiplier(multiplier, { skipSave: true });
        setArpeggiatorEnabled(true, { skipSave: true });
        stateSaveSuspended = false;
    }, { mode, multiplier });
    await page.locator('#keyboardContainer').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const notes = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].filter(key => {
        const b = key.getBoundingClientRect();
        return b.width > 0 && document.elementFromPoint(b.x + b.width / 2, b.y + b.height * .8)?.closest('.key') === key;
    }).slice(1, 4).map(key => key.dataset.note));
    assert.equal(notes.length, 3);
    for (const note of notes) {
        const key = page.locator(`#keyboardContainer .key[data-note="${note}"]`);
        const b = await key.boundingBox();
        await key.tap({ position: { x: b.width / 2, y: b.height * .8 } });
    }
    await page.waitForFunction(() => heldNotes.size === 3 && isArpeggiatorPlaying());
    if (stopped) await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
    return page.evaluate(() => ({ notes: getArpeggiatorNotes(), mode: arpMode, multiplier: getArpClockMultiplierValue(), sound: keyboardSoundSource }));
}
(async () => {
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.MYGRAIN_ARP_RECORD_ENGINE && process.env.MYGRAIN_ARP_RECORD_ENGINE !== engine) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.setDefaultTimeout(45000);
        try {
            const registration = await context.request.post(base + 'api/auth/register', { data: { username: `arprec_${engine}_${Date.now()}`, password: 'isolated-arp-recording-test' } });
            assert.equal(registration.status(), 200);
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                window.arpRecordEvents = [];
                const original = playKeyboardSound;
                playKeyboardSound = (note, when, velocity, options = {}) => {
                    arpRecordEvents.push({ note, time: when, role: options.role || 'keyboard' });
                    return original(note, when, velocity, options);
                };
            });
            for (const [index, sound] of (process.env.MYGRAIN_ARP_RECORD_SOURCES || 'grain,osc,piano,strings').split(',').entries()) {
                const viewport = index % 2 ? { width: 844, height: 390 } : { width: 390, height: 844 };
                await page.setViewportSize(viewport);
                const before = await setup(page, sound, index % 2 ? 'down' : 'updown', index % 2 ? 2 : 1, index % 2 === 0);
                await page.evaluate(() => { arpRecordEvents.length = 0; });
                await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
                await page.waitForFunction(() => bastardLoopKRecordingState === 'countin');
                const start = await page.evaluate(() => { arpRecordEvents.length = 0; return bastardLoopKRecorderStartTime; });
                await page.waitForTimeout(200);
                const early = await page.evaluate(start => arpRecordEvents.filter(e => e.time < start - 1 / audioContext.sampleRate), start);
                assert.deepEqual(early, [], 'arp cannot sound during count-in');
                await page.waitForFunction(() => bastardLoopKRecordingState === 'idle' && Boolean(bastardLoopKRawBuffer));
                const result = await page.evaluate(start => {
                    const data = bastardLoopKRawBuffer.getChannelData(0);
                    const notes = arpRecordEvents.filter(e => e.role === 'arp' && e.time >= start - 1 / audioContext.sampleRate);
                    return { notes, duration: bastardLoopKRawBuffer.duration,
                        rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length),
                        selected: { notes: getArpeggiatorNotes(), mode: arpMode, multiplier: getArpClockMultiplierValue(), sound: keyboardSoundSource },
                        step: getArpeggiatorStepSeconds(), running: isArpeggiatorPlaying(), timer: arpTimerId,
                        joined: Boolean(bastardLoopKSource), origin: transportSync.origin, start,
                        captureLive: bastardLoopKRecordingAbortController !== null };
                }, start);
                results.push({ engine, viewport, sound, ...result });
                assert.ok(result.notes.length >= 6, 'configured arp must restart for the take');
                assert.ok(result.rms > .001, `real ${sound} arp PCM must be non-silent: ${result.rms}`);
                assert.ok(Math.abs(result.duration - 4 / 3) < .001);
                assert.deepEqual(result.selected, before);
                assert.ok(Math.abs(result.notes[0].time - start) < 1 / 44100, 'first arp note on capture downbeat');
                for (let i = 1; i < result.notes.length; i++) assert.ok(Math.abs(result.notes[i].time - result.notes[i - 1].time - result.step) < .001, 'unchanged arp clock');
                if (before.mode === 'down') assert.deepEqual(result.notes.slice(0, 3).map(e => e.note), [...before.notes].reverse());
                else assert.deepEqual(result.notes.slice(0, 4).map(e => e.note), [before.notes[0], before.notes[1], before.notes[2], before.notes[1]]);
                assert.equal(result.running, false, 'completed take must not double-monitor live arp with K');
                assert.equal(result.timer, null);
                assert.equal(result.captureLive, false);
                assert.equal(result.joined, true);
                assert.ok(Math.abs(result.origin - start) < .0001);
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await page.screenshot({ path: path.join(evidence, `${engine}-${sound}-${viewport.width}.png`) });
                console.log('PASS', engine, sound, viewport.width, 'actual arp PCM, exact downbeat/rate/order, preserved setup, K joins, live arp stops', result.rms);
            }
            // Abort during final count-in beat, after backing/arp starts were prepared.
            await setup(page, 'osc', 'down', 2, true);
            await page.evaluate(() => { window.savedArpTake = bastardLoopKRawBuffer; arpRecordEvents.length = 0; });
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForFunction(() => bastardLoopKRecordingState === 'countin' && keyboardArpTransportPlaying && audioContext.currentTime < bastardLoopKRecorderStartTime);
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForTimeout(500);
            assert.ok(await page.evaluate(() => bastardLoopKRecordingState === 'idle' && bastardLoopKRawBuffer === savedArpTake && !isArpeggiatorPlaying() && arpTimerId === null && heldNotes.size === 3));
            // Cancel a live take; its arp and pending callbacks must stop too.
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForFunction(() => bastardLoopKRecordingState === 'recording');
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            const count = await page.evaluate(() => arpRecordEvents.length);
            await page.waitForTimeout(300);
            assert.ok(await page.evaluate(() => bastardLoopKRawBuffer === savedArpTake && !isArpeggiatorPlaying() && arpTimerId === null && bastardLoopKRecordingState === 'idle'));
            assert.equal(await page.evaluate(() => arpRecordEvents.length), count);
            assert.deepEqual(errors, []);
            console.log('PASS', engine, 'late count-in and live cancellation retain previous take/chord with no stale arp');
        } finally { await context.close(); await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2)));
