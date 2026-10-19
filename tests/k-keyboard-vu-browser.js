const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18799/mygrain/';
const evidence = process.env.MYGRAIN_VU_EVIDENCE || '/tmp/mygrain-k15-keyboard-vu';
const baseline = process.env.MYGRAIN_VU_BASELINE;
const failures = [];
const results = [];
const pageErrors = [];
const consoleErrors = [];
const blockedWrites = [];
const instruments = ['piano', 'strings'];
const controlId = instrument => `performanceKeyboard${instrument === 'piano' ? 'Piano' : 'Strings'}Volume`;

function check(condition, description) {
    if (!condition) failures.push(description);
}

async function read(page, instrument) {
    const identifier = controlId(instrument);
    if (await page.locator(`#${identifier}VuShell`).count()) {
        await page.locator(`#${identifier}VuShell`).scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(400);
    return page.evaluate(identifier => {
        const shell = document.getElementById(`${identifier}VuShell`);
        const label = document.getElementById(`${identifier}VuValue`)?.textContent;
        const pcm = new Float32Array(keyboardVuOutput.fftSize);
        keyboardVuOutput.getFloatTimeDomainData(pcm);
        const capture = new Float32Array(keyboardVuCapture.fftSize);
        keyboardVuCapture.getFloatTimeDomainData(capture);
        const rms = samples => Math.sqrt(samples.reduce((energy, sample) => energy + sample * sample, 0) / samples.length);
        if (!shell) return { exists: false, output: rms(pcm), capture: rms(capture) };
        const channelAnalyser = performanceMixerVuTapState.get(identifier)?.analyser;
        const channel = channelAnalyser ? new Float32Array(channelAnalyser.fftSize) : null;
        if (channel) channelAnalyser.getFloatTimeDomainData(channel);
        return {
            exists: true,
            visible: isPerformanceElementVisible(shell),
            role: shell.getAttribute('role'),
            label,
            db: label === '-inf dB' ? null : Number.parseFloat(label),
            level: Number(shell.getAttribute('aria-valuenow')),
            width: Number.parseFloat(document.getElementById(`${identifier}VuFill`).style.width),
            channel: channel ? rms(channel) : null,
            output: rms(pcm),
            capture: rms(capture)
        };
    }, identifier);
}

async function activity(page, instrument) {
    const readings = [];
    for (let probe = 0; probe < 3; probe += 1) readings.push(await read(page, instrument));
    return readings.find(reading => reading.db !== null) || readings.at(-1);
}

async function voice(page, instrument, midi = 60) {
    await page.evaluate(async ({ instrument, midi }) => {
        await getKeyboardSamplePlayer().noteOn(`vu-${instrument}-${midi}`, midi, { instrument, velocity: 127 });
    }, { instrument, midi });
}

async function stop(page) {
    await page.evaluate(() => {
        stopAllPerformancePlayback({ silent: true });
        panicAllNotes({ immediate: true, preserveStatus: true });
        setArpeggiatorEnabled(false, { skipSave: true });
        setHoldEnabled(false);
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
    });
    await page.waitForTimeout(400);
}

async function volume(page, instrument, value) {
    await page.locator(`#${controlId(instrument)}`).evaluate((control, value) => {
        control.value = String(value);
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
            page.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()); });
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) {
                    blockedWrites.push({ method: route.request().method(), url: route.request().url() });
                    return route.abort();
                }
                if (baseline && new URL(route.request().url()).pathname === '/mygrain/') {
                    return route.fulfill({ path: baseline, contentType: 'text/html' });
                }
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await stop(page);
            await page.evaluate(async () => {
                stateSaveSuspended = true;
                for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
                setDrumMachineEnabled(false, { silent: true, skipSave: true });
                setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
                setGeneratedDryLoopEnabled(false, { silent: true, skipSave: true });
                setFxMuted(true, { silent: true });
                setPerformanceMixerVuMetersEnabled(true);
                window.keyboardVuOutput = audioContext.createAnalyser();
                keyboardVuOutput.fftSize = 8192;
                finalAmplifierNode.connect(keyboardVuOutput);
                window.keyboardVuCapture = audioContext.createAnalyser();
                keyboardVuCapture.fftSize = 8192;
                keyboardGrainCaptureGain.connect(keyboardVuCapture);
                await Promise.all(['piano', 'strings'].map(instrument => getKeyboardSamplePlayer().prepare(instrument, 60, 127)));
                window.keyboardVuQBefore = JSON.stringify(mygrainQ.getState());
            });
            await page.locator('#sectionJumpBastardMixerBtn').tap();
            const cases = [];
            results.push({ viewport, cases });
            for (const instrument of instruments) {
                const other = instrument === 'piano' ? 'strings' : 'piano';
                await stop(page);
                await volume(page, instrument, 75);
                await volume(page, other, 75);
                await voice(page, instrument);
                const playing = await read(page, instrument);
                const excluded = await read(page, other);
                check(playing.exists, `${viewport.width}/${instrument}: dedicated VU exists`);
                cases.push({ instrument, playing, excluded });
                if (!playing.exists || !excluded.exists) continue;
                check(playing.visible && playing.role === 'meter' && playing.level > 0 && playing.width > 0 && playing.db !== null,
                    `${viewport.width}/${instrument}: actual samples move visible accessible VU`);
                check(playing.output > .00001 && playing.capture > .00001, `${viewport.width}/${instrument}: output and K capture remain audible`);
                check(excluded.db === null && excluded.level === 0, `${viewport.width}/${instrument}: other channel does not cross-feed`);
                await volume(page, instrument, 0);
                const muted = await read(page, instrument);
                Object.assign(cases.at(-1), { muted });
                check(muted.db === null && muted.channel === 0 && muted.output < .00001 && muted.capture === 0,
                    `${viewport.width}/${instrument}: zero volume silences channel/meter/capture with master below -100 dB`);
                await volume(page, instrument, 75);
                await voice(page, instrument);
                const restored = await read(page, instrument);
                check(restored.db !== null && restored.level > 0, `${viewport.width}/${instrument}: volume restoration restores meter`);
                await page.locator(`#${controlId(other)}SoloBtn`).tap();
                const soloMuted = await read(page, instrument);
                Object.assign(cases.at(-1), { soloMuted });
                check(soloMuted.db === null && soloMuted.channel === 0 && soloMuted.output < .00001 && soloMuted.capture === 0,
                    `${viewport.width}/${instrument}: other Solo silences channel/meter/capture with master below -100 dB`);
                await page.evaluate(() => clearAllPerformanceSoloStates({ silent: true, skipSave: true }));
                await voice(page, instrument);
                const soloRestored = await read(page, instrument);
                check(soloRestored.db !== null, `${viewport.width}/${instrument}: Clear Solos restores meter`);
                await page.locator('#performanceMixerVuToggleBtn').tap();
                const disabled = await page.locator(`#${controlId(instrument)}VuShell`).isVisible();
                await page.locator('#performanceMixerVuToggleBtn').tap();
                const reenabled = await read(page, instrument);
                check(!disabled && reenabled.visible && reenabled.db !== null, `${viewport.width}/${instrument}: VU toggle reconnects running audio`);
                await stop(page);
                const stopped = await read(page, instrument);
                check(stopped.db === null && stopped.output < .000001 && stopped.capture < .000001,
                    `${viewport.width}/${instrument}: Stop clears meter and audio`);
                Object.assign(cases.at(-1), { muted, restored, soloMuted, soloRestored, reenabled, stopped });
            }
            if (await page.locator(`#${controlId('piano')}VuShell`).count()) {
                await stop(page);
                await voice(page, 'piano');
                await voice(page, 'piano', 64);
                await voice(page, 'strings');
                const both = { piano: await read(page, 'piano'), strings: await read(page, 'strings') };
                check(both.piano.db !== null && both.strings.db !== null, `${viewport.width}: polyphonic simultaneous channels meter independently`);
                await page.screenshot({ path: `${evidence}-${viewport.width}.png`, fullPage: false });
                cases.push({ both });
                await stop(page);
                await page.locator('#performanceKeyboardSoundSwitch [data-keyboard-sound="piano"]').tap();
                await page.evaluate(async () => {
                    await prepareKeyboardSound('piano');
                    applyGlobalBpm(120, { skipSave: true });
                    setArpClockMultiplier(2, { skipSave: true });
                    setArpeggiatorEnabled(true, { skipSave: true });
                });
                await page.locator('#keyboardContainer').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
                const note = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].find(key => {
                    const bounds = key.getBoundingClientRect();
                    return bounds.width > 0 && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height * .8)?.closest('.key') === key;
                })?.dataset.note);
                assert.ok(note, 'a keyboard key is actually tappable');
                const key = page.locator(`#keyboardContainer .key[data-note="${note}"]`);
                const bounds = await key.boundingBox();
                await key.tap({ position: { x: bounds.width / 2, y: bounds.height * .8 } });
                await page.waitForFunction(() => isArpeggiatorPlaying());
                const arpPiano = await activity(page, 'piano');
                check(arpPiano.db !== null, `${viewport.width}: keyboard-only arp drives Piano VU`);
                await page.locator('#performanceKeyboardSoundSwitch [data-keyboard-sound="strings"]').tap();
                await page.evaluate(() => prepareKeyboardSound('strings'));
                const arpStrings = await activity(page, 'strings');
                const oldPiano = await read(page, 'piano');
                check(arpStrings.db !== null && oldPiano.db === null, `${viewport.width}: arp sound switch moves only the selected meter`);
                const state = await page.evaluate(() => ({ held: heldNotes.size, running: isArpeggiatorPlaying(), backing: sequencerPlaying,
                    qSame: JSON.stringify(mygrainQ.getState()) === keyboardVuQBefore, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
                check(state.held > 0 && state.running && !state.backing && state.qSame && !state.overflow,
                    `${viewport.width}: arp keys/transport/Q/layout preserved`);
                cases.push({ arpPiano, arpStrings, oldPiano, state });
                await stop(page);
            }
            await context.close();
        }
    } catch (error) {
        failures.push(error.stack || String(error));
    } finally {
        await browser.close();
        const summary = { base, baseline, results, failures, pageErrors, consoleErrors, blockedWrites };
        fs.writeFileSync(`${evidence}.json`, JSON.stringify(summary, null, 2));
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        assert.equal(pageErrors.length, 0, 'no uncaught browser errors');
        assert.equal(blockedWrites.length, 0, 'no attempted network writes');
        assert.equal(failures.length, 0, failures.join('\n'));
    }
})();
