const test = require('node:test'), assert = require('node:assert/strict');
const dsp = require('../drum-tone.js');
const buffer = channels => ({ numberOfChannels: channels.length, getChannelData: i => channels[i] });
test('linked stereo peak normalization preserves raw PCM, channel balance and dynamics', async () => {
    const left = Float32Array.of(.01, -.1, .04), right = Float32Array.of(.005, -.05, .02);
    const original = Array.from(left), sample = buffer([left, right]);
    const normalized = await dsp.analyzeSample(sample);
    assert(normalized.enabled); assert(Math.abs(normalized.gain * .1 - 10 ** (-6 / 20)) < 1e-7);
    assert.deepEqual(Array.from(left), original); assert.equal(left[0] / right[0], 2);
    const state = dsp.sampleState(); state.lanes.snare = normalized;
    assert.equal(dsp.sampleGain(state, 'roll'), normalized.gain);
    state.lanes.snare.enabled = false; assert.equal(dsp.sampleGain(state, 'snare'), 1);
});
test('normalization guards silence/noise, caps boost, attenuates hot sources and rejects nonfinite PCM', async () => {
    for (const values of [[0, 0], [.00001, -.00001], [.01, ...Array(20000).fill(0)]]) {
        const measured = await dsp.analyzeSample(buffer([Float32Array.from(values)]));
        assert.equal(measured.enabled, false); assert.equal(measured.gain, 1);
    }
    assert.equal((await dsp.analyzeSample(buffer([Float32Array.of(.002, -.002)]))).gain, dsp.MAX_NORMALIZE_GAIN);
    assert((await dsp.analyzeSample(buffer([Float32Array.of(2, -2)]))).gain < 1);
    await assert.rejects(dsp.analyzeSample(buffer([Float32Array.of(NaN)])));
});
test('legacy saved processing is unity/legacy; fresh patches choose smooth without altering PCM', () => {
    const legacy = dsp.sampleState(), fresh = dsp.sampleState(null, true);
    assert.equal(legacy.snareDrive, 'legacy'); assert.equal(fresh.snareDrive, 'smooth');
    for (const lane of dsp.SAMPLE_LANES) assert.equal(dsp.sampleGain(legacy, lane), 1);
    assert.deepEqual(dsp.sampleState(JSON.parse(JSON.stringify(fresh))), fresh);
    for (const gain of [-1, 0, Infinity, 20, '2']) assert.throws(() => dsp.sampleState({ version: 1, lanes: { snare: { gain } } }));
    assert.throws(() => dsp.sampleState({ version: 2, lanes: {} }));
});
test('smooth distortion has no low-drive attenuation, DC bias or unbounded output', () => {
    for (const amount of [0, .01, .05, .1, .25, .5, 1]) {
        const curve = dsp.snareCurve(amount); assert.equal(curve[1024], 0);
        for (let i = 0; i < curve.length; i++) {
            const x = 2 * i / (curve.length - 1) - 1;
            assert(Number.isFinite(curve[i]) && Math.abs(curve[i]) <= 1);
            assert(Math.abs(curve[i]) + 1e-7 >= Math.abs(x));
            assert(Math.abs(curve[i] + curve[curve.length - 1 - i]) < 1e-7);
            if (amount === 0) assert.equal(curve[i], x);
        }
    }
});
test('render revision requires audible normalization or smooth distortion, not next-load preferences', () => {
    const state = { modes: { drumMachineEnabled: true, drumMachineSnarePattern: [true] }, sliders: {} }, assets = [{ key: 'drumSnare' }];
    assert.equal(dsp.sampleRenderState(state, assets), null);
    state.modes.drumMachineSampleProcessing = dsp.sampleState(null, true);
    assert.equal(dsp.sampleRenderState(state, assets), null);
    state.sliders.drumMachineSnareDistortion = '1';
    assert.deepEqual(dsp.sampleRenderState(state, assets), { version: 1, gains: {}, snareDrive: 'smooth' });
    state.sliders.drumMachineSnareDistortion = '0';
    state.modes.drumMachineSampleProcessing.lanes.snare = { enabled: true, gain: 4, peak: .125 };
    assert.equal(dsp.sampleRenderState(state, assets).gains.snare, 4);
    state.modes.drumMachineEnabled = false; assert.equal(dsp.sampleRenderState(state, assets), null);
});
