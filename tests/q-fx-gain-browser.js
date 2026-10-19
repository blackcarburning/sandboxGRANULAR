const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
            const url = new URL(request.url());
            return url.origin === new URL(base).origin && !url.pathname.startsWith('/mygrain-bastardloops/') ? route.continue() : route.abort();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#performanceBastardLoopQDelayDivision option').length === 18);
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        const choices = await page.locator('#performanceBastardLoopQDelayDivision option').evaluateAll(options => options.map(option => ({ beats: Number(option.value), label: option.textContent })));
        assert.equal(choices.filter(choice => choice.label.endsWith('dotted')).length, 6);
        assert.equal(choices.filter(choice => choice.label.endsWith('triplet')).length, 6);
        assert.equal(Math.min(...choices.map(choice => choice.beats)), 1 / 12);
        assert.equal(Math.max(...choices.map(choice => choice.beats)), 6);
        for (const beats of [.75, 1 / 3, 1 / 12, 6]) {
            await page.selectOption('#performanceBastardLoopQDelayDivision', String(beats));
            assert.equal(await page.evaluate(() => mygrainQ.state.delayBeats), beats);
        }
        const audio = await page.evaluate(async () => {
            const readings = [];
            for (const sampleRate of [44100, 48000]) {
                for (const room of [0, .1, 1]) {
                    const context = new OfflineAudioContext(2, Math.round(sampleRate * 2), sampleRate);
                    const controller = new MygrainQ.Controller({ context: () => context, destination: () => context.destination, bpm: () => 120, soloGain: () => 1 });
                    Object.assign(controller.state, { enabled: true, level: 1, room, delay: 0 });
                    const graph = controller.ensureGraph();
                    const signal = context.createBuffer(2, Math.round(sampleRate * .6), sampleRate);
                    for (let channel = 0; channel < 2; channel += 1) {
                        const samples = signal.getChannelData(channel);
                        for (let index = 0; index < samples.length; index += 1) samples[index] = [261.63, 329.63, 392, 493.88].reduce((sum, frequency) => sum + .04 * Math.sin(2 * Math.PI * frequency * index / sampleRate), 0) * Math.sin(Math.PI * index / samples.length);
                    }
                    const source = context.createBufferSource();
                    source.buffer = signal;
                    source.connect(graph.input);
                    source.start(.25);
                    const rendered = await context.startRendering();
                    let peak = 0;
                    let energy = 0;
                    let tailEnergy = 0;
                    for (const [index, value] of rendered.getChannelData(0).entries()) {
                        peak = Math.max(peak, Math.abs(value));
                        energy += value * value;
                        if (index > sampleRate) tailEnergy += value * value;
                    }
                    readings.push({ sampleRate, room, normalize: graph.convolver.normalize, peak, rms: Math.sqrt(energy / rendered.length), tailEnergy });
                }
            }
            const delays = [];
            for (const bpm of [60, 120, 300]) for (const delayBeats of [1 / 12, 1 / 3, .75, 6]) {
                const seconds = 60 / bpm * delayBeats;
                const context = new OfflineAudioContext(2, Math.round(48000 * (seconds + 1)), 48000);
                const controller = new MygrainQ.Controller({ context: () => context, destination: () => context.destination, bpm: () => bpm, soloGain: () => 1 });
                Object.assign(controller.state, { enabled: true, level: 1, room: 0, delay: 1, delayBeats, feedback: 0 });
                const graph = controller.ensureGraph();
                graph.dry.gain.value = 0;
                const impulse = context.createBuffer(1, 1, 48000);
                impulse.getChannelData(0)[0] = .25;
                const source = context.createBufferSource();
                source.buffer = impulse;
                source.connect(graph.input);
                source.start(.25);
                const rendered = await context.startRendering();
                const samples = rendered.getChannelData(0);
                let peakIndex = 0;
                for (let index = 1; index < samples.length; index += 1) if (Math.abs(samples[index]) > Math.abs(samples[peakIndex])) peakIndex = index;
                delays.push({ bpm, delayBeats, expected: seconds, measured: peakIndex / 48000 - .25, peak: Math.abs(samples[peakIndex]) });
            }
            return { readings, delays };
        });
        for (const sampleRate of [44100, 48000]) {
            const readings = audio.readings.filter(reading => reading.sampleRate === sampleRate);
            const dry = readings[0];
            assert.ok(dry.peak > .14 && dry.peak < .16);
            for (const reading of readings) {
                assert.equal(reading.normalize, true);
                assert.ok(reading.peak < .25, JSON.stringify(reading));
                assert.ok(reading.rms < dry.rms * 1.5, JSON.stringify(reading));
                if (reading.room) assert.ok(reading.tailEnergy > .000001, JSON.stringify(reading));
            }
        }
        for (const delay of audio.delays) {
            assert.ok(Math.abs(delay.expected - delay.measured) < .002, JSON.stringify(delay));
            assert.ok(delay.peak > .01, JSON.stringify(delay));
        }
        const piano = await page.evaluate(async () => {
            const notes = [48, 52, 55, 59, 62, 65, 69];
            await mygrainQ.piano.ensure([{ notes, velocity: 127 }]);
            const readings = [];
            for (const sampleRate of [44100, 48000]) for (const room of [0, 1]) {
                const context = new OfflineAudioContext(2, sampleRate * 3, sampleRate);
                const controller = new MygrainQ.Controller({ context: () => context, destination: () => context.destination, bpm: () => 120, soloGain: () => 1 });
                Object.assign(controller.state, { enabled: true, level: .5, room });
                controller.piano.manifest = mygrainQ.piano.manifest;
                controller.piano.cache = mygrainQ.piano.cache;
                for (const note of notes) controller.voice(note, 127, .25, .8);
                const buffer = await context.startRendering();
                let peak = 0;
                for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
                readings.push({ sampleRate, room, peak });
            }
            return readings;
        });
        for (const reading of piano) assert.ok(reading.peak > .01 && reading.peak < .9, JSON.stringify(reading));
        await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true });
            const state = MygrainQTheory.defaults();
            Object.assign(state, { enabled: true, room: 1 });
            mygrainQ.restore(state);
            await mygrainQ.audition(MygrainQTheory.normalizeStep({ notes: [48, 52, 55], root: 48 }));
            syncPerformanceMixerVuVisibility();
        });
        await page.waitForFunction(() => {
            updatePerformanceMixerVuChannel(PERFORMANCE_MIXER_VU_CHANNELS.find(channel => channel.controlId === 'performanceBastardLoopQLevelMixer'));
            return Number.isFinite(parseFloat(document.getElementById('performanceBastardLoopQLevelMixerVuValue').textContent));
        });
        const monitoring = await page.evaluate(async () => {
            const controls = ['performanceBastardLoopQRoom', 'performanceBastardLoopQDelay', 'performanceBastardLoopQFeedback'];
            const gains = captureAudioDebug().gains;
            const suggestions = [];
            for (const controlId of controls) {
                for (const control of controls) {
                    const input = document.getElementById(control);
                    input.value = control === controlId ? '0.8' : '0';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                await new Promise(resolve => setTimeout(resolve, 150));
                const suggestion = collectPerformanceGainStageSuggestions().suggestions.find(entry => entry.controlId === controlId);
                suggestions.push({ controlId, suggestion, graph: suggestion ? buildPerformanceGainStageGraph({ suggestions: [suggestion], debug: captureAudioDebug() }) : null });
            }
            return { qMeter: document.getElementById('performanceBastardLoopQLevelMixerVuValue').textContent, qNode: PERFORMANCE_MIXER_VU_CHANNELS.find(channel => channel.controlId === 'performanceBastardLoopQLevelMixer').getNode() === mygrainQ.graph.pan, gains, suggestions };
        });
        assert.equal(monitoring.qNode, true);
        assert.ok(Number(monitoring.gains.bastardLoopQRoomWet) > .7);
        for (const entry of monitoring.suggestions) {
            assert.ok(entry.suggestion, JSON.stringify(entry));
            assert.match(entry.graph.title, /Bastardloop Q/);
            assert.equal(entry.graph.stages.length, 5);
        }
        await page.evaluate(async () => {
            mygrainQ.stop();
            mygrainQ.state.enabled = false;
            const buffer = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .4), audioContext.sampleRate);
            const samples = buffer.getChannelData(0);
            for (let index = 0; index < samples.length; index += 1) samples[index] = .2 * Math.sin(2 * Math.PI * 330 * index / buffer.sampleRate);
            await applyRecordedBastardLoopMPlusBuffer(buffer, { bpm: 120 });
            setBastardLoopMPlusEnabled(true, { silent: true, skipSave: true });
            startAllBastardLoopLayers(audioContext.currentTime + .05, { skipUi: true });
        });
        await page.waitForFunction(() => {
            updatePerformanceMixerVuChannel(PERFORMANCE_MIXER_VU_CHANNELS.find(channel => channel.controlId === 'performanceBastardLoopMPlusLevelMixer'));
            return Number.isFinite(parseFloat(document.getElementById('performanceBastardLoopMPlusLevelMixerVuValue').textContent));
        });
        const backing = await page.evaluate(() => {
            document.getElementById('performanceBastardLoopMPlusInputGain').value = '200';
            const suggestion = collectPerformanceGainStageSuggestions().suggestions.find(entry => entry.controlId === 'performanceBastardLoopMPlusInputGain');
            const result = { meter: document.getElementById('performanceBastardLoopMPlusLevelMixerVuValue').textContent, postEffects: PERFORMANCE_MIXER_VU_CHANNELS.find(channel => channel.controlId === 'performanceBastardLoopMPlusLevelMixer').getNode() === bastardLoopMPlusPanNode, suggestion };
            stopAllPerformancePlayback({ silent: true });
            return result;
        });
        assert.equal(backing.postEffects, true);
        assert.ok(backing.suggestion);
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ choices, audio, piano, monitoring, backing, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
