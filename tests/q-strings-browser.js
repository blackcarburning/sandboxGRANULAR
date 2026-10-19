const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const sampleRate of [44100, 48000]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext;
                window.AudioContext = class extends NativeAudioContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                window.webkitAudioContext = window.AudioContext;
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                const url = new URL(request.url());
                return url.origin === new URL(base).origin && !url.pathname.startsWith('/mygrain-bastardloops/') ? route.continue() : route.abort();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#performanceBastardLoopQInstrument option').length === 2);
            await page.click('#start-btn');
            await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
            assert.equal(await page.evaluate(() => mygrainQ.state.instrument), 'piano');
            await page.selectOption('#performanceBastardLoopQInstrument', 'strings');
            if (process.env.Q_SCREENSHOT_DIR && sampleRate === 48000) await page.locator('#bastardLoopQCard').screenshot({ path: `${process.env.Q_SCREENSHOT_DIR}/q-strings-card.png` });
            await page.evaluate(async () => {
                const state = { ...MygrainQTheory.defaults(), instrument: 'strings', enabled: true, level: .5 };
                state.sequence[0] = MygrainQTheory.normalizeStep({ notes: [36, 48, 66], velocity: 96, gate: 64 });
                state.sequence[8] = MygrainQTheory.normalizeStep({ notes: [36, 48, 66], velocity: 32, gate: 4 });
                mygrainQ.restore(state);
                await mygrainQ.preparePlayback();
                await mygrainQ.piano.ensure([{ notes: [36, 43, 48, 52, 55, 62, 66, 72], velocity: 127 }]);
            });
            const sustained = await page.evaluate(async rate => {
                async function render(velocity, room = 0, pitches = [36, 48, 66]) {
                    const offline = new OfflineAudioContext(2, rate * 9, rate);
                    const controller = new MygrainQ.Controller({ context: () => offline, destination: () => offline.destination, bpm: () => 120, length: () => 64, soloGain: () => 1 });
                    controller.state = { ...mygrainQ.getState(), level: 1, room };
                    controller.piano = mygrainQ.piano;
                    for (const pitch of pitches) controller.voice(pitch, velocity, .01, 8);
                    const mapping = [...controller.voices].map(voice => ({ pitch: voice.pitch, loop: voice.source.loop, loopStart: voice.source.loopStart, loopEnd: voice.source.loopEnd }));
                    const rendered = await offline.startRendering();
                    const pcm = rendered.getChannelData(0);
                    const rms = start => {
                        const block = pcm.subarray(Math.round(start * rate), Math.round((start + .2) * rate));
                        return Math.sqrt(block.reduce((sum, sample) => sum + sample * sample, 0) / block.length);
                    };
                    return { mapping, rms: [.6, 2, 4.7, 7.3].map(rms), afterRelease: rms(8.5), peak: pcm.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0) };
                }
                return { loud: await render(96), soft: await render(32), wet: await render(96, 1), extended: await render(127, 1, [36, 43, 48, 52, 55, 62, 66, 72]) };
            }, sampleRate);
            for (const mode of ['loud', 'soft']) {
                assert.ok(sustained[mode].mapping.every(voice => voice.loop && voice.loopStart === 1.5 && voice.loopEnd === 4.5));
                assert.ok(sustained[mode].rms.every(value => value > .0005), `Sustained strings should remain audible: ${JSON.stringify(sustained[mode])}`);
                assert.ok(sustained[mode].afterRelease < .00001);
                assert.ok(sustained[mode].peak < 1);
            }
            assert.ok(sustained.loud.rms[1] > sustained.soft.rms[1]);
            assert.ok(sustained.wet.peak < 1);
            assert.ok(sustained.extended.peak < 1);
            const beforeSwitch = await page.evaluate(() => {
                mygrainQ.start(audioContext.currentTime + .03);
                return { origin: mygrainQ.origin, sequence: JSON.stringify(mygrainQ.state.sequence) };
            });
            await page.selectOption('#performanceBastardLoopQInstrument', 'piano');
            await page.waitForFunction(() => mygrainQ.running && mygrainQ.playbackState?.instrument === 'piano');
            assert.deepEqual(await page.evaluate(() => ({ origin: mygrainQ.origin, sequence: JSON.stringify(mygrainQ.state.sequence) })), beforeSwitch);
            assert.ok(await page.evaluate(() => [...mygrainQ.piano.cache.keys()].every(id => /^[A-G]s?\dv/.test(id))));
            await page.selectOption('#performanceBastardLoopQInstrument', 'strings');
            await page.waitForFunction(() => mygrainQ.running && mygrainQ.playbackState?.instrument === 'strings');
            const monitoring = await page.evaluate(() => {
                const channel = PERFORMANCE_MIXER_VU_CHANNELS.find(entry => entry.controlId === 'performanceBastardLoopQLevelMixer');
                mygrainQ.state.room = .8;
                mygrainQ.sync();
                mygrainQ.updateEffects();
                updatePerformanceMixerVuChannel(channel);
                const suggestion = collectPerformanceGainStageSuggestions().suggestions.find(entry => entry.controlId === 'performanceBastardLoopQRoom');
                const graph = suggestion ? buildPerformanceGainStageGraph({ suggestions: [suggestion], debug: captureAudioDebug() }) : null;
                mygrainQ.state.room = 0;
                mygrainQ.sync();
                mygrainQ.updateEffects();
                return { nodeIsPostEffects: channel.getNode() === mygrainQ.graph.pan, meter: document.getElementById('performanceBastardLoopQLevelMixerVuValue').textContent, graph };
            });
            assert.equal(monitoring.nodeIsPostEffects, true);
            assert.match(monitoring.graph.title, /Q strings/);
            assert.equal(monitoring.graph.stages[0].label, 'Strings Input');
            await page.evaluate(() => mygrainQ.stop());
            await page.click('#performanceBastardLoopQEditBtn');
            await page.evaluate(() => {
                mygrainQ.state.sequence.fill(null);
                mygrainQ.state.record = true;
                mygrainQ.state.recordMode = 'live';
                mygrainQ.sync();
                mygrainQ.start(audioContext.currentTime + .03);
            });
            await page.waitForTimeout(180);
            await page.locator('.q-chord[data-root="0"][data-type="major"]').click();
            await page.waitForFunction(() => mygrainQ.state.sequence.some(step => step && !step.rest));
            const recorded = await page.evaluate(() => ({ instrument: mygrainQ.state.instrument, chord: mygrainQ.state.sequence.find(Boolean), cursor: mygrainQ.cursor, running: mygrainQ.running }));
            assert.equal(recorded.instrument, 'strings');
            assert.deepEqual(recorded.chord.notes, [48, 52, 55]);
            assert.equal(recorded.running, true);
            await page.click('#bastardLoopQNudgeLeftBtn');
            assert.equal(await page.evaluate(() => mygrainQ.state.sequence[mygrainQ.cursor].notes.join(',')), '48,52,55');
            assert.equal(await page.evaluate(() => mygrainQ.running), true);
            if (process.env.Q_SCREENSHOT_DIR && sampleRate === 48000) await page.screenshot({ path: `${process.env.Q_SCREENSHOT_DIR}/q-strings-editor.png` });
            await page.click('#bastardLoopQAllStopBtn');
            results.push({ sampleRate, sustained, monitoring, switchingKeepsClockAndSequence: true, liveRecord: recorded, nudgeWhilePlaying: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ results, errors, writes, physicalSafari: 'not tested' }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
