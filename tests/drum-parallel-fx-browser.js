const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const fixture = require('./drum-parallel-fx-fixture.js');

async function exerciseDedicatedFx(created, permutation) {
    const { state, functions } = created;
    functions.setDrumMachineDirectDelaySend(permutation === 'delay' || permutation === 'both', { silent: true, skipSave: true });
    functions.setDrumMachineDirectReverbSend(permutation === 'reverb' || permutation === 'both', { silent: true, skipSave: true });
    state.drumSendFxState.delay.amount = 60;
    state.drumSendFxState.delay.send = 135;
    state.drumSendFxState.reverb.amount = 60;
    state.drumSendFxState.reverb.send = 135;
    for (let repeat = 0; repeat < 3; repeat += 1) functions.updateDrumSendEffects();
    if (functions.waitForDrumSendImpulse) {
        if (!await functions.waitForDrumSendImpulse(state.drumSendFxGraph)) throw new Error('Latest dedicated room IR failed readiness');
    }
}

async function runEngine(engineName, source, baseline, contract = {
    exercise: exerciseDedicatedFx.toString(), wetOutputNodes: ['drumSendFxGraph.returnTrim']
}) {
    const engine = engineName === 'webkit' ? webkit : chromium;
    const browser = await engine.launch(engineName === 'chromium' ? {
        executablePath: process.env.CHROMIUM_PATH || '/snap/chromium/current/usr/lib/chromium-browser/chrome',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
    } : { headless: true });
    const requests = [];
    const workerRequests = [];
    try {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => {
            const url = route.request().url();
            if (url.startsWith('blob:')) { workerRequests.push(url); return route.continue(); }
            requests.push(url);
            return route.abort();
        });
        const page = await context.newPage();
        page.on('console', message => {
            if (message.text().startsWith('Drum FX PCM:')) process.stderr.write(`${engineName}: ${message.text()}\n`);
            if (process.env.MYGRAIN_DRUM_FX_CHECKPOINT && message.text().startsWith('Drum FX PCM case:')) {
                const row = JSON.parse(message.text().slice('Drum FX PCM case:'.length));
                fs.appendFileSync(process.env.MYGRAIN_DRUM_FX_CHECKPOINT, `${JSON.stringify({ engine: engineName, ...row })}\n`);
            }
        });
        const result = await page.evaluate(async input => {
            const buildFixture = new Function(`return (${input.fixtureFactory});`)();
            const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (!OfflineContext) return { unavailable: 'OfflineAudioContext is unavailable', failures: [] };
            const calibrationCache = new Map();
            const failures = [];
            const dryComparisons = [];
            const wetComparisons = [];
            const realWorkerComparisons = [];
            if (input.realWorkerOnly) {
                for (const sampleRate of [44100, 48000]) {
                    const workers = [];
                    const urls = new Set();
                    class TrackedWorker extends window.Worker {
                        constructor(url) { super(url); workers.push(this); this.terminated = false; }
                        terminate() { this.terminated = true; return super.terminate(); }
                    }
                    const offline = new OfflineContext(2, Math.ceil(sampleRate * .45), sampleRate);
                    const created = buildFixture(input.source, offline, { globals: {
                        audioContext: null, Worker: TrackedWorker,
                        URL: {
                            createObjectURL(blob) { const url = window.URL.createObjectURL(blob); urls.add(url); return url; },
                            revokeObjectURL(url) { urls.delete(url); window.URL.revokeObjectURL(url); }
                        }
                    } });
                    const settings = created.functions.normalizeDrumSendFxState({ reverb: {
                        enabled: true, amount: 60, send: 100, room: 'hall', size: 8, decay: 10,
                        predelay: 0, shimmerEnabled: true, shimmerShift: '12', shimmerMix: 80
                    } });
                    const started = performance.now();
                    const graph = created.functions.createDrumSendFxGraph(offline, offline.destination, settings, 120);
                    for (let decay = 12; decay <= 20; decay += 1) {
                        settings.reverb.decay = decay;
                        created.functions.configureDrumSendFxGraph(graph, settings, 120, true);
                    }
                    const configureMs = performance.now() - started;
                    let timeout;
                    let ready;
                    try {
                        ready = await Promise.race([
                            created.functions.waitForDrumSendImpulse(graph),
                            new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('Real drum IR readiness timed out')), 45000); })
                        ]);
                    } finally {
                        clearTimeout(timeout);
                    }
                    const inspect = buffer => {
                        if (!buffer) return { missing: true };
                        let peak = 0;
                        let nonfinite = 0;
                        let nonzero = 0;
                        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
                            for (const value of buffer.getChannelData(channel)) {
                                if (!Number.isFinite(value)) nonfinite += 1;
                                if (value !== 0) nonzero += 1;
                                peak = Math.max(peak, Math.abs(value));
                            }
                        }
                        return { sampleRate: buffer.sampleRate, length: buffer.length,
                            channels: buffer.numberOfChannels, peak, nonzero, nonfinite };
                    };
                    const base = inspect(graph.reverb.buffer);
                    const shimmer = inspect(graph.shimmer.buffer);
                    const source = offline.createBufferSource();
                    const signal = offline.createBuffer(1, 64, sampleRate);
                    signal.getChannelData(0)[0] = .25;
                    source.buffer = signal;
                    source.connect(graph.reverbInput);
                    graph.reverbWet.gain.value = 0;
                    source.start(0);
                    const rendered = await offline.startRendering();
                    const shimmerOutput = inspect(rendered);
                    const result = { sampleRate, ready, configureMs, readyMs: performance.now() - started,
                        requestedKey: graph.requestedImpulseKey, installedKey: graph.impulseKey,
                        shimmerKey: graph.shimmerImpulseKey, base, shimmer, shimmerOutput,
                        workers: workers.length, terminated: workers.every(worker => worker.terminated),
                        activeUrls: urls.size, activeWorker: Boolean(graph.impulseWorker),
                        activeTimer: Boolean(graph.impulseTimer || graph.impulseTimeout), isLive: graph.isLive };
                    realWorkerComparisons.push(result);
                    if (!ready || graph.impulseKey !== 'hall:8:20:12' || graph.shimmerImpulseKey !== graph.impulseKey
                        || [base, shimmer, shimmerOutput].some(buffer => buffer.missing || buffer.sampleRate !== sampleRate
                            || buffer.channels !== 2 || buffer.nonfinite || buffer.nonzero === 0 || !(buffer.peak > 0))
                        || workers.length !== 1 || !result.terminated || result.activeUrls || result.activeWorker
                        || result.activeTimer || result.isLive) failures.push(`Real worker preparation failed: ${JSON.stringify(result)}`);
                }
                return { dryComparisons, wetComparisons, realWorkerComparisons, failures,
                    scope: 'Actual Blob Worker and production IR/shimmer builders; latest-generation native buffers and offline shimmer-only PCM. No DSP substitutes, live UI, network, stores, or transport stress.' };
            }
            class ControlledPcmWorker {
                postMessage(request) {
                    queueMicrotask(() => {
                        if (this.terminated) return;
                        const channels = [new Float32Array(128), new Float32Array(128)];
                        for (const channel of channels) channel[17] = 1;
                        const identity = { requestId: request.requestId, requestKey: request.requestKey };
                        this.onmessage({ data: { ...identity, type: 'base', sampleRate: request.sampleRate, length: 128, channels } });
                        if (request.shimmerMode !== 'off') {
                            this.onmessage({ data: { ...identity, type: 'shimmer', sampleRate: request.sampleRate,
                                length: 128, channels: channels.map(channel => channel.slice()) } });
                        }
                        this.onmessage({ data: { ...identity, type: 'done' } });
                    });
                }
                terminate() { this.terminated = true; }
            }
            const pcmGlobals = () => ({ window: { OfflineAudioContext: OfflineContext },
                ...(input.controlledPcm ? { Worker: ControlledPcmWorker } : {}) });
            const instrument = offline => {
                const nodes = [];
                for (const kind of ['Gain', 'StereoPanner', 'Analyser', 'ConstantSource', 'Oscillator',
                    'DynamicsCompressor', 'WaveShaper', 'Convolver', 'BiquadFilter', 'Delay',
                    'ChannelSplitter', 'ChannelMerger', 'BufferSource']) {
                    const create = offline[`create${kind}`].bind(offline);
                    offline[`create${kind}`] = (...args) => {
                        const node = create(...args);
                        node.kind = kind;
                        node.connections = [];
                        node.disconnectCalls = 0;
                        node.startCalls = 0;
                        node.stopCalls = 0;
                        const connect = node.connect.bind(node);
                        node.connect = (...args) => {
                            const returned = connect(...args);
                            node.connections.push({ destination: args[0], output: args[1] || 0, input: args[2] || 0 });
                            return returned;
                        };
                        const disconnect = node.disconnect.bind(node);
                        node.disconnect = (...args) => {
                            const returned = disconnect(...args);
                            node.disconnectCalls += 1;
                            node.connections = args.length
                                ? node.connections.filter(edge => edge.destination !== args[0]) : [];
                            return returned;
                        };
                        for (const method of ['start', 'stop']) {
                            if (typeof node[method] !== 'function') continue;
                            const original = node[method].bind(node);
                            node[method] = (...args) => { node[`${method}Calls`] += 1; return original(...args); };
                        }
                        nodes.push(node);
                        return node;
                    };
                }
                return nodes;
            };
            async function render(sourceSet, configuration, drumFx) {
                const { sampleRate, placement, direct, sidechain, mainFx, pan = 0 } = configuration;
                const length = Math.ceil(sampleRate * .45);
                const offline = new OfflineContext(2, length, sampleRate);
                const nodes = instrument(offline);
                const fixture = buildFixture(sourceSet, offline, { placement, direct, globals: pcmGlobals() });
                fixture.state.transportLatencyCache = calibrationCache;
                await fixture.functions.setupEffects();
                fixture.functions.rebuildFinalFxRouting();
                fixture.state.finalCompressorSidechainSource = sidechain;
                const drum = fixture.functions.ensureDrumMachineBus();
                const kick = fixture.functions.ensureDrumMachineKickBypassBus();
                fixture.functions.updateDrumMachineMix();
                fixture.state.finalPanBaseOffsetSource.offset.value = pan;
                fixture.state.distortionNode.curve = fixture.functions.makeDistortionCurve(mainFx ? .35 : 0);
                fixture.state.finalDistortionNodes.forEach((node, index) => {
                    node.curve = fixture.functions.makeFinalDistortionCurve(['soft', 'hard', 'fold', 'crush'][index], mainFx ? .35 : 0);
                });
                fixture.state.finalCompressorNode.threshold.value = mainFx ? -18 : 0;
                fixture.state.finalCompressorNode.ratio.value = mainFx ? 3 : 1;
                fixture.state.finalDelayNode.delayTime.value = .06;
                fixture.state.finalDelayFeedbackGain.gain.value = mainFx ? .2 : 0;
                fixture.state.finalDelayWetGain.gain.value = mainFx ? .3 : 0;
                fixture.state.finalReverbWetGain.gain.value = mainFx ? .2 : 0;
                fixture.state.finalReverbShimmerGain.gain.value = 0;
                const room = offline.createBuffer(2, 19, sampleRate);
                room.getChannelData(0)[18] = 1;
                room.getChannelData(1)[18] = 1;
                fixture.state.finalReverbNode.normalize = false;
                fixture.state.finalReverbNode.buffer = room;
                const source = offline.createBufferSource();
                const signal = offline.createBuffer(1, length, sampleRate);
                const values = signal.getChannelData(0);
                const impulseFrame = Math.round(sampleRate * .04);
                values[impulseFrame] = .25;
                const toneStart = Math.round(sampleRate * .12);
                const toneLength = Math.round(sampleRate * .045);
                for (let frame = 0; frame < toneLength; frame += 1) {
                    const envelope = Math.sin(Math.PI * frame / (toneLength - 1)) ** 2;
                    values[toneStart + frame] = .14 * envelope * (Math.sin(2 * Math.PI * 173 * frame / sampleRate)
                        + .23 * Math.sin(2 * Math.PI * 1937 * frame / sampleRate));
                }
                source.buffer = signal;
                source.connect(sidechain === 'kick' ? kick : drum);
                source.start(0);
                const branchNodes = new Set([...(fixture.state.drumSendFxGraph?.nodes || []),
                    fixture.state.drumMachineDirectDelaySendGainNode, fixture.state.drumMachineDirectReverbSendGainNode,
                    fixture.state.drumMachineDirectDelayLatencyNode, fixture.state.drumMachineDirectReverbLatencyNode]);
                const protectedNodes = nodes.filter(node => !branchNodes.has(node));
                const before = protectedNodes.map(node => ({ node, disconnects: node.disconnectCalls,
                    starts: node.startCalls, stops: node.stopCalls }));
                if (input.contract.exercise && sourceSet.dedicatedFx) {
                    const exercise = new Function(`return (${input.contract.exercise});`)();
                    await exercise(fixture, drumFx, offline);
                    for (const state of before) {
                        if (state.node.disconnectCalls !== state.disconnects || state.node.startCalls !== state.starts
                            || state.node.stopCalls !== state.stops) failures.push(`Effect control mutated a dry node: ${JSON.stringify(configuration)}, FX=${drumFx}`);
                    }
                    for (const name of input.contract.wetOutputNodes || []) {
                        const node = name.split('.').reduce((value, key) => value?.[key], fixture.state);
                        if (!node) throw new Error(`Missing dedicated wet return ${name}`);
                        node.gain.value = 0;
                        node.gain.cancelScheduledValues(0);
                        node.gain.setValueAtTime(0, 0);
                    }
                } else if (drumFx !== 'off') {
                    throw new Error('Final drum FX contract is required for effect permutations');
                }
                const rendered = await offline.startRendering();
                return { channels: [rendered.getChannelData(0), rendered.getChannelData(1)],
                    sourceStarts: source.startCalls, sourceStops: source.stopCalls,
                    compensation: fixture.state.finalKickBypassDelay.delayTime.value,
                    nodeCount: nodes.length };
            }
            async function renderWet(configuration, reference, timing) {
                const { sampleRate, placement, direct, sidechain, kind, mainFx, pan = 0 } = configuration;
                const length = Math.ceil(sampleRate * .38);
                const offline = new OfflineContext(2, length, sampleRate);
                instrument(offline);
                const signal = offline.createBuffer(1, length, sampleRate);
                signal.getChannelData(0)[Math.round(sampleRate * .04)] = .25;
                const source = offline.createBufferSource();
                source.buffer = signal;
                const sendPercent = configuration.sendPercent ?? 100;
                const impulse = offline.createBuffer(2, 128, sampleRate);
                for (let channel = 0; channel < 2; channel += 1) {
                    impulse.getChannelData(channel)[17] = 1;
                    impulse.getChannelData(channel)[61] = -.4;
                }
                const tap = timing.taps[placement].seconds;
                const remaining = Math.max(0, timing.seconds - tap);
                let disposed = true;
                let duplicateTaps = false;
                if (reference) {
                    const inputDelay = offline.createDelay(.25);
                    inputDelay.delayTime.value = tap;
                    const outputDelay = offline.createDelay(.25);
                    outputDelay.delayTime.value = remaining;
                    const outputPan = offline.createStereoPanner();
                    outputPan.pan.value = pan;
                    outputDelay.connect(outputPan);
                    outputPan.connect(offline.destination);
                    const sendGain = offline.createGain();
                    sendGain.gain.value = sendPercent / 100;
                    source.connect(sendGain);
                    sendGain.connect(inputDelay);
                    if (kind === 'delay') {
                        const amount = Math.sin(.6 * Math.PI / 2);
                        const times = [.08, .08 * .72 + .013, .08 * 1.18 + .021];
                        const levels = [amount * .64, amount * .26 * .8, amount * .26 * .54];
                        for (let index = 0; index < times.length; index += 1) {
                            const delay = offline.createDelay(2.5);
                            const gain = offline.createGain();
                            delay.delayTime.value = times[index];
                            gain.gain.value = levels[index];
                            inputDelay.connect(delay);
                            delay.connect(gain);
                            if (index) {
                                const pan = offline.createStereoPanner();
                                pan.pan.value = index === 1 ? -.58 : .58;
                                gain.connect(pan);
                                pan.connect(outputDelay);
                            } else gain.connect(outputDelay);
                        }
                    } else {
                        const predelay = offline.createDelay(.18);
                        predelay.delayTime.value = .08;
                        const convolver = offline.createConvolver();
                        convolver.normalize = false;
                        convolver.buffer = impulse;
                        const gain = offline.createGain();
                        gain.gain.value = .6 * (.68 + 45 * .0018);
                        inputDelay.connect(predelay);
                        predelay.connect(convolver);
                        convolver.connect(gain);
                        gain.connect(outputDelay);
                    }
                } else {
                    const created = buildFixture(input.source, offline, { placement, direct, globals: pcmGlobals() });
                    Object.assign(created.state, { preFilterGainNode: offline.createGain(),
                        finalKickBypassMasterGain: offline.createGain(), finalKickBypassPanner: offline.createStereoPanner(),
                        finalAmplifierNode: offline.createGain(), finalReverbEnabled: mainFx });
                    created.state.transportSync.latency = timing;
                    created.state.finalAmplifierNode.connect(offline.destination);
                    const drum = created.functions.ensureDrumMachineBus();
                    const kick = created.functions.ensureDrumMachineKickBypassBus();
                    const imported = { delay: { enabled: kind === 'delay', amount: 60, send: sendPercent, timeMode: 'free',
                        time: 80, feedback: 0, tone: 12000 }, reverb: { enabled: kind === 'reverb', amount: 60,
                        send: sendPercent, size: 45, predelay: 80, shimmerEnabled: false } };
                    created.functions.loadDrumSendFxState(imported);
                    const oldGraph = created.state.drumSendFxGraph;
                    created.functions.disposeDrumSendFxGraph();
                    created.functions.updateDrumSendEffects();
                    disposed = oldGraph.nodes.every(node => node.connections.length === 0);
                    for (let repeat = 0; repeat < 4; repeat += 1) created.functions.updateDrumSendEffects();
                    const graph = created.state.drumSendFxGraph;
                    graph.returnPanner.pan.value = pan;
                    if (created.functions.waitForDrumSendImpulse
                        && !await created.functions.waitForDrumSendImpulse(graph)) throw new Error('Wet-only latest IR failed readiness');
                    graph.reverb.normalize = false;
                    graph.reverb.buffer = impulse;
                    graph.delayTone.type = 'peaking';
                    graph.delayTone.gain.value = 0;
                    graph.reverbTone.type = 'peaking';
                    graph.reverbTone.gain.value = 0;
                    source.connect(sidechain === 'kick' ? kick : drum);
                    for (const bus of [drum, kick]) {
                        for (const node of [created.state.drumMachineDirectDelayLatencyNode, created.state.drumMachineDirectReverbLatencyNode]) {
                            if (bus.connections.filter(edge => edge.destination === node).length !== 1) duplicateTaps = true;
                        }
                    }
                }
                source.start(0);
                const rendered = await offline.startRendering();
                return { channels: [rendered.getChannelData(0), rendered.getChannelData(1)], disposed, duplicateTaps };
            }
            const configurations = [];
            for (const sampleRate of [44100, 48000]) {
                for (const placement of ['pre', 'post']) {
                    for (const direct of [false, true]) {
                        for (const sidechain of ['off', 'kick']) {
                            for (const mainFx of input.neutralOnly ? [false] : [false, true]) {
                                for (const pan of input.pans) configurations.push({ sampleRate, placement, direct, sidechain, mainFx, pan });
                            }
                        }
                    }
                }
            }
            const dryConfigurations = input.compactPcm ? configurations.filter(configuration => {
                const kick = configuration.sidechain === 'kick';
                return configuration.placement === (kick ? 'post' : 'pre')
                    && configuration.mainFx === (configuration.direct !== kick)
                    && configuration.pan === (configuration.mainFx ? (configuration.direct ? .65 : -.65) : 0);
            }) : configurations;
            for (const configuration of input.wetOnly ? [] : dryConfigurations.slice(input.caseOffset,
                input.caseLimit ? input.caseOffset + input.caseLimit : dryConfigurations.length)) {
                const reference = await render(input.baseline, configuration, 'off');
                for (const drumFx of input.baselineOnly ? ['off'] : ['off', 'delay', 'reverb', 'both']) {
                    const actual = await render(input.source, configuration, drumFx);
                    let maximumDifference = 0;
                    let squaredDifference = 0;
                    let peak = 0;
                    let nonfinite = 0;
                    for (let channel = 0; channel < actual.channels.length; channel += 1) {
                        for (let frame = 0; frame < actual.channels[channel].length; frame += 1) {
                            const value = actual.channels[channel][frame];
                            if (!Number.isFinite(value)) nonfinite += 1;
                            const difference = value - reference.channels[channel][frame];
                            maximumDifference = Math.max(maximumDifference, Math.abs(difference));
                            squaredDifference += difference * difference;
                            peak = Math.max(peak, Math.abs(value));
                        }
                    }
                    const result = { ...configuration, drumFx, maximumDifference,
                        rmsDifference: Math.sqrt(squaredDifference / (actual.channels.length * actual.channels[0].length)),
                        peak, nonfinite, compensation: actual.compensation,
                        sourceStarts: actual.sourceStarts, sourceStops: actual.sourceStops,
                        maximumTolerance: configuration.mainFx ? .000002 : .0000001 };
                    dryComparisons.push(result);
                    if (dryComparisons.length % 16 === 0) console.log(`Drum FX PCM: ${dryComparisons.length} dry comparisons complete`);
                    if (nonfinite || !Number.isFinite(maximumDifference) || maximumDifference > result.maximumTolerance || peak < .001) {
                        failures.push(`Dry null failed: ${JSON.stringify(result)}`);
                    }
                    if (input.checkpoint) console.log(`Drum FX PCM case:${JSON.stringify({ kind: 'dry', result, failures })}`);
                }
            }
            if (!input.baselineOnly) {
                for (const sampleRate of [44100, 48000]) {
                    if (!calibrationCache.has(sampleRate) && input.wetOnly) {
                        const offline = new OfflineContext(2, 1024, sampleRate);
                        const created = buildFixture(input.source, offline,
                            { globals: { window: { OfflineAudioContext: OfflineContext } } });
                        calibrationCache.set(sampleRate, created.functions.measureTransportComponentLatency(sampleRate));
                    }
                    const timing = await calibrationCache.get(sampleRate);
                    if (!timing) continue;
                    for (const placement of ['pre', 'post']) {
                        for (const direct of [false, true]) {
                            for (const sidechain of ['off', 'kick']) {
                                for (const mainFx of [false, true]) {
                                    for (const kind of ['delay', 'reverb']) {
                                      for (const sendPercent of kind === 'reverb' && placement === 'pre' && sidechain === 'kick' && !mainFx ? [0, 25, 100, 200] : [100]) {
                                       for (const pan of input.pans) {
                                        if (input.compactPcm && (mainFx || placement !== (direct ? 'post' : 'pre')
                                            || pan !== (sidechain === 'kick' ? (kind === 'delay' ? -.65 : .65) : 0))) continue;
                                        const configuration = { sampleRate, placement, direct, sidechain, mainFx, kind, sendPercent, pan };
                                        const actual = await renderWet(configuration, false, timing);
                                        const reference = await renderWet(configuration, true, timing);
                                        let maximumDifference = 0;
                                        let peak = 0;
                                        let firstFrame = -1;
                                        let referenceFirstFrame = -1;
                                        let nonfinite = 0;
                                        for (let channel = 0; channel < 2; channel += 1) {
                                            for (let frame = 0; frame < actual.channels[channel].length; frame += 1) {
                                                const value = actual.channels[channel][frame];
                                                if (!Number.isFinite(value)) nonfinite += 1;
                                                peak = Math.max(peak, Math.abs(value));
                                                maximumDifference = Math.max(maximumDifference, Math.abs(value - reference.channels[channel][frame]));
                                                if (Math.abs(value) > 1e-7 && (firstFrame < 0 || frame < firstFrame)) firstFrame = frame;
                                                if (Math.abs(reference.channels[channel][frame]) > 1e-7
                                                    && (referenceFirstFrame < 0 || frame < referenceFirstFrame)) referenceFirstFrame = frame;
                                            }
                                        }
                                        const result = { ...configuration, maximumDifference, peak, nonfinite,
                                            firstFrame, referenceFirstFrame, compensation: timing.seconds,
                                            disposed: actual.disposed, duplicateTaps: actual.duplicateTaps };
                                        wetComparisons.push(result);
                                        if (wetComparisons.length % 16 === 0) console.log(`Drum FX PCM: ${wetComparisons.length} wet comparisons complete`);
                                        if (!actual.disposed || actual.duplicateTaps || nonfinite || maximumDifference > 2e-6
                                            || !Number.isFinite(maximumDifference) || (sendPercent === 0 ? peak > 1e-8 : peak < .001)
                                            || Math.abs(firstFrame - referenceFirstFrame) > 1) {
                                            failures.push(`Wet timing/null failed: ${JSON.stringify(result)}`);
                                        }
                                        if (input.checkpoint) console.log(`Drum FX PCM case:${JSON.stringify({ kind: 'wet', result, failures })}`);
                                       }
                                      }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return { dryComparisons, wetComparisons, realWorkerComparisons, failures,
                controlledImpulsePreparation: input.controlledPcm, compactMatrix: input.compactPcm,
                scope: 'Isolated actual application setup/routing/curves/native calibration. Dedicated wet returns are silenced only at their output while their controls and sends remain active. No page bootstrap, auth, backend, stores, device output, or network.' };
        }, { source: fixture.collectSources(source), baseline: fixture.collectSources(baseline),
            fixtureFactory: fixture.createFixture.toString(), contract,
            baselineOnly: process.env.MYGRAIN_DRUM_FX_BASELINE_ONLY === '1',
            wetOnly: process.env.MYGRAIN_DRUM_FX_WET_ONLY === '1',
            realWorkerOnly: process.env.MYGRAIN_DRUM_FX_REAL_WORKER_ONLY === '1',
            controlledPcm: process.env.MYGRAIN_DRUM_FX_CONTROLLED_PCM === '1',
            compactPcm: process.env.MYGRAIN_DRUM_FX_COMPACT_PCM === '1',
            checkpoint: Boolean(process.env.MYGRAIN_DRUM_FX_CHECKPOINT),
            neutralOnly: process.env.MYGRAIN_DRUM_FX_NEUTRAL_ONLY === '1',
            pans: (process.env.MYGRAIN_DRUM_FX_PANS || '0').split(',').map(Number),
            caseOffset: Number(process.env.MYGRAIN_DRUM_FX_CASE_OFFSET) || 0,
            caseLimit: Number(process.env.MYGRAIN_DRUM_FX_CASE_LIMIT) || 0 });
        assert.deepEqual(requests, [], 'PCM fixtures must never contact the network');
        return { engine: engineName, browserVersion: browser.version(), pageUrl: page.url(), requests, workerRequests, ...result };
    } finally {
        await browser.close();
    }
}

async function runCli() {
        const baseline = fs.readFileSync(fixture.baselinePath, 'utf8');
        assert.equal(fixture.fingerprint(baseline), fixture.expectedBaselineSha256);
        const source = process.env.MYGRAIN_DRUM_FX_BASELINE_ONLY === '1' ? baseline : fs.readFileSync(fixture.sourcePath, 'utf8');
        const requested = process.env.MYGRAIN_DRUM_FX_ENGINE || 'all';
        assert.ok(['chromium', 'webkit', 'all'].includes(requested));
        const results = [];
        for (const engine of requested === 'all' ? ['chromium', 'webkit'] : [requested]) {
            results.push(await runEngine(engine, source, baseline));
        }
        process.stdout.write(`${JSON.stringify({ baselinePath: fixture.baselinePath, sourcePath: fixture.sourcePath,
            baselineSha256: fixture.fingerprint(baseline), sourceSha256: fixture.fingerprint(source), results }, null, 2)}\n`);
        if (results.some(result => result.failures.length || result.unavailable)) process.exitCode = 1;
}

module.exports = { runEngine, runCli };

if (require.main === module) {
    runCli().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
