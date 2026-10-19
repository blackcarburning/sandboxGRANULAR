const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18798/mygrain/';
const evidence = process.env.MYGRAIN_HOLD_MIX_EVIDENCE || '/tmp/mygrain-k-hold-mix.json';
const baseline = process.env.MYGRAIN_HOLD_BASELINE === '1';
const results = [];
const failures = [];
const pageErrors = [];
const consoleErrors = [];
const blockedWrites = [];

function check(condition, message) {
    if (!condition) failures.push(message);
}

async function rms(page, duration = 250) {
    const samples = [];
    for (let reading = 0; reading < 5; reading += 1) {
        await page.waitForTimeout(duration / 5);
        samples.push(await page.evaluate(() => {
            const pcm = new Float32Array(holdMixAnalyser.fftSize);
            holdMixAnalyser.getFloatTimeDomainData(pcm);
            return Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
        }));
    }
    return Math.max(...samples);
}

async function configure(page) {
    await page.evaluate(() => {
        stateSaveSuspended = true;
        stopAllPerformancePlayback({ silent: true });
        panicAllNotes({ immediate: true, preserveStatus: true });
        setHoldEnabled(false);
        setArpeggiatorEnabled(false, { skipSave: true });
        setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
        for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
        setDrumMachineEnabled(false, { silent: true, skipSave: true });
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        setFxMuted(true, { silent: true });
        const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
        const pcm = buffer.getChannelData(0);
        for (let frame = 0; frame < pcm.length; frame += 1) pcm[frame] = .3 * Math.sin(2 * Math.PI * 440 * frame / buffer.sampleRate);
        grainASampleBuffer = buffer;
        grainBSampleBuffer = buffer;
        document.getElementById('grainSynthASource').value = 'grainASample';
        document.getElementById('grainSynthBSource').value = 'grainBSample';
        syncLegacyAudioBuffer();
        setGranularLayerMuted('A', false, { silent: true, skipSave: true });
        setGranularLayerMuted('B', true, { silent: true, skipSave: true });
        window.holdMixAnalyser = audioContext.createAnalyser();
        holdMixAnalyser.fftSize = 8192;
        finalAmplifierNode.connect(holdMixAnalyser);
    });
}

async function select(page, source) {
    await page.locator(`#performanceKeyboardSoundSwitch [data-keyboard-sound="${source}"]`).tap();
    await page.waitForFunction(sound => keyboardSoundSource === sound, source);
    await page.evaluate(async sound => { await prepareKeyboardSound(sound); }, source);
}

async function tapKey(page, input) {
    await page.locator('.performance-keyboard-card .keyboard-section').evaluate(section => section.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const selector = await page.evaluate(() => {
        const key = [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].find(element => {
            const bounds = element.getBoundingClientRect();
            return bounds.width > 0 && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height * .8)?.closest('.key') === element;
        });
        return `.key[data-note="${key.dataset.note}"]`;
    });
    const key = page.locator(selector);
    if (input === 'touch') {
        const bounds = await key.boundingBox();
        await key.tap({ position: { x: bounds.width / 2, y: bounds.height * .8 } });
    } else {
        await key.focus();
        await page.keyboard.down('Enter');
        await page.waitForTimeout(35);
        await page.keyboard.up('Enter');
    }
}

async function slider(page, controlId, value) {
    await page.locator(`#${controlId}`).evaluate((control, next) => {
        control.value = String(next);
        control.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) {
                    blockedWrites.push({ method: route.request().method(), url: route.request().url() });
                    return route.abort();
                }
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await configure(page);
            const qBefore = await page.evaluate(() => JSON.stringify(mygrainQ.getState()));
            const hold = [];
            for (const source of ['strings', 'osc', 'grain']) {
                for (const input of ['touch', 'keyboard']) {
                    await page.evaluate(() => { setHoldEnabled(false); panicAllNotes({ immediate: true, preserveStatus: true }); });
                    await select(page, source);
                    await page.locator('#holdBtn').tap();
                    await tapKey(page, input);
                    const initial = await rms(page);
                    await page.waitForTimeout(1500);
                    const sustained = await rms(page);
                    const held = await page.evaluate(() => ({ holdEnabled, arpEnabled, held: [...heldNotes], sampleVoices: keyboardSamplePlayer?.metrics.voices || 0, oscillatorVoices: activeOscVoices.size }));
                    check(held.holdEnabled && !held.arpEnabled && held.held.length > 0 && sustained > .0001, `${viewport.width}/${source}/${input}: Hold sustains after release (${sustained})`);
                    await page.evaluate(() => stopLoopAndHeldKeys({ silent: true }));
                    await page.waitForTimeout(250);
                    const stopped = await rms(page, 350);
                    check(stopped < .0001, `${viewport.width}/${source}/${input}: Stop silences Hold (${stopped})`);
                    await page.evaluate(() => playLoopAndHeldKeys({ silent: true }));
                    const restarted = await rms(page, 400);
                    check(restarted > .0001, `${viewport.width}/${source}/${input}: Play restores held sound (${restarted})`);
                    await page.locator('#holdBtn').tap();
                    await page.waitForTimeout(1000);
                    const released = await rms(page);
                    check(released < .0001, `${viewport.width}/${source}/${input}: Hold off releases sound (${released})`);
                    hold.push({ source, input, initial, sustained, stopped, restarted, released, held });
                    console.log(JSON.stringify({ viewport, source, input, sustained, stopped, restarted, released }));
                }
            }
            const mix = [];
            if (!baseline) {
                for (const [source, controlId] of [['piano', 'performanceKeyboardPianoVolume'], ['strings', 'performanceKeyboardStringsVolume']]) {
                    await select(page, source);
                    await slider(page, controlId, 100);
                    await page.locator('#holdBtn').tap();
                    await tapKey(page, 'touch');
                    const sounding = await rms(page);
                    await slider(page, controlId, 0);
                    await page.waitForTimeout(200);
                    const muted = await rms(page);
                    await slider(page, controlId, 70);
                    const restored = await rms(page);
                    check(sounding > .0001 && muted < .0001 && restored > .0001, `${viewport.width}/${source}: slider changes currently sounding voice (${sounding}/${muted}/${restored})`);
                    await page.evaluate(() => { setHoldEnabled(false); panicAllNotes({ immediate: true, preserveStatus: true }); });
                    await slider(page, controlId, 0);
                    await page.locator('#holdBtn').tap();
                    await tapKey(page, 'touch');
                    const freshMuted = await rms(page);
                    check(freshMuted < .0001, `${viewport.width}/${source}: new notes respect zero volume (${freshMuted})`);
                    await slider(page, controlId, 60);
                    await page.locator('#holdBtn').tap();
                    await page.locator('#sectionJumpBastardMixerBtn').tap();
                    const jump = page.locator(`#performanceMixerSliderJumps button[aria-controls="${controlId}"]`);
                    await jump.tap();
                    const destination = await page.locator(`#${controlId}`).evaluate(control => {
                        const bounds = control.getBoundingClientRect();
                        return { focused: document.activeElement === control, visible: bounds.top >= 0 && bounds.bottom <= innerHeight, value: control.value };
                    });
                    check(destination.focused && destination.visible, `${viewport.width}/${source}: Mix jump focuses visible volume slider`);
                    mix.push({ source, controlId, sounding, muted, restored, freshMuted, destination });
                }
                const saved = await page.evaluate(() => {
                    stateSaveSuspended = false;
                    const success = saveState({ force: true });
                    const snapshot = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY));
                    stateSaveSuspended = true;
                    return { success, snapshot };
                });
                check(saved.success, `${viewport.width}: volume state saved`);
                check(await page.evaluate(before => JSON.stringify(mygrainQ.getState()) === before, qBefore), `${viewport.width}: Q state remains unchanged`);
                await page.reload({ waitUntil: 'load' });
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                for (const { controlId } of mix) check(await page.locator(`#${controlId}`).inputValue() === '60', `${viewport.width}/${controlId}: volume restored after reload`);
                check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${viewport.width}: no horizontal page overflow`);
            }
            results.push({ viewport, hold, mix });
            await context.close();
        }
    } finally {
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify({ base, baseline, results, failures, pageErrors, consoleErrors, blockedWrites, physicalSafari: 'not tested' }, null, 2));
    }
    console.log(JSON.stringify({ evidence, cases: results.length, failures, pageErrors, consoleErrors: consoleErrors.length, blockedWrites }, null, 2));
    assert.deepEqual(failures, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(blockedWrites, []);
})().catch(error => { console.error(error); process.exitCode = 1; });
