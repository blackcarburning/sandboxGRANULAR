const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function extract(name) {
    const start = html.indexOf(`function ${name}(`);
    let body = html.indexOf(') {', start) + 2, depth = 0;
    assert.ok(start > 0, name);
    for (let i = body; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}') depth--;
        if (!depth) return html.slice(start, i + 1);
    }
    throw Error(name);
}
function fixture() {
    const controls = new Map();
    for (const id of ['performanceBastardLoopKInputGain', 'performanceBastardLoopKInputGainValue',
        ...['Shell', 'Fill', 'Peak', 'Value'].map(s => `performanceKeyboardRecordingVu${s}`)]) controls.set(id, { style: {} });
    let reads = 0, renders = 0, saves = 0, observers = [];
    const timers = new Set();
    function source() { return { outputs: new Set(), gain: { setTargetAtTime(value) { this.value = value; } },
        connect(n) { this.outputs.add(n); }, disconnect(n) { this.outputs.delete(n); } }; }
    const gain = source();
    const c = vm.createContext({ Float32Array, Math, Number, keyboardSoundSource: 'grain', keyboardRecordingLevels: {},
        bastardLoopKInputGain: 1, keyboardRecordingGainNode: gain, keyboardRecordingMeterTimer: null,
        keyboardRecordingMeterTap: null, keyboardRecordingMeterVisible: false, keyboardRecordingMeterObserver: null,
        document: { hidden: false, getElementById: id => controls.get(id), addEventListener() {} },
        IntersectionObserver: class { constructor(cb) { observers.push(cb); } observe() {} },
        setTimeout(cb) { const timer = { cb }; timers.add(timer); return timer; }, clearTimeout(t) { timers.delete(t); },
        audioContext: { currentTime: 2, state: 'running', createAnalyser() { return { fftSize: 0,
            disconnect() {}, getFloatTimeDomainData(data) { reads++; data.fill(gain.gain.value * .1); } }; } },
        saveState() { saves++; }, updatePerformanceVuDisplay() { renders++; }
    });
    for (const name of ['normalizeKeyboardSoundSource', 'getBastardLoopKInputGainPercent', 'syncKeyboardRecordingLevel',
        'setBastardLoopKInputGainPercent', 'stopKeyboardRecordingMeter', 'syncKeyboardRecordingMeter', 'initKeyboardRecordingMeter']) vm.runInContext(extract(name), c);
    return { c, gain, controls, timers, source, observers, counts: () => ({ reads, renders, saves }) };
}
test('each instrument gets a raised recording default; overrides and zero are independent of live playback', () => {
    const { c, gain, controls } = fixture();
    for (const [sound, expected] of Object.entries({ grain: 160, osc: 180, piano: 250, strings: 250 })) {
        c.keyboardSoundSource = sound; c.syncKeyboardRecordingLevel();
        assert.equal(c.getBastardLoopKInputGainPercent(), expected);
        assert.equal(controls.get('performanceBastardLoopKInputGain').value, String(expected));
        assert.equal(gain.gain.value, expected / 100);
    }
    c.keyboardSoundSource = 'piano'; c.setBastardLoopKInputGainPercent(0);
    c.keyboardSoundSource = 'grain'; c.setBastardLoopKInputGainPercent(230);
    c.keyboardSoundSource = 'piano'; c.syncKeyboardRecordingLevel();
    assert.equal(gain.gain.value, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(c.keyboardRecordingLevels)), { piano: 0, grain: 230 });
    c.setBastardLoopKInputGainPercent(1000); assert.equal(gain.gain.value, 4);
});
test('only the visible meter connects an analyser and runs its refresh timer; hiding disconnects both', () => {
    const { c, gain, timers, counts, observers, controls } = fixture();
    c.initKeyboardRecordingMeter();
    assert.equal(timers.size, 0); assert.equal(gain.outputs.size, 0); assert.equal(counts().renders, 0);
    observers[0]([{ target: controls.get('performanceKeyboardRecordingVuShell'), isIntersecting: true }]);
    assert.equal(timers.size, 1); assert.equal(gain.outputs.size, 1); assert.equal(counts().reads, 1);
    c.document.hidden = true; c.syncKeyboardRecordingMeter();
    assert.equal(timers.size, 0); assert.equal(gain.outputs.size, 0); assert.equal(counts().reads, 1);
    c.document.hidden = false; c.syncKeyboardRecordingMeter(); assert.equal(timers.size, 1);
    observers[0]([{ target: controls.get('performanceKeyboardRecordingVuShell'), isIntersecting: false }]);
    assert.equal(timers.size, 0); assert.equal(gain.outputs.size, 0);
});
test('meter context replacement disconnects the old graph and suspended contexts do no work', () => {
    const { c, gain, source, timers } = fixture();
    c.keyboardRecordingMeterVisible = true; c.syncKeyboardRecordingMeter(); assert.equal(gain.outputs.size, 1);
    c.keyboardRecordingGainNode = source(); c.syncKeyboardRecordingMeter();
    assert.equal(gain.outputs.size, 0); assert.equal(c.keyboardRecordingGainNode.outputs.size, 1);
    c.audioContext.state = 'suspended'; c.syncKeyboardRecordingMeter(); assert.equal(timers.size, 0);
    assert.equal(c.keyboardRecordingGainNode.outputs.size, 0);
});
test('one authoritative recording control lives below the keys, persists by instrument and is protected from randomise', () => {
    assert.equal((html.match(/id="performanceBastardLoopKInputGain"/g) || []).length, 1);
    const keyboard = html.slice(html.indexOf('<div class="performance-feature-card performance-keyboard-card"'), html.indexOf('<div class="performance-feature-card" id="performanceGrainControlsCard"'));
    assert.ok(keyboard.indexOf('id="performanceBastardLoopKInputGain"') > keyboard.indexOf('id="keyboardContainer"'));
    assert.match(extract('saveState'), /keyboardRecordingLevels: \{ \.\.\.keyboardRecordingLevels \}/);
    assert.match(extract('restoreState'), /state.modes\?\.keyboardRecordingLevels/);
    assert.match(html.slice(html.indexOf('const RANDOMIZE_SKIP_SLIDERS'), html.indexOf('const RANDOMIZE_SKIP_PARAMS')), /performanceBastardLoopKInputGain/);
});
