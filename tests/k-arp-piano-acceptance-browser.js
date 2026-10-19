const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18798/mygrain/';
const baseline = process.env.MYGRAIN_ARP_BASELINE;
const evidence = process.env.MYGRAIN_ARP_EVIDENCE || '/tmp/mygrain-k9-acceptance.json';
const results = [];
const failures = [];
const consoleErrors = [];
const blockedWrites = [];
const transitions = [];

function check(condition, message) {
    if (!condition) failures.push(message);
}

async function levels(page, duration = 250) {
    const readings = [];
    for (let sample = 0; sample < 5; sample += 1) {
        await page.waitForTimeout(duration / 5);
        readings.push(await page.evaluate(() => {
            const values = new Float32Array(acceptanceAnalyser.fftSize);
            acceptanceAnalyser.getFloatTimeDomainData(values);
            return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
        }));
    }
    return Math.max(...readings);
}

async function state(page) {
    return page.evaluate(() => ({
        arpEnabled, holdEnabled, running: isArpeggiatorPlaying(), held: [...heldNotes], sequencerPlaying,
        played: acceptanceNotes.slice(),
        oscillatorRoles: [...activeOscVoices.values()].map(voice => voice.role),
        sampleVoices: keyboardSamplePlayer?.metrics.voices || 0,
        pending: keyboardSamplePlayer?.metrics.pending || 0
    }));
}

async function chord(page, input) {
    await page.locator('.performance-keyboard-card .keyboard-section').evaluate(section => section.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const selectors = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')]
        .filter(key => {
            const bounds = key.getBoundingClientRect();
            const position = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * .8 };
            return bounds.width > 0 && document.elementFromPoint(position.x, position.y)?.closest('.key') === key;
        })
        .slice(1, 4).map(key => `.key[data-note="${key.dataset.note}"]`));
    assert.equal(selectors.length, 3);
    for (const selector of selectors) {
        if (input === 'touch') {
            const bounds = await page.locator(selector).boundingBox();
            await page.locator(selector).tap({ position: { x: bounds.width / 2, y: bounds.height * .8 } });
        } else {
            await page.locator(selector).focus();
            await page.keyboard.down('Enter');
            await page.waitForTimeout(45);
            await page.keyboard.up('Enter');
        }
        await page.waitForTimeout(60);
    }
}

async function freshKey(page, input) {
    await page.locator('.performance-keyboard-card .keyboard-section').evaluate(section => section.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const selector = await page.evaluate(() => {
        const key = [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].find(element => {
            const bounds = element.getBoundingClientRect();
            return !heldNotes.has(element.dataset.note) && bounds.width > 0 && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height * .8)?.closest('.key') === element;
        });
        return key ? `.key[data-note="${key.dataset.note}"]` : null;
    });
    assert.ok(selector, 'A fresh visible key must be available');
    if (input === 'touch') {
        const bounds = await page.locator(selector).boundingBox();
        await page.locator(selector).tap({ position: { x: bounds.width / 2, y: bounds.height * .8 } });
    } else {
        await page.locator(selector).focus();
        await page.keyboard.press('Enter');
    }
}

function medianStep(events) {
    const intervals = events.slice(1).map((event, index) => event.scheduledTime - events[index].scheduledTime).sort((first, second) => first - second);
    return intervals.length ? intervals[Math.floor(intervals.length / 2)] : null;
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            const page = await context.newPage();
            page.setDefaultTimeout(45000);
            const errors = [];
            const downloads = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()); });
            page.on('response', response => {
                if (/SAMPLES_Q.*\.(wav|mp3|json)$/.test(new URL(response.url()).pathname)) {
                    downloads.push({ url: response.url(), bytes: Number(response.headers()['content-length'] || 0) });
                }
            });
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) {
                    blockedWrites.push({ url: route.request().url(), method: route.request().method() });
                    return route.abort();
                }
                const pathname = new URL(route.request().url()).pathname;
                if (baseline && (pathname === '/mygrain/' || pathname.endsWith('/index.html') || pathname.endsWith('/q-card.js'))) {
                    const filename = pathname.endsWith('/q-card.js') ? 'q-card.js' : 'index.html';
                    return route.fulfill({ path: path.join(baseline, filename), contentType: filename.endsWith('.js') ? 'application/javascript' : 'text/html' });
                }
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                panicAllNotes({ immediate: true, preserveStatus: true });
                setHoldEnabled(false);
                setArpeggiatorEnabled(false, { skipSave: true });
                for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
                setDrumMachineEnabled(false, { silent: true, skipSave: true });
                clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                setFxMuted(true, { silent: true });
                const tone = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const pcm = tone.getChannelData(0);
                for (let frame = 0; frame < pcm.length; frame += 1) pcm[frame] = .3 * Math.sin(2 * Math.PI * 440 * frame / tone.sampleRate);
                grainASampleBuffer = tone;
                grainBSampleBuffer = tone;
                document.getElementById('grainSynthASource').value = 'grainASample';
                document.getElementById('grainSynthBSource').value = 'grainBSample';
                syncLegacyAudioBuffer();
                setGranularLayerMuted('A', false, { silent: true, skipSave: true });
                setGranularLayerMuted('B', true, { silent: true, skipSave: true });
                window.acceptanceAnalyser = audioContext.createAnalyser();
                acceptanceAnalyser.fftSize = 2048;
                finalAmplifierNode.connect(acceptanceAnalyser);
                window.acceptanceNotes = [];
                const original = playKeyboardSound;
                playKeyboardSound = (note, time, velocity, options = {}) => {
                    acceptanceNotes.push({ note, role: options.role || 'keyboard', time: audioContext.currentTime, scheduledTime: time });
                    return original(note, time, velocity, options);
                };
            });
            const qBefore = await page.evaluate(() => JSON.stringify(mygrainQ.getState()));
            for (const source of ['piano', 'strings', 'osc', 'grain']) {
                await page.evaluate(() => {
                    stopAllPerformancePlayback({ silent: true });
                    panicAllNotes({ immediate: true, preserveStatus: true });
                    setArpeggiatorEnabled(false, { skipSave: true });
                    setHoldEnabled(false);
                    applyGlobalBpm(120, { skipSave: true });
                    setArpClockMultiplier(1, { skipSave: true });
                    acceptanceNotes.length = 0;
                });
                const beforeRequests = downloads.length;
                const started = Date.now();
                await page.locator(`#performanceKeyboardSoundSwitch [data-keyboard-sound="${source}"]`).tap();
                await page.waitForFunction(sound => keyboardSoundSource === sound, source);
                await page.evaluate(sound => prepareKeyboardSound(sound), source);
                const loadingMs = Date.now() - started;
                const sampleDownloads = downloads.slice(beforeRequests);
                await page.locator('#arpBtn').tap();
                await chord(page, viewport.width === 390 ? 'touch' : 'keyboard');
                const beforePlayRms = await levels(page, 700);
                const beforePlay = await state(page);
                check(beforePlay.holdEnabled && beforePlay.running && beforePlayRms > .0001, `${viewport.width}/${source}: fresh keys must audition arp before Play`);
                check(!beforePlay.sequencerPlaying, `${viewport.width}/${source}: keyboard audition started backing transport`);
                check(beforePlay.played.length >= 4 && beforePlay.played.every(event => event.role === 'arp') && beforePlay.oscillatorRoles.every(role => role === 'arp'), `${viewport.width}/${source}: audition must contain only arp voices, not a held chord drone`);
                const initialStep = medianStep(beforePlay.played.slice(-5));
                check(initialStep !== null && Math.abs(initialStep - .125) < .025, `${viewport.width}/${source}: audition must follow 120 BPM, got ${initialStep}`);
                await page.evaluate(() => {
                    acceptanceNotes.length = 0;
                    const slider = document.getElementById('globalBpmSlider');
                    slider.value = '80';
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                    slider.dispatchEvent(new Event('change', { bubbles: true }));
                });
                await levels(page, 1000);
                const slower = await state(page);
                const changedStep = medianStep(slower.played.slice(-4));
                check(changedStep !== null && Math.abs(changedStep - .1875) < .025, `${viewport.width}/${source}: audition must follow live 80 BPM, got ${changedStep}`);
                await page.evaluate(() => { acceptanceNotes.length = 0; playLoopAndHeldKeys({ silent: true }); });
                const playingRms = await levels(page, 500);
                const playing = await state(page);
                check(playingRms > .0001 && playing.played.some(event => event.role === 'arp'), `${viewport.width}/${source}: Play must sound arp`);
                check(playing.played.every(event => event.role === 'arp') && playing.oscillatorRoles.every(role => role === 'arp'), `${viewport.width}/${source}: direct drone during arp`);
                await page.evaluate(() => { stopLoopAndHeldKeys({ silent: true }); acceptanceNotes.length = 0; });
                await page.waitForTimeout(250);
                const stoppedRms = await levels(page);
                const stopped = await state(page);
                check(stopped.arpEnabled && !stopped.running && !stopped.pending && !stopped.sampleVoices && stopped.played.length === 0 && stoppedRms < .0001, `${viewport.width}/${source}: Stop must silence notes without disabling arp`);
                await freshKey(page, viewport.width === 390 ? 'touch' : 'keyboard');
                const freshKeyRms = await levels(page, 400);
                const freshKeyState = await state(page);
                check(freshKeyRms > .0001 && freshKeyState.running && !freshKeyState.sequencerPlaying && freshKeyState.played.every(event => event.role === 'arp'), `${viewport.width}/${source}: new key after Stop must restart only keyboard arp`);
                await page.evaluate(() => { stopLoopAndHeldKeys({ silent: true }); acceptanceNotes.length = 0; });
                await page.waitForTimeout(250);
                await page.evaluate(() => playLoopAndHeldKeys({ silent: true }));
                const restartedRms = await levels(page);
                check(restartedRms > .0001, `${viewport.width}/${source}: Play restarts selected arp chord`);
                await page.evaluate(() => { stopAllPerformancePlayback({ silent: true }); acceptanceNotes.length = 0; });
                await page.waitForTimeout(250);
                const stopAllRms = await levels(page);
                const stoppedAll = await state(page);
                check(stoppedAll.arpEnabled && !stoppedAll.running && stoppedAll.played.length === 0 && !stoppedAll.sampleVoices && stopAllRms < .0001, `${viewport.width}/${source}: Stop All leaves a drone`);
                if (!baseline) {
                    await page.locator('#sectionJumpTransportBtn').tap();
                    const toolbarPlayRms = await levels(page);
                    const toolbarPlaying = await state(page);
                    check(toolbarPlayRms > .0001 && toolbarPlaying.running, `${viewport.width}/${source}: visible Start must play arp`);
                    await page.locator('#sectionJumpTransportBtn').tap();
                    await page.waitForTimeout(250);
                    const toolbarStopRms = await levels(page);
                    check(toolbarStopRms < .0001 && !(await state(page)).running, `${viewport.width}/${source}: visible Stop must silence arp`);
                }
                await page.evaluate(() => applyGlobalBpm(120, { skipSave: true }));
                const result = { viewport, source, loadingMs, sampleBytes: sampleDownloads.reduce((sum, item) => sum + item.bytes, 0),
                    sampleDownloads, beforePlayRms, beforePlay, initialStep, changedStep, freshKeyRms, playingRms, playing, stoppedRms, stopped, restartedRms, stopAllRms, stoppedAll };
                results.push(result);
                console.log(JSON.stringify({ viewport, source, loadingMs, sampleBytes: result.sampleBytes, beforePlayRms, playingRms, stoppedRms, stopAllRms }));
            }
            if (!baseline) {
                await page.evaluate(() => {
                    stopAllPerformancePlayback({ silent: true });
                    panicAllNotes({ immediate: true, preserveStatus: true });
                    setArpeggiatorEnabled(false, { skipSave: true });
                    setHoldEnabled(true);
                    setKeyboardSoundSource('osc', { skipSave: true });
                    applyGlobalBpm(120, { skipSave: true });
                    setArpClockMultiplier(1, { skipSave: true });
                    acceptanceNotes.length = 0;
                });
                await freshKey(page, viewport.width === 390 ? 'touch' : 'keyboard');
                const directRms = await levels(page, 400);
                check(directRms > .0001, `${viewport.width}: direct held chord must sound before enabling arp`);
                await page.evaluate(() => { acceptanceNotes.length = 0; });
                await page.locator('#arpBtn').tap();
                const enabledRms = await levels(page, 500);
                const enabledState = await state(page);
                check(enabledRms > .0001 && enabledState.running && !enabledState.sequencerPlaying && enabledState.played.every(event => event.role === 'arp') && enabledState.oscillatorRoles.every(role => role === 'arp'), `${viewport.width}: enabling arp over a held chord must replace it with keyboard-only arp`);
                await page.locator('#sectionJumpTransportBtn').tap();
                await page.waitForTimeout(250);
                const visibleStopRms = await levels(page);
                check(visibleStopRms < .0001 && !(await state(page)).running, `${viewport.width}: visible Stop must stop keyboard-only audition`);
                await page.evaluate(() => {
                    acceptanceNotes.length = 0;
                    applyGlobalBpm(90, { skipSave: true });
                    setArpClockMultiplier(2, { skipSave: true });
                    setArpMode('down', { skipSave: true });
                });
                const afterControlsRms = await levels(page, 600);
                const afterControls = await state(page);
                check(afterControlsRms < .0001 && !afterControls.running && afterControls.played.length === 0, `${viewport.width}: tempo/mode changes after Stop must not restart held arp`);
                await freshKey(page, viewport.width === 390 ? 'touch' : 'keyboard');
                const multiplierRms = await levels(page, 700);
                const multiplierState = await state(page);
                const multiplierStep = medianStep(multiplierState.played.slice(-5));
                check(multiplierRms > .0001 && multiplierStep !== null && Math.abs(multiplierStep - 1 / 12) < .025, `${viewport.width}: fresh-key audition must honor 90 BPM and x2 multiplier, got ${multiplierStep}`);
                await page.evaluate(() => {
                    stopLoopAndHeldKeys({ silent: true });
                    acceptanceNotes.length = 0;
                    window.arpAcceptanceReadyOriginal = ensureAudioReadyForKeyInteraction;
                    ensureAudioReadyForKeyInteraction = async () => {
                        await new Promise(resolve => { window.arpAcceptanceReleaseReady = resolve; });
                        return arpAcceptanceReadyOriginal();
                    };
                });
                await freshKey(page, viewport.width === 390 ? 'touch' : 'keyboard');
                await page.waitForFunction(() => typeof arpAcceptanceReleaseReady === 'function');
                await page.evaluate(() => {
                    stopLoopAndHeldKeys({ silent: true });
                    arpAcceptanceReleaseReady();
                    ensureAudioReadyForKeyInteraction = arpAcceptanceReadyOriginal;
                });
                await page.waitForTimeout(250);
                const canceledRms = await levels(page, 500);
                const canceledState = await state(page);
                check(canceledRms < .0001 && !canceledState.running && !canceledState.pending && canceledState.played.length === 0, `${viewport.width}: a key waiting for audio readiness must not restart after Stop`);
                transitions.push({ viewport, directRms, enabledRms, visibleStopRms, afterControlsRms, multiplierRms, multiplierStep, canceledRms });
                await page.evaluate(() => applyGlobalBpm(120, { skipSave: true }));
            }
            check(await page.evaluate(() => JSON.stringify(mygrainQ.getState())) === qBefore, `${viewport.width}: Q state changed`);
            check(errors.length === 0, `${viewport.width}: browser errors: ${errors.join('; ')}`);
            await page.screenshot({ path: evidence.replace(/\.json$/, `-${viewport.width}.png`) });
            await context.close();
        }
    } finally {
        fs.writeFileSync(evidence, JSON.stringify({ results, transitions, failures, consoleErrors, blockedWrites }, null, 2));
        await browser.close();
    }
    console.log(JSON.stringify({ failures }));
    if (!baseline) assert.deepEqual(failures, []);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
