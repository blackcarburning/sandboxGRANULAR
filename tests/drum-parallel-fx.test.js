const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./drum-parallel-fx-fixture.js');

const baseline = fs.readFileSync(fixture.baselinePath, 'utf8');
const html = fs.readFileSync(fixture.sourcePath, 'utf8');

function createStateFixture(options = {}, extraNames = []) {
    const sourceSet = fixture.collectSources(html);
    for (const name of extraNames) {
        sourceSet.names.push(name);
        sourceSet.functions.push(fixture.extractFunction(html, name));
    }
    return fixture.createFixture(sourceSet, fixture.createFakeContext(48000),
        { globals: { audioContext: null, ...options } });
}

function controlMarkup(id) {
    const match = new RegExp(`<(input|select|button)\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html);
    assert.ok(match, `Missing control ${id}`);
    return { tag: match[1], attributes: match[0], index: match.index };
}

function createBranchFixture(options = {}) {
    const context = fixture.createFakeContext(options.sampleRate || 48000);
    const events = [];
    for (const method of Object.keys(context).filter(name => name.startsWith('create') && name !== 'createBuffer')) {
        const original = context[method].bind(context);
        context[method] = (...args) => {
            const node = original(...args);
            for (const operation of ['connect', 'disconnect', 'start', 'stop']) {
                const perform = node[operation].bind(node);
                node[operation] = (...parameters) => {
                    events.push({ node, operation, parameters });
                    return perform(...parameters);
                };
            }
            for (const [name, parameter] of Object.entries(node)) {
                if (!parameter || typeof parameter.setValueAtTime !== 'function') continue;
                for (const operation of ['cancelScheduledValues', 'setValueAtTime', 'linearRampToValueAtTime']) {
                    const perform = parameter[operation].bind(parameter);
                    parameter[operation] = (...parameters) => {
                        events.push({ node, parameter: name, operation, parameters });
                        return perform(...parameters);
                    };
                }
            }
            return node;
        };
    }
    const created = fixture.createFixture(fixture.collectSources(html), context, { direct: options.direct,
        globals: { retiredTransportVoices: new Set(), retiredTransportGraphs: new Set() } });
    Object.assign(created.state, {
        preFilterGainNode: context.createGain(), finalKickBypassMasterGain: context.createGain(),
        finalKickBypassPanner: context.createStereoPanner(), finalAmplifierNode: context.createGain(),
        finalReverbEnabled: false, finalReverbNode: context.createConvolver(),
        finalDelayNode: context.createDelay(), finalReverbWetGain: context.createGain(),
        finalDelayWetGain: context.createGain()
    });
    created.functions.ensureDrumMachineBus();
    created.functions.ensureDrumMachineKickBypassBus();
    created.events = events;
    return created;
}

test('dedicated drum FX baseline is the exact post-sync/post-K-mute source', () => {
    assert.equal(fixture.fingerprint(baseline), fixture.expectedBaselineSha256);
});

for (const name of fixture.invariantFunctions) {
    test(`dedicated FX leave dry/sidechain/scheduler function ${name} unchanged`, () => {
        assert.equal(fixture.extractFunction(html, name), fixture.extractFunction(baseline, name));
    });
}

for (const direct of [false, true]) {
    for (const placement of ['pre', 'post']) {
        test(`dry graph adds no serial processors: Direct Out ${direct}, FX ${placement}`, async () => {
            const options = { direct, placement, sidechain: 'kick' };
            const before = await fixture.makeFixture(baseline, 48000, options);
            const after = await fixture.makeFixture(html, 48000, options);
            assert.deepEqual(fixture.topology(after), fixture.topology(before));
            const ordinary = fixture.dryPaths(after, after.state.drumMachineBusGainNode);
            const kick = fixture.dryPaths(after, after.state.drumMachineKickBypassGainNode);
            assert.ok(ordinary.length > 0);
            assert.equal(kick.length, 1);
            assert.deepEqual(kick[0].map(node => node.kind), ['Gain', 'Gain', 'Delay', 'StereoPanner', 'Gain']);
            assert.equal(kick[0].filter(node => node.kind === 'Delay').length, 1);
            if (direct) assert.ok(ordinary.every(chain => chain.filter(node => node.kind === 'Delay').length === 1));
            else assert.ok(ordinary.some(chain => chain.filter(node => node.kind === 'WaveShaper').length === 5));
        });
    }
}

test('dedicated controls expose every independent state field and retain main parameter parity', () => {
    const created = createStateFixture();
    for (const [kind, defaults] of Object.entries(created.state.DRUM_SEND_FX_DEFAULTS)) {
        const represented = [...html.matchAll(/<(?:input|select|button)\b[^>]*data-drum-send="(delay|reverb)"[^>]*data-param="([^"]+)"[^>]*>/g)]
            .filter(match => match[1] === kind).map(match => match[2]);
        assert.deepEqual(represented.sort(), Object.keys(defaults).sort());
    }
    const pairs = [['drumSendDelayAmount', 'finalDelayDepth'], ['drumSendDelayFeedback', 'finalDelayFeedback'],
        ['drumSendReverbSize', 'finalReverbSize'], ['drumSendReverbDecay', 'finalReverbDecay'],
        ['drumSendReverbTone', 'finalReverbLowpass'], ['drumSendReverbAmount', 'finalReverbMix'],
        ['drumSendReverbShimmerMix', 'finalReverbShimmerMix']];
    for (const [dedicated, main] of pairs) {
        for (const name of ['min', 'max']) {
            const attribute = new RegExp(`\\b${name}="([^"]+)"`);
            assert.equal(attribute.exec(controlMarkup(dedicated).attributes)?.[1], attribute.exec(controlMarkup(main).attributes)?.[1]);
        }
    }
    for (const [dedicated, main] of [['drumSendDelayDivision', 'finalDelayDivision'],
        ['drumSendDelayTailMode', 'finalDelayTailMode'], ['drumSendReverbRoom', 'finalReverbRoomPreset'],
        ['drumSendReverbShimmerShift', 'finalReverbShimmerShift']]) {
        const optionValues = id => {
            const start = controlMarkup(id).index;
            return [...html.slice(start, html.indexOf('</select>', start)).matchAll(/<option\b[^>]*value="([^"]*)"/g)].map(match => match[1]);
        };
        assert.deepEqual(optionValues(dedicated), optionValues(main));
    }
    controlMarkup('drumSendResetTailsBtn');
    assert.doesNotMatch(html, /id="finalReverbDrumSend"/);
});

test('legacy send buttons are removed; VideoLab jump opens and targets its card', () => {
    for (const id of ['performanceDrumMachineDirectDelayBtn', 'performanceDrumMachineDirectReverbBtn',
        'drumMachineDirectDelayBtn', 'drumMachineDirectReverbBtn']) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    assert.match(controlMarkup('performanceVideoLabJumpBtn').attributes, /data-jump-target="#performanceVideoLabCard"/);
    assert.match(html, /if \(button\.dataset\.jumpTarget === '#performanceVideoLabCard'\) window\.mygrainVideolab\?\.open\(\)/);
});

test('absent state migrates legacy room timing; explicit missing/partial fields use independent defaults', () => {
    const { state, functions } = createStateFixture();
    const defaults = state.DRUM_SEND_FX_DEFAULTS;
    const migrated = functions.normalizeDrumSendFxState(undefined);
    assert.deepEqual(migrated, { delay: { ...defaults.delay }, reverb: { ...defaults.reverb,
        predelay: Math.round(state.FINAL_REVERB_ROOM_PRESETS.cloud.predelay * 1000) } });
    assert.deepEqual(state.drumSendFxState, defaults);
    assert.deepEqual(functions.normalizeDrumSendFxState({}), defaults);
    const partial = functions.normalizeDrumSendFxState({ delay: { enabled: true, amount: 0 } });
    assert.equal(partial.delay.amount, 0);
    assert.equal(partial.delay.enabled, true);
    assert.deepEqual(partial.reverb, defaults.reverb);
});

test('captured state round-trips every parameter without aliases, main-FX mutations, or writes', () => {
    let saves = 0;
    const { state, functions } = createStateFixture({ saveState() { saves += 1; } });
    state.finalReverbEnabled = false;
    const imported = { delay: { enabled: true, amount: 61, send: 160, timeMode: 'free', division: '2d', time: 311,
        feedback: 74, tone: 7900, tailMode: 'clean' }, reverb: { enabled: true, amount: 44, send: 181,
        room: 'hall', size: 76, decay: 81, predelay: 91, tone: 5100, shimmerEnabled: true, shimmerShift: '-12', shimmerMix: 27 } };
    const original = JSON.stringify(imported);
    functions.loadDrumSendFxState(imported);
    const exported = functions.captureDrumSendFxState();
    assert.deepEqual(exported, { version: 1, ...imported });
    assert.equal(JSON.stringify(imported), original);
    assert.equal(state.finalReverbEnabled, false);
    assert.equal(state.drumMachineDirectDelaySendEnabled, true);
    assert.equal(state.drumMachineDirectReverbSendEnabled, true);
    exported.delay.amount = 1;
    imported.reverb.amount = 2;
    assert.equal(state.drumSendFxState.delay.amount, 61);
    assert.equal(state.drumSendFxState.reverb.amount, 44);
    assert.equal(saves, 0);
});

test('legacy flat presets and saved modes migrate without losing explicit disabled or zero parameters', () => {
    const { functions } = createStateFixture();
    const sliders = { finalDelayDepth: 42, finalDelayFeedback: 0, finalReverbMix: 51,
        finalReverbDrumSend: 0, finalReverbSize: 0, finalReverbDecay: 0, finalReverbLowpass: 3000, finalReverbShimmerMix: 23 };
    const selects = { finalDelayDivision: '2t', finalDelayTailMode: 'clean', finalReverbRoomPreset: 'smallRoom', finalReverbShimmerShift: '12' };
    const modes = { drumMachineDirectDelaySendEnabled: true, drumMachineDirectReverbSendEnabled: false, finalReverbShimmerEnabled: true };
    const migrated = functions.normalizeDrumSendFxState(undefined, { sliders, selects, modes });
    assert.equal(migrated.delay.enabled, true);
    assert.equal(migrated.delay.amount, 42);
    assert.equal(migrated.delay.feedback, 0);
    assert.equal(migrated.delay.division, '2t');
    assert.equal(migrated.reverb.enabled, false);
    assert.equal(migrated.reverb.send, 0);
    assert.equal(migrated.reverb.size, 0);
    assert.equal(migrated.reverb.decay, 0);
    assert.equal(migrated.reverb.predelay, 6);
    assert.deepEqual(functions.normalizeDrumSendFxState(undefined, { sliders, ...selects, ...modes }), migrated);
});

test('invalid imported values are bounded and unsupported fields/enums cannot enter captured state', () => {
    const { functions } = createStateFixture();
    const normalized = functions.normalizeDrumSendFxState({ delay: { amount: Infinity, send: -99, time: 9000,
        feedback: 300, tone: -1, timeMode: 'evil', division: 'evil', tailMode: 'evil', enabled: 'true', injected: true },
    reverb: { amount: -1, send: 900, size: NaN, decay: -1, predelay: 999, tone: 99999,
        shimmerEnabled: 'false', shimmerShift: '99', shimmerMix: 999, room: 'evil' } });
    assert.deepEqual(normalized.delay, { enabled: false, amount: 30, send: 0, timeMode: 'sync', division: '4', time: 2500, feedback: 100, tone: 700, tailMode: 'filtered' });
    assert.deepEqual(normalized.reverb, { enabled: false, amount: 0, send: 200, room: 'cloud', size: 45,
        decay: 0, predelay: 180, tone: 12000, shimmerEnabled: false, shimmerShift: 'off', shimmerMix: 100 });
});

test('preset and local-state capture/restore paths call the dedicated serialization API', () => {
    for (const name of ['gatherPreset', 'saveState', 'captureStemExportState']) assert.match(fixture.extractFunction(html, name), /drumSendFx:\s*captureDrumSendFxState\(\)/);
    for (const name of ['applyPreset', 'restoreState', 'restoreStemExportState']) assert.match(fixture.extractFunction(html, name), /loadDrumSendFxState\(/);
});

for (const direct of [false, true]) {
    test(`effect controls mutate only wet branches with no duplicate taps, Direct Out ${direct}`, () => {
        const created = createBranchFixture({ direct });
        const { state, functions, events } = created;
        const protectedNodes = new Set([state.drumMachineBusGainNode, state.drumMachineKickBypassGainNode,
            state.finalKickBypassMasterGain, state.finalKickBypassPanner, state.preFilterGainNode,
            state.finalAmplifierNode, state.finalDelayNode, state.finalReverbNode]);
        const dryDestinations = [state.drumMachineBusGainNode.connectedTo, state.drumMachineKickBypassGainNode.connectedTo];
        events.length = 0;
        for (let repeat = 0; repeat < 4; repeat += 1) {
            functions.setDrumMachineDirectDelaySend(repeat % 2 === 0, { silent: true, skipSave: true });
            functions.setDrumMachineDirectReverbSend(repeat % 2 === 1, { silent: true, skipSave: true });
            state.drumSendFxState.delay.time = 180 + repeat * 20;
            state.drumSendFxState.reverb.predelay = 40 + repeat;
            functions.updateDrumSendEffects();
        }
        assert.equal(events.filter(event => protectedNodes.has(event.node)).length, 0, 'Even dry AudioParam automation remains untouched');
        assert.deepEqual([state.drumMachineBusGainNode.connectedTo, state.drumMachineKickBypassGainNode.connectedTo], dryDestinations);
        assert.equal(state.finalReverbEnabled, false);
        for (const bus of [state.drumMachineBusGainNode, state.drumMachineKickBypassGainNode]) {
            for (const tap of [state.drumMachineDirectDelayLatencyNode, state.drumMachineDirectReverbLatencyNode]) {
                assert.equal(bus.connections.filter(edge => edge.destination === tap).length, 1);
            }
        }
        assert.deepEqual(state.drumMachineDirectDelaySendGainNode.connections.map(edge => edge.destination), [state.drumSendFxGraph.delayInput]);
        assert.deepEqual(state.drumMachineDirectReverbSendGainNode.connections.map(edge => edge.destination), [state.drumSendFxGraph.reverbInput]);
        for (const input of [state.drumSendFxGraph.delayInput, state.drumSendFxGraph.reverbInput]) {
            assert.equal(fixture.graphPaths(input, state.drumSendFxGraph.returnTrim).some(chain => !chain.some(node => ['Delay', 'Convolver'].includes(node.kind))), false);
        }
    });
}

test('clearing and rebuilding wet tails disposes old graphs without touching dry buses', () => {
    const created = createBranchFixture();
    const { state, functions, events } = created;
    functions.setDrumMachineDirectDelaySend(true, { silent: true, skipSave: true });
    functions.setDrumMachineDirectReverbSend(true, { silent: true, skipSave: true });
    const oldGraph = state.drumSendFxGraph;
    state.drumMachineReverbTailUntil = 12;
    events.length = 0;
    functions.disposeDrumSendFxGraph();
    functions.updateDrumSendEffects();
    assert.notEqual(state.drumSendFxGraph, oldGraph);
    assert.ok(oldGraph.nodes.every(node => node.connections.length === 0));
    assert.equal(oldGraph.reverb.buffer, null);
    assert.equal(oldGraph.shimmer.buffer, null);
    assert.equal(state.drumMachineReverbTailUntil, 0);
    assert.equal(events.filter(event => [state.drumMachineBusGainNode, state.drumMachineKickBypassGainNode].includes(event.node)).length, 0);
    assert.equal(state.drumMachineDirectDelaySendGainNode.connections.length, 1);
    assert.equal(state.drumMachineDirectReverbSendGainNode.connections.length, 1);
});

test('transport reset drops old-context wet graph and creates only current-context taps', () => {
    const created = createBranchFixture();
    const { state, functions } = created;
    functions.setDrumMachineDirectDelaySend(true, { silent: true, skipSave: true });
    const oldGraph = state.drumSendFxGraph;
    const oldBuses = [state.drumMachineBusGainNode, state.drumMachineKickBypassGainNode];
    functions.resetTransportSynchronization();
    assert.equal(state.drumSendFxGraph, null);
    assert.ok(oldGraph.nodes.every(node => node.connections.length === 0));
    assert.ok(oldBuses.every(node => node.connections.length === 0));
    const nextContext = fixture.createFakeContext(44100);
    state.audioContext = nextContext;
    state.preFilterGainNode = nextContext.createGain();
    state.finalKickBypassMasterGain = nextContext.createGain();
    state.finalKickBypassPanner = nextContext.createStereoPanner();
    state.finalAmplifierNode = nextContext.createGain();
    functions.ensureDrumMachineBus();
    functions.ensureDrumMachineKickBypassBus();
    functions.updateDrumSendEffects();
    assert.equal(state.drumSendFxGraph.context, nextContext);
    assert.ok(state.drumSendFxGraph.nodes.every(node => node.context === nextContext));
    assert.ok(state.drumMachineBusGainNode.connections.every(edge => edge.destination.context === nextContext));
});

test('offline final bus exposes separate wet-only drum ports without injecting into its main serial chain', () => {
    const created = createStateFixture({ fxMuted: false, finalReverbEnabled: false,
        getFinalCompressorAmount: () => 0,
        getFinalCompressorSettings: () => ({ drive: 1, threshold: 0, knee: 0, ratio: 1, attack: .003, release: .1 }),
        getFinalReverbShimmerSettings: () => ({ mode: 'off', drive: 0, highpass: 20, lowpass: 12000, delay: .012, gain: 0 }),
        shouldProcessFinalReverbShimmer: () => false, getFinalReverbRoomPreset: () => 'cloud'
    }, ['createOfflineFinalFxBus']);
    const { state, functions } = created;
    state.document.getElementById('volume').value = '100';
    state.transportSync.latency = { status: 'measured', seconds: .026 };
    functions.loadDrumSendFxState({ delay: { enabled: true, amount: 70 }, reverb: { enabled: true, amount: 45 } });
    const before = functions.captureDrumSendFxState();
    const offline = fixture.createFakeContext(48000);
    offline.length = 19200;
    const input = functions.createOfflineFinalFxBus(offline, offline.destination, 120);
    assert.equal(input.drumDelaySendInput, input.drumSendFxGraph.delayInput);
    assert.equal(input.drumReverbSendInput, input.drumSendFxGraph.reverbInput);
    assert.deepEqual(input.drumSendFxGraph.returnLatency.connections.map(edge => edge.destination), [input.drumSendFxGraph.returnPanner]);
    assert.deepEqual(input.drumSendFxGraph.returnPanner.connections.map(edge => edge.destination), [offline.destination]);
    assert.equal(input.drumSendFxGraph.returnLatency.delayTime.value, .026);
    assert.equal(input.drumSendFxGraph.returnTrim.gain.value, 1);
    assert.equal(fixture.graphPaths(input, input.drumDelaySendInput).length, 0);
    assert.equal(fixture.graphPaths(input, input.drumReverbSendInput).length, 0);
    for (const port of [input.drumDelaySendInput, input.drumReverbSendInput]) {
        assert.equal(fixture.graphPaths(port, input).length, 0);
        assert.ok(fixture.graphPaths(port, offline.destination).length > 0);
    }
    assert.deepEqual(functions.captureDrumSendFxState(), before);
});

test('dedicated wet return owns its panner and never feeds the existing dry panner', () => {
    const { state } = createBranchFixture();
    const graph = state.drumSendFxGraph;
    assert.notEqual(graph.returnPanner, state.finalKickBypassPanner);
    assert.deepEqual(graph.returnLatency.connections.map(edge => edge.destination), [graph.returnPanner]);
    assert.deepEqual(graph.returnPanner.connections.map(edge => edge.destination), [state.finalAmplifierNode]);
    for (const node of graph.nodes) {
        assert.equal(node.connections.some(edge => edge.destination === state.finalKickBypassPanner), false);
    }
});

for (const sampleRate of [44100, 48000]) {
    test(`controlled protocol coalesces latest room and cleans all worker resources at ${sampleRate}Hz`, async () => {
        const created = fixture.createControlledImpulseFixture(fixture.collectSources(html), { sampleRate });
        const abandoned = [];
        for (let decay = 10; decay <= 90; decay += 10) {
            created.request({ decay }, '12');
            abandoned.push(created.graph.impulseReady);
        }
        assert.deepEqual(await Promise.all(abandoned.slice(0, -1)), Array(8).fill(false));
        assert.equal(created.timers.size, 1);
        assert.equal(created.workers.length, 0);
        created.flush(100);
        assert.equal(created.workers.length, 1);
        const worker = created.workers[0];
        assert.equal(worker.request.sampleRate, sampleRate);
        assert.equal(worker.request.decay, 90);
        worker.reply('base');
        worker.reply('shimmer');
        worker.reply('done');
        assert.equal(await created.functions.waitForDrumSendImpulse(created.graph), true);
        assert.equal(created.graph.impulseKey, 'hall:40:90:12');
        assert.equal(created.graph.reverb.buffer.sampleRate, sampleRate);
        assert.equal(created.graph.shimmer.buffer.sampleRate, sampleRate);
        assert.ok(worker.terminated);
        assert.equal(created.urls.size, 0);
        assert.equal(created.timers.size, 0);
    });
}

for (const invalid of ['sample-rate', 'channel-count', 'length', 'typed-pcm']) {
    test(`controlled protocol rejects ${invalid} payload without installing a false-ready room`, async () => {
        const created = fixture.createControlledImpulseFixture(fixture.collectSources(html));
        const prior = created.context.createBuffer(2, 16, created.context.sampleRate);
        created.graph.reverb.buffer = prior;
        created.request();
        created.flush(100);
        const worker = created.workers[0];
        const overrides = invalid === 'sample-rate' ? { sampleRate: 44100 }
            : invalid === 'channel-count' ? { channels: [new Float32Array(32)] }
            : invalid === 'length' ? { length: 31 }
            : { channels: [Array(32).fill(.25), Array(32).fill(.5)] };
        worker.reply('base', overrides);
        worker.reply('done');
        assert.equal(await created.functions.waitForDrumSendImpulse(created.graph), false);
        assert.equal(created.graph.impulseStatus, 'error');
        assert.equal(created.graph.reverb.buffer, prior);
        assert.ok(worker.terminated);
        assert.equal(created.urls.size, 0);
        assert.equal(created.timers.size, 0);
    });
}

test('controlled protocol can retry a failed room without stale errors cancelling its replacement', async () => {
    const created = fixture.createControlledImpulseFixture(fixture.collectSources(html));
    created.request();
    created.flush(100);
    const failed = created.workers[0];
    failed.onerror({ message: 'Controlled worker failure', preventDefault() {} });
    assert.equal(await created.functions.waitForDrumSendImpulse(created.graph), false);
    created.functions.cancelDrumSendImpulseBuild(created.graph);
    created.request();
    created.flush(100);
    const retry = created.workers[1];
    failed.reply('error', { error: 'Late obsolete failure' });
    retry.reply('base');
    retry.reply('done');
    assert.equal(await created.functions.waitForDrumSendImpulse(created.graph), true);
    assert.equal(created.graph.impulseError, '');
    assert.equal(created.urls.size, 0);
    assert.equal(created.timers.size, 0);
});

test('controlled protocol disposal settles pending readiness and cannot resurrect wet nodes', async () => {
    const created = fixture.createControlledImpulseFixture(fixture.collectSources(html));
    created.request({}, '12');
    created.flush(100);
    const ready = created.functions.waitForDrumSendImpulse(created.graph);
    const worker = created.workers[0];
    created.functions.disposeDrumSendFxGraph();
    worker.reply('base');
    worker.reply('shimmer');
    worker.reply('done');
    assert.equal(await ready, false);
    assert.equal(created.state.drumSendFxGraph, null);
    assert.equal(created.graph.reverb.buffer, null);
    assert.equal(created.graph.shimmer.buffer, null);
    assert.ok(created.graph.nodes.every(node => node.connections.length === 0));
    assert.equal(created.urls.size, 0);
    assert.equal(created.timers.size, 0);
});

module.exports = { createStateFixture, createBranchFixture };
