const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
    const start = html.indexOf(`        function ${name}(`);
    assert.notEqual(start, -1, name);
    const end = html.indexOf('\n        }', start);
    assert.notEqual(end, -1, name);
    return html.slice(start, end + '\n        }'.length);
}

function parameter(value = 0) {
    return {
        value,
        ramps: [],
        cancelScheduledValues() {},
        setValueAtTime(nextValue) { this.value = nextValue; },
        linearRampToValueAtTime(nextValue, time) { this.value = nextValue; this.ramps.push({ value: nextValue, time }); }
    };
}

function fixture(amount, invert = false) {
    const lfoSource = { connections: [], connect(node) { this.connections.push(node); } };
    const voice = { filterNodes: [{ frequency: parameter(12000) }, { frequency: parameter(12000) }] };
    const slider = { value: '12000', addEventListener(event, handler) { this.handler = handler; } };
    const context = {
        audioContext: {
            state: 'running', currentTime: 2,
            createGain: () => ({ gain: parameter(1), connect() {} }),
            createConstantSource: () => ({ offset: parameter(1), connect() {}, start() {}, stop() {} })
        },
        bastardLoopXActiveVoices: new Set([voice]),
        sequencerKeyboardHolds: new Set(),
        bastardLoopXFilterCutoff: 12000,
        performanceBastardLoopXFilterCutoff: slider,
        getBastardLoopXFilterCutoff: () => Number(slider.value),
        getBastardLoopXFilterLfoAmount: () => amount,
        getBastardLoopXFilterLfoInvert: () => invert,
        clampBastardLoopFilterCutoff: value => Math.max(50, Math.min(18000, Math.round(Number(value)))),
        ensureBastardLoopXFilterLfoSource: () => lfoSource,
        updateBastardLoopXDelayBusSettings() {},
        syncBastardLoopXUi() {},
        saveState() {},
        safeDisconnectNode() {}
    };
    vm.createContext(context);
    for (const name of ['getSequencerKeyboardVoices', 'rampBastardLoopXDelayParam', 'smoothBastardLoopFilterCutoff', 'getBastardLoopXFilterLfoDepthHz', 'destroyBastardLoopXVoiceLfo', 'attachBastardLoopXFilterLfoToVoice', 'updateBastardLoopXVoiceFx']) {
        vm.runInContext(functionSource(name), context);
    }
    const listener = html.match(/performanceBastardLoopXFilterCutoff\?\.addEventListener\('input', \(event\) => \{[\s\S]*?\n        \}\);/);
    assert.ok(listener);
    vm.runInContext(listener[0], context);
    context.attachBastardLoopXFilterLfoToVoice(voice, 12000);
    return { context, voice, slider, lfoSource };
}

for (const [cutoff, amount, invert] of [[600, .8, false], [600, .8, true], [50, 1, false], [600, 0, false], [18000, 1, false]]) {
    test(`X cutoff input updates existing voices and LFO together: ${cutoff} Hz / ${amount} / invert ${invert}`, () => {
        const { context, voice, slider, lfoSource } = fixture(amount, invert);
        const originalDepth = voice.filterLfoDepthGain;
        const originalOffset = voice.filterLfoOffsetSource;
        slider.value = String(cutoff);
        slider.handler({ target: slider });
        const halfDepth = (cutoff - 50) * amount * .5;
        assert.equal(context.bastardLoopXFilterCutoff, cutoff);
        assert.equal(voice.filterLfoDepthGain.gain.value, invert ? -halfDepth : halfDepth);
        assert.equal(voice.filterLfoOffsetSource.offset.value, -halfDepth);
        for (const filter of voice.filterNodes) {
            assert.equal(filter.frequency.value, cutoff);
            assert.equal(filter.frequency.ramps.at(-1).time, 2.03);
        }
        assert.equal(voice.filterLfoDepthGain.gain.ramps.at(-1).time, 2.03);
        assert.equal(voice.filterLfoOffsetSource.offset.ramps.at(-1).time, 2.03);
        assert.equal(voice.filterLfoDepthGain, originalDepth);
        assert.equal(voice.filterLfoOffsetSource, originalOffset);
        assert.equal(voice.filterLfoSourceNode, lfoSource);
        assert.equal(lfoSource.connections.length, 1);
    });
}

test('X repeated cutoff changes leave old and newly attached voices at the same modulation range', () => {
    const { context, voice, slider } = fixture(.8);
    for (const cutoff of [9000, 1800, 600, 2400, 120]) {
        slider.value = String(cutoff);
        slider.handler({ target: slider });
        const nextVoice = { filterNodes: [{ frequency: parameter(cutoff) }] };
        context.attachBastardLoopXFilterLfoToVoice(nextVoice, cutoff);
        assert.equal(voice.filterLfoDepthGain.gain.value, nextVoice.filterLfoDepthGain.gain.value);
        assert.equal(voice.filterLfoOffsetSource.offset.value, nextVoice.filterLfoOffsetSource.offset.value);
    }
});

test('X cutoff changes without active notes are retained for the next voice', () => {
    const { context, slider } = fixture(.8);
    context.bastardLoopXActiveVoices.clear();
    slider.value = '600';
    slider.handler({ target: slider });
    const voice = { filterNodes: [{ frequency: parameter(600) }] };
    context.attachBastardLoopXFilterLfoToVoice(voice);
    assert.equal(context.bastardLoopXFilterCutoff, 600);
    assert.equal(voice.filterLfoDepthGain.gain.value, 220);
    assert.equal(voice.filterLfoOffsetSource.offset.value, -220);
});

test('X held keyboard samples follow live filter/LFO changes alongside transport voices', () => {
    const { context, slider } = fixture(.8);
    const heldVoice = { filterNodes: [{ frequency: parameter(12000) }] };
    context.sequencerKeyboardHolds.add({ layer: 'X', voice: heldVoice });
    slider.value = '600';
    context.updateBastardLoopXVoiceFx();
    assert.equal(heldVoice.filterNodes[0].frequency.value, 600);
    assert.equal(heldVoice.filterLfoDepthGain.gain.value, 220);
    assert.equal(heldVoice.filterLfoOffsetSource.offset.value, -220);
});
