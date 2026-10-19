const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = process.env.MYGRAIN_TEST_ROOT || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const { Controller } = require(path.join(root, 'q-card.js'));
const manualKeys = ['bastardm', 'bastardmplus', 'bastardq', 'bastardk'];

function functionSource(name, asynchronous = false) {
    const start = html.indexOf(`        ${asynchronous ? 'async ' : ''}function ${name}(`);
    assert.notEqual(start, -1, name);
    return html.slice(start, html.indexOf('\n        }', start) + '\n        }'.length);
}

function fixture() {
    const states = new Map();
    const calls = [];
    const context = { window: {}, syncPerformanceControlState() {} };
    const registry = html.match(/        const SPARSE_RANDOM_LAYER_DEFINITIONS = \[[\s\S]*?\n        \];/)[0];
    const setterKeys = [...registry.matchAll(/key: '([^']+)'[^\n]*?=> (?:window\.mygrainQ\?\.)?(\w+)\(enabled, options\)/g)];
    for (const [, key, name] of setterKeys) {
        states.set(key, true);
        const setter = (enabled, options) => { states.set(key, enabled); calls.push({ key, enabled, options }); };
        if (key === 'bastardq') context.window.mygrainQ = { setEnabled: setter };
        else context[name] = setter;
    }
    context.setDrumMachineEnabled = enabled => states.set('drums', enabled);
    context.chooseRandomSubset = candidates => candidates.slice(0, 4);
    vm.createContext(context);
    const mutedKeys = html.match(/        const RANDOMIZE_MUTED_LOOP_LAYER_KEYS = [^\n]+/);
    if (mutedKeys) vm.runInContext(mutedKeys[0], context);
    vm.runInContext(registry, context);
    vm.runInContext("const SPARSE_RANDOM_GRANULAR_CHILD_KEYS = new Set(['sample', 'loop', 'dropbox']);", context);
    for (const name of ['chooseSparseRandomLayerSelection', 'applySparseRandomLayerSelection']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, states, calls };
}

test('all Q toggles share the muted class and reflect re-enable and restored state', () => {
    const buttons = Array.from({ length: 3 }, () => ({
        classes: new Set(), attributes: {},
        classList: { toggle(name, enabled) { if (enabled) this.owner.classes.add(name); else this.owner.classes.delete(name); } },
        setAttribute(name, value) { this.attributes[name] = value; }
    }));
    for (const button of buttons) button.classList.owner = button;
    const previousDocument = global.document;
    global.document = { querySelectorAll: selector => selector === '[data-q-action="toggle"]' ? buttons : [] };
    try {
        const instance = new Controller({ length: () => 64 });
        for (const enabled of [false, true, false]) {
            instance.state.enabled = enabled;
            instance.syncTransport();
            for (const button of buttons) {
                assert.equal(button.classes.has('layer-muted'), !enabled);
                assert.equal(button.attributes['aria-pressed'], String(enabled));
                assert.equal(button.textContent, `Bastardloop Q ${enabled ? 'On' : 'Off'}`);
            }
        }
    } finally {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
    }
});

test('the shared randomise policy mutes only M, M+, Q and K without saving intermediate state', () => {
    const { context, states, calls } = fixture();
    vm.runInContext(functionSource('muteRandomizeManualLoopLayers'), context);
    context.muteRandomizeManualLoopLayers();
    assert.deepEqual(calls.map(call => call.key).sort(), [...manualKeys].sort());
    for (const [key, enabled] of states) assert.equal(enabled, !manualKeys.includes(key), key);
    for (const call of calls) assert.deepEqual({ ...call.options }, { silent: true, skipSave: true });
    context.muteRandomizeManualLoopLayers();
    assert.equal(calls.length, manualKeys.length * 2);
});

test('the shared helper uses the K setter to cancel active output without changing its take or solo', () => {
    for (const solo of [[], ['bastardk'], ['bastardm']]) {
        const { context } = fixture();
        const take = { samples: [0.25, -0.5, 0.75] };
        const metadata = { summary: 'Recorded grain take', bpm: 120 };
        const gainCalls = [];
        let stopped = 0;
        Object.assign(context, {
            bastardLoopKEnabled: true, bastardLoopKLevel: 0.75,
            bastardLoopKBuffer: take, bastardLoopKRawBuffer: take, bastardLoopKMetadata: metadata,
            bastardLoopKRecordingState: 'idle', bastardLoopKRecordingToken: 42,
            loopLayerSolo: solo, bastardLoopPlaying: true, bastardLoopKSource: {},
            bastardLoopKFilterNodes: [], audioContext: { currentTime: 10 }, MIX_HEADROOM: 0.8,
            document: { getElementById: () => null },
            syncBastardLoopKUi() {},
            bastardLoopKGainNode: { gain: {
                value: 0.5,
                cancelScheduledValues: time => gainCalls.push(['cancel', time]),
                setValueAtTime() {},
                linearRampToValueAtTime: (value, time) => gainCalls.push(['ramp', value, time])
            } },
            getLoopLayerSoloGain: key => solo.length === 0 || solo.includes(key) ? 1 : 0,
            stopBastardLoopK: () => { stopped += 1; context.bastardLoopKSource = null; },
            saveState: () => assert.fail('The mute helper must not save'),
            setStatus: () => assert.fail('The mute helper must be silent')
        });
        for (const name of ['getBastardLoopKLevelValue', 'getBastardLoopKOutputGain',
            'updateBastardLoopKMix', 'setBastardLoopKEnabled', 'muteRandomizeManualLoopLayers']) {
            vm.runInContext(functionSource(name), context);
        }
        context.muteRandomizeManualLoopLayers();
        assert.equal(context.bastardLoopKEnabled, false);
        assert.equal(context.getBastardLoopKOutputGain(), 0);
        assert.equal(context.bastardLoopKSource, null);
        assert.equal(stopped, 1);
        assert.deepEqual(gainCalls, [['cancel', 10], ['ramp', 0, 10.03]]);
        assert.equal(context.bastardLoopKBuffer, take);
        assert.equal(context.bastardLoopKRawBuffer, take);
        assert.equal(context.bastardLoopKMetadata, metadata);
        assert.deepEqual(take.samples, [0.25, -0.5, 0.75]);
        assert.equal(context.bastardLoopKRecordingState, 'idle');
        assert.equal(context.bastardLoopKRecordingToken, 42);
        assert.equal(context.loopLayerSolo, solo);
        context.muteRandomizeManualLoopLayers();
        assert.equal(stopped, 1);
    }
});

test('Sparse excludes the manual loops from every candidate pool and keeps four eligible layers plus drums', () => {
    const { context, states } = fixture();
    let inspected = 0;
    for (let offset = 0; offset < 20; offset += 1) {
        context.chooseRandomSubset = candidates => {
            inspected += 1;
            assert.equal(candidates.some(layer => manualKeys.includes(layer.key)), false);
            return Array.from({ length: 4 }, (_, index) => candidates[(offset + index) % candidates.length]);
        };
        const selected = context.applySparseRandomLayerSelection({ silent: true });
        assert.equal(selected.length, 4);
        assert.equal(new Set(selected.map(layer => layer.key)).size, 4);
        for (const key of manualKeys) assert.equal(states.get(key), false, key);
        assert.equal([...states.values()].filter(Boolean).length, 5);
        assert.equal(states.get('drums'), true);
    }
    assert.ok(inspected >= 20);
});

test('Patch mutes the manual loops before any randomise work can fail', async () => {
    const { context, states } = fixture();
    vm.runInContext(functionSource('muteRandomizeManualLoopLayers'), context);
    context.suspendFinalReverbImpulseUpdates = () => { throw new Error('fixture interruption'); };
    vm.runInContext(functionSource('runPatchRandomization', true), context);
    await assert.rejects(context.runPatchRandomization(), /fixture interruption/);
    for (const key of manualKeys) assert.equal(states.get(key), false, key);
});

test('Mega and Sparse mute on entry and their shared settings never re-enable manual loops', async () => {
    assert.match(functionSource('runMegaRandomization', true), /if \(megaRandomizeInFlight\) return;\s*muteRandomizeManualLoopLayers\(\);/);
    assert.doesNotMatch(functionSource('randomizeMegaBastardLoopSettings'), /setBastardLoop(?:M(?:Plus)?|K)Enabled\(true/);
    for (const sparseMode of [false, true]) {
        const { context, states } = fixture();
        context.megaRandomizeInFlight = false;
        context.syncPerformanceControlState = () => { throw new Error('fixture interruption'); };
        vm.runInContext(functionSource('muteRandomizeManualLoopLayers'), context);
        vm.runInContext(functionSource('runMegaRandomization', true), context);
        await assert.rejects(context.runMegaRandomization({ sparseMode }), /fixture interruption/);
        for (const key of manualKeys) assert.equal(states.get(key), false, key);
    }
});
