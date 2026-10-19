const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18798/mygrain/';
const evidence = process.env.MYGRAIN_K_KEYBOARD_EVIDENCE || '/tmp/mygrain-k-keyboard-browser';
const sources = ['osc', 'grain', 'piano', 'strings'];

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

async function holdTouch(page, context) {
    await page.locator('.performance-keyboard-card .keyboard-section').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const point = await page.evaluate(() => [...document.querySelectorAll('.performance-keyboard-card .key:not(.black)')]
        .map(key => { const box = key.getBoundingClientRect(); return { key, note: key.dataset.note, x: box.x + box.width / 2, y: box.y + box.height * .8 }; })
        .filter(item => document.elementFromPoint(item.x, item.y)?.closest('.key') === item.key)
        .sort((first, second) => Math.abs(first.x - innerWidth / 2) - Math.abs(second.x - innerWidth / 2))
        .map(({ note, x, y }) => ({ note, x, y }))[0]);
    assert.ok(point, 'A physical keyboard key is visible');
    const touch = await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
    return { note: point.note, release: async () => {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await touch.detach();
    } };
}

async function voiceState(page) {
    return page.evaluate(() => {
        const samples = new Float32Array(kKeyboardOutputAnalyser.fftSize);
        kKeyboardOutputAnalyser.getFloatTimeDomainData(samples);
        const captureSamples = new Float32Array(kKeyboardCaptureAnalyser.fftSize);
        kKeyboardCaptureAnalyser.getFloatTimeDomainData(captureSamples);
        const amplitude = frequency => {
            let cosine = 0;
            let sine = 0;
            for (let frame = 0; frame < samples.length; frame += 1) {
                const angle = 2 * Math.PI * frequency * frame / audioContext.sampleRate;
                cosine += samples[frame] * Math.cos(angle);
                sine += samples[frame] * Math.sin(angle);
            }
            return 2 * Math.hypot(cosine, sine) / samples.length;
        };
        return {
            rms: Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length),
            captureRms: Math.sqrt(captureSamples.reduce((total, sample) => total + sample * sample, 0) / captureSamples.length),
            backingAmplitude: amplitude(220), playing: bastardLoopPlaying, backing: Boolean(bastardLoopSource),
            osc: [...activeOscVoices.values()].filter(voice => isKeyboardSoundRole(voice.role)).length,
            grain: [...activeGrains.values()].filter(voice => isKeyboardSoundRole(voice.role)).length,
            samples: [...getKeyboardSamplePlayer().voices.values()].map(voice => ({ instrument: voice.instrument, midi: voice.midi, loop: voice.source.loop, released: voice.released })),
            sampleMetrics: getKeyboardSamplePlayer().metrics
        };
    });
}

function assertEngine(state, source) {
    assert.ok(state.rms > .0002, `${source}: physical key is audible: ${JSON.stringify(state)}`);
    assert.equal(state.osc > 0, source === 'osc', `${source}: oscillator keyboard routing`);
    assert.equal(state.grain > 0, source === 'grain', `${source}: grain keyboard routing`);
    if (source === 'piano' || source === 'strings') {
        assert.ok(state.samples.length > 0, `${source}: sample keyboard voice exists`);
        assert.ok(state.samples.every(voice => voice.instrument === source));
        assert.ok(state.samples.every(voice => voice.loop === (source === 'strings')));
    } else assert.equal(state.samples.length, 0, `${source}: no sample keyboard voice`);
}

async function capture(page) {
    return page.evaluate(() => {
        const buffer = bastardLoopKRawBuffer;
        const samples = buffer.getChannelData(0);
        const start = Math.floor(buffer.sampleRate * .1);
        const count = Math.min(Math.floor(buffer.sampleRate * .2), samples.length - start);
        let cosine = 0;
        let sine = 0;
        for (let frame = 0; frame < count; frame += 1) {
            const angle = 2 * Math.PI * 220 * frame / buffer.sampleRate;
            cosine += samples[start + frame] * Math.cos(angle);
            sine += samples[start + frame] * Math.sin(angle);
        }
        const canvas = document.getElementById('performanceBastardLoopKWaveform');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const colours = new Set();
        for (let offset = 0; offset < pixels.length; offset += 4) colours.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`);
        return { duration: buffer.duration, rms: Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length),
            backingAmplitude: 2 * Math.hypot(cosine, sine) / count,
            peak: samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0),
            waveformColours: colours.size, waveformStatus: document.getElementById('performanceBastardLoopKWaveformStatus').textContent,
            playing: bastardLoopPlaying, source: Boolean(bastardLoopKSource) };
    });
}

async function pendingCancellation(page) {
    return page.evaluate(async () => {
        panicAllNotes({ immediate: true });
        setKeyboardSoundSource('piano', { skipSave: true });
        const player = getKeyboardSamplePlayer();
        const sampler = player.samplers.get('piano').piano;
        const ensure = sampler.ensure;
        const operations = [];
        await prepareKeyboardSound('piano');
        try {
            for (const mode of ['release', 'switch']) {
                let resume;
                const gate = new Promise(resolve => { resume = resolve; });
                let entered;
                const waiting = new Promise(resolve => { entered = resolve; });
                sampler.ensure = async function (...args) { entered(); await gate; return ensure.apply(this, args); };
                setKeyboardSoundSource('piano', { skipSave: true });
                sampler.cache.clear();
                playKeyboardSound('C4');
                await Promise.race([waiting, new Promise((resolve, reject) => setTimeout(() => reject(new Error('Cold cancellation sample did not start loading.')), 3000))]);
                const pendingBefore = player.metrics.pending;
                if (mode === 'release') stopKeyboardSound('C4');
                else setKeyboardSoundSource('grain', { skipSave: true });
                resume();
                await new Promise(resolve => setTimeout(resolve, 180));
                operations.push({ mode, pendingBefore, ...player.metrics });
            }
        } finally { sampler.ensure = ensure; player.stop(); }
        return operations;
    });
}

async function persistence(page) {
    const results = [];
    const reload = async source => {
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.MygrainQ?.createKeyboardPlayer && document.querySelectorAll('[data-keyboard-sound]').length === 8);
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        const loaded = await page.evaluate(() => {
            stateSaveSuspended = true;
            return { actual: keyboardSoundSource, controls: [...document.querySelectorAll('[data-keyboard-sound]')].map(button => ({
                source: button.dataset.keyboardSound, pressed: button.getAttribute('aria-pressed')
            })) };
        });
        assert.equal(loaded.actual, source, `${source}: actual saved source survives fresh page reload`);
        assert.equal(loaded.controls.length, 8);
        for (const control of loaded.controls) assert.equal(control.pressed, String(control.source === source));
        return loaded;
    };
    for (const source of sources) {
        const stored = await page.evaluate(source => {
            panicAllNotes({ immediate: true });
            setKeyboardSoundSource(source, { skipSave: true });
            const saved = saveState({ force: true });
            const snapshot = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY));
            return { source, saved, stored: snapshot.modes.keyboardSoundSource };
        }, source);
        results.push({ ...stored, ...await reload(source) });
    }
    await page.evaluate(() => {
        const snapshot = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY));
        delete snapshot.modes.keyboardSoundSource;
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(snapshot));
    });
    const legacy = await reload('grain');
    return { results, legacyDefault: legacy.actual, method: 'saveState to localStorage, fresh page reload, physical Start, both selector groups checked' };
}

(async () => {
    fs.mkdirSync(evidence, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const consoleErrors = [];
    const blockedWrites = [];
    const results = [];
    try {
        for (const [sampleRate, viewport] of [[44100, { width: 390, height: 844 }], [48000, { width: 844, height: 390 }]]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeContext = window.AudioContext;
                window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                window.webkitAudioContext = window.AudioContext;
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(15000);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            page.on('pageerror', error => errors.push(error.stack || error.message));
            page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) {
                    blockedWrites.push(route.request().url());
                    return route.abort();
                }
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.MygrainQ?.createKeyboardPlayer && document.querySelectorAll('[data-keyboard-sound]').length === 8);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                window.kKeyboardRecordEvents = [];
                for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) document.addEventListener(type, event => {
                    const target = event.target.closest('button');
                    if (target?.id.includes('KRecord')) kKeyboardRecordEvents.push({ type, target: target.id, time: performance.now(), state: bastardLoopKRecordingState });
                }, true);
            });
            assert.equal(await page.evaluate(() => keyboardSoundSource), 'grain', 'Legacy/clean keyboard defaults to Grain');
            await configure(page);
            const qBefore = await page.evaluate(() => JSON.stringify(mygrainQ.getState()));
            const captures = [];
            for (const [index, source] of sources.entries()) {
                await configure(page);
                const group = index % 2 ? 'performanceKeyboardSoundSwitch' : 'performanceBastardLoopKSoundSwitch';
                await selected(page, source, group);
                const liveTouch = await holdTouch(page, context);
                await page.waitForFunction(sound => {
                    if (sound === 'piano' || sound === 'strings') return [...getKeyboardSamplePlayer().voices.values()].some(voice => voice.instrument === sound);
                    const voices = sound === 'osc' ? activeOscVoices : activeGrains;
                    return [...voices.values()].some(voice => isKeyboardSoundRole(voice.role));
                }, source, { timeout: 10000 });
                await page.waitForTimeout(source === 'strings' ? 450 : 200);
                const live = await voiceState(page);
                assertEngine(live, source);
                await liveTouch.release();
                await page.waitForFunction(() => getKeyboardSamplePlayer().metrics.voices === 0 && getKeyboardSamplePlayer().metrics.pending === 0, null, { timeout: 2000 });
                await page.evaluate(() => panicAllNotes({ immediate: true, preserveStatus: true }));
                await page.locator('#performanceBastardLoopKStartBtn').tap();
                await page.waitForFunction(() => bastardLoopPlaying && Boolean(bastardLoopSource));
                await page.waitForFunction(() => {
                    const samples = new Float32Array(kKeyboardCaptureAnalyser.fftSize);
                    kKeyboardCaptureAnalyser.getFloatTimeDomainData(samples);
                    return samples.every(sample => Math.abs(sample) < .00001);
                }, null, { timeout: 4000 });
                await page.waitForTimeout(160);
                const backingOnly = await voiceState(page);
                assert.ok(backingOnly.backingAmplitude > .002, `${source}: backing audible before key press`);
                assert.ok(backingOnly.captureRms < .00001, `${source}: backing excluded from K bus before selected key starts: ${JSON.stringify(backingOnly)}`);
                const recordButton = index % 2 ? 'performanceKeyboardToKRecordSurfaceBtn' : 'performanceBastardLoopKRecordBtn';
                await page.locator(`#${recordButton}`).tap();
                try {
                    await page.waitForFunction(() => ['countin', 'recording'].includes(bastardLoopKRecordingState), null, { timeout: 2500 });
                } catch (error) {
                    console.error('record arm failed', source, await page.evaluate(() => ({
                        state: bastardLoopKRecordingState, status: document.getElementById('status').textContent,
                        recordStatus: bastardLoopKRecordStatus, activeKeys: activeKeyCount, held: [...heldNotes], events: kKeyboardRecordEvents
                    })));
                    throw error;
                }
                const recordTouch = await holdTouch(page, context);
                await page.waitForFunction(() => bastardLoopKRecordingState === 'recording', null, { timeout: 3500 });
                await page.waitForTimeout(120);
                const during = await voiceState(page);
                assertEngine(during, source);
                assert.equal(during.playing, true);
                assert.equal(during.backing, true);
                assert.ok(during.backingAmplitude > .002, `${source}: backing remains audible: ${JSON.stringify(during)}`);
                await page.waitForFunction(() => bastardLoopKRecordingState === 'idle', null, { timeout: 5000 });
                await recordTouch.release();
                const recorded = await capture(page);
                assert.ok(Math.abs(recorded.duration - .8) < .02, `${source}: bounded two-pattern capture`);
                assert.ok(recorded.rms > .0002, `${source}: selected sound captured: ${JSON.stringify({ during, recorded })}`);
                assert.ok(recorded.peak > .001);
                assert.ok(during.captureRms > .0002, `${source}: selected physical key reaches K capture bus`);
                assert.ok(recorded.waveformColours > 2);
                assert.ok(recorded.playing && recorded.source);
                for (let repeat = 0; repeat < 2; repeat += 1) {
                    await page.locator('#performanceBastardLoopKStartBtn').tap();
                    await page.waitForFunction(() => !bastardLoopPlaying && !bastardLoopKSource);
                    await page.locator('#performanceBastardLoopKStartBtn').tap();
                    await page.waitForFunction(() => bastardLoopPlaying && Boolean(bastardLoopKSource));
                }
                await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
                assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.getState())), qBefore, 'Keyboard leaves Q instrument/sequence/state unchanged');
                const item = { source, group, recordButton, note: recordTouch.note, live, backingOnly, during, recorded };
                captures.push(item);
                fs.writeFileSync(path.join(evidence, `captures-${sampleRate}.json`), JSON.stringify(captures, null, 2));
                console.log('capture passed', sampleRate, source, JSON.stringify(recorded));
            }
            await selected(page, 'strings', 'performanceKeyboardSoundSwitch');
            await page.locator('#holdBtn').tap();
            const held = await holdTouch(page, context);
            await page.waitForTimeout(200);
            await held.release();
            await page.waitForTimeout(350);
            const sustain = await voiceState(page);
            assert.ok(sustain.samples.length > 0 && sustain.samples.every(voice => !voice.released), 'Hold sustains string voices');
            await page.locator('#holdBtn').tap();
            await page.waitForFunction(() => getKeyboardSamplePlayer().metrics.voices === 0, null, { timeout: 1800 });
            const octaveBefore = await page.evaluate(() => octaveOffset);
            await page.locator('#octaveUpBtn').tap();
            const octaveTouch = await holdTouch(page, context);
            await page.waitForTimeout(180);
            const octave = await voiceState(page);
            const expectedMidi = await page.evaluate(note => 69 + 12 * Math.log2(getKeyboardNoteFrequency(note) / 440), octaveTouch.note);
            assert.ok(octave.samples.some(voice => Math.abs(voice.midi - expectedMidi) < .001));
            await octaveTouch.release();
            await page.locator('#octaveDownBtn').tap();
            assert.equal(await page.evaluate(() => octaveOffset), octaveBefore);
            const cancellation = await pendingCancellation(page);
            for (const operation of cancellation) {
                assert.ok(operation.pendingBefore > 0);
                assert.equal(operation.voices, 0);
                assert.equal(operation.pending, 0);
            }
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.getState())), qBefore);
            const persisted = await persistence(page);
            for (const result of persisted.results) {
                assert.equal(result.saved, true);
                assert.equal(result.stored, result.source);
                assert.equal(result.actual, result.source);
            }
            assert.equal(persisted.legacyDefault, 'grain');
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.getState())), qBefore);
            await page.locator('#performanceBastardLoopKSoundSwitch').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.screenshot({ path: path.join(evidence, `k-source-${sampleRate}.png`) });
            await page.locator('#performanceKeyboardSoundSwitch').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.screenshot({ path: path.join(evidence, `keyboard-source-${sampleRate}.png`) });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.waitForTimeout(350);
            await selected(page, 'strings', 'performanceKeyboardSoundSwitch');
            const panicTouch = await holdTouch(page, context);
            await page.waitForFunction(() => getKeyboardSamplePlayer().metrics.voices > 0);
            const beforePanic = await page.evaluate(() => getKeyboardSamplePlayer().metrics);
            await page.locator('#panicBtn').evaluate(button => button.click());
            await panicTouch.release();
            await page.waitForFunction(() => !audioEngineResetPromise && !engineStarting && isAudioGraphReady());
            await page.waitForFunction(() => getKeyboardSamplePlayer().metrics.voices === 0 && getKeyboardSamplePlayer().metrics.pending === 0);
            const afterPanic = await page.evaluate(() => getKeyboardSamplePlayer().metrics);
            results.push({ sampleRate, viewport, captures, sustain, octave, cancellation, persisted, panic: { before: beforePanic, after: afterPanic }, qStateUnchanged: true });
            await context.close();
        }
        const report = { base, results, errors, consoleErrors, blockedWrites, physicalSafari: 'not tested' };
        fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
        assert.deepEqual(errors, []);
        assert.deepEqual(blockedWrites, []);
        console.log(JSON.stringify(report, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
