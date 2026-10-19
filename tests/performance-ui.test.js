const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Controller } = require('../q-card.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extract(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(name);
}

function fixture(names, values) {
    const context = vm.createContext(values);
    for (const name of names) vm.runInContext(extract(name), context);
    return context;
}

function button() {
    const classes = new Set();
    const writes = [];
    return { classes, writes, classList: { add: value => { classes.add(value); writes.push(value); }, remove: value => { classes.delete(value); writes.push(value); } } };
}

test('static effect parameters stop scheduling only after their original ramps settle', () => {
    const calls = [];
    const context = fixture(['smoothEffectParam'], { effectParamTargets: new WeakMap(), smoothGainParam: (...args) => calls.push(args) });
    const parameter = { value: 0 };
    context.smoothEffectParam(parameter, .7);
    context.smoothEffectParam(parameter, .7);
    assert.equal(calls.length, 2);
    parameter.value = Math.fround(.7);
    context.smoothEffectParam(parameter, .7);
    assert.equal(calls.length, 2);
    context.smoothEffectParam(parameter, .8);
    assert.equal(calls.length, 3);
    parameter.value = .1;
    context.smoothEffectParam(parameter, .8);
    assert.equal(calls.length, 4);
    context.smoothEffectParam({ value: Math.fround(.8) }, .8);
    assert.equal(calls.length, 5);
});

test('changing modulation targets retain every update and the requested ramp duration', () => {
    const calls = [];
    const context = fixture(['smoothEffectParam'], { effectParamTargets: new WeakMap(), smoothGainParam: (...args) => calls.push(args) });
    const parameter = { value: .5 };
    for (const value of [.5, .6, .5, .4, .5]) context.smoothEffectParam(parameter, value, .06);
    assert.deepEqual(calls.map(call => call.slice(1)), [[.5, .06], [.6, .06], [.5, .06], [.4, .06], [.5, .06]]);
});

test('distortion caches are per node and invalidate on depth, mute and graph replacement', () => {
    const calls = [];
    const context = fixture(['updateFinalDistortionCurve'], { finalDistortionNodeAmounts: new WeakMap(), makeFinalDistortionCurve: (type, amount) => { calls.push([type, amount]); return amount; } });
    for (const type of ['soft', 'hard', 'fold', 'crush']) {
        const node = {};
        context.updateFinalDistortionCurve(node, type, .4);
        context.updateFinalDistortionCurve(node, type, .4);
        context.updateFinalDistortionCurve(node, type, 0);
        context.updateFinalDistortionCurve(node, type, .4);
        context.updateFinalDistortionCurve({}, type, .4);
    }
    assert.equal(calls.length, 16);
});

test('identical meter values produce no repeated style, text or accessibility writes', () => {
    let writes = 0;
    const attributes = new Map();
    const shell = { getAttribute: key => attributes.get(key), setAttribute: (key, value) => { attributes.set(key, value); writes += 1; } };
    const style = () => new Proxy({}, { set(target, key, value) { target[key] = value; writes += 1; return true; } });
    const fill = { style: style() };
    const peak = { style: style() };
    let label = '';
    const value = { get textContent() { return label; }, set textContent(next) { label = next; writes += 1; } };
    const context = fixture(['updatePerformanceVuDisplay'], {});
    context.updatePerformanceVuDisplay(shell, fill, peak, value, 40, 50, -20);
    assert.equal(writes, 5);
    context.updatePerformanceVuDisplay(shell, fill, peak, value, 40, 50, -20);
    assert.equal(writes, 5);
    context.updatePerformanceVuDisplay(shell, fill, peak, value, 0, 0, -Infinity);
    assert.equal(label, '-inf dB');
    assert.equal(attributes.get('aria-valuetext'), 'silent');
});

test('offscreen channel meters neither attach analysers nor read samples', () => {
    const calls = [];
    const context = fixture(['updatePerformanceMixerVuChannel'], {
        getPerformanceMixerVuDomIds: () => ({}), document: { getElementById: () => ({}) }, isPerformanceElementVisible: () => false,
        disconnectPerformanceMixerVuTap: id => calls.push(id), syncPerformanceMixerVuTap: () => { throw new Error('Hidden analyser attached'); }
    });
    context.updatePerformanceMixerVuChannel({ controlId: 'bass' });
    assert.deepEqual(calls, ['bass']);
});

test('meter scheduler runs at 20 Hz and does not keep running in a hidden document', () => {
    const timers = [];
    const calls = [];
    const context = fixture(['startPerformanceMixerVuMeters'], {
        performanceControlsReady: true, stopPerformanceMixerVuMeters: () => calls.push('stop'), performanceMixerVuMetersEnabled: true, performanceMixerVuTimerId: null,
        document: { hidden: false }, PERFORMANCE_MIXER_VU_CHANNELS: [{}], updatePerformanceMixerVuChannel: () => calls.push('channel'),
        performanceOutputVuShell: {}, performanceMixerVuShell: {}, isPerformanceElementVisible: () => false,
        updatePerformanceVuMeter: () => { throw new Error('Hidden output updated'); }, readFinalPanRms: () => { throw new Error('Hidden output sampled'); },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }
    });
    context.startPerformanceMixerVuMeters();
    assert.equal(timers[0].delay, 50);
    timers[0].callback();
    assert.equal(timers.length, 2);
    assert.deepEqual(calls, ['stop', 'channel']);
    context.document.hidden = true;
    timers[1].callback();
    assert.equal(timers.length, 2);
    assert.equal(context.performanceMixerVuTimerId, null);
});

test('visibility uses observer notifications without synchronous layout polling', () => {
    const observed = [];
    const visible = new WeakSet();
    const context = fixture(['isPerformanceElementVisible'], {
        document: { hidden: false }, performanceVisibleElements: visible, performanceObservedElements: new WeakSet(),
        performanceVisibilityObserver: { observe: element => observed.push(element) }
    });
    const element = {};
    assert.equal(context.isPerformanceElementVisible(element), false);
    visible.add(element);
    assert.equal(context.isPerformanceElementVisible(element), true);
    assert.equal(observed.length, 1);
    context.document.hidden = true;
    assert.equal(context.isPerformanceElementVisible(element), false);
});

test('visibility fallback excludes hidden, empty and offscreen elements', () => {
    const context = fixture(['isPerformanceElementVisible'], { document: { hidden: false }, performanceVisibilityObserver: null, window: { innerWidth: 390, innerHeight: 844 } });
    const element = bounds => ({ getBoundingClientRect: () => bounds });
    assert.equal(context.isPerformanceElementVisible(element({ width: 10, height: 10, top: 20, bottom: 30, left: 0, right: 10 })), true);
    assert.equal(context.isPerformanceElementVisible(element({ width: 10, height: 10, top: 850, bottom: 860, left: 0, right: 10 })), false);
    assert.equal(context.isPerformanceElementVisible(element({ width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 })), false);
});

test('drum visual scheduling still advances while closed without rendering full grids', () => {
    const context = fixture(['scheduleDrumMachineVisualStep', 'updateDrumMachinePlayhead'], {
        audioContext: { currentTime: 1 }, drumMachinePlaying: true, drumMachineCurrentVisualStep: -1,
        document: { getElementById: () => ({ hidden: true }) }, setTimeout: (callback, delay) => { assert.equal(delay, 125); callback(); }
    });
    context.scheduleDrumMachineVisualStep(7, 1.125);
    assert.equal(context.drumMachineCurrentVisualStep, 7);
});

test('full drum-grid rendering is deferred while the editor is closed', () => {
    const context = fixture(['renderDrumMachineStepGrid'], { document: { hidden: false, getElementById: id => {
        assert.equal(id, 'drumMachineOverlay');
        return { hidden: true };
    } } });
    context.renderDrumMachineStepGrid('kick');
});

test('unchanged drum patterns reuse their grid while edits invalidate the render signature', () => {
    const pattern = [true, false];
    const ratchets = [0, 2];
    const grid = { childElementCount: 2, setAttribute: () => { throw new Error('Grid render required'); } };
    const signatures = new WeakMap([[grid, JSON.stringify([pattern, ratchets, undefined, true])]]);
    const context = fixture(['renderDrumMachineStepGrid'], {
        document: { hidden: false, getElementById: id => id === 'drumMachineOverlay' ? { hidden: false } : grid },
        drumMachineExtraTracks: {}, getDrumMachinePattern: () => pattern, getDrumMachineTrackLabel: () => 'Kick', drumMachineKickRatchetPattern: ratchets,
        drumMachineGridRenderSignatures: signatures, drumMachinePlaying: true
    });
    context.renderDrumMachineStepGrid('kick');
    pattern[1] = true;
    assert.throws(() => context.renderDrumMachineStepGrid('kick'), /Grid render required/);
    context.drumMachinePlaying = false;
    assert.throws(() => context.renderDrumMachineStepGrid('kick'), /Grid render required/);
});

test('drum playheads touch only previous/current cells of visible grids', () => {
    const previous = button();
    const current = button();
    const grid = { querySelector: () => previous, children: [{ querySelector: () => current }] };
    const context = fixture(['updateDrumMachinePlayhead'], {
        document: { hidden: false, getElementById: id => id === 'drumMachineOverlay' ? { hidden: false } : id === 'drumMachineKickGrid' ? grid : {} },
        drumMachineExtraTracks: { clap: { id: 'drumMachineClap' }, cymbals: { id: 'drumMachineCymbals' } },
        drumMachinePlaying: true, drumMachineCurrentVisualStep: 0, isPerformanceElementVisible: element => element === grid
    });
    context.updateDrumMachinePlayhead();
    assert.deepEqual(previous.writes, ['current']);
    assert.deepEqual(current.writes, ['current']);
});

test('Q skips hidden visual work and changes only the old and new playhead cells', () => {
    const previousDocument = global.document;
    const previous = button();
    const current = button();
    const overlay = { hidden: true };
    let selected = previous;
    const grid = { querySelector: () => selected, children: [current] };
    try {
        global.document = { hidden: false, getElementById: id => id === 'bastardLoopQOverlay' ? overlay : grid };
        const controller = new Controller({ context: () => null });
        assert.equal(controller.updatePlayhead(0), false);
        controller.reflectPlaying();
        assert.equal(controller.playingFingerprint, null);
        overlay.hidden = false;
        assert.equal(controller.updatePlayhead(0), true);
        assert.deepEqual(previous.writes, ['playing']);
        assert.deepEqual(current.writes, ['playing']);
        selected = current;
        assert.equal(controller.updatePlayhead(0), false);
        assert.equal(current.writes.length, 1);
    } finally {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
    }
});

test('early mixer lifecycle entry points do not touch uninitialized bindings', () => {
    // Deliberately provide no late-bound meter state or DOM dependencies: any
    // access before the readiness barrier must fail this regression.
    const context = fixture(['startPerformanceMixerVuMeters', 'stopPerformanceMixerVuMeters',
        'updatePerformanceVuMeter', 'syncPerformanceMixerVuVisibility', 'setPerformanceMixerVuMetersEnabled'], {
        performanceControlsReady: false
    });
    assert.doesNotThrow(() => {
        context.startPerformanceMixerVuMeters();
        context.stopPerformanceMixerVuMeters();
        context.updatePerformanceVuMeter(.2);
        context.syncPerformanceMixerVuVisibility();
        context.setPerformanceMixerVuMetersEnabled(false);
    });
});
