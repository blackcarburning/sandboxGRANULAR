const assert = require('node:assert/strict');
const test = require('node:test');
const theory = require('../q-theory.js');
const { Controller } = require('../q-card.js');

function voice() {
    const calls = [];
    const parameter = { value: .25, cancelScheduledValues: time => calls.push(['cancel', time]), setValueAtTime: (value, time) => calls.push(['set', value, time]), linearRampToValueAtTime: (value, time) => calls.push(['ramp', value, time]) };
    return { calls, start: .1, end: 1.1, peak: 1, release: .16, source: { stop: time => calls.push(['stop', time]) }, gain: { gain: parameter } };
}

test('old Q states retain full sample length and natural decay; new values normalize and survive JSON recall', () => {
    const legacy = theory.normalizeState({ version: 1 });
    assert.equal(legacy.sampleLength, 1);
    assert.equal(legacy.sampleDecay, 1);
    const restored = theory.normalizeState(JSON.parse(JSON.stringify({ sampleLength: .3, sampleDecay: .4 })));
    assert.equal(restored.sampleLength, .3);
    assert.equal(restored.sampleDecay, .4);
    assert.equal(theory.normalizeState({ sampleLength: -2, sampleDecay: 9 }).sampleLength, .05);
    assert.equal(theory.normalizeState({ sampleLength: -2, sampleDecay: 9 }).sampleDecay, 1);
});

test('Length shortens the gate and release, while Decay independently shortens and fades the envelope', () => {
    assert.deepEqual(theory.sampleEnvelope({}, 1, .16), { duration: 1, release: .16, fading: false });
    assert.deepEqual(theory.sampleEnvelope({ sampleLength: .5 }, 1, .16), { duration: .5, release: .08, fading: false });
    assert.deepEqual(theory.sampleEnvelope({ sampleDecay: .5 }, 1, .16), { duration: .5, release: .16, fading: true });
    assert.deepEqual(theory.sampleEnvelope({ sampleLength: .5, sampleDecay: .5 }, 1, .16), { duration: .25, release: .08, fading: true });
    assert.equal(theory.sampleEnvelope({ sampleLength: .05, sampleDecay: .05 }, .1, .02).duration, .006);
    assert.ok(theory.sampleEnvelope({ sampleLength: .05 }, .005, .02).duration <= .005);
});

test('100% preserves the original flat sustain, attack and release envelope', () => {
    const controller = new Controller({});
    const instance = voice();
    controller.applyVoiceEnvelope(instance, theory.defaults());
    assert.equal(instance.end, 1.1);
    assert.equal(instance.release, .16);
    assert.ok(instance.calls.some(([kind, value, time]) => kind === 'ramp' && value === 1 && Math.abs(time - .94) < 1e-8));
    assert.deepEqual(instance.calls.at(-1), ['ramp', 0, 1.1]);
});

test('shorter Decay fades from the attack rather than holding full volume until the end', () => {
    const controller = new Controller({});
    const instance = voice();
    controller.applyVoiceEnvelope(instance, { sampleLength: 1, sampleDecay: .5 });
    assert.equal(instance.end, .6);
    assert.ok(instance.calls.some(([kind, value, time]) => kind === 'ramp' && time > .2 && value > 0 && value < .5));
    assert.deepEqual(instance.calls.at(-1), ['ramp', 0, .6]);
});

test('live edits reschedule the source stop without compounding the shortening and can restore the full window', () => {
    const controller = new Controller({});
    const instance = { ...voice(), started: true };
    controller.applyVoiceEnvelope(instance, { sampleLength: .5, sampleDecay: 1 }, .15);
    assert.equal(instance.end, .6);
    controller.applyVoiceEnvelope(instance, { sampleLength: .5, sampleDecay: 1 }, .2);
    assert.equal(instance.end, .6);
    controller.applyVoiceEnvelope(instance, { sampleLength: 1, sampleDecay: 1 }, .25);
    assert.equal(instance.end, 1.1);
    assert.deepEqual(instance.calls.at(-1), ['stop', 1.1]);
});

test('shortening below the current play position fades an existing voice out instead of stopping abruptly', () => {
    const controller = new Controller({});
    const instance = { ...voice(), started: true };
    controller.applyVoiceEnvelope(instance, { sampleLength: .05, sampleDecay: .05 }, .4);
    assert.equal(instance.end, .406);
    assert.deepEqual(instance.calls.slice(-3), [['set', .25, .4], ['ramp', 0, .406], ['stop', .406]]);
});

test('new piano and strings voices stop at their shaped end and keep the sample playback pitch', () => {
    for (const instrument of ['piano', 'strings']) {
        const stops = [];
        const context = {
            currentTime: 0,
            createBufferSource: () => ({ playbackRate: {}, connect: gain => gain, start() {}, stop: time => stops.push(time) }),
            createGain: () => ({ gain: { cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} })
        };
        const controller = new Controller({ context: () => context, bpm: () => 120 });
        controller.ensureGraph = () => ({ input: {} });
        controller.piano.source = () => ({ sample: { midi: 60 }, duration: 8, buffer: {}, offset: 0, loopStart: .1, loopEnd: .8 });
        Object.assign(controller.state, { instrument, sampleLength: .25, sampleDecay: .5 });
        controller.voice(60, 96, .1, .5);
        const instance = [...controller.voices][0];
        const full = .5 + (instrument === 'strings' ? .25 : .16);
        assert.ok(Math.abs(instance.end - (.1 + full * .125)) < 1e-8);
        assert.equal(stops.at(-1), instance.end);
        assert.equal(instance.source.playbackRate.value, 1);
        assert.equal(instance.source.loop === true, instrument === 'strings');
    }
});
