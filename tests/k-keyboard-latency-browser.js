const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18798/mygrain/';
const evidence = process.env.MYGRAIN_LATENCY_EVIDENCE || '/tmp/mygrain-k14-latency.json';
const baseline = process.env.MYGRAIN_LATENCY_BASELINE;
const results = [];
const failures = [];
const pageErrors = [];
const consoleErrors = [];
const blockedWrites = [];

function check(condition, message) {
    if (!condition) failures.push(message);
}

async function chooseKey(page) {
    await page.locator('#keyboardContainer').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    return page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].map(key => {
        const bounds = key.getBoundingClientRect();
        return { note: key.dataset.note, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * .8 };
    }).filter(item => document.elementFromPoint(item.x, item.y)?.closest('.key')?.dataset.note === item.note)
        .sort((first, second) => Math.abs(first.x - innerWidth / 2) - Math.abs(second.x - innerWidth / 2))[0]);
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            await context.addInitScript(() => {
                window.latencyContextOptions = [];
                for (const name of ['AudioContext', 'webkitAudioContext']) {
                    if (!window[name]) continue;
                    window[name] = new Proxy(window[name], { construct(target, args, newTarget) {
                        latencyContextOptions.push(args[0]);
                        return Reflect.construct(target, args, newTarget);
                    } });
                }
            });
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
                window.latencyAnalyser = audioContext.createAnalyser();
                latencyAnalyser.fftSize = 256;
                finalAmplifierNode.connect(latencyAnalyser);
                window.latencyTrial = null;
                for (const name of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(name, event => {
                    if (!latencyTrial || latencyTrial.started !== null || !event.target.closest('#keyboardContainer .key')) return;
                    latencyTrial.started = performance.now();
                    latencyTrial.audioStarted = audioContext.currentTime;
                    latencyTrial.event = name;
                }, true);
                const original = playKeyboardSound;
                playKeyboardSound = (note, time, velocity, options = {}) => {
                    if (latencyTrial?.started !== null && latencyTrial) latencyTrial.calls.push({ note, role: options.role || 'keyboard', afterMs: performance.now() - latencyTrial.started,
                        scheduledOffsetMs: 1000 * ((time ?? audioContext.currentTime) - latencyTrial.audioStarted) });
                    return original(note, time, velocity, options);
                };
                window.latencyPoll = setInterval(() => {
                    if (!latencyTrial || latencyTrial.started === null || latencyTrial.pcmMs !== null) return;
                    const values = new Float32Array(latencyAnalyser.fftSize);
                    latencyAnalyser.getFloatTimeDomainData(values);
                    const level = Math.sqrt(values.reduce((total, value) => total + value * value, 0) / values.length);
                    if (level > .0001) latencyTrial.pcmMs = performance.now() - latencyTrial.started;
                }, 4);
            });
            const qBefore = await page.evaluate(() => JSON.stringify(mygrainQ.getState()));
            const cdp = await context.newCDPSession(page);
            for (const source of ['osc', 'grain', 'piano', 'strings']) {
                await page.locator(`#performanceKeyboardSoundSwitch [data-keyboard-sound="${source}"]`).tap();
                await page.waitForFunction(value => keyboardSoundSource === value, source);
                await page.evaluate(value => prepareKeyboardSound(value), source);
                const key = await chooseKey(page);
                assert.ok(key, 'visible phone key');
                for (const mode of ['direct', 'hold', 'arp']) {
                    for (const input of ['touch', 'keyboard']) {
                        await page.evaluate(mode => {
                            panicAllNotes({ immediate: true, preserveStatus: true });
                            setArpeggiatorEnabled(mode === 'arp', { skipSave: true });
                            setHoldEnabled(mode !== 'direct');
                            applyGlobalBpm(120, { skipSave: true });
                            setArpClockMultiplier(1, { skipSave: true });
                            latencyTrial = null;
                        }, mode);
                        await page.waitForTimeout(220);
                        await page.locator(`#keyboardContainer .key[data-note="${key.note}"]`).focus();
                        await page.evaluate(() => { latencyTrial = { started: null, audioStarted: null, event: null, pcmMs: null, calls: [] }; });
                        if (input === 'touch') await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: key.x, y: key.y, id: 1 }] });
                        else await page.keyboard.down('Enter');
                        await page.waitForTimeout(260);
                        const beforeRelease = await page.evaluate(() => ({ ...latencyTrial, active: getKeyboardActiveNotes(), held: [...heldNotes], running: isArpeggiatorPlaying(), sequencer: sequencerPlaying,
                            baseLatencyMs: audioContext.baseLatency * 1000, outputLatencyMs: (audioContext.outputLatency || 0) * 1000, options: latencyContextOptions }));
                        if (input === 'touch') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                        else await page.keyboard.up('Enter');
                        const label = `${viewport.width}/${source}/${mode}/${input}`;
                        check(beforeRelease.options.some(options => options?.latencyHint === 'interactive'), `${label}: interactive audio buffering`);
                        check(beforeRelease.started !== null && beforeRelease.calls.length > 0, `${label}: note starts on keydown, not release`);
                        check(beforeRelease.calls[0]?.afterMs < 40, `${label}: dispatch latency under 40ms (${beforeRelease.calls[0]?.afterMs})`);
                        check(beforeRelease.calls[0]?.scheduledOffsetMs < 25, `${label}: no transport pre-roll (${beforeRelease.calls[0]?.scheduledOffsetMs})`);
                        check(beforeRelease.pcmMs !== null && beforeRelease.pcmMs < 170, `${label}: ready-source PCM under 170ms (${beforeRelease.pcmMs})`);
                        check(!beforeRelease.sequencer, `${label}: no backing starts`);
                        if (mode === 'arp') check(beforeRelease.calls.every(call => call.role === 'arp'), `${label}: no chord drone`);
                        results.push({ viewport, source, mode, input, ...beforeRelease });
                        console.log(JSON.stringify({ label, dispatchMs: beforeRelease.calls[0]?.afterMs, scheduledOffsetMs: beforeRelease.calls[0]?.scheduledOffsetMs, pcmMs: beforeRelease.pcmMs, baseLatencyMs: beforeRelease.baseLatencyMs, failures: failures.length }));
                    }
                }
            }
            await page.evaluate(() => { panicAllNotes({ immediate: true, preserveStatus: true }); clearInterval(latencyPoll); latencyTrial = null; });
            check(await page.evaluate(() => JSON.stringify(mygrainQ.getState())) === qBefore, `${viewport.width}: Q unchanged`);
            await page.screenshot({ path: evidence.replace(/\.json$/, `-${viewport.width}.png`) });
            await context.close();
        }
        check(pageErrors.length === 0, `uncaught errors: ${pageErrors.join('; ')}`);
        check(blockedWrites.length === 0, 'no network writes');
    } finally {
        fs.writeFileSync(evidence, JSON.stringify({ results, failures, pageErrors, consoleErrors, blockedWrites }, null, 2));
        await browser.close();
    }
    console.log(JSON.stringify({ cases: results.length, failures }));
    if (!baseline) assert.deepEqual(failures, []);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
