const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { extractFunction } = require('./transport-latency.test.js');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function fixture() {
    const params = () => ({ value: 0 });
    const state = {
        transportSync: { latency: { status: 'unavailable', seconds: 0 } },
        audioContext: { state: 'running', currentTime: 1 },
        fxMuted: false, idle: false,
        shouldIdleBypassFinalBusCompressor() { return state.idle; },
        getFinalCompressorAmount: () => .8, getFinalCompressorReleaseSeconds: () => .1,
        getFinalCompressorSidechainAmount: () => 1,
        getFinalCompressorSidechainDetector: () => 1,
        smoothEffectParam(param, value) { if (param) param.value = value; },
        finalCompressorDriveGain: { gain: params() }, finalSidechainGain: { gain: params() },
        finalCompressorNode: Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, params()]))
    };
    vm.createContext(state);
    for (const name of ['getTransportOutputLatencySeconds', 'getTransportCompressorLatencySeconds',
        'getTransportPreCompressorLatencySeconds', 'getFinalCompressorSettings', 'updateFinalCompressorDynamics']) {
        vm.runInContext(extractFunction(html, name), state);
    }
    return state;
}
for (const rate of [44100, 48000]) {
    test(`shared lookahead is excluded from direct/return alignment at ${rate}Hz`, () => {
        const s = fixture(), lookahead = Math.round(rate * .006), upstream = 128;
        s.transportSync.latency = { status: 'measured', sampleRate: rate, baseOutputFrames: lookahead, seconds: (lookahead + upstream) / rate };
        assert.ok(Math.abs(s.getTransportPreCompressorLatencySeconds() - upstream / rate) < 1e-10);
        assert.equal(s.getTransportCompressorLatencySeconds(), lookahead / rate);
    });
}
test('unavailable or older incomplete timing metadata never invents a negative delay', () => {
    const s = fixture();
    assert.equal(s.getTransportPreCompressorLatencySeconds(), 0);
    s.transportSync.latency = { status: 'measured', seconds: .026 };
    assert.equal(s.getTransportPreCompressorLatencySeconds(), .026);
    assert.equal(s.getTransportCompressorLatencySeconds(), 0);
});
test('sidechain ducking does not alter the common compressor drive', () => {
    const s = fixture(); s.updateFinalCompressorDynamics();
    assert.ok(s.finalCompressorDriveGain.gain.value > 1);
    assert.equal(s.finalSidechainGain.gain.value, 0);
    assert.ok(s.finalCompressorNode.ratio.value > 1);
});
test('idle silence is local to music and cannot mute independent drum returns', () => {
    const s = fixture(); s.idle = true; s.updateFinalCompressorDynamics();
    assert.equal(s.finalCompressorDriveGain.gain.value, 1);
    assert.equal(s.finalSidechainGain.gain.value, 0);
    assert.equal(s.finalCompressorNode.ratio.value, 1);
});
test('FX mute uses unity shared compression and no ducking', () => {
    const s = fixture(); s.fxMuted = true; s.updateFinalCompressorDynamics();
    assert.equal(s.finalCompressorDriveGain.gain.value, 1);
    assert.equal(s.finalCompressorNode.ratio.value, 1);
    assert.equal(s.finalSidechainGain.gain.value, 1);
});
test('kick detector is evaluated before lookahead without changing its audible event timestamps', () => {
    const s = fixture(); let detectorTime;
    Object.assign(s, { normalizeFinalCompressorSidechainSource: value => value,
        finalCompressorSidechainSource: 'kick',
        getFinalKickSidechainDetector: time => { detectorTime = time; return .75; } });
    s.transportSync.latency = { status: 'measured', sampleRate: 48000, baseOutputFrames: 288, seconds: .009 };
    vm.runInContext(extractFunction(html, 'getFinalCompressorSidechainDetector'), s);
    assert.equal(s.getFinalCompressorSidechainDetector(1), .75);
    assert.equal(detectorTime, 1.006);
});
test('offline drum returns share the same compressor as the main export, without a feedback edge', () => {
    const audio = require('./drum-parallel-fx-fixture.js');
    const sources = audio.collectSources(html);
    for (const name of ['createOfflineFinalFxBus', 'getFinalCompressorSettings']) {
        sources.names.push(name); sources.functions.push(extractFunction(html, name));
    }
    const ctx = audio.createFakeContext(48000); ctx.length = 48000;
    const f = audio.createFixture(sources, ctx, { globals: { fxMuted: false, finalReverbEnabled: false,
        getFinalCompressorAmount: () => .3, getFinalReverbRoomPreset: () => 'cloud' } });
    const input = f.functions.createOfflineFinalFxBus(ctx, ctx.destination, 120);
    const returns = audio.graphPaths(input.drumSendFxGraph.returnPanner, ctx.destination);
    assert.ok(returns.length > 0);
    for (const path of returns) assert.equal(path.filter(node => node.kind === 'DynamicsCompressor').length, 1);
    const compressors = new Set(returns.flat().filter(node => node.kind === 'DynamicsCompressor'));
    for (const path of audio.graphPaths(input, ctx.destination)) assert.equal(path.filter(node => compressors.has(node)).length, 1);
    assert.equal(audio.graphPaths(input.drumSendFxGraph.returnPanner, input).length, 0);
});
