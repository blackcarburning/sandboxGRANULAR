const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium, webkit } = require('playwright-core');
const { baselinePath, sourcePath, collectSources, createFixture, graphPaths } = require('./transport-latency.test.js');
const runMetadata = { sourcePath, baselinePath, physicalDeviceTested: false };

async function runEngine(engineName, sources, baselineSources) {
    const engine = engineName === 'webkit' ? webkit : chromium;
    const browser = await engine.launch(engineName === 'chromium' ? {
        executablePath: process.env.CHROMIUM_PATH || '/snap/chromium/current/usr/lib/chromium-browser/chrome',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    } : { headless: true });
    const requests = [];
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => route.abort());
        const page = await context.newPage();
        page.on('request', request => requests.push(request.url()));
        const result = await page.evaluate(async input => {
            const buildFixture = new Function(`return (${input.fixtureFactory});`)();
            const findPaths = new Function(`return (${input.pathsFunction});`)();
            const failures = [];
            const results = [];
            const wetSendResults = [];
            const detectorResults = [];
            const calibrationCache = new Map();
            const calibrations = new Map();
            const probeContexts = [];
            const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (!OfflineContext) throw new Error('OfflineAudioContext is unavailable');
            function ProbeOfflineContext(...args) {
                const offline = new OfflineContext(...args);
                const probe = { sampleRate: offline.sampleRate, channels: args[0], shapers: 0, compressors: 0,
                    impulse: false, sourceStarts: 0 };
                for (const [method, field] of [['createWaveShaper', 'shapers'], ['createDynamicsCompressor', 'compressors']]) {
                    const create = offline[method].bind(offline);
                    offline[method] = (...parameters) => {
                        probe[field] += 1;
                        return create(...parameters);
                    };
                }
                const createSource = offline.createBufferSource.bind(offline);
                offline.createBufferSource = (...parameters) => {
                    const source = createSource(...parameters);
                    const start = source.start.bind(source);
                    source.start = (...times) => {
                        probe.sourceStarts += 1;
                        probe.impulse = source.buffer.getChannelData(0).some(value => value !== 0);
                        return start(...times);
                    };
                    return source;
                };
                probeContexts.push(probe);
                return offline;
            }

            function check(condition, message) {
                if (!condition) failures.push(message);
            }

            function instrument(offline) {
                const nodes = [];
                for (const kind of ['Gain', 'StereoPanner', 'Analyser', 'ConstantSource', 'Oscillator',
                    'DynamicsCompressor', 'WaveShaper', 'Convolver', 'BiquadFilter', 'Delay',
                    'ChannelSplitter', 'ChannelMerger', 'BufferSource']) {
                    const original = offline[`create${kind}`].bind(offline);
                    offline[`create${kind}`] = (...args) => {
                        const node = original(...args);
                        node.kind = kind;
                        node.connections = [];
                        const connect = node.connect.bind(node);
                        const disconnect = node.disconnect.bind(node);
                        node.connect = (...connections) => {
                            const returned = connect(...connections);
                            node.connections.push({ destination: connections[0], output: connections[1] || 0,
                                input: connections[2] || 0 });
                            return returned;
                        };
                        node.disconnect = (...connections) => {
                            const returned = disconnect(...connections);
                            node.connections = connections.length
                                ? node.connections.filter(edge => edge.destination !== connections[0]) : [];
                            return returned;
                        };
                        nodes.push(node);
                        return node;
                    };
                }
                return nodes;
            }

            async function render(sourceSet, sampleRate, placement, amount, route, baseline = false, wetSend = null) {
                const frameCount = Math.ceil(sampleRate * .3);
                const impulseFrame = Math.round(sampleRate * .04);
                const offline = new OfflineContext(2, frameCount, sampleRate);
                const nodes = instrument(offline);
                const direct = !['drums-via-fx', 'kick-bypass'].includes(route);
                const fixture = buildFixture(sourceSet, offline, { placement, direct,
                    globals: { window: { OfflineAudioContext: ProbeOfflineContext } } });
                if (!baseline) fixture.state.transportLatencyCache = calibrationCache;
                await fixture.functions.setupEffects();
                fixture.functions.rebuildFinalFxRouting();
                fixture.state.distortionNode.curve = fixture.functions.makeDistortionCurve(amount);
                const types = ['soft', 'hard', 'fold', 'crush'];
                fixture.state.finalDistortionNodes.forEach((node, index) => {
                    node.curve = fixture.functions.makeFinalDistortionCurve(types[index], amount);
                });
                const signal = offline.createBuffer(1, frameCount, sampleRate);
                const values = signal.getChannelData(0);
                values[impulseFrame] = .25;
                const toneStart = Math.round(sampleRate * .15);
                const toneLength = Math.round(sampleRate * .045);
                for (let frame = 0; frame < toneLength; frame += 1) {
                    const envelope = Math.sin(Math.PI * frame / (toneLength - 1)) ** 2;
                    values[toneStart + frame] = .18 * envelope *
                        (Math.sin(2 * Math.PI * 173 * frame / sampleRate) + .23 * Math.sin(2 * Math.PI * 1937 * frame / sampleRate));
                }
                let destination = fixture.functions.getBastardLoopXPlaybackDestination();
                if (route === 'drums' || route === 'drums-via-fx') destination = fixture.functions.ensureDrumMachineBus();
                if (route === 'kick' || route === 'kick-bypass') destination = fixture.functions.ensureDrumMachineKickBypassBus();
                if (wetSend) {
                    fixture.state.finalCompressorSidechainSource = direct || route === 'kick-bypass' ? 'kick' : 'off';
                    fixture.state.drumMachineDirectDelaySendEnabled = wetSend.kind === 'delay' && wetSend.enabled;
                    fixture.state.drumMachineDirectReverbSendEnabled = wetSend.kind === 'reverb' && wetSend.enabled;
                    if (fixture.state.drumSendFxState) {
                        fixture.state.drumSendFxState.delay.enabled = wetSend.kind === 'delay' && wetSend.enabled;
                        fixture.state.drumSendFxState.reverb.enabled = wetSend.kind === 'reverb' && wetSend.enabled;
                        fixture.state.drumSendFxState.delay.send = 100;
                        fixture.state.drumSendFxState.reverb.send = 100;
                        fixture.state.drumSendFxState.delay.amount = 100;
                        fixture.state.drumSendFxState.reverb.amount = 100;
                    }
                    fixture.functions.updateDrumMachineMix();
                    const dedicated = fixture.state.drumSendFxGraph;
                    if (wetSend.kind === 'delay') {
                        (dedicated?.delay || fixture.state.finalDelayNode).delayTime.setValueAtTime(.08, 0);
                        (dedicated?.delayWet || fixture.state.finalDelayWetGain).gain.value = 1;
                        (dedicated?.feedback || fixture.state.finalDelayFeedbackGain).gain.value = 0;
                        if (dedicated) {
                            dedicated.shadowGainA.gain.value = 0;
                            dedicated.shadowGainB.gain.value = 0;
                            dedicated.delayTone.type = 'peaking';
                            dedicated.delayTone.gain.value = 0;
                        }
                    } else {
                        const impulse = offline.createBuffer(2, 18, sampleRate);
                        impulse.getChannelData(0)[17] = 1;
                        impulse.getChannelData(1)[17] = 1;
                        const reverb = dedicated?.reverb || fixture.state.finalReverbNode;
                        const predelay = dedicated?.predelay || fixture.state.finalReverbPreDelay;
                        const tone = dedicated?.reverbTone || fixture.state.finalReverbLowpass;
                        reverb.normalize = false;
                        reverb.buffer = impulse;
                        predelay.delayTime.setValueAtTime(.08, 0);
                        tone.type = 'peaking';
                        tone.gain.value = 0;
                        (dedicated?.reverbWet || fixture.state.finalReverbWetGain).gain.value = 1;
                        (dedicated?.shimmerWet || fixture.state.finalReverbShimmerGain).gain.value = 0;
                    }
                }
                const scheduledHits = [];
                if (wetSend?.detector) {
                    fixture.state.drumMachineKickBuffer = signal;
                    fixture.state.playDrumMachineHit = (buffer, time, pitch, options) => scheduledHits.push({ time, options });
                    fixture.functions.scheduleDrumMachineRepeats('kick', 0, impulseFrame / sampleRate, .125);
                }
                if (route !== 'silence') {
                    const source = offline.createBufferSource();
                    source.buffer = signal;
                    source.connect(destination);
                    source.start(0);
                }
                const paths = findPaths(destination, fixture.state.finalAmplifierNode);
                const dryPaths = paths.filter(chain => !chain.includes(fixture.state.finalFxOutput)
                    && !chain.some(node => fixture.state.drumSendFxGraph?.nodes.includes(node)));
                const actualDelays = [...new Set(dryPaths.flatMap(chain => chain.filter(node => node.kind === 'Delay')))];
                const timing = fixture.functions.getTransportTimingDebug?.().latency || null;
                if (!baseline && timing) calibrations.set(sampleRate, { ...timing });
                let detector = null;
                if (wetSend?.detector) {
                    const audibleTime = impulseFrame / sampleRate + timing.seconds;
                    const valueAt = time => fixture.functions.getFinalKickSidechainDetector(time);
                    detector = { audibleTime, scheduledHits,
                        events: fixture.state.finalSidechainKickEvents.map(event => ({ ...event })),
                        atSource: valueAt(impulseFrame / sampleRate), before: valueAt(audibleTime - .5 / sampleRate),
                        atStart: valueAt(audibleTime), afterOneSample: valueAt(audibleTime + 1 / sampleRate),
                        atAttackPeak: valueAt(audibleTime + .004),
                        afterRelease: valueAt(audibleTime + .004 + .1 + 1 / sampleRate),
                        dispatcherAtPeak: fixture.functions.getFinalCompressorSidechainDetector(audibleTime + .004),
                        enabled: fixture.state.finalCompressorSidechainSource === 'kick' };
                }
                const audio = await offline.startRendering();
                const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) =>
                    new Float32Array(audio.getChannelData(channel)));
                for (const node of nodes) {
                    try { node.disconnect(); } catch {}
                }
                return { channels, impulseFrame, toneStart, timing, detector,
                    sendGain: wetSend ? (wetSend.kind === 'delay'
                        ? fixture.state.drumSendFxGraph?.delayInput || fixture.state.drumMachineDirectDelaySendGainNode
                        : fixture.state.drumSendFxGraph?.reverbInput || fixture.state.drumMachineDirectReverbSendGainNode)?.gain.value : null,
                    ratio: fixture.state.finalCompressorNode.ratio.value,
                    delayFrames: actualDelays.map(node => node.delayTime.value * sampleRate),
                    processedStages: paths.map(chain => chain.filter(node => node.kind === 'WaveShaper').length) };
            }

            function subtract(signal, silence) {
                return signal.channels.map((channel, channelIndex) =>
                    Float32Array.from(channel, (value, frame) => value - silence.channels[channelIndex][frame]));
            }

            function marker(values, start, end) {
                let peak = 0;
                let peakFrame = start;
                for (let frame = start; frame < end; frame += 1) {
                    const amplitude = Math.abs(values[frame]);
                    if (amplitude > peak) { peak = amplitude; peakFrame = frame; }
                }
                let salientOnsetFrame = peakFrame;
                while (salientOnsetFrame > start && Math.abs(values[salientOnsetFrame - 1]) >= peak * .5) salientOnsetFrame -= 1;
                return { peak, peakFrame, salientOnsetFrame };
            }

            function residual(first, second, shift) {
                let maxError = 0;
                let errorEnergy = 0;
                let signalEnergy = 0;
                for (let channel = 0; channel < first.length; channel += 1) {
                    for (let frame = 0; frame < second[channel].length; frame += 1) {
                        const actual = first[channel][frame + shift] || 0;
                        const expected = second[channel][frame];
                        const error = actual - expected;
                        maxError = Math.max(maxError, Math.abs(error));
                        errorEnergy += error * error;
                        signalEnergy += expected * expected;
                    }
                }
                return { maxError, relativeRmsError: Math.sqrt(errorEnergy / Math.max(signalEnergy, Number.EPSILON)) };
            }

            async function nativeDelayReference(channels, sampleRate, seconds) {
                const offline = new OfflineContext(channels.length, channels[0].length, sampleRate);
                const buffer = offline.createBuffer(channels.length, channels[0].length, sampleRate);
                channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
                const source = offline.createBufferSource();
                source.buffer = buffer;
                const delay = offline.createDelay(.25);
                delay.delayTime.setValueAtTime(seconds, 0);
                source.connect(delay);
                delay.connect(offline.destination);
                source.start(0);
                try {
                    const rendered = await offline.startRendering();
                    return Array.from({ length: rendered.numberOfChannels }, (_, channel) =>
                        new Float32Array(rendered.getChannelData(channel)));
                } finally {
                    source.disconnect();
                    delay.disconnect();
                }
            }

            for (const sampleRate of [44100, 48000]) {
                for (const placement of ['pre', 'post']) {
                    for (const amount of [0, .45]) {
                        const label = `${sampleRate}Hz/${placement}/${amount ? 'active' : 'zero'} FX`;
                        const baselineSilence = await render(input.baselineSources, sampleRate, placement, amount, 'silence', true);
                        const baselineDrums = await render(input.baselineSources, sampleRate, placement, amount, 'drums', true);
                        const beforeDrumPcm = subtract(baselineDrums, baselineSilence);
                        const silence = await render(input.sources, sampleRate, placement, amount, 'silence');
                        const processed = await render(input.sources, sampleRate, placement, amount, 'processed');
                        const processedPcm = subtract(processed, silence);
                        const processedMarker = marker(processedPcm[0], processed.impulseFrame, processed.toneStart);
                        const beforeMarker = marker(beforeDrumPcm[0], baselineDrums.impulseFrame, baselineDrums.toneStart);
                        const frames = processed.timing?.frames;
                        check(processed.timing?.status === 'measured', `${label}: actual runtime calibration must succeed`);
                        check(Number.isInteger(frames) && frames > 0, `${label}: positive measured integral frame latency`);
                        check(processed.ratio === 1, `${label}: compressor ratio is unity, not bypassed`);
                        check(processed.processedStages.includes(5), `${label}: actual X path contains all five source-created shapers`);
                        check(processedMarker.peakFrame - beforeMarker.peakFrame > sampleRate * .015,
                            `${label}: the pre-fix fast path demonstrably leads the actual processed X path`);
                        const routes = [];
                        for (const route of ['drums', 'kick', 'drums-via-fx']) {
                            const after = await render(input.sources, sampleRate, placement, amount, route);
                            const pcm = subtract(after, silence);
                            const onset = marker(pcm[0], after.impulseFrame, after.toneStart);
                            const peakResidualFrames = onset.peakFrame - processedMarker.peakFrame;
                            const onsetResidualFrames = onset.salientOnsetFrame - processedMarker.salientOnsetFrame;
                            check(onset.peak > .0001, `${label}/${route}: measurable impulse is present`);
                            check(Math.abs(peakResidualFrames) <= 1, `${label}/${route}: peak residual ${peakResidualFrames} frames`);
                            check(Math.abs(onsetResidualFrames) <= 1, `${label}/${route}: salient onset residual ${onsetResidualFrames} frames`);
                            let tone;
                            if (route === 'drums-via-fx') {
                                tone = residual(pcm, processedPcm, 0);
                                check(tone.maxError < .000002, `${label}: Direct Out off equals processed X, without extra compensation`);
                            } else {
                                check(after.delayFrames.length === 1, `${label}/${route}: exactly one real delay on clean bus`);
                                check(Math.abs(after.delayFrames[0] - frames) <= .001,
                                    `${label}/${route}: actual DelayNode configuration equals independently measured calibration`);
                                const expected = await nativeDelayReference(beforeDrumPcm, sampleRate, after.timing.seconds);
                                tone = residual(pcm, expected, 0);
                                tone.integerShiftMaxError = residual(pcm, beforeDrumPcm, frames).maxError;
                                check(tone.maxError < .000002 && tone.relativeRmsError < .00002,
                                    `${label}/${route}: waveform and stereo tone must remain unchanged after pure time shift`);
                            }
                            routes.push({ route, delayFrames: after.delayFrames, marker: onset,
                                peakResidualFrames, onsetResidualFrames, tone });
                        }
                        results.push({ sampleRate, placement, fxAmount: amount, timing: processed.timing,
                            processed: processedMarker, before: beforeMarker,
                            beforeLeadFrames: processedMarker.peakFrame - beforeMarker.peakFrame, routes });
                    }
                    for (const scenario of [
                        { kind: 'delay', route: 'drums' },
                        { kind: 'reverb', route: 'drums' },
                        { kind: 'reverb', route: 'kick-bypass' },
                        { kind: 'reverb', route: 'drums-via-fx' }
                    ]) {
                        const label = `${sampleRate}Hz/${placement}/${scenario.route}/${scenario.kind}`;
                        const disabled = await render(input.sources, sampleRate, placement, 0, scenario.route, false,
                            { kind: scenario.kind, enabled: false, detector: true });
                        const enabled = await render(input.sources, sampleRate, placement, 0, scenario.route, false,
                            { kind: scenario.kind, enabled: true });
                        const directSendPcm = subtract(enabled, disabled);
                        const dry = marker(disabled.channels[0], disabled.impulseFrame,
                            disabled.impulseFrame + Math.round(sampleRate * .06));
                        const wet = marker(directSendPcm[0], enabled.impulseFrame + Math.round(sampleRate * .065), enabled.toneStart);
                        const impulseDelayFrames = scenario.kind === 'reverb' ? 17 : 0;
                        const expectedWetOffsetFrames = Math.round(sampleRate * .08) + impulseDelayFrames;
                        const actualWetOffsetFrames = wet.peakFrame - dry.peakFrame;
                        const residualFrames = actualWetOffsetFrames - expectedWetOffsetFrames;
                        check(wet.peak > .0001 && dry.peak > .0001, `${label}: direct send contributes a measurable wet impulse`);
                        check(enabled.sendGain > .9 && disabled.sendGain < .00001, `${label}: real mixer honors the direct-send toggle`);
                        check(Math.abs(residualFrames) <= 1, `${label}: wet/dry residual ${residualFrames} frames`);
                        wetSendResults.push({ sampleRate, placement, ...scenario, musicalDelaySeconds: .08, impulseDelayFrames,
                            dry, wet, expectedWetOffsetFrames, actualWetOffsetFrames, residualFrames });
                        const detector = disabled.detector;
                        const detectorLabel = `${label}/detector`;
                        check(detector.scheduledHits.length === 1, `${detectorLabel}: the actual kick scheduler emits one source event`);
                        check(Math.abs(detector.scheduledHits[0]?.time * sampleRate - disabled.impulseFrame) < .00001,
                            `${detectorLabel}: source scheduling is not delayed a second time`);
                        check(detector.scheduledHits[0]?.options.bypassFinalCompressor === (scenario.route === 'kick-bypass'),
                            `${detectorLabel}: scheduler uses the expected normal/bypass route`);
                        check(detector.atSource === 0 && detector.before === 0, `${detectorLabel}: ducking does not begin at the uncompensated source time`);
                        check(Math.abs(detector.atStart) < .000001 && detector.afterOneSample > 0,
                            `${detectorLabel}: the envelope begins at the compensated audible time`);
                        check(Math.abs(detector.atAttackPeak - .8) < .000001 && detector.afterRelease === 0,
                            `${detectorLabel}: attack and release remain unchanged after compensation`);
                        check(Math.abs(detector.dispatcherAtPeak - (detector.enabled ? .8 : 0)) < .000001,
                            `${detectorLabel}: sidechain-source selection is preserved`);
                        check(Math.abs(detector.audibleTime * sampleRate - dry.peakFrame) <= 1,
                            `${detectorLabel}: detector timing agrees with the independently rendered dry impulse`);
                        detectorResults.push({ sampleRate, placement, ...scenario, dryPeakFrame: dry.peakFrame, ...detector });
                    }
                }
            }
            for (const sampleRate of [44100, 48000]) {
                const probes = probeContexts.filter(probe => probe.sampleRate === sampleRate);
                check(probes.length === 6,
                    `${sampleRate}Hz: output/pre/post calibration must each render one impulse/silence pair, without repeating across graph rebuilds`);
                for (const tap of [
                    { name: 'output', shapers: 5, compressors: 1 },
                    { name: 'pre', shapers: 4, compressors: 0 },
                    { name: 'post', shapers: 5, compressors: 0 }
                ]) {
                    const matching = probes.filter(probe => probe.shapers === tap.shapers && probe.compressors === tap.compressors);
                    check(matching.length === 2 && matching.filter(probe => probe.impulse).length === 1 &&
                        matching.every(probe => probe.sourceStarts === 1),
                    `${sampleRate}Hz/${tap.name}: independent actual-node topology has exactly one signal probe and one silence probe`);
                }
                const timing = calibrations.get(sampleRate);
                check(timing?.frames > timing?.taps?.post?.frames && timing?.taps?.post?.frames > timing?.taps?.pre?.frames &&
                    timing?.taps?.pre?.frames > 0, `${sampleRate}Hz: independently measured output/post/pre latencies preserve their actual path ordering`);
            }
            return { results, wetSendResults, detectorResults, calibrations: Object.fromEntries(calibrations), probeContexts, failures,
                scope: 'Application setupEffects/routing/curve/calibration functions run in isolation with neutral controls; no application page, UI bootstrap, network, or physical device.',
                toneReference: 'Before-snapshot PCM through a separate native DelayNode at the measured time; integer-shift residual is also reported because engines differ in sub-frame interpolation precision.',
                wetReference: 'Enabled-minus-disabled direct-send PCM isolates the direct wet contribution, including Direct Out off; reverb uses a non-normalized stereo delta IR at sample 17 and a neutral 0dB peaking filter.',
                onsetDefinition: 'Leading contiguous sample at >=50% of the impulse peak after subtracting a silence render; oversampling pre-ringing is not treated as an onset.' };
        }, { sources, baselineSources, fixtureFactory: createFixture.toString(), pathsFunction: graphPaths.toString() });
        if (requests.length) result.failures.push(`Unexpected browser network requests: ${requests.join(', ')}`);
        return { engine: engineName, browserVersion: browser.version(), pageUrl: page.url(), networkRequests: requests, ...result };
    } finally {
        await browser.close();
    }
}

(async () => {
    const html = fs.readFileSync(sourcePath, 'utf8');
    const baseline = fs.readFileSync(baselinePath, 'utf8');
    const sources = collectSources(html);
    const baselineSources = collectSources(baseline);
    const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');
    runMetadata.sourceSha256 = fingerprint(html);
    runMetadata.baselineSha256 = fingerprint(baseline);
    runMetadata.sourceFunctionSha256 = Object.fromEntries(sources.names.map((name, index) =>
        [name, fingerprint(sources.functions[index])]));
    runMetadata.sourceDeclarationsSha256 = fingerprint(JSON.stringify(sources.declarations));
    const requestedEngine = process.env.MYGRAIN_LATENCY_ENGINE || process.env.PLAYWRIGHT_BROWSER || 'chromium';
    if (!['chromium', 'webkit', 'all'].includes(requestedEngine)) throw new Error(`Unsupported engine: ${requestedEngine}`);
    const results = [];
    for (const engine of requestedEngine === 'all' ? ['chromium', 'webkit'] : [requestedEngine]) {
        results.push(await runEngine(engine, sources, baselineSources));
    }
    const failures = results.flatMap(result => result.failures.map(failure => `${result.engine}: ${failure}`));
    process.stdout.write(`${JSON.stringify({ ...runMetadata, engines: results, failures }, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
})().catch(error => {
    process.stdout.write(`${JSON.stringify({ ...runMetadata, error: String(error.stack || error) })}\n`);
    process.exitCode = 1;
});
