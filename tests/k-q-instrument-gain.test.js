const test = require('node:test');
const assert = require('node:assert/strict');
const theory = require('../q-theory.js');
const { Controller, createKeyboardPlayer } = require('../q-card.js');
const calibration = { piano: .60, strings: 1.30 };

function parameter(value = 1) {
    return {
        value, calls: [],
        cancelScheduledValues(time) { this.calls.push(['cancel', time]); },
        setValueAtTime(value, time) { this.calls.push(['set', value, time]); },
        linearRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); },
        setTargetAtTime(value, time, constant) { this.value = value; this.calls.push(['target', value, time, constant]); }
    };
}

function node(properties = {}) {
    return { connections: [], connect(destination) { this.connections.push(destination); return destination; }, disconnect() { this.connections = []; }, ...properties };
}

function fixture(instrument, sampleRate = 48000) {
    const output = node();
    const capture = node();
    const mix = { volume: 1, solo: 1 };
    const context = {
        currentTime: 1, state: 'running', sampleRate,
        createGain: () => node({ gain: parameter() }),
        createBufferSource: () => node({ playbackRate: {}, start() {}, stop() {} }),
        createBiquadFilter: () => node({ frequency: parameter(), Q: parameter() }),
        createDelay: () => node({ delayTime: parameter() }),
        createConvolver: () => node(),
        createStereoPanner: () => node({ pan: parameter(0) }),
        createBuffer: (channels, frames) => ({ getChannelData: () => new Float32Array(frames) })
    };
    const selected = { sample: { midi: 60 }, buffer: { numberOfChannels: 2 }, duration: 8, offset: 0, loopStart: .1, loopEnd: .8 };
    const host = {
        context: () => context, output: () => output, destination: () => output, capture: () => capture,
        volume: () => mix.volume * mix.solo, soloGain: () => mix.solo, bpm: () => 120, length: () => 16
    };
    const keyboard = createKeyboardPlayer(host);
    keyboard.samplers.get(instrument).piano.segment = () => selected;
    const controller = new Controller(host);
    Object.assign(controller.state, { instrument, enabled: true, room: 0, delay: 0 });
    controller.piano.select(instrument);
    controller.piano.source = () => selected;
    controller.reflectPlaying = () => {};
    controller.origin = context.currentTime + .01;
    return { keyboard, controller, context, output, capture, mix, selected };
}

function velocityGain(instrument, velocity) {
    return instrument === 'strings' ? velocity / 127 : Math.sqrt(velocity / 127);
}

function expectedPeak(instrument, velocity) {
    return velocityGain(instrument, velocity) * calibration[instrument];
}

function envelopeMaximum(voice) {
    return Math.max(...voice.gain.gain.calls.filter(([kind]) => kind === 'set' || kind === 'ramp').map(([, value]) => value));
}

for (const instrument of ['piano', 'strings']) {
    test(`${instrument}: K and Q share bounded calibration at both context rates and retain velocity dynamics`, async () => {
        for (const sampleRate of [44100, 48000]) {
            const { keyboard, controller, context } = fixture(instrument, sampleRate);
            let previous = 0;
            for (const velocity of [32, 64, 96, 127]) {
                const live = await keyboard.noteOn(velocity, 60, { instrument, velocity });
                controller.voice(60, velocity, context.currentTime + .01, .5);
                const sequenced = [...controller.voices].at(-1);
                const expected = expectedPeak(instrument, velocity);
                assert.equal(live.peak, expected);
                assert.equal(sequenced.peak, expected);
                assert.equal(envelopeMaximum(live), expected);
                assert.equal(envelopeMaximum(sequenced), expected);
                assert.ok(live.peak > previous && live.peak <= calibration[instrument]);
                assert.ok(Math.abs(live.peak / (velocityGain(instrument, velocity) * .32) - calibration[instrument] / .32) < 1e-10);
                previous = live.peak;
            }
            keyboard.stop();
        }
    });

    test(`${instrument}: K slider and solo scale once before audible output and capture, including zero`, async () => {
        const { keyboard, output, capture, mix } = fixture(instrument);
        mix.volume = .5;
        const live = await keyboard.noteOn('key', 60, { instrument, velocity: 127, volume: .75 });
        assert.equal(live.peak, calibration[instrument] * .75);
        assert.equal(live.mixGain.gain.value, .5);
        assert.deepEqual(live.source.connections, [live.gain]);
        assert.deepEqual(live.gain.connections, [live.mixGain]);
        assert.deepEqual(live.mixGain.connections, [output, capture]);
        assert.deepEqual(capture.connections, []);
        for (const volume of [0, .25, 1]) {
            mix.volume = volume;
            keyboard.refreshVolumes();
            assert.deepEqual(live.mixGain.gain.calls.at(-1), ['ramp', volume, 1.015]);
            assert.equal(live.peak, calibration[instrument] * .75);
        }
        mix.solo = 0;
        keyboard.refreshVolumes();
        assert.equal(live.mixGain.gain.calls.at(-1)[1], 0);
        mix.solo = 1;
        keyboard.refreshVolumes();
        assert.equal(live.mixGain.gain.calls.at(-1)[1], 1);
        const silent = await keyboard.noteOn('zero', 60, { instrument, volume: 0 });
        assert.equal(silent.peak, 0);
        assert.equal(envelopeMaximum(silent), 0);
        keyboard.stop();
    });

    test(`${instrument}: Q block and arp previews use calibrated voices and one accent multiplier`, () => {
        for (const arp of [false, true]) {
            const { controller } = fixture(instrument);
            controller.preview = { chord: { accent: true }, pitches: [60], order: [60], velocity: 96, next: 0, nextTime: 1.01, arp, repeat: false, done: false };
            controller.tickPreview();
            assert.equal(controller.voices.size, 1);
            const voice = [...controller.voices][0];
            assert.equal(voice.preview, true);
            assert.equal(voice.peak, expectedPeak(instrument, 96));
            assert.equal(envelopeMaximum(voice), voice.peak * 1.5);
            assert.equal(controller.preview.done, true);
        }
    });

    test(`${instrument}: Q sequence uses base velocity with grid accent, not an already-accented velocity`, () => {
        const { controller } = fixture(instrument);
        controller.state.sequence[0] = theory.normalizeStep({ notes: [60], velocity: 96, gate: 4, accent: true });
        const sampledVelocities = [];
        const source = controller.piano.source;
        controller.piano.source = (pitch, velocity) => { sampledVelocities.push(velocity); return source(pitch, velocity); };
        controller.running = true;
        controller.tick();
        assert.equal(controller.voices.size, 1);
        const voice = [...controller.voices][0];
        assert.deepEqual(sampledVelocities, [120]);
        assert.equal(voice.grid, true);
        assert.equal(voice.peak, expectedPeak(instrument, 96));
        assert.equal(envelopeMaximum(voice), voice.peak * 1.5);
        assert.deepEqual(voice.gain.gain.calls.at(-1), ['ramp', 0, voice.end]);
    });

    test(`${instrument}: Q default, slider, solo and effects remain downstream of voice calibration`, () => {
        const { controller, mix, output } = fixture(instrument);
        controller.voice(60, 127, 1.01, .5);
        const voice = [...controller.voices][0];
        const graph = controller.graph;
        assert.equal(controller.state.level, .5);
        assert.equal(graph.level.gain.value, .5);
        assert.deepEqual(voice.gain.connections, [graph.input]);
        assert.deepEqual(graph.level.connections, [graph.pan]);
        assert.deepEqual(graph.pan.connections, [output]);
        for (const level of [0, .25, .5, 1]) {
            controller.state.level = level;
            controller.updateEffects();
            assert.equal(graph.level.gain.value, level);
            assert.equal(voice.peak, calibration[instrument]);
        }
        mix.solo = 0;
        controller.updateEffects();
        assert.equal(graph.level.gain.value, 0);
        mix.solo = 1;
        Object.assign(controller.state, { room: .4, delay: .5, feedback: .3, pan: -.25 });
        controller.updateEffects();
        assert.equal(graph.level.gain.value, 1);
        assert.equal(graph.roomWet.gain.value, .4 * .8);
        assert.equal(graph.delayWet.gain.value, .5 * .65);
        assert.equal(graph.feedback.gain.value, .3);
        assert.equal(graph.pan.pan.value, -.25);
        controller.state.enabled = false;
        controller.updateEffects();
        assert.equal(graph.level.gain.value, 0);
    });

    test(`${instrument}: restored Q sample-bank PCM stays unchanged and receives calibration only when voiced`, () => {
        const { controller, context, selected } = fixture(instrument);
        const midi = theory.sampleMidi(60, instrument);
        const sample = { id: 'probe', midi, velocity: theory.sampleVelocity(96, instrument), offset: 0, frames: context.sampleRate * 8, loopStart: 4800, loopEnd: 38400 };
        const bank = { version: 1, instrument: theory.instruments[instrument].id, sampleRate: context.sampleRate, samples: [sample] };
        const samples = new Float32Array(context.sampleRate * 8);
        samples.set([.1, -.2, .3, -.4]);
        const buffer = { ...selected.buffer, length: samples.length, sampleRate: context.sampleRate, getChannelData: () => samples };
        const before = samples.slice();
        const serializedBank = JSON.stringify(bank);
        delete controller.piano.source;
        controller.piano.restored(buffer, bank);
        for (let replay = 0; replay < 3; replay += 1) {
            controller.voice(60, 96, 1.01 + replay, .5);
            const voice = [...controller.voices].at(-1);
            assert.equal(voice.source.buffer, buffer);
            assert.equal(voice.peak, expectedPeak(instrument, 96));
            assert.equal(envelopeMaximum(voice), voice.peak);
        }
        assert.deepEqual(samples, before);
        assert.equal(JSON.stringify(controller.piano.bank), serializedBank);
        assert.equal(JSON.stringify(bank), serializedBank);
    });
}
