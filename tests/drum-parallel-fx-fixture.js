const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const latency = require('./transport-latency.test.js');

const baselinePath = process.env.MYGRAIN_DRUM_FX_BASELINE || path.join(__dirname,
    '../backups/drum-dedicated-fx-qa-20261018T172433Z/before/index.html');
const sourcePath = process.env.MYGRAIN_DRUM_FX_SOURCE || path.join(__dirname, '../index.html');
const expectedBaselineSha256 = '7a4e2a2f956c2d60a903df0ef1b2b2fe738a175351dae5109ed3a786962fe02b';
const fingerprint = source => crypto.createHash('sha256').update(source).digest('hex');
const invariantFunctions = [
    'rebuildFinalFxRouting', 'rebuildFilterChain', 'getDrumMachineBusDestination',
    'shouldRouteDrumMachineDirectToOutput', 'getBastardLoopXPlaybackDestination',
    'normalizeFinalCompressorSidechainSource', 'pruneFinalSidechainKickEvents',
    'registerFinalSidechainKickTrigger', 'getFinalKickSidechainDetector',
    'getFinalCompressorSidechainDetector', 'shouldRouteKickAroundFinalCompressor',
    'getTransportLoopOriginTime', 'getBufferedTransportStartTime', 'getTransportTimingDebug',
    'getTransportOutputLatencySeconds', 'getTransportPreparationLeadSeconds',
    'startTransportSource', 'cancelPreparedTransportStarts', 'startTransportChordLayer',
    'getTransportClockBpm', 'getTransportScheduleHorizon', 'scheduleTransportSourceStop',
    'retireTransportVoice', 'retireTransportOscillators', 'stopRetiredTransportVoices',
    'prepareChordTransportHandoff',
    'getTransportGridPosition', 'setTransportEpoch', 'resolveTransportLaneStart',
    'withBufferedTransportStart', 'retimeSharedTransport', 'scheduleExtraDrumMachineRepeats',
    'alignDrumMachineToTransport', 'scheduleDrumMachineVisualStep', 'scheduleDrumMachineHatStep',
    'scheduleDrumMachineRepeats', 'scheduleDrumMachine', 'scheduleBastardLoopLSingleVoice',
    'scheduleBastardLoopLVoice', 'scheduleBastardLoopLSteps', 'scheduleBastardLoopXSingleVoice',
    'scheduleBastardLoopXVoice', 'scheduleBastardLoopXSteps', 'restartAllTransport'
];

function sourceMetadata(html) {
    return {
        sha256: fingerprint(html),
        functionSha256: Object.fromEntries(invariantFunctions.map(name =>
            [name, fingerprint(latency.extractFunction(html, name))]))
    };
}

function collectSources(html) {
    const sourceSet = latency.collectSources(html, { raw: true });
    const extraNames = [...html.matchAll(/^        (?:async )?function (\w+)\(/gm)]
        .map(match => match[1])
        .filter(name => /(?:DrumMachine.*(?:Fx|Delay|Reverb)|DrumSend|Drum(?:Delay|Reverb))/.test(name));
    if (html.includes('function captureDrumSendFxState(')) {
        sourceSet.dedicatedFx = true;
        extraNames.push('normalizeFinalReverbRoomPreset', 'getBpmDelaySeconds', 'smoothGainParam', 'smoothEffectParam', 'getBufferPeak');
        extraNames.push(...[...html.matchAll(/^        (?:async )?function (\w+)\(/gm)]
            .map(match => match[1]).filter(name => /Final(?:Reverb)?Shimmer/.test(name)
                && !/(?:Enabled|Settings|Routing|Process)/.test(name)));
        for (const name of ['DRUM_SEND_FX_DEFAULTS', 'FINAL_REVERB_ROOM_PRESETS']) {
            const header = new RegExp(`^        const ${name} = \\{`, 'm').exec(html);
            if (!header) throw new Error(`Missing constant ${name}`);
            const ending = html.indexOf('\n        };', header.index);
            if (ending < 0) throw new Error(`Unclosed constant ${name}`);
            sourceSet.declarations.push(html.slice(header.index, ending + '\n        };'.length).trim().replace(/^const /, ''));
        }
        sourceSet.declarations.push('drumSendFxState = { delay: { ...DRUM_SEND_FX_DEFAULTS.delay }, reverb: { ...DRUM_SEND_FX_DEFAULTS.reverb } };',
            'drumSendFxGraph = null;', 'effectParamTargets = new WeakMap();');
        if (html.includes('function getDrumSendImpulseWorkerSource(')) {
            const builders = ['normalizeFinalReverbRoomPreset', 'createFinalRoomReverbImpulseForContext',
                'createFinalReverbImpulseForContext', 'getFinalReverbShimmerRatio', 'sampleFinalShimmerCubic',
                'sampleFinalShimmerWindowedSinc', 'resampleFinalShimmerChannel', 'timeStretchFinalShimmerChannel',
                'smoothFinalShimmerChannel', 'computeFinalShimmerEnvelope', 'matchFinalShimmerEnvelopeToSource',
                'createFinalReverbShimmerChannel', 'createFinalReverbShimmerImpulseForContext', 'getBufferPeak'];
            const presets = sourceSet.declarations.find(declaration => declaration.startsWith('FINAL_REVERB_ROOM_PRESETS ='));
            const workerSource = `const ${presets}\n${builders.filter(name => html.includes('function ' + name + '(')).map(name => latency.extractFunction(html, name)).join('\n')}\n`
                + `(${latency.extractFunction(html, 'drumSendImpulseWorkerMain')})();`;
            sourceSet.declarations.push(`drumSendImpulseWorkerSource = ${JSON.stringify(workerSource)};`);
        }
    }
    for (const name of extraNames) {
        if (sourceSet.names.includes(name)) continue;
        sourceSet.names.push(name);
        sourceSet.functions.push(latency.extractFunction(html, name));
    }
    sourceSet.baseFixtureFactory = latency.createFixture.toString();
    return sourceSet;
}

function createFixture(sourceSet, context, options = {}) {
    const baseFactory = new Function(`return (${sourceSet.baseFixtureFactory});`)();
    let created;
    const globals = {
        drumMachineEnabled: true, drumMachineReverbTailUntil: 0,
        getModulatedValue: name => name === 'volume' ? 100 : Number(created.controls.get(name)?.value || 0),
        getSliderPercent: name => Number(created.controls.get(name)?.value || 0) / 100,
        getLoopLayerSoloGain: () => 1, getFinalFxPlacementSwitchDuck: () => 1,
        setStatus() {}, saveState() {},
        ...(context.nodes ? { finalAmplifierNode: context.createGain() } : {}),
        ...options.globals
    };
    if (context.nodes) {
        const createBuffer = context.createBuffer.bind(context);
        context.createBuffer = (...args) => {
            const buffer = createBuffer(...args);
            buffer.copyToChannel = (values, channel, offset = 0) => buffer.getChannelData(channel).set(values, offset);
            return buffer;
        };
    }
    created = baseFactory(sourceSet, context, { ...options, globals });
    created.state.document.querySelectorAll ||= () => [];
    created.state.createFinalReverbShimmerImpulseForContext ||= () => null;
    return created;
}

function dryPaths(fixture, start) {
    const wetNodes = new Set(Object.entries(fixture.state)
        .filter(([name, node]) => node && /(?:delayNode|DelayShadowNode|reverbNode|ReverbPreDelay|WetGain|wetGain|(?:Drum|drumMachine).*(?:Wet|SendGain|SendLatency|LatencyNode))/.test(name))
        .map(([, node]) => node));
    function visit(node, visited) {
        if (!node || visited.has(node) || wetNodes.has(node)) return [];
        if (node === fixture.state.finalAmplifierNode) return [[node]];
        const nextVisited = new Set(visited).add(node);
        return (node.connections || []).flatMap(edge => visit(edge.destination, nextVisited)
            .map(chain => [node, ...chain]));
    }
    return visit(start, new Set());
}

function topology(fixture) {
    const names = new Map();
    for (const [name, value] of Object.entries(fixture.state)) {
        if (value && typeof value.connect === 'function' && !names.has(value)) names.set(value, name);
    }
    return Object.fromEntries(['drumMachineBusGainNode', 'drumMachineKickBypassGainNode', 'preFilterGainNode']
        .map(name => [name, dryPaths(fixture, fixture.state[name])
            .map(chain => chain.map(node => ({ name: names.get(node) || node.kind, kind: node.kind,
                ...(node.kind === 'Delay' ? { seconds: node.delayTime.value } : {}) }))) ]));
}

async function makeFixture(html, sampleRate = 48000, options = {}) {
    const context = options.context || latency.createFakeContext(sampleRate);
    const fixture = createFixture(collectSources(html), context, {
        ...options, compile: body => vm.runInNewContext(`(function(scope) { ${body} })`)
    });
    await fixture.functions.setupEffects();
    fixture.functions.rebuildFinalFxRouting();
    fixture.state.finalCompressorSidechainSource = options.sidechain || 'off';
    fixture.functions.ensureDrumMachineKickBypassBus();
    fixture.functions.updateDrumMachineMix();
    return fixture;
}

function createControlledImpulseFixture(sourceSet, options = {}) {
    const timers = new Map();
    const workers = [];
    const urls = new Set();
    let timerId = 0;
    let urlId = 0;
    class ControlledWorker {
        constructor(url) {
            this.url = url;
            this.terminated = false;
            workers.push(this);
        }
        postMessage(request) { this.request = request; }
        terminate() { this.terminated = true; }
        reply(type, overrides = {}) {
            this.onmessage({ data: { type, requestId: this.request.requestId,
                requestKey: this.request.requestKey, sampleRate: this.request.sampleRate, length: 32,
                channels: [new Float32Array(32).fill(.25), new Float32Array(32).fill(-.5)], ...overrides } });
        }
    }
    const context = latency.createFakeContext(options.sampleRate || 48000);
    context.state = 'running';
    const created = createFixture(sourceSet, context, { globals: {
        Worker: options.unavailable ? undefined : ControlledWorker,
        URL: {
            createObjectURL() { const url = `blob:controlled-${++urlId}`; urls.add(url); return url; },
            revokeObjectURL(url) { urls.delete(url); }
        },
        setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout(identifier) { timers.delete(identifier); },
        performance: { now: () => 0 }
    } });
    const graph = created.functions.createDrumSendFxGraph(context, context.destination);
    created.state.drumSendFxGraph = graph;
    const reverb = { enabled: true, amount: 65, send: 100, room: 'hall', size: 40, decay: 60 };
    const request = (changes = {}, shimmer = 'off') =>
        created.functions.requestDrumSendImpulseBuild(graph, { ...reverb, ...changes }, shimmer);
    const flush = delay => {
        for (const [identifier, timer] of [...timers]) {
            if (timer.delay !== delay) continue;
            timers.delete(identifier);
            timer.callback();
        }
    };
    return { ...created, graph, workers, timers, urls, request, flush };
}

module.exports = { baselinePath, sourcePath, expectedBaselineSha256, fingerprint, invariantFunctions,
    sourceMetadata, collectSources, dryPaths, topology, makeFixture,
    createControlledImpulseFixture,
    createFixture, createFakeContext: latency.createFakeContext,
    graphPaths: latency.graphPaths, extractFunction: latency.extractFunction };

if (require.main === module) {
    (async () => {
        const baseline = fs.readFileSync(baselinePath, 'utf8');
        if (fingerprint(baseline) !== expectedBaselineSha256) throw new Error('Unexpected baseline snapshot');
        const graphs = [];
        for (const sampleRate of [44100, 48000]) {
            for (const placement of ['pre', 'post']) {
                for (const direct of [false, true]) {
                    for (const sidechain of ['off', 'kick']) {
                        graphs.push({ sampleRate, placement, direct, sidechain,
                            dryTopology: topology(await makeFixture(baseline, sampleRate, { placement, direct, sidechain })) });
                    }
                }
            }
        }
        process.stdout.write(`${JSON.stringify({ capturedAt: new Date().toISOString(), baselinePath,
            ...sourceMetadata(baseline), graphs }, null, 2)}\n`);
    })().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
