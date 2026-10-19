const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const baseline = process.env.MYGRAIN_RESOURCE_BASELINE === '1';
const seconds = Number(process.env.MYGRAIN_SOAK_SECONDS || 180);
const rates = (process.env.MYGRAIN_SAMPLE_RATES || '44100,48000').split(',').map(Number);
const mixed = process.env.MYGRAIN_MODULATED_SYNTH === '1';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    try {
        for (const sampleRate of rates) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext;
                window.AudioContext = class extends NativeAudioContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            await page.goto(`${base}?audio-resource-check=${Date.now()}`, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const cdp = await context.newCDPSession(page);
            await cdp.send('Performance.enable');
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.MYGRAIN_CPU_THROTTLE || 1) });
            const burst = await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                stateSaveSuspended = true;
                clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                destroyBastardLoopXFilterLfoSource();
                const nativeConnect = AudioNode.prototype.connect;
                const nativeDisconnect = AudioNode.prototype.disconnect;
                const edges = new WeakMap();
                const ids = new WeakMap();
                let nextId = 0;
                let connects = 0;
                let disconnects = 0;
                AudioNode.prototype.connect = function (destination, ...args) {
                    const result = nativeConnect.call(this, destination, ...args);
                    if (this === bastardLoopXFilterLfoSourceNode) {
                        if (!ids.has(destination)) ids.set(destination, ++nextId);
                        if (!edges.has(this)) edges.set(this, new Set());
                        edges.get(this).add(ids.get(destination));
                        connects += 1;
                    }
                    return result;
                };
                AudioNode.prototype.disconnect = function (...args) {
                    const result = nativeDisconnect.apply(this, args);
                    if (edges.has(this)) {
                        if (!args.length) edges.get(this).clear();
                        else edges.get(this).delete(ids.get(args[0]));
                        disconnects += 1;
                    }
                    return result;
                };
                window.resourceProbe = () => ({
                    connections: edges.get(bastardLoopXFilterLfoSourceNode)?.size || 0,
                    connects, disconnects, voices: bastardLoopXActiveVoices.size,
                    drumVoices: drumMachineActiveVoices.size, grains: activeGrainNodes,
                    contextTime: audioContext.currentTime, rms: readFinalPanRms()
                });
                for (let index = 0; index < 2000; index += 1) {
                    const voice = { filterNodes: [] };
                    const filter = audioContext.createBiquadFilter();
                    voice.filterNodes.push(filter);
                    attachBastardLoopXFilterLfoToVoice(voice);
                    destroyBastardLoopXVoiceLfo(voice);
                    filter.disconnect();
                }
                return resourceProbe();
            });
            console.log(JSON.stringify({ sampleRate, phase: '2000-note-burst', ...burst }));
            if (!baseline) assert.equal(burst.connections, 0);
            await page.evaluate(mixed => {
                destroyBastardLoopXFilterLfoSource();
                const tone = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .24), audioContext.sampleRate);
                const data = tone.getChannelData(0);
                for (let index = 0; index < data.length; index += 1) {
                    data[index] = .12 * Math.sin(2 * Math.PI * 110 * index / audioContext.sampleRate);
                }
                bastardLoopXSampleBuffer = tone;
                bastardLoopXEnabled = true;
                bastardLoopXRootNote = 'C3';
                bastardLoopXSequence = Array.from({ length: 64 }, (_, index) => ({ note: index % 2 ? 'G3' : 'C3', rest: false, accent: index % 4 === 0, slide: false, ratchet: 4 }));
                for (const [id, value] of Object.entries({
                    performanceBastardLoopXLevel: 70, performanceBastardLoopXLength: 50,
                    performanceBastardLoopXDecay: 50, performanceBastardLoopXAttack: 4,
                    performanceBastardLoopXFilterLfoAmount: 70, performanceBastardLoopXFilterCutoff: 5000,
                    performanceBastardLoopXStartTrim: 0, performanceBastardLoopXDelayMix: 20
                })) document.getElementById(id).value = String(value);
                bastardLoopBuffer = tone;
                bastardLoopEnabled = true;
                document.getElementById('performanceBastardLoopLevel').value = '40';
                drumMachineKickBuffer = tone;
                drumMachineSnareBuffer = tone;
                drumMachineKickPattern = Array.from({ length: 64 }, (_, index) => index % 4 === 0);
                drumMachineSnarePattern = Array.from({ length: 64 }, (_, index) => index % 4 === 2);
                setDrumMachineDirectReverbSend(true, { silent: true, skipSave: true });
                const origin = audioContext.currentTime + .1;
                if (!startBastardLoop(origin, { skipUi: true })) throw new Error('Loop A did not start');
                if (!startBastardLoopX(origin, { skipUi: true })) throw new Error('Loop X did not start');
                if (!startDrumMachine(origin, { silent: true, skipSave: true })) throw new Error('Drums did not start');
                if (mixed) {
                    grainASampleBuffer = tone;
                    grainBSampleBuffer = tone;
                    syncLegacyAudioBuffer();
                    setGranularLayersEnabled(true, { silent: true, skipSave: true });
                    setGranularLayerMuted('A', false, { silent: true, skipSave: true });
                    setGranularLayerMuted('B', false, { silent: true, skipSave: true });
                    for (const [id, value] of Object.entries({ osc1Wave: 'vocal', osc2Wave: 'metal', osc3Wave: 'pulse', osc2Sync: 'osc1',
                        synthWaveShape: 50, synthMod1Source: 'lfo1', synthMod1Target: 'synthWaveShape', synthMod1Amount: 65,
                        performanceModAmount: 100, osc1Level: 70, osc2Level: 70, osc3Level: 60 })) {
                        const element = document.getElementById(id);
                        element.value = String(value);
                        element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
                    }
                    setLfoRouteState('osc2Detune', '2', true);
                    setOscillatorsEnabled(true, { silent: true, skipSave: true });
                    for (const note of ['C3', 'E3', 'G3', 'B3']) playOscillatorNote(note);
                    startGrainStream('C3');
                    if (activeGrains.size !== 1 || activeOscVoices.size !== 4) throw new Error('Mixed fixture did not start');
                }
                window.resourceTiming = { callbacks: 0, over120ms: 0, max: 0 };
                let previous = performance.now();
                window.resourceTimer = setInterval(() => {
                    const now = performance.now();
                    const gap = now - previous;
                    resourceTiming.callbacks += 1;
                    resourceTiming.max = Math.max(resourceTiming.max, gap);
                    if (gap > 120) resourceTiming.over120ms += 1;
                    previous = now;
                }, 10);
            }, mixed);
            const snapshots = [];
            for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
                await page.waitForTimeout(Math.min(10, seconds - elapsed) * 1000);
                const resources = await page.evaluate(() => ({ ...resourceProbe(), timing: { ...resourceTiming },
                    scheduling: { ...audioSchedulingStats }, oscillatorCache: oscillatorWaveCache.size, syncCache: hardSyncWaveCache.size,
                    oscillatorVoices: activeOscVoices.size, grainStreams: activeGrains.size }));
                const metrics = (await cdp.send('Performance.getMetrics')).metrics;
                const selected = Object.fromEntries(metrics.filter(metric => ['JSHeapUsedSize', 'TaskDuration', 'Nodes'].includes(metric.name)).map(metric => [metric.name, metric.value]));
                snapshots.push(resources);
                console.log(JSON.stringify({ sampleRate, phase: 'playing', elapsed: Math.min(elapsed + 10, seconds), ...resources, ...selected }));
                if (!baseline) assert.equal(resources.connections, resources.voices);
                assert.ok(resources.voices < 80);
                assert.ok(resources.grains < 80);
                assert.ok(resources.oscillatorCache <= 128 && resources.syncCache <= 128);
                if (mixed) {
                    assert.equal(resources.oscillatorVoices, 4);
                    assert.equal(resources.grainStreams, 1);
                    assert.ok(resources.timing.over120ms < Math.max(10, resources.timing.callbacks * .01));
                }
                assert.ok(resources.contextTime > (snapshots.at(-2)?.contextTime || 0));
            }
            await page.evaluate(() => {
                clearInterval(resourceTimer);
                stopAllGrains({ immediate: true });
                stopOscillatorsByRole('keyboard', audioContext.currentTime);
                stopAllPerformancePlayback({ silent: true });
            });
            await page.waitForTimeout(1800);
            const stopped = await page.evaluate(() => resourceProbe());
            console.log(JSON.stringify({ sampleRate, phase: 'stopped', ...stopped }));
            assert.equal(stopped.voices, 0);
            assert.equal(stopped.drumVoices, 0);
            if (!baseline) assert.equal(stopped.connections, 0);
            await cdp.send('HeapProfiler.collectGarbage');
            console.log(JSON.stringify({ sampleRate, phase: 'gc', metrics: (await cdp.send('Performance.getMetrics')).metrics.filter(metric => ['JSHeapUsedSize', 'Nodes'].includes(metric.name)) }));
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ pass: true, baseline, mixed, seconds, rates, errors, writes }));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
