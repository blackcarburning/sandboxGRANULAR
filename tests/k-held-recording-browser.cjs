const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18839/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Disposable local accounts only');
const evidence = process.env.MYGRAIN_HELD_EVIDENCE || '/tmp/mygrain-k-held';
fs.mkdirSync(evidence, { recursive: true });
const results = [];

async function setup(page, sound, running) {
    await page.evaluate(() => {
        stateSaveSuspended = true;
        stopAllPerformancePlayback({ silent: true });
        panicAllNotes({ immediate: true, preserveStatus: true });
        setArpeggiatorEnabled(false, { skipSave: true });
        setHoldEnabled(true);
        for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
        setDrumMachineEnabled(false, { silent: true, skipSave: true });
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        setFxMuted(true, { silent: true });
        applyGlobalBpm(180);
        syncPatternLengthControls(8, { skipSave: true });
        const buffer = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * 2 / 3), audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(2 * Math.PI * 220 * i / buffer.sampleRate);
        bastardLoopBuffer = buffer;
        bastardLoopEnabled = true;
        bastardLoopSourceBpm = 180;
        grainASampleBuffer = buffer;
        grainBSampleBuffer = buffer;
        document.getElementById('grainSynthASource').value = 'grainASample';
        document.getElementById('grainSynthBSource').value = 'grainBSample';
        syncLegacyAudioBuffer();
        document.getElementById('performanceBastardLoopKRecordLength').value = '2';
        syncBastardLoopUi();
        syncBastardLoopKUi();
    });
    await page.locator(`#performanceKeyboardSoundSwitch [data-keyboard-sound="${sound}"]`).tap();
    await page.waitForFunction(source => keyboardSoundSource === source && keyboardSoundReadiness !== 'loading' && !document.getElementById('performanceKeyboardGrainOnBtn').disabled, sound);
    await page.evaluate(async () => {
        await prepareKeyboardSound(keyboardSoundSource);
        setGranularLayerMuted('A', false, { silent: true, skipSave: true });
        setGranularLayerMuted('B', true, { silent: true, skipSave: true });
        setHoldEnabled(true);
        stateSaveSuspended = false;
    });
    await page.locator('#keyboardContainer').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const notes = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].filter(key => {
        const r = key.getBoundingClientRect();
        return r.width > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height * .8)?.closest('.key') === key;
    }).slice(1, 4).map(key => key.dataset.note));
    assert.equal(notes.length, 3);
    for (const note of notes) {
        const key = page.locator(`#keyboardContainer .key[data-note="${note}"]`);
        const r = await key.boundingBox();
        await key.tap({ position: { x: r.width / 2, y: r.height * .8 } });
    }
    assert.equal(await page.evaluate(() => heldNotes.size), 3);
    if (running) await page.evaluate(() => restartAllTransport({ silent: true }));
    return notes;
}

async function snapshot(page) {
    return page.evaluate(() => {
        const buffer = bastardLoopKRawBuffer;
        let hash = 2166136261;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            const bytes = new Uint8Array(buffer.getChannelData(c).buffer);
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        }
        return { hash, frames: buffer.length, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate };
    });
}

(async () => {
    for (const [name, engine] of Object.entries({ chromium, webkit })) {
        if (process.env.MYGRAIN_HELD_ENGINE && process.env.MYGRAIN_HELD_ENGINE !== name) continue;
        const browser = await engine.launch(name === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.setDefaultTimeout(40000);
        try {
            const response = await context.request.post(base + 'api/auth/register', { data: { username: `held_${name[0]}_${Date.now()}`, password: 'isolated-held-record-test' } });
            assert.equal(response.status(), 200);
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                window.heldRecordEvents = [];
                const original = playKeyboardSound;
                playKeyboardSound = (note, time, velocity, options = {}) => {
                    heldRecordEvents.push({ note, time, role: options.role || 'keyboard' });
                    return original(note, time, velocity, options);
                };
                window.heldRecordAnalyser = audioContext.createAnalyser();
                heldRecordAnalyser.fftSize = 1024;
                keyboardGrainCaptureGain.connect(heldRecordAnalyser);
            });
            for (const sound of (process.env.MYGRAIN_HELD_SOUNDS || 'grain,osc,piano,strings').split(',')) {
                for (const state of (process.env.MYGRAIN_HELD_STATES || 'stopped,running').split(',')) {
                    const running = state === 'running';
                    await page.setViewportSize(running ? { width: 844, height: 390 } : { width: 390, height: 844 });
                    const notes = await setup(page, sound, running);
                    await page.evaluate(() => { heldRecordEvents.length = 0; });
                    await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
                    await page.waitForFunction(() => bastardLoopKRecordingState === 'countin');
                    const start = await page.evaluate(() => bastardLoopKRecorderStartTime);
                    await page.waitForTimeout(180);
                    const countin = await page.evaluate(() => {
                        const data = new Float32Array(heldRecordAnalyser.fftSize);
                        heldRecordAnalyser.getFloatTimeDomainData(data);
                        return { peak: Math.max(...data.map(Math.abs)), playing: bastardLoopPlaying, arp: arpEnabled };
                    });
                    assert.ok(countin.peak < .00001, 'Held audio is silent during count-in: ' + JSON.stringify(countin));
                    assert.equal(countin.playing, false);
                    assert.equal(countin.arp, false);
                    await page.waitForFunction(() => bastardLoopKRecordingState === 'idle' && Boolean(bastardLoopKRawBuffer));
                    const result = await page.evaluate(start => {
                        const data = bastardLoopKRawBuffer.getChannelData(0);
                        return {
                            rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length),
                            duration: bastardLoopKRawBuffer.duration, events: heldRecordEvents,
                            notes: [...heldNotes], hold: holdEnabled, arp: arpEnabled, sound: keyboardSoundSource,
                            liveGrains: [...activeGrains.values()].filter(v => ['keyboard', 'arp'].includes(v.role)).length,
                            liveOsc: [...activeOscVoices.values()].filter(v => ['keyboard', 'arp'].includes(v.role)).length,
                            sampleVoices: keyboardSamplePlayer?.voices.size || 0,
                            authorized: keyboardPlaybackAuthorized, joined: Boolean(bastardLoopKSource),
                            origin: transportSync.origin, start
                        };
                    }, start);
                    assert.ok(result.rms > .001, `Held ${sound} must record real audio: ${result.rms}`);
                    assert.equal(result.events.length, 3, 'Chord restarts exactly once, not an arp');
                    assert.deepEqual(result.events.map(event => event.note), notes);
                    assert.ok(result.events.every(event => event.role === 'keyboard' && Math.abs(event.time - start) < 1 / 44100), 'All held notes start together on the capture downbeat');
                    assert.deepEqual(result.notes, notes);
                    assert.equal(result.hold, true);
                    assert.equal(result.arp, false);
                    assert.equal(result.sound, sound);
                    assert.deepEqual([result.liveGrains, result.liveOsc, result.sampleVoices], [0, 0, 0], 'No live chord doubles the recorded K');
                    assert.equal(result.authorized, false);
                    assert.equal(result.joined, true);
                    assert.ok(Math.abs(result.duration - 4 / 3) < .001);
                    assert.ok(Math.abs(result.origin - start) < .0001);
                    results.push({ engine: name, state, sound, ...result });
                    console.log('PASS', name, sound, state, 'silent count-in, exact chord downbeat, real PCM, preserved setup, no doubled notes', result.rms);
                }
            }
            // Actual held take survives history in both directions; unrelated controls stay put.
            await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
            const take = await snapshot(page);
            await page.locator('#performanceKeyboardKLevel').fill('61');
            await page.evaluate(() => mygrainCardHistory.undo());
            await page.evaluate(() => mygrainCardHistory.redo());
            assert.deepEqual(await snapshot(page), take);
            assert.equal(await page.locator('#performanceKeyboardKLevel').inputValue(), '61');
            // Cancelling scheduled or live held notes must never resurrect them or replace the take.
            for (const phase of ['countin', 'recording']) {
                const notes = await setup(page, 'osc', false);
                const prior = await snapshot(page);
                await page.evaluate(() => { heldRecordEvents.length = 0; });
                await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
                await page.waitForFunction(phase => phase === 'recording' ? bastardLoopKRecordingState === phase : bastardLoopKRecordingState === 'countin' && activeOscVoices.size > 0 && audioContext.currentTime < bastardLoopKRecorderStartTime, phase);
                await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
                const events = await page.evaluate(() => heldRecordEvents.length);
                await page.waitForTimeout(500);
                assert.deepEqual(await snapshot(page), prior);
                assert.deepEqual(await page.evaluate(() => [...heldNotes]), notes);
                const stopped = await page.evaluate(() => ({ phase: bastardLoopKRecordingState, authorized: keyboardPlaybackAuthorized,
                    voices: [...activeOscVoices].filter(([, voice]) => ['keyboard', 'arp'].includes(voice.role)).map(([key, voice]) => ({ key, role: voice.role })), outputs: keyboardVoiceOutputs.size,
                    events: heldRecordEvents, heldRecording: bastardLoopKRecordingHeld, backing: bastardLoopPlaying }));
                assert.equal(stopped.phase, 'idle', JSON.stringify(stopped));
                assert.equal(stopped.authorized, false, JSON.stringify(stopped));
                assert.deepEqual(stopped.voices, [], JSON.stringify(stopped));
                assert.equal(stopped.outputs, 0, JSON.stringify(stopped));
                assert.equal(stopped.events.length, 3, JSON.stringify(stopped));
                assert.equal(stopped.heldRecording, false);
                if (phase === 'countin') assert.equal(stopped.backing, false);
                assert.equal(await page.evaluate(() => heldRecordEvents.length), events);
            }
            assert.deepEqual(errors, []);
            console.log('PASS', name, 'held take exact Undo/Redo; late count-in/live cancellation keeps prior take and selected chord');
        } finally { await context.close(); await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2)));
