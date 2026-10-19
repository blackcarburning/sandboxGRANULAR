const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixtureTools = require('./drum-parallel-fx-fixture.js');

const html = fs.readFileSync(fixtureTools.sourcePath, 'utf8');
const functionSource = name => fixtureTools.extractFunction(html, name);

function fixture() {
    const sourceSet = fixtureTools.collectSources(html);
    sourceSet.names.push('shouldIdleBypassFinalBusCompressor');
    sourceSet.functions.push(functionSource('shouldIdleBypassFinalBusCompressor'));
    const audio = fixtureTools.createFakeContext(48000);
    audio.currentTime = 1;
    const effects = { saves: 0 };
    const created = fixtureTools.createFixture(sourceSet, audio, { globals: {
        getDrumMachineOutputGain: () => .6,
        shouldRouteKickAroundFinalCompressor: () => true,
        finalReverbEnabled: false, drumMachineActiveVoices: new Set(),
        sequencerPlaying: false, bastardLoopPlaying: false, drumMachinePlaying: false,
        activeKeyCount: 0, activeGrains: new Set(), sourceWaveformSoloKinds: new Set(), auditionSources: [],
        activeOscVoices: new Map(), keyboardSamplePlayer: null,
        isArpeggiatorPlaying: () => false, isBastardLoopLRunning: () => false,
        isBastardLoopXRunning: () => false, isBastardLoopVCutPreviewRunning: () => false,
        saveState() { effects.saves += 1; }
    } });
    Object.assign(created.state, { finalKickBypassMasterGain: audio.createGain(),
        finalKickBypassPanner: audio.createStereoPanner(), preFilterGainNode: audio.createGain(),
        finalCompressorSidechainSource: 'kick' });
    const controls = { finalReverbMix: created.state.document.getElementById('finalReverbMix') };
    Object.assign(created.state, created.functions);
    return { context: created.state, controls, effects, gainNode: () => audio.createGain() };
}

test('manual send activation enables an independent audible return without enabling main reverb', () => {
    const { context, controls, effects } = fixture();
    context.setDrumMachineDirectReverbSend(true);
    assert.equal(context.drumSendFxState.reverb.enabled, true);
    assert.equal(context.drumSendFxState.reverb.amount, 30);
    assert.equal(context.finalReverbEnabled, false);
    assert.equal(controls.finalReverbMix.value, '0');
    assert.ok(context.drumSendFxGraph.reverbWet.gain.value > 0);
    assert.equal(effects.saves, 1);
});

test('manual activation preserves a positive independent amount and an already-enabled return', () => {
    const { context, controls } = fixture();
    controls.finalReverbMix.value = '47';
    context.drumSendFxState.reverb.amount = 61;
    context.setDrumMachineDirectReverbSend(true);
    const graph = context.drumSendFxGraph;
    context.setDrumMachineDirectReverbSend(true);
    assert.equal(context.drumSendFxGraph, graph);
    assert.equal(context.drumSendFxState.reverb.amount, 61);
    assert.equal(controls.finalReverbMix.value, '47');
});

test('silent snapshot loading retains deliberately zero dedicated amount and does not save', () => {
    const { context, effects } = fixture();
    context.drumSendFxState.reverb.amount = 0;
    context.setDrumMachineDirectReverbSend(true, { silent: true, skipSave: true });
    assert.equal(context.drumSendFxState.reverb.amount, 0);
    assert.equal(context.drumSendFxGraph.reverbWet.gain.value, 0);
    assert.equal(effects.saves, 0);
});

test('turning the send off gates only its independent wet input/return, never the dry buses or main room', () => {
    const { context } = fixture();
    context.ensureDrumMachineBus();
    context.ensureDrumMachineKickBypassBus();
    context.setDrumMachineDirectReverbSend(true);
    context.finalReverbEnabled = true;
    const dry = [context.drumMachineBusGainNode.gain.value, context.drumMachineKickBypassGainNode.gain.value];
    context.setDrumMachineDirectReverbSend(false);
    assert.equal(context.drumSendFxGraph.reverbInput.gain.value, 0);
    assert.equal(context.drumSendFxGraph.reverbWet.gain.value, 0);
    assert.deepEqual([context.drumMachineBusGainNode.gain.value, context.drumMachineKickBypassGainNode.gain.value], dry);
    assert.equal(context.finalReverbEnabled, true);
});

for (const percent of [0, 25, 100, 135, 200]) {
    test(`the independent send follows ${percent}% without changing either dry drum gain`, () => {
        const { context } = fixture();
        context.drumMachineDirectOutput = false;
        context.updateDrumMachineMix();
        context.setDrumMachineDirectReverbSend(true);
        context.drumSendFxState.reverb.send = percent;
        context.updateDrumSendEffects();
        assert.equal(context.drumSendFxGraph.reverbInput.gain.value, percent / 100);
        assert.equal(context.drumMachineBusGainNode.gain.value, .6);
        assert.equal(context.drumMachineKickBypassGainNode.gain.value, .6);
    });
}

test('dedicated control handlers update only wet state, bypassing generic dry/main slider handlers', () => {
    assert.match(html, /if \(slider\.closest\('#drumSendEffects'\)\) return;/);
    const start = html.lastIndexOf("document.querySelectorAll('#drumSendEffects [data-drum-send]').forEach((control) => {");
    const ending = html.indexOf("document.getElementById('drumSendResetTailsBtn')", start);
    assert.ok(start >= 0 && ending > start);
    const handler = html.slice(start, ending);
    assert.match(handler, /updateDrumSendEffects\(\)/);
    assert.doesNotMatch(handler, /updateDrumMachineMix\(|updateEffects\(|restartAllTransport\(/);
});

test('normal drums and SC-kick bypass feed the same dedicated send exactly once', () => {
    const { context } = fixture();
    context.drumMachineDirectOutput = false;
    context.setDrumMachineDirectReverbSend(true);
    for (let repeat = 0; repeat < 5; repeat += 1) context.updateDrumMachineMix();
    for (const bus of [context.drumMachineBusGainNode, context.drumMachineKickBypassGainNode]) {
        assert.equal(bus.connections.filter(edge => edge.destination === context.drumMachineDirectReverbLatencyNode).length, 1);
    }
    assert.deepEqual(context.drumMachineDirectReverbSendGainNode.connections.map(edge => edge.destination), [context.drumSendFxGraph.reverbInput]);
});

test('rerouting either dry bus reconnects dedicated sends without duplicating the other bus', () => {
    const { context, gainNode } = fixture();
    context.drumMachineDirectOutput = false;
    context.updateDrumMachineMix();
    context.setDrumMachineDirectReverbSend(true);
    context.finalKickBypassMasterGain = gainNode();
    context.ensureDrumMachineKickBypassBus();
    for (const direct of [true, false, true, false]) {
        context.drumMachineDirectOutput = direct;
        context.updateDrumMachineMix();
    }
    for (const bus of [context.drumMachineBusGainNode, context.drumMachineKickBypassGainNode]) {
        for (const tap of [context.drumMachineDirectReverbLatencyNode, context.drumMachineDirectDelayLatencyNode]) {
            assert.equal(bus.connections.filter(edge => edge.destination === tap).length, 1);
        }
    }
});

test('a kick bypass can create its dedicated wet connections before the main drum bus exists', () => {
    const { context } = fixture();
    context.ensureDrumMachineKickBypassBus();
    assert.equal(context.drumMachineBusGainNode, null);
    assert.ok(context.drumMachineKickBypassGainNode.connections.some(edge => edge.destination === context.drumMachineDirectReverbLatencyNode));
    assert.ok(context.drumMachineKickBypassGainNode.connections.some(edge => edge.destination === context.drumMachineDirectDelayLatencyNode));
});

test('active one-shot voices keep the main bus awake, but independent wet tails never change its idle gate', () => {
    const { context } = fixture();
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
    context.drumMachineActiveVoices.add({});
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), false);
    context.setDrumMachineDirectReverbSend(true);
    context.drumSendFxGraph.reverb.buffer = { duration: 2 };
    context.registerDrumMachineReverbTail(1, .2);
    assert.ok(Math.abs(context.drumMachineReverbTailUntil - (1 + .2 + 2 + .043 + .05)) < 1e-12);
    context.drumMachineActiveVoices.clear();
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
});

test('tail bookkeeping extends, never shortens, and ignores invalid times', () => {
    const { context } = fixture();
    context.setDrumMachineDirectReverbSend(true);
    context.registerDrumMachineReverbTail(2, .4);
    const deadline = context.drumMachineReverbTailUntil;
    context.registerDrumMachineReverbTail(1, .1);
    context.registerDrumMachineReverbTail(NaN, .1);
    context.registerDrumMachineReverbTail(4, Infinity);
    assert.equal(context.drumMachineReverbTailUntil, deadline);
});

for (const disabled of ['enabled', 'amount', 'send']) {
    test(`an inaudible independent ${disabled} does not open or extend its tail deadline`, () => {
        const { context } = fixture();
        context.setDrumMachineDirectReverbSend(true);
        context.drumSendFxState.reverb[disabled] = disabled === 'enabled' ? false : 0;
        context.registerDrumMachineReverbTail(1, .2);
        assert.equal(context.drumMachineReverbTailUntil, 0);
        assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
    });
}

test('main reverb off and main zero mix do not suppress an audible independent drum tail', () => {
    const { context, controls } = fixture();
    context.setDrumMachineDirectReverbSend(true);
    context.finalReverbEnabled = false;
    controls.finalReverbMix.value = '0';
    context.registerDrumMachineReverbTail(1, .2);
    assert.ok(context.drumMachineReverbTailUntil > 1.2);
});

test('sampled and synthesized hat paths register tails, while Panic clears their deadline', () => {
    assert.match(functionSource('playDrumMachineHit'), /registerDrumMachineReverbTail\(scheduledTime, duration \+ fadeSeconds \+ 0\.01\)/);
    assert.match(functionSource('playDrumMachineHatHit'), /registerDrumMachineReverbTail\(scheduledTime, duration \+ fadeSeconds\)/);
    assert.match(functionSource('panicAllNotes'), /drumMachineReverbTailUntil = 0/);
});
