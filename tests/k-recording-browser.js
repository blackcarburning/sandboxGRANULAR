const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18796/mygrain/';
const baseline = process.env.MYGRAIN_K_BASELINE;
const evidence = process.env.MYGRAIN_K_EVIDENCE || '/tmp/mygrain-k-browser';
const buttons = process.env.MYGRAIN_K_KEYBOARD_ONLY ? [] : ['performanceBastardLoopKRecordBtn', 'performanceBastardLoopKRecordLoopBtn',
    'performanceKeyboardToKRecordBtn', 'performanceKeyboardToKRecordSurfaceBtn'];

async function fixture(page, injectTone = true) {
    await page.evaluate(injectTone => {
        stateSaveSuspended = true;
        stopAllPerformancePlayback({ silent: true });
        document.getElementById('globalBpmSlider').value = '300';
        document.getElementById('globalBpmSlider').dispatchEvent(new Event('input', { bubbles: true }));
        syncPatternLengthControls(8);
        for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
        setDrumMachineEnabled(false, { silent: true, skipSave: true });
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        setFxMuted(true, { silent: true });
        const tone = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .4), audioContext.sampleRate);
        const samples = tone.getChannelData(0);
        for (let frame = 0; frame < samples.length; frame += 1) {
            samples[frame] = .2 * Math.sin(2 * Math.PI * 220 * frame / tone.sampleRate);
        }
        bastardLoopBuffer = tone;
        bastardLoopEnabled = true;
        bastardLoopSourceBpm = 300;
        bastardLoopPitchOctaves = 0;
        bastardLoopPitchSemitones = 0;
        bastardLoopFineCents = 0;
        document.getElementById('performanceBastardLoopLevel').value = '60';
        syncBastardLoopUi();
        setGranularLayersEnabled(true, { silent: true, skipSave: true });
        granularOutputGain.gain.value = .6;
        if (injectTone) {
            window.kTestTone = audioContext.createOscillator();
            const level = audioContext.createGain();
            level.gain.value = .2;
            kTestTone.frequency.value = 880;
            kTestTone.connect(level);
            level.connect(granularOutputGain);
            if (typeof keyboardGrainCaptureGain !== 'undefined') level.connect(keyboardGrainCaptureGain);
            kTestTone.start();
        } else {
            const grains = audioContext.createBuffer(1, tone.length, tone.sampleRate);
            const grainSamples = grains.getChannelData(0);
            for (let frame = 0; frame < grainSamples.length; frame += 1) {
                grainSamples[frame] = .3 * Math.sin(2 * Math.PI * 1375 * frame / tone.sampleRate);
            }
            grainASampleBuffer = grains;
            grainBSampleBuffer = grains;
            document.getElementById('grainSynthASource').value = 'grainASample';
            document.getElementById('grainSynthBSource').value = 'grainBSample';
            syncLegacyAudioBuffer();
            setGranularLayerMuted('A', false, { silent: true, skipSave: true });
            setGranularLayerMuted('B', true, { silent: true, skipSave: true });
        }
        if (window.kTestAnalyser) finalAmplifierNode.disconnect(kTestAnalyser);
        window.kTestAnalyser = audioContext.createAnalyser();
        kTestAnalyser.fftSize = 16384;
        finalAmplifierNode.connect(kTestAnalyser);
        syncBastardLoopKUi();
    }, injectTone);
}

async function audioState(page) {
    return page.evaluate(() => {
        const samples = new Float32Array(kTestAnalyser.fftSize);
        kTestAnalyser.getFloatTimeDomainData(samples);
        let cosine = 0;
        let sine = 0;
        for (let frame = 0; frame < samples.length; frame += 1) {
            const angle = 2 * Math.PI * 220 * frame / audioContext.sampleRate;
            cosine += samples[frame] * Math.cos(angle);
            sine += samples[frame] * Math.sin(angle);
        }
        return { recording: bastardLoopKRecordingState, playing: bastardLoopPlaying,
            backingSource: Boolean(bastardLoopSource), backingGain: bastardLoopGainNode?.gain.value || 0,
            backingAmplitude: 2 * Math.hypot(cosine, sine) / samples.length,
            sourceSolo: [...performanceSourceLayerSolo], loopSolo: [...loopLayerSolo], inputGain: bastardLoopKInputGain };
    });
}

async function captureState(page) {
    return page.evaluate(() => {
        const buffer = bastardLoopKRawBuffer;
        const samples = buffer.getChannelData(0);
        const start = Math.floor(buffer.sampleRate * .1);
        const length = Math.min(Math.floor(buffer.sampleRate * .2), samples.length - start);
        const amplitude = frequency => {
            let cosine = 0;
            let sine = 0;
            for (let offset = 0; offset < length; offset += 1) {
                const angle = 2 * Math.PI * frequency * offset / buffer.sampleRate;
                cosine += samples[start + offset] * Math.cos(angle);
                sine += samples[start + offset] * Math.sin(angle);
            }
            return 2 * Math.hypot(cosine, sine) / length;
        };
        const canvas = document.getElementById('performanceBastardLoopKWaveform');
        const rectangle = canvas?.getBoundingClientRect();
        return { duration: buffer.duration, grainAmplitude: amplitude(880), backingAmplitude: amplitude(220),
            playing: bastardLoopPlaying, source: Boolean(bastardLoopKSource),
            waveform: rectangle ? { width: rectangle.width, height: rectangle.height, pixels: canvas.width } : null };
    });
}

(async () => {
    fs.mkdirSync(evidence, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const blockedWrites = [];
    const results = [];
    try {
        for (const [sampleRate, viewport] of [[44100, { width: 390, height: 844 }], [48000, { width: 844, height: 390 }]]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeContext = window.AudioContext;
                window.AudioContext = class extends NativeContext {
                    constructor(options = {}) { super({ ...options, sampleRate: rate }); }
                };
            }, sampleRate);
            const page = await context.newPage();
            await page.emulateMedia({ reducedMotion: 'reduce' });
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) {
                    blockedWrites.push(route.request().url());
                    return route.abort();
                }
                if (baseline && route.request().isNavigationRequest() && new URL(route.request().url()).pathname === new URL(base).pathname) {
                    return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(baseline, 'utf8') });
                }
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await fixture(page);
            await page.locator('#performanceBastardLoopKStartBtn').tap();
            await page.waitForFunction(() => bastardLoopPlaying && Boolean(bastardLoopSource));
            await page.locator('#performanceBastardLoopKStartBtn').tap();
            await page.waitForFunction(() => !bastardLoopPlaying);
            await page.evaluate(() => { kTestTone.stop(); kTestTone.disconnect(); });
            assert.match(await page.locator('#performanceBastardLoopKWaveformStatus').textContent(), /Empty/);
            for (const button of buttons) {
                await fixture(page);
                await page.locator(`#${button}`).tap();
                try {
                    await page.waitForFunction(() => bastardLoopKRecordingState === 'recording', null, { timeout: 8000 });
                } catch (error) {
                    console.error(await page.evaluate(() => ({ recording: bastardLoopKRecordingState,
                        status: document.getElementById('status').textContent, recordStatus: bastardLoopKRecordStatus })));
                    throw error;
                }
                await page.waitForTimeout(280);
                const during = await audioState(page);
                assert.equal(during.playing, true, `${button}: backing transport runs during recording`);
                assert.equal(during.backingSource, true, `${button}: backing loop source exists`);
                assert.ok(during.backingGain > .01, `${button}: backing loop is not muted`);
                assert.ok(during.backingAmplitude > .002, `${button}: backing loop is audible in output PCM: ${JSON.stringify(during)}`);
                assert.deepEqual(during.sourceSolo, []);
                assert.deepEqual(during.loopSolo, []);
                assert.equal(during.inputGain, 1);
                await page.waitForFunction(() => bastardLoopKRecordingState === 'idle', null, { timeout: 8000 });
                await page.evaluate(() => { kTestTone.stop(); kTestTone.disconnect(); });
                const after = await captureState(page);
                assert.ok(after.grainAmplitude > .01, `${button}: grain signal captured: ${JSON.stringify(after)}`);
                assert.ok(after.backingAmplitude < after.grainAmplitude * .05, `${button}: backing audio excluded from grain capture`);
                assert.equal(after.playing, true);
                assert.equal(after.source, true);
                assert.ok(after.waveform?.width > 100 && after.waveform.height > 30 && after.waveform.pixels > 100);
                results.push({ sampleRate, viewport, button, during, after });
                console.log('capture passed', sampleRate, button, JSON.stringify({ backing: during.backingAmplitude, grains: after.grainAmplitude, bleed: after.backingAmplitude }));
            }
            await fixture(page, false);
            await page.evaluate(() => {
                document.getElementById('performanceBastardLoopKRecordLength').value = '2';
                document.getElementById('performanceBastardLoopKRecordLength').dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForFunction(() => bastardLoopKRecordingState === 'countin', null, { timeout: 2000 });
            await page.locator('.performance-keyboard-card .keyboard-section').evaluate(element =>
                element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
            await page.waitForTimeout(80);
            const keyPoint = await page.evaluate(() => [...document.querySelectorAll('.performance-keyboard-card .key:not(.black)')]
                .map(key => { const bounds = key.getBoundingClientRect();
                    return { key, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * .8, note: key.dataset.note }; })
                .filter(point => document.elementFromPoint(point.x, point.y)?.closest('.key') === point.key)
                .sort((first, second) => Math.abs(first.x - innerWidth / 2) - Math.abs(second.x - innerWidth / 2))
                .map(({ x, y, note }) => ({ x, y, note }))[0]);
            assert.ok(keyPoint, 'Held-key touch lands on a visible key');
            await page.evaluate(() => document.addEventListener('pointerdown', event => {
                window.kTestLastPointer = { target: event.target.className, note: event.target.dataset.note, type: event.pointerType };
            }, { once: true, capture: true }));
            const touch = await context.newCDPSession(page);
            await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: keyPoint.x, y: keyPoint.y }] });
            try {
                await page.waitForFunction(() => [...activeGrains.values()].some(stream => stream.role === 'keyboard'), null, { timeout: 2000 });
            } catch (error) {
                await page.screenshot({ path: path.join(evidence, 'keyboard-failure.png') });
                console.error(await page.evaluate(() => ({ pointer: window.kTestLastPointer, notes: [...activeGrains.entries()],
                    enabled: granularLayersEnabled, buffer: Boolean(grainASampleBuffer), status: document.getElementById('status').textContent })));
                throw error;
            }
            await page.waitForFunction(() => bastardLoopKRecordingState === 'recording', null, { timeout: 8000 });
            await page.waitForFunction(() => bastardLoopKRecordingState === 'idle', null, { timeout: 8000 });
            await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await touch.detach();
            const keyboardCapture = await page.evaluate(() => {
                const samples = bastardLoopKRawBuffer.getChannelData(0);
                return Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length);
            });
            assert.ok(keyboardCapture > .001, `Actual held keyboard key records non-silent K PCM: ${keyboardCapture}`);
            results.push({ sampleRate, viewport, button: 'actual-keyboard-held-key', rms: keyboardCapture });
            await page.evaluate(() => stopBastardLoopK({ skipUi: true, fade: false }));
            await page.locator('#performanceBastardLoopKStartBtn').tap();
            await page.waitForFunction(() => !bastardLoopPlaying);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                bastardLoopEnabled = false;
                bastardLoopBuffer = null;
                syncBastardLoopUi();
                syncBastardLoopKUi();
            });
            for (let repeat = 0; repeat < 2; repeat += 1) {
                await page.locator('#performanceBastardLoopKStartBtn').tap();
                await page.waitForFunction(() => bastardLoopPlaying && Boolean(bastardLoopKSource));
                await page.locator('#performanceBastardLoopKStartBtn').tap();
                await page.waitForFunction(() => !bastardLoopPlaying && !bastardLoopKSource);
            }
            const beforeNormalize = await page.locator('#performanceBastardLoopKWaveform').evaluate(canvas => canvas.toDataURL());
            await page.locator('#performanceBastardLoopKNormalizeBtn').tap();
            await page.waitForTimeout(100);
            const afterNormalize = await page.locator('#performanceBastardLoopKWaveform').evaluate(canvas => canvas.toDataURL());
            assert.notEqual(afterNormalize, beforeNormalize, 'Waveform redraws normalized audio');
            await page.locator('#performanceBastardLoopKWaveform').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(evidence, `k-${sampleRate}.png`) });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
            await page.locator('#performanceBastardLoopKClearBtn').tap();
            await page.waitForFunction(() => !bastardLoopKRawBuffer && !bastardLoopKBuffer);
            await page.waitForFunction(() => document.getElementById('performanceBastardLoopKWaveformStatus').textContent.startsWith('Empty'));
            assert.match(await page.locator('#performanceBastardLoopKWaveformStatus').textContent(), /Empty/);
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(blockedWrites, []);
        fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
        console.log(JSON.stringify({ passed: results.length, errors, blockedWrites, evidence, results }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
