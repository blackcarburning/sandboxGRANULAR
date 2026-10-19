const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18798/mygrain/';
const evidence = process.env.MYGRAIN_SWITCH_EVIDENCE || '/tmp/mygrain-k13-source-switch.json';
const baseline = process.env.MYGRAIN_SWITCH_BASELINE;
const results = [];
const failures = [];
const pageErrors = [];
const consoleErrors = [];
const blockedWrites = [];
const sources = ['osc', 'grain', 'piano', 'strings'];

function check(condition, message) {
    if (!condition) failures.push(message);
}

async function snapshot(page) {
    return page.evaluate(() => ({
        source: keyboardSoundSource,
        held: [...heldNotes].sort(),
        highlighted: [...document.querySelectorAll('#keyboardContainer .key.active')].map(key => key.dataset.note).sort(),
        running: isArpeggiatorPlaying(),
        hold: holdEnabled,
        arp: arpEnabled,
        bpm: sequencerBPM,
        multiplier: getArpClockMultiplierValue(),
        sequencer: sequencerPlaying,
        events: switchEvents.slice(),
        osc: [...activeOscVoices.values()].map(voice => voice.role),
        grains: [...activeGrains.values()].map(voice => voice.role),
        samples: keyboardSamplePlayer?.metrics.voices || 0,
        pending: keyboardSamplePlayer?.metrics.pending || 0
    }));
}

async function rms(page, duration = 450) {
    const readings = [];
    for (let sample = 0; sample < 5; sample += 1) {
        await page.waitForTimeout(duration / 5);
        readings.push(await page.evaluate(() => {
            const values = new Float32Array(switchAnalyser.fftSize);
            switchAnalyser.getFloatTimeDomainData(values);
            return Math.sqrt(values.reduce((total, value) => total + value * value, 0) / values.length);
        }));
    }
    return Math.max(...readings);
}

async function select(page, source) {
    await page.locator(`#performanceKeyboardSoundSwitch [data-keyboard-sound="${source}"]`).tap();
    await page.waitForFunction(value => keyboardSoundSource === value, source);
    await page.evaluate(value => prepareKeyboardSound(value), source);
}

async function chord(page) {
    await page.locator('#keyboardContainer').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const notes = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].filter(key => {
        const bounds = key.getBoundingClientRect();
        return bounds.width > 0 && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height * .8)?.closest('.key') === key;
    }).slice(1, 4).map(key => key.dataset.note));
    assert.equal(notes.length, 3, 'three tappable phone keys');
    for (const note of notes) {
        const key = page.locator(`#keyboardContainer .key[data-note="${note}"]`);
        const bounds = await key.boundingBox();
        await key.tap({ position: { x: bounds.width / 2, y: bounds.height * .8 } });
        await page.waitForTimeout(70);
    }
    await page.waitForFunction(() => heldNotes.size === 3);
}

async function begin(page, source) {
    await page.evaluate(() => {
        panicAllNotes({ immediate: true, preserveStatus: true });
        setArpeggiatorEnabled(false, { skipSave: true });
        setHoldEnabled(false);
    });
    await select(page, source);
    await page.evaluate(() => {
        setArpeggiatorEnabled(true, { skipSave: true });
        applyGlobalBpm(90, { skipSave: true });
        setArpClockMultiplier(2, { skipSave: true });
    });
    await chord(page);
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            const page = await context.newPage();
            page.setDefaultTimeout(25000);
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()); });
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) {
                    blockedWrites.push({ method: route.request().method(), url: route.request().url() });
                    return route.abort();
                }
                if (baseline && new URL(route.request().url()).pathname === '/mygrain/') return route.fulfill({ path: baseline, contentType: 'text/html' });
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                panicAllNotes({ immediate: true, preserveStatus: true });
                for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
                setDrumMachineEnabled(false, { silent: true, skipSave: true });
                setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
                clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                setFxMuted(true, { silent: true });
                const tone = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const values = tone.getChannelData(0);
                for (let frame = 0; frame < values.length; frame += 1) values[frame] = .3 * Math.sin(2 * Math.PI * 440 * frame / tone.sampleRate);
                grainASampleBuffer = tone;
                grainBSampleBuffer = tone;
                document.getElementById('grainSynthASource').value = 'grainASample';
                document.getElementById('grainSynthBSource').value = 'grainBSample';
                syncLegacyAudioBuffer();
                setGranularLayerMuted('A', false, { silent: true, skipSave: true });
                setGranularLayerMuted('B', true, { silent: true, skipSave: true });
                window.switchAnalyser = audioContext.createAnalyser();
                switchAnalyser.fftSize = 2048;
                finalAmplifierNode.connect(switchAnalyser);
                window.switchEvents = [];
                const original = playKeyboardSound;
                playKeyboardSound = (note, time, velocity, options = {}) => {
                    switchEvents.push({ source: keyboardSoundSource, note, role: options.role || 'keyboard', time: time ?? audioContext.currentTime });
                    return original(note, time, velocity, options);
                };
            });
            const qBefore = await page.evaluate(() => JSON.stringify(mygrainQ.getState()));
            for (const from of sources) {
                for (const to of sources.filter(source => source !== from)) {
                    await begin(page, from);
                    const before = await snapshot(page);
                    check(await rms(page, 250) > .0001, `${viewport.width}/${from}: initial arp audible`);
                    await page.evaluate(() => { switchEvents.length = 0; });
                    await select(page, to);
                    await page.evaluate(() => { switchEvents.length = 0; });
                    await page.waitForTimeout(200);
                    const level = await rms(page);
                    const after = await snapshot(page);
                    const label = `${viewport.width}/${from}->${to}`;
                    check(JSON.stringify(after.held) === JSON.stringify(before.held), `${label}: held notes retained`);
                    check(JSON.stringify(after.highlighted) === JSON.stringify(before.highlighted), `${label}: key highlights retained`);
                    check(after.running && after.hold && after.arp && level > .0001, `${label}: arp keeps sounding (${level})`);
                    check(after.bpm === 90 && after.multiplier === 2 && !after.sequencer, `${label}: tempo/rate retained, no backing`);
                    check(after.events.length >= 3 && after.events.every(event => event.source === to && event.role === 'arp'), `${label}: only new-source arp, no direct chord`);
                    const intervals = after.events.slice(1).map((event, index) => event.time - after.events[index].time).sort((first, second) => first - second);
                    const medianStep = intervals[Math.floor(intervals.length / 2)];
                    check(Math.abs(medianStep - 1 / 12) < .025, `${label}: 90 BPM x2 cadence retained (${medianStep})`);
                    check(after.osc.every(role => role === 'arp') && after.grains.every(role => role === 'arp'), `${label}: no direct voice drone`);
                    check(to === 'osc' || after.osc.length === 0, `${label}: old osc voices cleared`);
                    check(to === 'grain' || after.grains.length === 0, `${label}: old grain voices cleared`);
                    check(['piano', 'strings'].includes(to) || (after.samples === 0 && after.pending === 0), `${label}: old sample voices and loads cleared`);
                    results.push({ viewport, from, to, mode: 'active', level, before, after });
                    await page.evaluate(() => stopLoopAndHeldKeys({ silent: true }));
                    const stoppedBefore = await snapshot(page);
                    await page.evaluate(() => { switchEvents.length = 0; });
                    await select(page, from);
                    await page.waitForTimeout(250);
                    const stoppedLevel = await rms(page, 300);
                    const stoppedAfter = await snapshot(page);
                    check(JSON.stringify(stoppedAfter.held) === JSON.stringify(stoppedBefore.held) && JSON.stringify(stoppedAfter.highlighted) === JSON.stringify(stoppedBefore.highlighted), `${label}/stopped: selection retained`);
                    check(!stoppedAfter.running && !stoppedAfter.sequencer && stoppedLevel < .0001 && stoppedAfter.events.length === 0, `${label}/stopped: switch does not restart audio (${stoppedLevel})`);
                    results.push({ viewport, from: to, to: from, mode: 'stopped', level: stoppedLevel, before: stoppedBefore, after: stoppedAfter });
                    console.log(JSON.stringify({ label, level, stoppedLevel, failures: failures.length }));
                }
            }
            await begin(page, 'osc');
            const rapidBefore = await snapshot(page);
            await page.evaluate(() => {
                for (const source of ['piano', 'strings', 'grain', 'piano', 'osc', 'strings']) setKeyboardSoundSource(source, { skipSave: true });
                switchEvents.length = 0;
            });
            await page.evaluate(() => prepareKeyboardSound('strings'));
            await page.waitForTimeout(250);
            const rapidLevel = await rms(page);
            const rapidAfter = await snapshot(page);
            check(JSON.stringify(rapidAfter.held) === JSON.stringify(rapidBefore.held) && JSON.stringify(rapidAfter.highlighted) === JSON.stringify(rapidBefore.highlighted), `${viewport.width}/rapid: selection retained`);
            check(rapidAfter.running && rapidLevel > .0001 && rapidAfter.events.every(event => event.source === 'strings' && event.role === 'arp') && rapidAfter.osc.length === 0 && rapidAfter.grains.length === 0, `${viewport.width}/rapid: final source only`);
            await page.locator('#keyboardContainer').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.screenshot({ path: evidence.replace(/\.json$/, `-selected-${viewport.width}.png`) });
            await page.evaluate(() => panicAllNotes({ immediate: true, preserveStatus: true }));
            await select(page, 'osc');
            await page.waitForTimeout(250);
            const panicLevel = await rms(page, 250);
            const panicState = await snapshot(page);
            check(!panicState.running && panicState.held.length === 0 && panicState.highlighted.length === 0 && panicLevel < .0001, `${viewport.width}/panic: explicit clear stays cleared`);
            results.push({ viewport, mode: 'rapid/panic', rapidBefore, rapidAfter, rapidLevel, panicState, panicLevel });
            check(await page.evaluate(() => JSON.stringify(mygrainQ.getState())) === qBefore, `${viewport.width}: Q state unchanged`);
            check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${viewport.width}: no horizontal overflow`);
            await page.locator('#performanceKeyboardSoundSwitch').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.screenshot({ path: evidence.replace(/\.json$/, `-${viewport.width}.png`) });
            await context.close();
        }
        check(pageErrors.length === 0, `uncaught browser errors: ${pageErrors.join('; ')}`);
        check(blockedWrites.length === 0, 'no attempted network writes');
    } finally {
        fs.writeFileSync(evidence, JSON.stringify({ results, failures, pageErrors, consoleErrors, blockedWrites }, null, 2));
        await browser.close();
    }
    console.log(JSON.stringify({ cases: results.length, failures }));
    if (!baseline) assert.deepEqual(failures, []);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
