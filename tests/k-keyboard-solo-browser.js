const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18798/mygrain/';
const evidence = process.env.MYGRAIN_SOLO_EVIDENCE || '/tmp/mygrain-k-keyboard-solo';
const failures = [];
const pageErrors = [];
const consoleErrors = [];
const blockedWrites = [];
const results = [];

function check(condition, message) {
    if (!condition) failures.push(message);
}

async function levels(page) {
    await page.waitForTimeout(350);
    return page.evaluate(() => {
        const measured = {};
        for (const [name, analyser] of Object.entries(window.keyboardSoloAnalysers)) {
            const pcm = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(pcm);
            measured[name] = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
        }
        return measured;
    });
}

async function toggle(page, instrument) {
    const button = page.locator(`#performanceKeyboard${instrument === 'strings' ? 'Strings' : 'Piano'}VolumeSoloBtn`);
    await button.tap();
    return button.getAttribute('aria-pressed');
}

async function prepare(page) {
    await page.evaluate(async () => {
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
        setGeneratedDryLoopEnabled(true, { silent: true, skipSave: true });
        document.getElementById('performanceGeneratedDryMix').value = '60';
        updateGeneratedDryLoopMix();
        for (const id of ['performanceKeyboardPianoVolume', 'performanceKeyboardStringsVolume']) {
            const control = document.getElementById(id);
            control.value = '75';
            control.dispatchEvent(new Event('input', { bubbles: true }));
        }
        window.keyboardSoloAnalysers = {};
        const attach = (name, node) => {
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 8192;
            node.connect(analyser);
            keyboardSoloAnalysers[name] = analyser;
        };
        attach('mix', finalAmplifierNode);
        attach('capture', keyboardGrainCaptureGain);
        const player = getKeyboardSamplePlayer();
        await Promise.all(['piano', 'strings'].map(instrument => player.prepare(instrument, 60, 127)));
        window.attachKeyboardSoloVoice = async instrument => {
            const voice = await player.noteOn(`solo-${instrument}`, 60, { instrument, velocity: 127 });
            attach(instrument, voice.mixGain || voice.gain);
        };
    });
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
            const counts = await Promise.all(['Piano', 'Strings'].map(instrument => page.locator(`#performanceKeyboard${instrument}VolumeSoloBtn`).count()));
            check(counts.every(count => count === 1), `${viewport.width}: both keyboard channels have exactly one Solo button`);
            if (!counts.every(count => count === 1)) {
                results.push({ viewport, counts });
                await context.close();
                continue;
            }
            await prepare(page);
            const qBefore = await page.evaluate(() => JSON.stringify(mygrainQ.getState()));
            const cases = [];
            for (const instrument of ['piano', 'strings']) {
                const other = instrument === 'piano' ? 'strings' : 'piano';
                await page.evaluate(() => {
                    clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                    keyboardSamplePlayer.stop();
                });
                await page.evaluate(source => attachKeyboardSoloVoice(source), instrument);
                const original = await levels(page);
                check(original[instrument] > .00001 && original.capture > .00001, `${viewport.width}/${instrument}: sounding voice reaches mix and K`);
                check(await toggle(page, other) === 'true', `${viewport.width}/${other}: Solo button activates`);
                const excluded = await levels(page);
                check(excluded[instrument] < .000001 && excluded.capture < .000001 && excluded.mix < .00001,
                    `${viewport.width}/${instrument}: other instrument Solo mutes sounding voice and K (${JSON.stringify(excluded)})`);
                await page.evaluate(source => attachKeyboardSoloVoice(source), instrument);
                const freshExcluded = await levels(page);
                check(freshExcluded[instrument] < .000001, `${viewport.width}/${instrument}: new voice respects other Solo`);
                check(await toggle(page, instrument) === 'true', `${viewport.width}/${instrument}: additive Solo activates`);
                const included = await levels(page);
                check(included[instrument] > .00001 && included.capture > .00001, `${viewport.width}/${instrument}: adding Solo restores sounding voice and K`);
                check(await toggle(page, other) === 'false', `${viewport.width}/${other}: Solo deactivates independently`);
                const remaining = await levels(page);
                check(remaining[instrument] > .00001, `${viewport.width}/${instrument}: other Solo off leaves selected channel audible`);
                await page.locator('#performanceOscVolumeSoloBtn').tap();
                check(await toggle(page, instrument) === 'false', `${viewport.width}/${instrument}: Solo off leaves Osc selected`);
                const oscOnly = await levels(page);
                check(oscOnly[instrument] < .000001 && oscOnly.capture < .000001, `${viewport.width}/${instrument}: existing Osc Solo excludes sample channel`);
                await page.evaluate(() => clearAllPerformanceSoloStates({ silent: true, skipSave: true }));
                const restored = await levels(page);
                check(restored[instrument] > .00001, `${viewport.width}/${instrument}: Clear Solos restores voice`);
                cases.push({ instrument, original, excluded, freshExcluded, included, remaining, oscOnly, restored });
            }
            await page.evaluate(async () => {
                keyboardSamplePlayer.stop();
                await attachKeyboardSoloVoice('piano');
                await attachKeyboardSoloVoice('strings');
            });
            await toggle(page, 'piano');
            const pianoOnly = await levels(page);
            check(pianoOnly.piano > .00001 && pianoOnly.strings < .000001, `${viewport.width}: Piano-only isolation`);
            await toggle(page, 'strings');
            const both = await levels(page);
            check(both.piano > .00001 && both.strings > .00001, `${viewport.width}: both solos audible together`);
            await toggle(page, 'piano');
            const stringsOnly = await levels(page);
            check(stringsOnly.piano < .000001 && stringsOnly.strings > .00001, `${viewport.width}: Strings-only isolation`);
            await page.evaluate(() => {
                keyboardSamplePlayer.stop();
                clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                generatedLoopBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const samples = generatedLoopBuffer.getChannelData(0);
                for (let frame = 0; frame < samples.length; frame += 1) {
                    samples[frame] = .2 * Math.sin(2 * Math.PI * 220 * frame / audioContext.sampleRate);
                }
                startGeneratedDryLoop();
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 8192;
                generatedDryGainNode.connect(analyser);
                keyboardSoloAnalysers.backing = analyser;
                setPerformanceSourceLayerSolo('strings', { silent: true, skipSave: true });
            });
            const backingExcluded = await levels(page);
            check(backingExcluded.backing < .000001, `${viewport.width}: sample Solo excludes backing bus`);
            await page.evaluate(() => clearAllPerformanceSoloStates({ silent: true, skipSave: true }));
            const backingRestored = await levels(page);
            check(backingRestored.backing > .00001 && backingRestored.capture < .000001, `${viewport.width}: Clear Solos restores backing without K leakage`);
            await page.evaluate(() => stopGeneratedDryLoop());
            check(await page.evaluate(before => JSON.stringify(mygrainQ.getState()) === before, qBefore), `${viewport.width}: Q state unchanged`);
            for (const instrument of ['Piano', 'Strings']) {
                const controlId = `performanceKeyboard${instrument}Volume`;
                await page.locator('#sectionJumpBastardMixerBtn').tap();
                await page.locator(`#performanceMixerSliderJumps button[aria-controls="${controlId}"]`).tap();
                const visible = await page.locator(`#${controlId}SoloBtn`).evaluate(button => {
                    const bounds = button.getBoundingClientRect();
                    return bounds.width > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight
                        && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('button') === button;
                });
                check(visible, `${viewport.width}/${instrument}: Mix jump reveals tappable Solo`);
            }
            await toggle(page, 'piano');
            await toggle(page, 'strings');
            const saved = await page.evaluate(() => {
                stateSaveSuspended = false;
                return saveState({ force: true });
            });
            check(saved, `${viewport.width}: solo state saved`);
            await page.reload({ waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            for (const instrument of ['Piano', 'Strings']) {
                const controlId = `performanceKeyboard${instrument}Volume`;
                check(await page.locator(`#${controlId}SoloBtn`).getAttribute('aria-pressed') === 'false', `${viewport.width}/${instrument}: Solo resets on reload like existing channel solos`);
                check(await page.locator(`#${controlId}`).inputValue() === '75', `${viewport.width}/${instrument}: level unchanged after reload`);
            }
            check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${viewport.width}: no horizontal overflow`);
            await page.locator('#performanceKeyboardPianoVolumeSoloBtn').scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${evidence}-${viewport.width}.png` });
            const result = { viewport, cases, pianoOnly, both, stringsOnly, backingExcluded, backingRestored };
            results.push(result);
            console.log(JSON.stringify(result));
            await context.close();
        }
    } finally {
        await browser.close();
        fs.writeFileSync(`${evidence}.json`, JSON.stringify({ base, results, failures, pageErrors, consoleErrors, blockedWrites, physicalSafari: 'not tested' }, null, 2));
    }
    console.log(JSON.stringify({ evidence, viewports: results.length, failures, pageErrors, consoleErrors: consoleErrors.length, blockedWrites }, null, 2));
    assert.deepEqual(failures, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(blockedWrites, []);
})().catch(error => { console.error(error); process.exitCode = 1; });
