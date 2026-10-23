const test = require('node:test');
const assert = require('node:assert/strict');
const theory = require('../q-theory.js');
const { Piano } = require('../q-card.js');

test('capturing a complete saved bank keeps its exact PCM, source rate and atlas identity', async () => {
    const state = theory.defaults();
    state.sequence[0] = theory.normalizeStep({ notes: [48], velocity: 96 });
    const piano = new Piano({ context: () => { throw new Error('No atlas allocation or resampling needed'); } });
    const atlas = { sampleRate: 48000 };
    const bank = { version: 1, sampleRate: 48000, samples: [{ id: 'C3v12', midi: 48, velocity: 95, offset: 0, frames: 4800 }] };
    piano.restored(atlas, bank);
    await piano.capture(state);
    assert.equal(piano.atlas, atlas); assert.deepEqual(piano.bank, bank);
});

test('adding a missing note to a different-rate bank resamples its segment instead of copying wrong frame offsets', async () => {
    const saved = global.OfflineAudioContext;
    const starts = [];
    global.OfflineAudioContext = class {
        constructor(channels, frames, rate) { assert.equal(rate, 44100); this.frames = frames; }
        createBufferSource() { return { connect() {}, disconnect() {}, start: (...args) => starts.push(args), buffer: null }; }
        async startRendering() { return { sampleRate: 44100, getChannelData: () => new Float32Array(this.frames).fill(.25) }; }
    };
    try {
        const state = theory.defaults(); state.sequence[0] = theory.normalizeStep({ notes: [48, 52], velocity: 96 });
        const context = { sampleRate: 44100, createBuffer: (channels, frames) => {
            const data = Array.from({ length: channels }, () => new Float32Array(frames));
            return { sampleRate: 44100, getChannelData: channel => data[channel] };
        } };
        const piano = new Piano({ context: () => context });
        piano.atlas = { sampleRate: 48000 }; piano.ensure = async () => {};
        piano.source = midi => ({ sample: { id: `${midi}v12`, midi, velocity: 95 }, buffer: midi === 48 ? piano.atlas : { sampleRate: 44100, getChannelData: () => new Float32Array(441).fill(.5) }, offset: midi === 48 ? .2 : 0, duration: .01 });
        await piano.capture(state);
        assert.deepEqual(starts, [[0, .2, .01]]);
        assert.equal(piano.bank.sampleRate, 44100);
        assert.equal(piano.atlas.getChannelData(0)[0], .25);
        assert.equal(piano.atlas.getChannelData(0)[piano.bank.samples[1].offset], .5);
    } finally { global.OfflineAudioContext = saved; }
});
