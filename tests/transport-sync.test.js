const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
    const match = new RegExp(`^        (?:async )?function ${name}\\(`, 'm').exec(html);
    assert.ok(match, `Missing ${name}`);
    const end = html.indexOf('\n        }', match.index);
    assert.ok(end > match.index, `Unclosed ${name}`);
    return html.slice(match.index, end + '\n        }'.length);
}

function load(context, names) {
    for (const name of names) vm.runInContext(functionSource(name), context);
    return context;
}

function parameter(value = 0) {
    return {
        value, events: [],
        setValueAtTime(next, time) { this.value = next; this.events.push(['set', next, time]); },
        linearRampToValueAtTime(next, time) { this.events.push(['ramp', next, time]); },
        cancelScheduledValues(time) { this.events.push(['cancel', time]); },
        cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
    };
}

function audioNode(kind = 'gain') {
    return {
        kind, connections: [], gain: parameter(1), delayTime: parameter(), playbackRate: parameter(1),
        connect(destination) { this.connections.push(destination); return destination; },
        disconnect(destination) { this.connections = destination ? this.connections.filter(node => node !== destination) : []; },
        start(...args) { this.started = args; }, stop(...args) { this.stopped = args; }
    };
}

function audioContext(sampleRate = 48000) {
    const nodes = [];
    const create = kind => { const node = audioNode(kind); nodes.push(node); return node; };
    return {
        currentTime: 10.005, sampleRate, state: 'running', nodes,
        createGain: () => create('gain'), createBufferSource: () => create('source'),
        createDelay: () => create('delay')
    };
}

function fixture(extra = {}) {
    const timers = new Map();
    const elements = new Map();
    let nextTimer = 1;
    const element = name => {
        if (!elements.has(name)) elements.set(name, { value: '120', handlers: {}, classList: { add() {}, remove() {} },
            addEventListener(event, callback) { this.handlers[event] = callback; } });
        return elements.get(name);
    };
    const context = {
        console, Math, Number, Float32Array, Promise, Map, Set,
        audioContext: audioContext(), transportSync: { context: null, origin: null, bpm: 120, revision: 0,
            depth: 0, startTime: null, lanes: {}, latency: { status: 'pending', seconds: 0, frames: 0 } },
        TRANSPORT_START_BUFFER_SECONDS: .3, SCHEDULE_AHEAD_TIME: .35,
        sequencerBPM: 120, sequencerPlaying: false, sequencerTimerId: null, sequencerCurrentStep: 0,
        sequencerNextStepTime: null, transportLoopStartTime: null, generatedDryLoopStartTime: null,
        generatedDrySource: null, generatedDryGainNode: null, generatedLoopBuffer: null,
        generatedLoopTransportEnabled: true, isOutputRecordingArmed: false,
        bastardLoopPlaying: false, bastardLoopTransportStartTime: null,
        drumMachinePlaying: false, drumMachineTransportStartTime: null,
        keyboardArpTransportPlaying: false, arpEnabled: false, holdEnabled: true,
        keyboardPlaybackAuthorized: true, activeKeyCount: 1, heldNotes: new Set(['C3']),
        arpStepIndex: 3, arpDirection: 1, arpLastRandomIndex: 2,
        audioSchedulingStats: { lateTicks: 0, skippedSteps: 0, maxLatenessMs: 0 },
        document: { getElementById: element, querySelectorAll: () => [] }, elements, timers,
        prewarmTransportBuffers() {}, ensureSharedRhythmClockRunning() {},
        hasSharedRhythmClockWork: () => context.drumMachinePlaying || context.bastardLoopLTransportActive || context.bastardLoopXTransportActive,
        scheduleSequencer() {}, scheduleDrumMachine() {}, scheduleBastardLoopLSteps() {}, scheduleBastardLoopXSteps() {},
        scheduleActiveGrains() {}, prepareChordTransportHandoff() {}, finalSidechainKickEvents: [],
        updateTransportSendLatency() {}, stopRetiredTransportVoices() {}, disposeDrumSendFxGraph() {},
        activeOscVoices: new Map(), retiringOscillatorVoices: new Set(), scheduledGrainVoices: new Set(),
        activeGrains: new Map(), stopGrainScheduler() {},
        drumMachineDirectDelayLatencyNode: null, drumMachineDirectReverbLatencyNode: null, finalFxPlacement: 'post',
        drumMachineDirectDelaySendGainNode: null, drumMachineDirectReverbSendGainNode: null,
        drumMachineBusGainNode: null, drumMachineKickBypassGainNode: null,
        startGeneratedDryLoop() {}, isAudioGraphReady: () => true,
        getPatternLengthSteps: () => 16, normalizeSequencerSteps: value => value,
        syncPerformanceControlState() {}, setStatus() {}, saveState() {},
        setAudioStatus() {}, clearSharedRhythmClockTimer() {},
        getDrumMachineStepDuration() { return 60 / context.sequencerBPM / 4; },
        getDrumMachinePatternLength: () => 16, drumMachineExtraTracks: {},
        stopScheduledGrainVoices() {}, cancelScheduledTransportOscillators() {},
        stopKeyboardSounds() { throw new Error('Tempo must not stop held keys'); },
        isArpeggiatorPlaying: () => false, stopArpeggiatorPlayback() {},
        ensureBastardLoopXFilterLfoSource() {}, updateBastardLoopXDelayBusSettings() {},
        updateBastardLoopLDelayBusSettings() {}, updateBastardLoopMFxBusSettings() {}, updateBastardLoopMPlusFxBusSettings() {},
        startArpeggiatorPlayback() {}, startHeldKeyboardPlayback() {},
        setTimeout(callback, delay) { const identifier = nextTimer++; timers.set(identifier, { callback, delay }); return identifier; },
        clearTimeout(identifier) { timers.delete(identifier); },
        window: {},
        ...extra
    };
    context.window.setTimeout = context.setTimeout;
    for (const suffix of ['', '2', '3', 'V', 'P', 'O', 'M', 'MPlus', 'K']) {
        for (const property of ['Source', 'Buffer']) context[`bastardLoop${suffix}${property}`] ??= null;
        for (const action of ['start', 'stop']) context[`${action}BastardLoop${suffix}`] ??= () => {};
    }
    context.dropboxSampleLayerSource ??= null;
    context.startDropboxSampleLayer ??= () => {};
    context.stopDropboxSampleLayer ??= () => {};
    for (const layer of ['L', 'X']) {
        const prefix = `bastardLoop${layer}`;
        context[`${prefix}SampleBuffer`] = {};
        context[`${prefix}TransportActive`] ??= false;
        context[`${prefix}NextStepTime`] ??= null;
        context[`${prefix}NextStepIndex`] ??= 0;
        context[`${prefix}SlideCarryIndex`] ??= -1;
        context[`getBastardLoop${layer}PlaybackDestination`] = () => ({});
        context[`getBastardLoop${layer}LevelValue`] = () => 1;
        context[`getBastardLoop${layer}PatternLength`] = () => 16;
        context[`getBastardLoop${layer}StepDurationSeconds`] = () => 60 / context.sequencerBPM / 4;
        context[`getBastardLoop${layer}Step`] = () => ({ note: 'C3', rest: false });
        context[`isBastardLoop${layer}Running`] = () => context[`${prefix}TransportActive`];
        context[`stopBastardLoop${layer}`] = () => { context[`${prefix}TransportActive`] = false; };
        context[`syncBastardLoop${layer}Ui`] = () => {};
        context[`syncBastardLoop${layer}EditorUi`] = () => {};
        context[`scheduleBastardLoop${layer}Voice`] = () => {};
    }
    context.isBastardLoopLUsingSynth = () => false;
    context.isBastardLoopXUsingSynth = () => false;
    context.hasBastardLoopXPlaybackSource = () => Boolean(context.bastardLoopXSampleBuffer);
    context.hasPlayableBastardLoopXTransportSource = () => false;
    context.stopOscillatorsByRole ??= () => {};
    vm.createContext(context);
    return load(context, ['getSharedLoopTransportOriginTime', 'getTransportLoopOriginTime', 'getTransportGridPosition',
        'setTransportEpoch', 'resolveTransportLaneStart', 'withBufferedTransportStart', 'getBufferedTransportStartTime',
        'getTransportPreparationLeadSeconds', 'startTransportSource', 'startTransportChordLayer', 'cancelPreparedTransportStarts',
        'countMissedAudioSteps', 'getTransportOutputLatencySeconds', 'getTransportClockBpm', 'getTransportScheduleHorizon', 'scheduleTransportSourceStop', 'startBastardLoopL', 'startBastardLoopX']);
}

function near(actual, expected, tolerance = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

for (const layer of ['L', 'X']) {
    for (const lateness of [.005, .009]) {
        test(`${layer}: ${lateness * 1000}ms late join retains the epoch across 35 notes`, () => {
            const context = fixture({ drumMachinePlaying: true, drumMachineTransportStartTime: 8 });
            context.audioContext.currentTime = 10 + lateness;
            const times = [];
            context[`scheduleBastardLoop${layer}Voice`] = (step, time) => times.push(time);
            load(context, [`scheduleBastardLoop${layer}Steps`]);
            context[`startBastardLoop${layer}`]();
            assert.ok(context[`bastardLoop${layer}NextStepTime`] >= context.audioContext.currentTime + .3);
            const origin = context.getSharedLoopTransportOriginTime();
            for (let tick = 0; times.length < 35 && tick < 300; tick += 1) {
                context[`scheduleBastardLoop${layer}Steps`]();
                context.audioContext.currentTime += .03;
            }
            assert.ok(times.length >= 35);
            for (const time of times) near((time - origin) / .125, Math.round((time - origin) / .125));
            near(origin, 8);
            near(context.getSharedLoopTransportOriginTime(), 8);
        });
    }
}

test('joining the generated sequencer cannot replace the active drum/Bastard epoch', () => {
    const context = fixture({ drumMachinePlaying: true, drumMachineTransportStartTime: .976,
        bastardLoopPlaying: true, bastardLoopTransportStartTime: .976 });
    load(context, ['startSequencer']);
    assert.equal(context.startSequencer(), true);
    near(context.getSharedLoopTransportOriginTime(), .976);
    near(context.transportLoopStartTime, .976);
    near(context.drumMachineTransportStartTime, .976);
    near((context.sequencerNextStepTime - .976) / .125, Math.round((context.sequencerNextStepTime - .976) / .125));
    assert.ok(context.sequencerNextStepTime - context.audioContext.currentTime >= .3);
});

test('preparation precedes T0 and a transaction suppresses independent startup ticks', () => {
    const context = fixture();
    let preparations = 0;
    const ticks = [];
    context.prewarmTransportBuffers = () => { preparations += 1; if (context.transportSync.depth === 0) context.audioContext.currentTime += .18; };
    context.ensureSharedRhythmClockRunning = () => ticks.push(context.transportSync.depth);
    const deadline = context.getBufferedTransportStartTime();
    near(deadline - context.audioContext.currentTime, .3);
    context.prewarmTransportBuffers = () => { preparations += 1; };
    load(context, ['ensureSharedRhythmClockRunning']);
    context.runSharedRhythmClock = () => ticks.push(context.transportSync.depth);
    context.withBufferedTransportStart(deadline, planned => {
        near(planned, deadline);
        context.audioContext.currentTime += .015;
        context.startBastardLoopL(planned);
        context.startBastardLoopX(planned);
        near(context.bastardLoopLNextStepTime, deadline);
        near(context.bastardLoopXNextStepTime, deadline);
        assert.deepEqual(ticks, []);
        near(context.getBufferedTransportStartTime(), deadline);
    }, { reset: true });
    assert.deepEqual(ticks, [0]);
    assert.ok(preparations >= 2);
    assert.equal(context.transportSync.depth, 0);
});

test('an expired explicit capture deadline rejects instead of moving one instrument', () => {
    const context = fixture();
    context.prewarmTransportBuffers = () => { context.audioContext.currentTime += .4; };
    let started = false;
    const deadline = context.audioContext.currentTime + .3;
    assert.throws(() => context.withBufferedTransportStart(deadline, () => { started = true; }), /deadline expired/);
    assert.equal(started, false);
});

test('a sample-quantized capture deadline reuses preparation and remains exact across the whole startup chain', () => {
    const context = fixture();
    let preparations = 0;
    context.prewarmTransportBuffers = () => {
        if (context.transportSync.depth > 0) return;
        preparations += 1;
        context.audioContext.currentTime += .23;
    };
    const planned = context.getBufferedTransportStartTime();
    const sourceTime = Math.round(planned * context.audioContext.sampleRate) / context.audioContext.sampleRate;
    context.withBufferedTransportStart(sourceTime, deadline => {
        assert.equal(deadline, sourceTime);
        assert.equal(context.getBufferedTransportStartTime(), sourceTime);
        context.withBufferedTransportStart(null, nested => assert.equal(nested, sourceTime));
        const lane = context.resolveTransportLaneStart(sourceTime, 'sequencer', .125, 16);
        assert.equal(lane.time, sourceTime);
        assert.equal(lane.origin, sourceTime);
    }, { reset: true });
    assert.equal(preparations, 1);
    assert.equal(context.transportSync.startTime, sourceTime);
    assert.throws(() => context.withBufferedTransportStart(sourceTime, () => {
        context.audioContext.currentTime = sourceTime - .01;
        assert.throws(() => context.resolveTransportLaneStart(sourceTime, 'X', .125, 16), /deadline expired/);
    }, { reset: true }), /deadline expired/);
});

test('the real buffer/FX prewarmer completes before reserving cold-start headroom', () => {
    const context = fixture({ oscillatorsEnabled: false, drumMachineEnabled: true,
        hasPlayableBastardLoopLTransportSource: () => false,
        ensureDrumMachineBus() {}, ensureDrumMachineHatNoiseBuffer() {} });
    for (const suffix of ['', '2', '3', 'V', 'P', 'O']) {
        context[`bastardLoop${suffix}Buffer`] = { duration: 2 };
        context[`getBastardLoop${suffix}PlaybackBuffer`] = () => { context.audioContext.currentTime += .075; };
    }
    context.bastardLoopMBuffer = {};
    context.bastardLoopMPlusBuffer = {};
    context.getBastardLoopMPlaybackDestination = () => ({});
    context.getBastardLoopMPlusPlaybackDestination = () => ({});
    context.ensureBastardLoopMFxBus = () => { context.audioContext.currentTime += .06; };
    context.ensureBastardLoopMPlusFxBus = () => { context.audioContext.currentTime += .06; };
    load(context, ['prewarmTransportBuffers']);
    const before = context.audioContext.currentTime;
    const deadline = context.getBufferedTransportStartTime();
    assert.ok(context.audioContext.currentTime - before > .5);
    near(deadline - context.audioContext.currentTime, .3);
    const preparedAt = context.audioContext.currentTime;
    context.withBufferedTransportStart(deadline, actual => near(actual, deadline), { reset: true });
    near(context.audioContext.currentTime, preparedAt);
});

test('slow multi-lane construction replans the whole group before any native source can start', () => {
    const context = fixture({ drumMachinePlaying: true, drumMachineTransportStartTime: 8 });
    const attempts = [];
    let clocks = 0;
    context.ensureSharedRhythmClockRunning = () => { clocks += 1; };
    context.withBufferedTransportStart(null, deadline => {
        const sources = [];
        attempts.push({ deadline, sources });
        for (const lane of ['A', 'B', 'X']) {
            context.audioContext.currentTime += .16;
            const position = context.resolveTransportLaneStart(deadline, lane, .125, 16);
            const source = audioNode('source');
            source.loop = true;
            source.loopStart = .02;
            source.loopEnd = 2.03;
            context.startTransportSource(source, position.time, .02);
            sources.push(source);
            assert.equal(source.started, undefined);
        }
    });
    assert.equal(attempts.length, 2);
    assert.ok(attempts[0].sources.every(source => source.started === undefined));
    assert.equal(attempts[1].sources.length, 3);
    for (const source of attempts[1].sources) {
        near(source.started[0], attempts[1].deadline);
        near(source.started[1], .02);
        near(source.loopStart, .02);
        near(source.loopEnd, 2.03);
    }
    assert.equal(context.drumMachineTransportStartTime, 8);
    assert.equal(clocks, 1);
    assert.ok(context.transportSync.preparation.remainingLeadSeconds >= .05);
    assert.equal(context.transportSync.preparation.attempts, 2);
    const next = context.getBufferedTransportStartTime();
    assert.ok(next - context.audioContext.currentTime >= .3 + .48 * 2 - 1e-9);
});

test('an explicit late capture group cancels every prepared source instead of moving its source T0', () => {
    const context = fixture();
    const source = audioNode('source');
    const deadline = context.audioContext.currentTime + .3;
    let callbacks = 0;
    let operations = 0;
    assert.throws(() => context.withBufferedTransportStart(deadline, when => {
        operations += 1;
        context.startTransportSource(source, when, 0);
        context.transportSync.preparedCallbacks.push(() => { callbacks += 1; });
        context.audioContext.currentTime += .4;
        context.resolveTransportLaneStart(when, 'X', .125, 16);
    }, { reset: true }), /deadline expired/);
    assert.equal(operations, 1);
    assert.equal(source.started, undefined);
    assert.equal(callbacks, 0);
    assert.equal(context.transportSync.startTime, deadline);
    assert.equal(context.transportSync.depth, 0);
    assert.equal(context.transportSync.preparedStarts, null);
    assert.ok(context.getBufferedTransportStartTime() > context.audioContext.currentTime + .3);
});

test('prepared source cancellations and future stops commit atomically with deferred chord playback', () => {
    const calls = [];
    const context = fixture({ window: { mygrainQ: { playable: () => true,
        start: when => calls.push(['Q', when]), seek: when => calls.push(['seek', when]) } } });
    const cancelled = audioNode('source');
    const sounding = audioNode('source');
    context.withBufferedTransportStart(null, when => {
        context.startTransportSource(cancelled, when);
        cancelled.stop();
        context.startTransportSource(sounding, when);
        context.scheduleTransportSourceStop(sounding, when + .2);
        context.startTransportChordLayer(when, when);
        assert.equal(cancelled.started, undefined);
        assert.equal(sounding.started, undefined);
        assert.equal(calls.length, 0);
    });
    assert.equal(cancelled.started, undefined);
    near(sounding.started[0], context.transportSync.startTime);
    near(sounding.stopped[0], context.transportSync.startTime + .2);
    assert.deepEqual(calls, [['Q', context.transportSync.startTime], ['seek', context.transportSync.startTime]]);
});

test('all rhythm lanes share the 350ms horizon and survive a 180ms UI stall without lost beats', () => {
    const context = fixture({ drumMachinePlaying: true, bastardLoopLTransportActive: true, bastardLoopXTransportActive: true,
        drumMachineNextStepTime: 10, drumMachineCurrentStep: 0, bastardLoopLNextStepTime: 10, bastardLoopXNextStepTime: 10 });
    context.audioContext.currentTime = 10;
    const scheduled = { drums: [], lead: [], sample: [] };
    context.scheduleDrumMachineRepeats = (kind, index, time) => { if (kind === 'kick') scheduled.drums.push(time); };
    context.scheduleDrumMachineHatStep = () => {};
    context.scheduleDrumMachineVisualStep = () => {};
    context.scheduleBastardLoopLVoice = (step, time) => scheduled.lead.push(time);
    context.scheduleBastardLoopXVoice = (step, time) => scheduled.sample.push(time);
    load(context, ['scheduleDrumMachine', 'scheduleBastardLoopLSteps', 'scheduleBastardLoopXSteps']);
    const tick = () => { context.scheduleDrumMachine(); context.scheduleBastardLoopLSteps(); context.scheduleBastardLoopXSteps(); };
    tick();
    context.audioContext.currentTime += .18;
    tick();
    assert.deepEqual(scheduled.drums, scheduled.lead);
    assert.deepEqual(scheduled.drums, scheduled.sample);
    assert.equal(context.audioSchedulingStats.skippedSteps, 0);
    assert.ok(scheduled.drums.length >= 5);
    for (const name of ['scheduleDrumMachine', 'scheduleBastardLoopLSteps', 'scheduleBastardLoopXSteps', 'scheduleSequencer']) {
        assert.match(functionSource(name), /getTransportScheduleHorizon\(now\)/);
    }
    const grainHorizon = Number(/const GRAIN_SCHEDULER_LOOKAHEAD = ([\d.]+);/.exec(html)[1]);
    const stepHorizon = Number(/const SCHEDULE_AHEAD_TIME = ([\d.]+);/.exec(html)[1]);
    assert.equal(grainHorizon, stepHorizon, 'sequencer grains must be queued before later future steps replace their streams');
});

test('long stalls skip historic steps while keeping phase, without stale catch-up bursts', () => {
    const context = fixture({ bastardLoopXTransportActive: true, bastardLoopXNextStepTime: .976,
        bastardLoopXNextStepIndex: 7 });
    context.audioContext.currentTime = 300;
    const times = [];
    context.scheduleBastardLoopXVoice = (step, time) => times.push(time);
    load(context, ['scheduleBastardLoopXSteps']);
    context.scheduleBastardLoopXSteps();
    assert.ok(times.length > 0 && times.length <= 3);
    assert.ok(times.every(time => time >= 300 && time < 300.35));
    for (const time of times) near((time - .976) / .125, Math.round((time - .976) / .125));
    assert.ok(context.audioSchedulingStats.skippedSteps > 2000);
});

function tempoFixture() {
    const events = [];
    const context = fixture({ drumMachinePlaying: true, drumMachineTransportStartTime: .976,
        bastardLoopPlaying: true, bastardLoopTransportStartTime: .976, bastardLoopLTransportActive: true,
        bastardLoopXTransportActive: true, sequencerPlaying: true, transportLoopStartTime: .976,
        bastardLoopSource: {}, syncingGlobalBpm: false, INTERNAL_BPM_CLOCK_RATE_IDS: [], GLOBAL_BPM_MIN: 1, GLOBAL_BPM_MAX: 300 });
    context.audioContext.currentTime = 10.21;
    context.syncAllBastardLoopTempos = () => events.push(['idle']);
    context.stopSequencer = () => { events.push(['stop', 'sequencer']); context.sequencerPlaying = false; };
    context.stopDrumMachine = () => { events.push(['stop', 'drums']); context.drumMachinePlaying = false; };
    context.stopBastardLoop = () => { events.push(['stop', 'A']); context.bastardLoopSource = null; };
    context.startBastardLoop = when => { events.push(['start', 'A', when]); context.bastardLoopSource = {}; };
    context.startSequencer = when => { events.push(['start', 'sequencer', when]); context.sequencerPlaying = true; };
    context.startDrumMachine = when => {
        events.push(['start', 'drums', when]);
        const position = context.resolveTransportLaneStart(when, 'drums', 60 / context.sequencerBPM / 4, 16);
        context.drumMachineNextStepTime = position.time;
        context.drumMachineCurrentStep = position.index;
        context.drumMachinePlaying = true;
    };
    context.cancelScheduledTransportOscillators = role => events.push(['cancel', role]);
    context.stopScheduledGrainVoices = role => events.push(['cancel-grains', role]);
    load(context, ['clampBpmValue', 'syncGlobalBpmControls', 'syncSequencerBpmControls', 'applyGlobalBpm', 'retimeSharedTransport']);
    return { context, events };
}

test('120→125 uses one future boundary, preserves beat position, and rebuilds only requested lanes', () => {
    const { context, events } = tempoFixture();
    context.applyGlobalBpm(125);
    const transition = context.transportSync.transition;
    assert.ok(transition.boundary >= 10.51);
    near((transition.boundary - transition.previousOrigin) * 120 / 60, transition.beat);
    near((transition.boundary - transition.origin) * 125 / 60, transition.beat);
    near(context.bastardLoopLNextStepTime, context.drumMachineNextStepTime);
    near(context.bastardLoopXNextStepTime, context.drumMachineNextStepTime);
    near(context.bastardLoopLNextStepTime, transition.boundary);
    near(context.getSharedLoopTransportOriginTime(), transition.origin);
    assert.equal(context.sequencerBPM, 125);
    assert.deepEqual(events.filter(event => event[0] === 'start').map(event => event[1]), ['sequencer', 'A', 'drums']);
    assert.ok(events.filter(event => event[0] === 'cancel').every(event => event[1] !== 'keyboard'));
    assert.deepEqual([...context.heldNotes], ['C3']);
    const revision = context.transportSync.revision;
    context.applyGlobalBpm(125);
    assert.equal(context.transportSync.revision, revision);
});

test('global slider, global number commit, and both SEQ controls all use the same BPM path', () => {
    for (const [identifier, eventName] of [['globalBpmSlider', 'input'], ['globalBpmNumber', 'change'], ['seqBpm', 'input'], ['seqBpm', 'change']]) {
        const { context } = tempoFixture();
        const marker = `document.getElementById('${identifier}')`;
        const start = html.indexOf(marker + (identifier === 'seqBpm' ? '.' : '?.') + `addEventListener('${eventName}'`);
        assert.ok(start > 0, `${identifier}:${eventName}`);
        const end = html.indexOf('\n        });', start) + '\n        });'.length;
        vm.runInContext(html.slice(start, end), context);
        const element = context.document.getElementById(identifier);
        element.value = '125';
        element.handlers[eventName]({ target: element });
        assert.equal(context.sequencerBPM, 125);
        near(context.bastardLoopLNextStepTime, context.drumMachineNextStepTime);
        near(context.bastardLoopXNextStepTime, context.drumMachineNextStepTime);
    }
});

test('rapid BPM requests replace the queued generation and never add historic drift offsets', () => {
    const { context, events } = tempoFixture();
    for (const bpm of [125, 123, 129, 120, 125]) {
        context.audioContext.currentTime += .013;
        context.applyGlobalBpm(bpm);
        const origin = context.getSharedLoopTransportOriginTime();
        const duration = 60 / bpm / 4;
        near((context.bastardLoopXNextStepTime - origin) / duration, Math.round((context.bastardLoopXNextStepTime - origin) / duration));
        near(context.bastardLoopXNextStepTime, context.drumMachineNextStepTime);
    }
    assert.equal(events.filter(event => event[0] === 'stop' && event[1] === 'A').length, 5);
    assert.equal(events.filter(event => event[0] === 'start' && event[1] === 'A').length, 5);
});

test('a tempo handoff prequeues the old rhythm through the boundary without a missing step or immediate voice stop', () => {
    const { context } = tempoFixture();
    Object.assign(context, { retiredTransportVoices: new Set(), retiredTransportGraphs: new Set(),
        drumMachineActiveVoices: new Set(), drumMachineNextStepTime: 10.601, drumMachineCurrentStep: 13,
        scheduleDrumMachineHatStep() {}, scheduleDrumMachineVisualStep() {}, getClickGuardSeconds: () => .003 });
    const times = [10.101, 10.226, 10.351, 10.476];
    context.scheduleDrumMachineRepeats = (track, index, when) => {
        if (track !== 'kick') return;
        times.push(when);
        const source = audioNode('source');
        const gain = audioNode();
        source.connect(gain);
        source.start(when);
        source.transportStopTime = when + .08;
        context.drumMachineActiveVoices.add({ source, gain, cleanupNodes: [] });
    };
    load(context, ['getDrumMachineStepDuration', 'scheduleDrumMachine', 'retireTransportVoice', 'stopDrumMachineVoices', 'stopRetiredTransportVoices']);
    context.stopDrumMachine = () => { context.stopDrumMachineVoices({ fade: false }); context.drumMachinePlaying = false; };
    context.applyGlobalBpm(125);
    const boundary = context.transportSync.transition.boundary;
    const oldVoices = [...context.retiredTransportVoices];
    assert.ok(oldVoices.length >= 3);
    for (const voice of oldVoices) {
        assert.ok(voice.source.stopped[0] > context.audioContext.currentTime);
        assert.ok(voice.source.stopped[0] <= boundary);
        assert.equal(voice.source.connections.length, 1);
    }
    context.audioContext.currentTime = boundary;
    context.scheduleDrumMachine();
    for (let index = 1; index < times.length; index += 1) {
        const expected = times[index] <= boundary + 1e-9 ? .125 : .12;
        near(times[index] - times[index - 1], expected);
    }
    context.stopRetiredTransportVoices('drums');
    assert.equal(context.retiredTransportVoices.size, 0);
    assert.ok(oldVoices.every(voice => voice.source.stopped.length === 0));
    assert.ok(oldVoices.every(voice => voice.source.connections.length === 0));
});

test('retirement preserves a voice natural deadline, silences post-boundary hits, and retains unrelated voices on lane stop', () => {
    const context = fixture({ retiredTransportVoices: new Set(), retiredTransportGraphs: new Set() });
    load(context, ['retireTransportVoice', 'stopRetiredTransportVoices']);
    const shortVoice = { source: audioNode('source'), gain: audioNode(), role: 'drums' };
    shortVoice.source.transportStopTime = 10.25;
    const futureVoice = { source: audioNode('source'), gain: audioNode(), role: 'drums' };
    futureVoice.source.start(11.2);
    const held = { source: audioNode('source'), gain: audioNode(), role: 'keyboard' };
    for (const voice of [shortVoice, futureVoice, held]) context.retireTransportVoice(voice, 11);
    near(shortVoice.source.stopped[0], 10.25);
    near(futureVoice.source.stopped[0], 11);
    assert.ok(futureVoice.gain.gain.events.some(event => event[0] === 'ramp' && event[1] === 0 && event[2] === 11));
    context.stopRetiredTransportVoices('drums');
    assert.equal(context.retiredTransportVoices.size, 1);
    assert.ok(context.retiredTransportVoices.has(held));
    context.stopRetiredTransportVoices();
    assert.equal(context.retiredTransportVoices.size, 0);
});

test('loop clock length is exact without altering source bounds, legacy metadata, or raw sampler duration', () => {
    const context = fixture({ GLOBAL_BPM_MIN: 1, GLOBAL_BPM_MAX: 300 });
    load(context, ['clampBpmValue', 'getLoopBarDurationSeconds', 'resolveLoopDurationSeconds', 'getSynchronizedLoopPlaybackRate']);
    const metadata = { durationSeconds: 2.01, sourceFiles: ['legacy.wav'] };
    const buffer = { duration: 2.01 };
    const saved = JSON.stringify(metadata);
    near(context.resolveLoopDurationSeconds(buffer.duration, { metadata, sourceBpm: 120 }), 2.01);
    near(buffer.duration / context.getSynchronizedLoopPlaybackRate(buffer, metadata, 120, 1), 2);
    near(buffer.duration / context.getSynchronizedLoopPlaybackRate(buffer, metadata, 120, 125 / 120), 60 / 125 * 4);
    near(context.getSynchronizedLoopPlaybackRate(buffer, metadata, 120, 2, false), 2);
    near(context.getSynchronizedLoopPlaybackRate(buffer, metadata, NaN, 1), 1);
    assert.equal(JSON.stringify(metadata), saved);
    assert.equal(buffer.duration, 2.01);
    assert.match(functionSource('getDropboxSampleLayerPlaybackRate'), /dropboxSampleLayerStretchToLoop && getDropboxSampleLayerPreserveDuration\(\)/);
    for (const suffix of ['', '2', '3', 'V', 'P', 'O']) assert.match(functionSource(`getBastardLoop${suffix}PlaybackRate`), /!getBastardLoop.*PitchAffectsDuration\(\)/);
    assert.equal(context.resolveLoopDurationSeconds(1.9, { metadata, sourceBpm: 120 }), 1.9);
});

function offlineContext(delayFrames, constructions) {
    return class OfflineContext {
        constructor(channels, frames, sampleRate) {
            Object.assign(this, { frames, sampleRate, nodes: [], destination: audioNode('destination') });
            constructions.push(this);
        }
        createBuffer(channels, frames) { const data = new Float32Array(frames); return { getChannelData: () => data }; }
        createBufferSource() { const source = audioNode('source'); this.source = source; this.nodes.push(source); return source; }
        createWaveShaper() { const node = audioNode('shaper'); this.nodes.push(node); return node; }
        createDynamicsCompressor() {
            const node = audioNode('compressor');
            for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[name] = parameter();
            this.nodes.push(node);
            return node;
        }
        async startRendering() {
            const output = new Float32Array(this.frames).fill(.003);
            const input = this.source.buffer.getChannelData(0);
            for (let frame = 0; frame < input.length - delayFrames; frame += 1) output[frame + delayFrames] += input[frame] * .3;
            return { getChannelData: () => output };
        }
    };
}

for (const [sampleRate, frames] of [[44100, 1224], [48000, 1248], [96000, 2304]]) {
    test(`calibration measures and silence-subtracts the actual five-shaper/ratio-1 graph at ${sampleRate}Hz`, async () => {
        const constructions = [];
        const context = fixture();
        context.window.OfflineAudioContext = offlineContext(frames, constructions);
        load(context, ['makeDistortionCurve', 'makeFinalDistortionCurve', 'measureTransportComponentLatency']);
        const result = await context.measureTransportComponentLatency(sampleRate);
        assert.equal(result.status, 'measured');
        assert.equal(result.frames, frames);
        near(result.seconds, frames / sampleRate);
        assert.equal(constructions.length, 6);
        for (const [index, offline] of constructions.entries()) {
            const shapers = offline.nodes.filter(node => node.kind === 'shaper');
            assert.equal(shapers.length, index >= 2 && index < 4 ? 4 : 5);
            assert.ok(shapers.every(node => node.oversample === '4x'));
            const compressor = offline.nodes.find(node => node.kind === 'compressor');
            if (index < 2) assert.equal(compressor.ratio.value, 1);
            else assert.equal(compressor, undefined);
            assert.ok(offline.nodes.every(node => node.connections.length === 0));
        }
    });
}

test('latency cache is rate-scoped, stale-context-safe, and a failed calibration is visibly unaligned', async () => {
    const context = fixture({ transportLatencyCache: new Map(), finalKickBypassDelay: audioNode('delay') });
    const warnings = [];
    context.setAudioStatus = (...args) => warnings.push(args);
    context.console = { warn() {} };
    let probes = 0;
    context.measureTransportComponentLatency = async sampleRate => { probes += 1; return { status: 'measured', sampleRate, frames: 1248, seconds: 1248 / sampleRate }; };
    load(context, ['ensureTransportLatencyReady']);
    assert.equal(await context.ensureTransportLatencyReady(context.audioContext), true);
    assert.equal(await context.ensureTransportLatencyReady(context.audioContext), true);
    assert.equal(probes, 1);
    near(context.finalKickBypassDelay.delayTime.value, .026);
    context.audioContext = audioContext();
    assert.equal(await context.ensureTransportLatencyReady(context.audioContext), true);
    assert.equal(probes, 1);
    context.audioContext = audioContext(44100);
    assert.equal(await context.ensureTransportLatencyReady(context.audioContext), true);
    assert.equal(probes, 2);
    let complete;
    context.audioContext = audioContext(96000);
    context.measureTransportComponentLatency = () => new Promise(resolve => { complete = resolve; });
    const stale = context.ensureTransportLatencyReady(context.audioContext);
    context.audioContext = audioContext(48000);
    const timing = context.transportSync.latency;
    complete({ status: 'measured', sampleRate: 96000, frames: 2000, seconds: .02 });
    assert.equal(await stale, false);
    assert.equal(context.transportSync.latency, timing);
    context.audioContext = audioContext(32000);
    context.measureTransportComponentLatency = async () => { throw new Error('Unsupported'); };
    assert.equal(await context.ensureTransportLatencyReady(context.audioContext), false);
    assert.equal(context.transportSync.latency.status, 'unavailable');
    assert.equal(context.transportLatencyCache.has(32000), false);
    assert.match(warnings.at(-1)[0], /DIRECT\/BYPASS is not aligned/);
    assert.equal(context.getTransportOutputLatencySeconds(), 0);
});

test('future oscillator release keeps its envelope and remains cancellable before onset', () => {
    const context = fixture({ activeOscVoices: new Map(), retiringOscillatorVoices: new Set(),
        osc1Config: { release: 100 }, osc2Config: { release: 100 }, osc3Config: { release: 100 },
        oscNoiseConfig: { release: 100 }, getClickGuardSeconds: () => .003,
        makePerformanceStreamId: (role, note) => `${role}:${note}` });
    load(context, ['stopOscillatorNote', 'releaseTransportOscillatorVoice', 'cancelScheduledTransportOscillators']);
    const voice = { note: 'C3', role: 'sequencer', startTime: 10.3, nodes: [audioNode()],
        osc1: audioNode('osc'), osc2: audioNode('osc'), osc3: audioNode('osc'),
        osc1Gain: audioNode(), osc2Gain: audioNode(), osc3Gain: audioNode() };
    const keyboard = { role: 'keyboard' };
    context.activeOscVoices.set('sequencer:C3', voice);
    context.activeOscVoices.set('keyboard:C3', keyboard);
    context.stopOscillatorNote('C3', 10.5, { role: 'sequencer' });
    assert.ok(voice.osc1Gain.gain.events.some(event => event[0] === 'hold' && event[1] === 10.5));
    near(voice.osc1.stopped[0], 10.6);
    assert.ok(context.retiringOscillatorVoices.has(voice));
    assert.ok([...context.timers.values()].every(timer => timer.delay > 600));
    context.audioContext.currentTime = 10.12;
    context.cancelScheduledTransportOscillators('sequencer');
    near(voice.osc1.stopped[0], 10.12);
    assert.equal(voice.osc1Gain.gain.value, 0);
    assert.equal(context.activeOscVoices.get('keyboard:C3'), keyboard);
    for (const timer of context.timers.values()) timer.callback();
    assert.equal(context.retiringOscillatorVoices.size, 0);
});

test('a stale failed latency probe is evicted without changing the replacement graph or suppressing its retry', async () => {
    const context = fixture({ transportLatencyCache: new Map(), finalKickBypassDelay: audioNode('delay') });
    let rejectProbe;
    context.measureTransportComponentLatency = () => new Promise((resolve, reject) => { rejectProbe = reject; });
    load(context, ['ensureTransportLatencyReady']);
    const stale = context.ensureTransportLatencyReady(context.audioContext);
    context.audioContext = audioContext();
    const replacementDelay = audioNode('delay');
    replacementDelay.delayTime.value = .04;
    context.finalKickBypassDelay = replacementDelay;
    rejectProbe(new Error('Obsolete renderer failed'));
    assert.equal(await stale, false);
    assert.equal(context.transportLatencyCache.has(48000), false);
    near(replacementDelay.delayTime.value, .04);
    context.measureTransportComponentLatency = async sampleRate => ({ status: 'measured', sampleRate, frames: 1248, seconds: .026 });
    assert.equal(await context.ensureTransportLatencyReady(context.audioContext), true);
    near(replacementDelay.delayTime.value, .026);
});

test('DIRECT and kick-bypass routes share exactly one unity delay, which reset/recovery disconnects', () => {
    const context = fixture({ finalKickBypassMasterGain: audioNode(), finalKickBypassPanner: audioNode(),
        finalKickBypassDelay: null });
    context.transportSync.latency = { status: 'measured', frames: 1248, seconds: .026 };
    load(context, ['flushTransportBypassDelay', 'resetTransportSynchronization']);
    context.flushTransportBypassDelay();
    const original = context.finalKickBypassDelay;
    near(original.delayTime.value, .026);
    assert.deepEqual(original.connections, [context.finalKickBypassPanner]);
    context.flushTransportBypassDelay();
    assert.equal(original.connections.length, 0);
    assert.equal(context.finalKickBypassMasterGain.connections.length, 1);
    assert.notEqual(context.finalKickBypassDelay, original);
    const replacement = context.finalKickBypassDelay;
    context.resetTransportSynchronization();
    assert.equal(replacement.connections.length, 0);
    assert.equal(context.finalKickBypassDelay, null);
    assert.equal(context.transportSync.latency.status, 'pending');
    const setup = functionSource('setupEffects');
    assert.match(setup, /finalKickBypassMasterGain.connect\(finalKickBypassDelay\)/);
    assert.match(setup, /finalKickBypassDelay.connect\(finalKickBypassPanner\)/);
    assert.match(setup, /await ensureTransportLatencyReady\(audioContext\)/);
    assert.doesNotMatch(setup, /finalKickBypassMasterGain.connect\(finalKickBypassPanner\)/);
});

test('live export uses a single prepared source deadline and trims the common output latency', () => {
    const renderer = functionSource('renderLiveOutputBarsBuffer');
    assert.ok(renderer.indexOf('prewarmTransportBuffers();') < renderer.indexOf('const captureStartTime = audioContext.currentTime;'));
    assert.match(renderer, /withBufferedTransportStart\(restartTime,/);
    assert.match(renderer, /captureSeconds = .*outputLatency \+ durationSeconds/);
    assert.match(renderer, /exactStart = Math.max\(0, restartTime \+ outputLatency - actualCaptureStartTime\)/);
    assert.match(html, /song-beta-clock\.js\?v=[^"\s]+/);
    const buildBadges = [...html.matchAll(/Build <strong>(v[^<]+)<\/strong>/g)].map(match => match[1]);
    assert.equal(buildBadges.length, 2);
    assert.equal(buildBadges[0], buildBadges[1]);
});

test('DIRECT delay and reverb compensate their exact FX tap, independently of dry output latency and placement', () => {
    const context = fixture({ drumMachineBusGainNode: audioNode(), drumMachineKickBypassGainNode: audioNode(),
        finalDelayNode: audioNode('delay'), finalDelayShadowNodeA: audioNode('delay'),
        finalDelayShadowNodeB: audioNode('delay'), finalReverbPreDelay: audioNode('delay') });
    const sendGraph = { delayInput: audioNode(), reverbInput: audioNode(), returnLatency: audioNode('delay') };
    context.drumSendFxGraph = sendGraph;
    context.ensureDrumSendFxGraph = () => sendGraph;
    context.transportSync.latency = { status: 'measured', seconds: .026,
        taps: { pre: { seconds: .016 }, post: { seconds: .02 } } };
    load(context, ['ensureDrumMachineDirectFxSends', 'updateTransportSendLatency', 'updateDrumSendReturnLatency']);
    context.ensureDrumMachineDirectFxSends();
    near(context.drumMachineDirectDelayLatencyNode.delayTime.value, .02);
    near(context.drumMachineDirectReverbLatencyNode.delayTime.value, .02);
    near(sendGraph.returnLatency.delayTime.value, .006);
    assert.deepEqual(context.drumMachineBusGainNode.connections, [context.drumMachineDirectDelayLatencyNode, context.drumMachineDirectReverbLatencyNode]);
    assert.deepEqual(context.drumMachineKickBypassGainNode.connections, [context.drumMachineDirectDelayLatencyNode, context.drumMachineDirectReverbLatencyNode]);
    assert.deepEqual(context.drumMachineDirectDelayLatencyNode.connections, [context.drumMachineDirectDelaySendGainNode]);
    assert.deepEqual(context.drumMachineDirectReverbLatencyNode.connections, [context.drumMachineDirectReverbSendGainNode]);
    assert.deepEqual(context.drumMachineDirectDelaySendGainNode.connections, [sendGraph.delayInput]);
    assert.deepEqual(context.drumMachineDirectReverbSendGainNode.connections, [sendGraph.reverbInput]);
    context.finalFxPlacement = 'pre';
    context.updateTransportSendLatency();
    near(context.drumMachineDirectDelayLatencyNode.delayTime.value, .016);
    near(context.drumMachineDirectReverbLatencyNode.delayTime.value, .016);
    near(sendGraph.returnLatency.delayTime.value, .01);
    const events = context.drumMachineDirectDelayLatencyNode.delayTime.events.length;
    context.ensureDrumMachineDirectFxSends();
    assert.equal(context.drumMachineDirectDelayLatencyNode.delayTime.events.length, events);
    assert.equal(context.drumMachineBusGainNode.connections.length, 2);
    assert.equal(context.drumMachineKickBypassGainNode.connections.length, 2);
    assert.match(functionSource('setFinalFxPlacement'), /updateTransportSendLatency\(\)/);
    load(context, ['flushTransportSendLatency', 'resetTransportSynchronization']);
    const oldDelay = context.drumMachineDirectDelayLatencyNode;
    const oldReverb = context.drumMachineDirectReverbLatencyNode;
    context.flushTransportSendLatency();
    assert.equal(oldDelay.connections.length, 0);
    assert.equal(oldReverb.connections.length, 0);
    assert.notEqual(context.drumMachineDirectDelayLatencyNode, oldDelay);
    near(context.drumMachineDirectDelayLatencyNode.delayTime.value, .016);
    assert.equal(context.drumMachineBusGainNode.connections.length, 2);
    assert.match(functionSource('panicAllNotes'), /flushTransportSendLatency\(\)/);
    const previousNodes = [context.drumMachineDirectDelayLatencyNode, context.drumMachineDirectReverbLatencyNode,
        context.drumMachineDirectDelaySendGainNode, context.drumMachineDirectReverbSendGainNode,
        context.drumMachineBusGainNode, context.drumMachineKickBypassGainNode];
    context.finalKickBypassDelay = null;
    context.resetTransportSynchronization();
    assert.ok(previousNodes.every(node => node.connections.length === 0));
    assert.equal(context.drumMachineDirectDelaySendGainNode, null);
    assert.equal(context.drumMachineDirectReverbSendGainNode, null);
    assert.equal(context.drumMachineBusGainNode, null);
});

test('kick sidechain events follow compensated audible drums rather than the source clock', () => {
    const context = fixture({ finalSidechainKickEvents: [], getFinalCompressorReleaseSeconds: () => .1 });
    context.transportSync.latency = { status: 'measured', seconds: .026 };
    load(context, ['pruneFinalSidechainKickEvents', 'registerFinalSidechainKickTrigger', 'getFinalKickSidechainDetector']);
    context.registerFinalSidechainKickTrigger(10.3, .7);
    near(context.finalSidechainKickEvents[0].time, 10.326);
    assert.equal(context.getFinalKickSidechainDetector(10.31), 0);
    near(context.getFinalKickSidechainDetector(10.33), .7);
});
