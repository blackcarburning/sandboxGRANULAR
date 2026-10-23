const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const theory = require('../q-theory.js');
const { Piano, Controller } = require('../q-card.js');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../SAMPLES_Q_STRINGS/manifest.json')));

function fixture() {
    const state = { ...theory.defaults(), instrument: 'strings' };
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55], velocity: 96 });
    state.bank = { version: 1, instrument: theory.instruments.strings.id, sampleRate: 44100,
        samples: [48, 52, 55].map((midi, index) => ({ id: `viola${midi}v96`, midi, velocity: 96, offset: index * 10, frames: 10, loopStart: 2, loopEnd: 10 })) };
    return { state, asset: { channels: 2, frames: 30, sampleRate: 44100 } };
}

test('legacy Q state still chooses piano while Strings selection survives serialization', () => {
    assert.equal(theory.normalizeState({}).instrument, 'piano');
    assert.equal(theory.normalizeState(JSON.parse(JSON.stringify({ instrument: 'strings' }))).instrument, 'strings');
});

test('every playable string pitch and velocity maps to one of 34 recorded section samples', () => {
    assert.equal(manifest.samples.length, 34);
    assert.equal(manifest.license, 'CC0 1.0');
    for (let midi = 21; midi <= 108; midi += 1) for (let velocity = 1; velocity <= 127; velocity += 1) {
        const sample = manifest.samples.find(item => item.midi === theory.sampleMidi(midi, 'strings') && item.velocity === theory.sampleVelocity(velocity, 'strings'));
        assert.ok(sample, `${midi} / ${velocity}`);
        assert.deepEqual(theory.sampleIdentity(sample.id, 'strings'), { midi: sample.midi, velocity: sample.velocity });
    }
    assert.equal(theory.sampleMidi(21, 'strings'), 36);
    assert.equal(theory.sampleMidi(108, 'strings'), 86);
    assert.equal(theory.sampleMidi(64, 'strings'), 62);
    assert.equal(theory.sampleVelocity(64, 'strings'), 32);
    assert.equal(theory.sampleVelocity(65, 'strings'), 96);
});

test('portable string bank validates exact pitch, dynamic layer and sustain loops', () => {
    const { state, asset } = fixture();
    assert.doesNotThrow(() => theory.validateBank(state, asset));
    for (const mutate of [copy => { copy.bank.samples.pop(); }, copy => { copy.bank.samples[0].loopStart = -1; },
        copy => { copy.bank.samples[0].loopEnd = 11; }, copy => { delete copy.bank.samples[0].loopStart; },
        copy => { copy.bank.samples[0].id = 'cello48v96'; }, copy => { copy.bank.instrument = theory.instruments.piano.id; },
        copy => { copy.instrument = 'piano'; }, copy => { copy.instrument = 'constructor'; },
        copy => { copy.sequence[0].velocity = 32; }]) {
        const altered = theory.copy(state);
        mutate(altered);
        assert.throws(() => theory.validateBank(altered, asset));
    }
});

test('embedded strings never substitute piano memory, neighbouring roots or another layer', () => {
    const { state } = fixture();
    const sampler = new Piano({});
    sampler.select('strings');
    sampler.restored({ sampleRate: 48000 }, state.bank);
    const segment = sampler.segment(48, 96);
    assert.equal(segment.loopStart, 2 / 44100);
    assert.equal(segment.loopEnd, 10 / 44100);
    assert.equal(sampler.segment(48, 32), null);
    assert.throws(() => sampler.source(48, 32), /Saved Q audio/);
    sampler.select('piano');
    assert.throws(() => sampler.restored({ sampleRate: 48000 }, state.bank), /do not match/);
});

test('an instrument change clears stale audio but preserves the sequence and effects', async () => {
    const instance = new Controller({ save: () => {}, context: () => ({ currentTime: 0 }), length: () => 16 });
    instance.status = () => {};
    instance.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.state.room = .4;
    instance.state.delayBeats = 1 / 3;
    instance.piano.atlas = {};
    instance.piano.cache.set('C3v12', {});
    const sequence = theory.copy(instance.state.sequence);
    await instance.setInstrument('strings');
    assert.equal(instance.state.instrument, 'strings');
    assert.equal(instance.piano.instrument, 'strings');
    assert.equal(instance.piano.cache.size, 0);
    assert.equal(instance.piano.atlas, null);
    assert.equal(instance.state.bank, null);
    assert.deepEqual(instance.state.sequence, sequence);
    assert.equal(instance.state.room, .4);
    assert.equal(instance.state.delayBeats, 1 / 3);
});

test('switching instrument cancels an in-flight catalog without poisoning the next instrument', async () => {
    const originalFetch = globalThis.fetch;
    let finish;
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    try {
        const sampler = new Piano({});
        sampler.select('strings');
        const pending = sampler.catalog();
        sampler.select('piano');
        finish({ ok: true, json: async () => manifest });
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(sampler.manifest, null);
        assert.equal(sampler.instrument, 'piano');
    } finally { globalThis.fetch = originalFetch; }
});

test('captured strings preserve relative sustain points at the audio-context rate', async () => {
    const { state } = fixture();
    const context = { sampleRate: 48000, createBuffer: (channels, frames) => ({ getChannelData: () => new Float32Array(frames) }) };
    const sampler = new Piano({ context: () => context });
    sampler.select('strings');
    sampler.manifest = manifest;
    sampler.ensure = async () => {};
    sampler.source = midi => ({ sample: { id: `viola${midi}v96`, midi, velocity: 96 }, offset: 0, duration: .01,
        loopStart: .002, loopEnd: .01, buffer: { sampleRate: 48000, getChannelData: () => new Float32Array(480) } });
    await sampler.capture(state);
    assert.equal(sampler.bank.instrument, manifest.id);
    assert.equal(sampler.bank.license, 'CC0 1.0');
    assert.equal(sampler.bank.samples[0].loopStart, 96);
    assert.equal(sampler.bank.samples[0].loopEnd, 480);
});

test('Strings MIDI export selects the ensemble program without changing note events', () => {
    const { state } = fixture();
    assert.ok(Buffer.from(theory.midiFile(state, 16, 120)).includes(Buffer.from([192, 48])));
    state.instrument = 'piano';
    assert.ok(Buffer.from(theory.midiFile(state, 16, 120)).includes(Buffer.from([192, 0])));
});
