const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function source(name) {
    const start = html.indexOf(`        function ${name}(`);
    assert.ok(start >= 0, name);
    const end = html.indexOf('\n        function ', start + 20);
    return html.slice(start, end);
}
function fixture() {
    const inputs = new Map(['performanceBastardLoopKRecordSteps', 'performanceKeyboardKRecordSteps'].map(id => [id, {}]));
    const context = {bastardLoopKRecordingSteps: null, bastardLoopKRecordingState: 'idle', pattern: 16, saves: 0,
        document: {getElementById: id => inputs.get(id), querySelectorAll: () => []},
        getPatternLengthSteps: () => context.pattern, getLoopBarDurationSeconds: bpm => 240 / (bpm || 120), PATTERN_STEPS_PER_BAR: 16,
        saveState: () => context.saves++};
    vm.createContext(context);
    for (const name of ['getBastardLoopKRecordingSteps', 'syncBastardLoopKRecordingLengthControls', 'setBastardLoopKRecordingSteps', 'restoreBastardLoopKRecordingSteps', 'formatBastardLoopKRecordingSteps', 'getBastardLoopKRecordingDurationSeconds']) vm.runInContext(source(name), context);
    return {context, inputs};
}
test('default follows the pattern; custom steps are synchronized and independent until reset', () => {
    const {context: c, inputs} = fixture();
    assert.equal(c.getBastardLoopKRecordingSteps(), 16);
    c.pattern = 32; c.syncBastardLoopKRecordingLengthControls();
    assert.equal(inputs.get('performanceKeyboardKRecordSteps').value, '32');
    c.setBastardLoopKRecordingSteps(73);
    c.pattern = 8; c.syncBastardLoopKRecordingLengthControls();
    assert.equal(c.getBastardLoopKRecordingSteps(), 73);
    assert.equal(inputs.get('performanceBastardLoopKRecordSteps').value, '73');
    c.setBastardLoopKRecordingSteps(null); assert.equal(c.getBastardLoopKRecordingSteps(), 8);
    c.bastardLoopKRecordingState = 'countin'; c.syncBastardLoopKRecordingLengthControls();
    assert.equal(inputs.get('performanceKeyboardKRecordSteps').disabled, true);
});
test('whole steps have no fixed musical maximum and durations use a sixteenth-note step', () => {
    const {context: c} = fixture();
    for (const steps of [1, 19, 73, 2048, 1e9]) {
        c.setBastardLoopKRecordingSteps(steps);
        assert.equal(c.getBastardLoopKRecordingDurationSeconds(120), steps / 8);
    }
    for (const bad of [0, -1, 1.5, NaN, Infinity, 'broken', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => c.setBastardLoopKRecordingSteps(bad), /positive whole number/);
    assert.equal(c.getBastardLoopKRecordingSteps(), 1e9);
});
test('legacy saved loop multipliers migrate to steps; modern null/custom state restores exactly', () => {
    const {context: c} = fixture();
    for (const loops of [1, 2, 8]) {
        c.restoreBastardLoopKRecordingSteps({sliders: {performanceBastardLoopKRecordLength: String(loops)}});
        assert.equal(c.bastardLoopKRecordingSteps, loops === 1 ? null : loops * 16);
    }
    c.restoreBastardLoopKRecordingSteps({modes: {bastardLoopKRecordingSteps: 73}, sliders: {performanceBastardLoopKRecordLength: '2'}});
    assert.equal(c.getBastardLoopKRecordingSteps(), 73);
    c.restoreBastardLoopKRecordingSteps({modes: {bastardLoopKRecordingSteps: null}});
    c.pattern = 64; assert.equal(c.getBastardLoopKRecordingSteps(), 64);
    c.restoreBastardLoopKRecordingSteps({modes: {bastardLoopKRecordingSteps: -7}});
    assert.equal(c.bastardLoopKRecordingSteps, null); assert.equal(c.saves, 0);
});
test('K accepts a valid take over three minutes without changing mic/import duration limits', async () => {
    const buffer = {duration: 181};
    const c = {Number, audioContext: {}, document: {getElementById: () => ({value: '120'})},
        bastardLoopKSourceBpm: 120, bastardLoopKRecordingSteps: 1448, bastardLoopPlaying: false,
        clampBpmValue: Number, rerenderBastardLoopKFromRaw() {}, saveAudioBufferToDB: async () => {},
        BASTARD_LOOP_K_AUDIO_BUFFER_KEY: 'K', syncBastardLoopKUi() {}, setStatus() {}};
    vm.createContext(c);
    const start = html.indexOf('        async function applyRecordedBastardLoopKBuffer(');
    const end = html.indexOf('        function recordKeyboardKAtTime(', start);
    vm.runInContext(html.slice(start, end), c);
    await c.applyRecordedBastardLoopKBuffer(buffer, {recordingSteps: 1448});
    assert.equal(c.bastardLoopKRawBuffer, buffer); assert.equal(c.bastardLoopKMetadata.recordingSteps, 1448);
    assert.match(html, /Bastardloop M audio longer than/);
    assert.doesNotMatch(html.slice(start, end), /MAX_SAMPLE_DURATION_SECONDS/);
});
