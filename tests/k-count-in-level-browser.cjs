const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18833/mygrain/';
const evidence = process.env.MYGRAIN_K_EVIDENCE || '/tmp/mygrain-k-count-in-level';
async function configure(page) {
    await page.evaluate(() => {
        stateSaveSuspended = true;
        stopAllPerformancePlayback({ silent: true });
        panicAllNotes({ immediate: true, preserveStatus: true });
        setHoldEnabled(false);
        setArpeggiatorEnabled(false, { skipSave: true });
        octaveOffset = 0;
        document.getElementById('globalBpmSlider').value = '300';
        document.getElementById('globalBpmSlider').dispatchEvent(new Event('input', { bubbles: true }));
        syncPatternLengthControls(8, { skipSave: true });
        for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
        setDrumMachineEnabled(false, { silent: true, skipSave: true });
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        setFxMuted(true, { silent: true });
        const tone = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .4), audioContext.sampleRate);
        const pcm = tone.getChannelData(0);
        for (let frame = 0; frame < pcm.length; frame += 1) pcm[frame] = .2 * Math.sin(2 * Math.PI * 220 * frame / tone.sampleRate);
        bastardLoopBuffer = tone;
        bastardLoopEnabled = true;
        bastardLoopSourceBpm = 300;
        bastardLoopPitchOctaves = 0;
        bastardLoopPitchSemitones = 0;
        bastardLoopFineCents = 0;
        document.getElementById('performanceBastardLoopLevel').value = '60';
        syncBastardLoopUi();
        const grains = audioContext.createBuffer(1, tone.length, tone.sampleRate);
        const grainPcm = grains.getChannelData(0);
        for (let frame = 0; frame < grainPcm.length; frame += 1) grainPcm[frame] = .35 * Math.sin(2 * Math.PI * 1375 * frame / tone.sampleRate);
        grainASampleBuffer = grains;
        grainBSampleBuffer = grains;
        document.getElementById('grainSynthASource').value = 'grainASample';
        document.getElementById('grainSynthBSource').value = 'grainBSample';
        syncLegacyAudioBuffer();
        setGranularLayerMuted('A', false, { silent: true, skipSave: true });
        setGranularLayerMuted('B', true, { silent: true, skipSave: true });
        document.getElementById('performanceBastardLoopKRecordLength').value = '2';
        document.getElementById('performanceBastardLoopKRecordLength').dispatchEvent(new Event('input', { bubbles: true }));
        if (!window.kKeyboardOutputAnalyser) {
            window.kKeyboardOutputAnalyser = audioContext.createAnalyser();
            kKeyboardOutputAnalyser.fftSize = 8192;
            finalAmplifierNode.connect(kKeyboardOutputAnalyser);
            window.kKeyboardCaptureAnalyser = audioContext.createAnalyser();
            kKeyboardCaptureAnalyser.fftSize = 1024;
            keyboardGrainCaptureGain.connect(kKeyboardCaptureAnalyser);
            const silent = audioContext.createGain();
            silent.gain.value = 0;
            kKeyboardCaptureAnalyser.connect(silent);
            silent.connect(audioContext.destination);
        }
        syncBastardLoopKUi();
    });
}

async function selected(page, source, group) {
    await page.locator(`#${group} [data-keyboard-sound="${source}"]`).tap();
    await page.waitForFunction(sound => keyboardSoundSource === sound && document.getElementById('status').textContent.startsWith('Keyboard and K sound:'), source);
    await page.evaluate(async sound => { await prepareKeyboardSound(sound); }, source);
    const controls = await page.evaluate(() => [...document.querySelectorAll('[data-keyboard-sound]')].map(button => ({
        source: button.dataset.keyboardSound, pressed: button.getAttribute('aria-pressed'), active: button.classList.contains('active')
    })));
    assert.equal(controls.length, 8);
    for (const control of controls) {
        assert.equal(control.pressed, String(control.source === source));
        assert.equal(control.active, control.source === source);
    }
}

async function startup(page) {
    await page.goto(base);
    await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
    await page.evaluate(() => mygrainCardHistory.ready);
    await page.locator('#start-btn').tap();
    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
}
async function holdKey(page) {
    await page.locator('.performance-keyboard-card .keyboard-section').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.evaluate(() => setHoldEnabled(true));
    const point = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')]
        .map(key => { const b = key.getBoundingClientRect(); return { key, x: b.x + b.width / 2, y: b.y + b.height * .8 }; })
        .find(p => document.elementFromPoint(p.x, p.y)?.closest('.key') === p.key));
    assert.ok(point, 'A touchable white key is visible');
    await page.touchscreen.tap(point.x, point.y);
}
(async () => {
    fs.mkdirSync(evidence, { recursive: true });
    const results = [];
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !process.env.MYGRAIN_K_ENGINE || process.env.MYGRAIN_K_ENGINE === name)) {
        const browser = await engine.launch(name === 'chromium' ? { executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') console.error(name, m.text()); });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        try {
            const registration = await context.request.post(base + 'api/auth/register', { data: {
                username: `k_${name}_${Date.now()}`, password: 'isolated-k-level-fixture' } });
            assert.ok(registration.ok(), await registration.text());
            await startup(page);
            const captureAvailable = await page.evaluate(() => Boolean(audioContext.audioWorklet && window.AudioWorkletNode && window.MygrainSongClock?.prepareCapture));
            if (!captureAvailable) {
                results.push({ engine: name, captureSkipped: 'AudioWorklet unavailable' });
                console.log('SKIP', name, 'actual capture: installed runtime has no AudioWorklet');
            }
            for (const [index, source] of (captureAvailable ? (process.env.MYGRAIN_K_SOURCES || 'grain,osc,piano,strings').split(',') : []).entries()) {
                await configure(page);
                await selected(page, source, 'performanceKeyboardSoundSwitch');
                const level = await page.locator('#performanceBastardLoopKInputGain').inputValue();
                assert.equal(Number(level), { grain: 160, osc: 180, piano: 250, strings: 250 }[source]);
                await page.locator('#performanceBastardLoopKStartBtn').tap();
                await page.waitForFunction(() => bastardLoopPlaying);
                const button = index % 2 ? '#performanceKeyboardToKRecordSurfaceBtn' : '#performanceBastardLoopKRecordBtn';
                await page.locator(button).tap();
                await page.waitForFunction(() => bastardLoopKRecordingState === 'countin');
                assert.equal(await page.evaluate(() => bastardLoopPlaying || sequencerPlaying || drumMachinePlaying), false,
                    'running pattern stops before count-in');
                await holdKey(page);
                await page.waitForFunction(() => bastardLoopKRecordingState === 'recording');
                assert.ok(await page.evaluate(() => bastardLoopPlaying && Boolean(bastardLoopSource)));
                const timing = await page.evaluate(() => ({ origin: bastardLoopTransportStartTime,
                    expected: bastardLoopKMetronomeNextTime - bastardLoopKMetronomeBeatIndex * bastardLoopKMetronomeIntervalSeconds + 4 * bastardLoopKMetronomeIntervalSeconds }));
                assert.ok(Math.abs(timing.origin - timing.expected) < .005, JSON.stringify(timing));
                await page.waitForFunction(() => bastardLoopKRecordingState === 'idle', null, { timeout: 10000 });
                const audio = await page.evaluate(() => {
                    const b = bastardLoopKRawBuffer;
                    if (!b) throw new Error('No K audio: ' + document.getElementById('status').textContent);
                    const data = b.getChannelData(0);
                    return { seconds: b.duration, rms: Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length),
                        peak: data.reduce((p, v) => Math.max(p, Math.abs(v)), 0), playing: bastardLoopPlaying, joined: Boolean(bastardLoopKSource) };
                });
                assert.ok(Math.abs(audio.seconds - .8) < .02, JSON.stringify(audio));
                assert.ok(audio.rms > .0002 && audio.peak > .001, `${source}: real key capture ${JSON.stringify(audio)}`);
                assert.ok(audio.playing && audio.joined);
                console.log('PASS', name, source, audio);
                results.push({ engine: name, source, audio, timing });
                await page.evaluate(() => { panicAllNotes({ immediate: true, preserveStatus: true }); setHoldEnabled(false); });
            }
            // Cancellation keeps the preceding take and never leaves scheduled backing running.
            if (captureAvailable) {
            await page.evaluate(() => { window.lastKTake = bastardLoopKRawBuffer; });
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForFunction(() => bastardLoopKRecordingState === 'countin');
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForFunction(() => bastardLoopKRecordingState === 'idle');
            await page.waitForTimeout(1100);
            assert.ok(await page.evaluate(() => bastardLoopKRawBuffer === lastKTake && !bastardLoopPlaying));
            }
            // VU shows gain actually entering the recorder, and zero means zero.
            await page.evaluate(() => {
                window.levelTone = audioContext.createOscillator();
                const g = audioContext.createGain(); g.gain.value = .08;
                levelTone.connect(g); g.connect(keyboardGrainCaptureGain); levelTone.start();
                setBastardLoopKInputGainPercent(100, { skipSave: true });
            });
            await page.locator('#performanceKeyboardRecordingVuShell').scrollIntoViewIfNeeded();
            await page.waitForFunction(() => keyboardRecordingMeterTap && keyboardRecordingMeterTimer !== null);
            await page.waitForTimeout(250);
            const firstDb = parseFloat(await page.locator('#performanceKeyboardRecordingVuValue').textContent());
            assert.ok(Number.isFinite(firstDb), 'visible meter reads real audio');
            await page.locator('#performanceBastardLoopKInputGain').fill('200');
            await page.waitForTimeout(250);
            const secondDb = parseFloat(await page.locator('#performanceKeyboardRecordingVuValue').textContent());
            assert.ok(Math.abs(secondDb - firstDb - 6.02) < .8, `meter follows +6dB live gain: ${firstDb}, ${secondDb}`);
            if (captureAvailable) {
                await page.evaluate(() => levelTone.frequency.setValueAtTime(660, audioContext.currentTime));
                await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
                await page.waitForFunction(() => bastardLoopKRecordingState === 'countin');
                await page.evaluate(() => {
                    const downbeat = bastardLoopKMetronomeNextTime - bastardLoopKMetronomeBeatIndex * bastardLoopKMetronomeIntervalSeconds + 4 * bastardLoopKMetronomeIntervalSeconds;
                    levelTone.frequency.setValueAtTime(880, downbeat);
                });
                await page.waitForFunction(() => bastardLoopKRecordingState === 'idle', null, { timeout: 10000 });
                const signal = await page.evaluate(() => {
                    const b = bastardLoopKRawBuffer, data = b.getChannelData(0);
                    const offset = Math.round(b.sampleRate * .1), count = Math.round(b.sampleRate * .5);
                    const amplitude = hz => {
                        let re = 0, im = 0;
                        for (let i = 0; i < count; i++) {
                            const angle = 2 * Math.PI * hz * i / b.sampleRate;
                            re += data[offset + i] * Math.cos(angle); im += data[offset + i] * Math.sin(angle);
                        }
                        return 2 * Math.hypot(re, im) / count;
                    };
                    return { recorded: amplitude(880), countIn: amplitude(660), backing: amplitude(220) };
                });
                assert.ok(Math.abs(signal.recorded - .16) < .015, '200% gain is applied exactly once: ' + JSON.stringify(signal));
                assert.ok(signal.countIn < .002 && signal.backing < .002, 'count-in and backing stay out of K: ' + JSON.stringify(signal));
                results.push({ engine: name, signal });
                console.log('PASS', name, 'exact input gain and trim; no backing in K', signal);
            }
            for (const [width, height] of [[390, 844], [844, 390]]) {
                await page.setViewportSize({ width, height });
                await page.locator('#keyboardRecordingLevelCard').scrollIntoViewIfNeeded();
                const bounds = await page.locator('#keyboardRecordingLevelCard').boundingBox();
                assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
                const order = await page.evaluate(() => {
                    const keyboard = document.querySelector('.performance-keyboard-card .keyboard-section');
                    const control = document.getElementById('keyboardRecordingLevelCard');
                    return { keyboard: Number(getComputedStyle(keyboard).order), control: Number(getComputedStyle(control).order) };
                });
                assert.ok(order.control > order.keyboard, JSON.stringify(order));
                await page.screenshot({ path: path.join(evidence, `${name}-${width}-level.png`) });
            }
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForFunction(() => keyboardRecordingMeterTimer === null && keyboardRecordingMeterTap === null);
            const hiddenText = await page.locator('#performanceKeyboardRecordingVuValue').textContent();
            await page.waitForTimeout(350);
            assert.equal(await page.locator('#performanceKeyboardRecordingVuValue').textContent(), hiddenText);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                stateSaveSuspended = false;
                window.kBeforeClear = bastardLoopKRawBuffer;
                window.kBeforeClearPcm = bastardLoopKRawBuffer.getChannelData(0).slice();
                setBastardLoopKEnabled(true, { silent: true, skipSave: true });
            });
            await page.locator('#performanceKeyboardKLevel').fill('73');
            assert.deepEqual(await page.evaluate(() => [
                document.getElementById('performanceBastardLoopKLevel').value,
                document.getElementById('performanceBastardLoopKLevelMixer').value,
                document.getElementById('performanceKeyboardKLevelValue').textContent
            ]), ['73', '73', '73%']);
            await page.evaluate(() => setBastardLoopPlaying(true, { silent: true, skipSave: true }));
            await page.waitForFunction(() => Math.abs((bastardLoopKGainNode?.gain.value ?? -1) - .73 * .9 * .88) < .001);
            const highGain = await page.evaluate(() => bastardLoopKGainNode.gain.value);
            await page.locator('#performanceKeyboardKLevel').fill('0');
            await page.waitForTimeout(100);
            assert.equal(await page.evaluate(() => bastardLoopKGainNode?.gain.value ?? 0), 0);
            assert.ok(Math.abs(highGain - .73 * .9 * .88) < .001);
            assert.ok(await page.evaluate(() => bastardLoopKRawBuffer.getChannelData(0).every((v, i) => v === kBeforeClearPcm[i])));
            await page.locator('#performanceKeyboardKLevel').fill('73');
            await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
            const pcmProof = await page.evaluate(() => {
                const data = bastardLoopKRawBuffer.getChannelData(0);
                const bits = new Uint32Array(data.buffer, data.byteOffset, data.length);
                return { length: data.length, hash: bits.reduce((hash, value) => Math.imul(hash ^ value, 16777619) >>> 0, 2166136261) };
            });
            const counts = await page.evaluate(() => mygrainCardHistory.counts);
            await page.locator('#performanceKeyboardClearKBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy && !bastardLoopKRawBuffer && !bastardLoopKBuffer);
            assert.ok(await page.locator('#performanceKeyboardClearKBtn').isDisabled());
            assert.equal((await page.evaluate(() => mygrainCardHistory.counts)).undo, Math.min(10, counts.undo + 1));
            await page.locator('#sectionJumpUndoBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy && Boolean(bastardLoopKRawBuffer));
            assert.ok(await page.evaluate(() => bastardLoopKRawBuffer.getChannelData(0).every((v, i) => v === kBeforeClearPcm[i])));
            await page.locator('#sectionJumpRedoBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy && !bastardLoopKRawBuffer && !bastardLoopKBuffer);
            await page.evaluate(() => mygrainCardHistory.flush());
            await startup(page);
            await page.locator('#sectionJumpUndoBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy && Boolean(bastardLoopKRawBuffer));
            const restoredProof = await page.evaluate(() => {
                const data = bastardLoopKRawBuffer.getChannelData(0);
                const bits = new Uint32Array(data.buffer, data.byteOffset, data.length);
                return { length: data.length, hash: bits.reduce((hash, value) => Math.imul(hash ^ value, 16777619) >>> 0, 2166136261) };
            });
            assert.deepEqual(restoredProof, pcmProof);
            assert.equal(await page.locator('#performanceKeyboardKLevel').inputValue(), '73');
            assert.equal(await page.locator('#performanceKeyboardToKRecordSurfaceBtn').textContent(), 'Record to K');
            console.log('PASS', name, 'K playback actual gain, Clear K, exact PCM Undo/Redo and history after reload');
            await page.evaluate(() => { stopAllPerformancePlayback({ silent: true }); stateSaveSuspended = false;
                for (const [source, level] of Object.entries({ grain: 217, osc: 0, piano: 236, strings: 189 })) {
                    setKeyboardSoundSource(source, { skipSave: true }); setBastardLoopKInputGainPercent(level, { skipSave: true });
                }
                saveState();
            });
            await startup(page);
            const restored = await page.evaluate(() => {
                const result = {};
                for (const source of ['grain', 'osc', 'piano', 'strings']) {
                    setKeyboardSoundSource(source, { skipSave: true }); result[source] = getBastardLoopKInputGainPercent();
                }
                return result;
            });
            assert.deepEqual(restored, { grain: 217, osc: 0, piano: 236, strings: 189 });
            assert.deepEqual(errors, []);
            console.log('PASS', name, (captureAvailable ? 'cancel, ' : '') + 'meter +6dB, hidden detach, portrait/landscape, saved instrument levels');
        } finally { await context.close(); await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
