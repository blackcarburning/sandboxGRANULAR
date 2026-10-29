const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scheduleAheadTime = Number(html.match(/const SCHEDULE_AHEAD_TIME = ([\d.]+);/)[1]);
const schedulerInterval = Number(html.match(/const SCHEDULER_INTERVAL = ([\d.]+);/)[1]);

function futureStepTimes(firstTime, stepDuration, now = 100) {
    const count = Math.ceil((now + scheduleAheadTime - firstTime) / stepDuration);
    return Array.from({ length: count }, (unused, index) => firstTime + index * stepDuration);
}

function functionSource(name) {
    const start = html.indexOf(`        function ${name}(`);
    assert.notEqual(start, -1, name);
    const end = html.indexOf('\n        }', start);
    assert.notEqual(end, -1, name);
    return html.slice(start, end + '\n        }'.length);
}

function fixture(extra = {}) {
    const context = {
        audioContext: { currentTime: 100 },
        audioSchedulingStats: { lateTicks: 0, skippedSteps: 0, maxLatenessMs: 0 },
        SCHEDULE_AHEAD_TIME: scheduleAheadTime,
        SCHEDULER_INTERVAL: schedulerInterval,
        transportSync: { depth: 0 },
        ...extra
    };
    vm.createContext(context);
    for (const name of ['countMissedAudioSteps', 'getTransportClockBpm', 'getTransportScheduleHorizon']) {
        vm.runInContext(functionSource(name), context);
    }
    return context;
}

test('deadline recovery counts missed grid steps without moving a future or exact-time step', () => {
    const context = fixture();
    assert.equal(context.countMissedAudioSteps(100.05, .125), 0);
    assert.equal(context.countMissedAudioSteps(100, .125), 0);
    assert.equal(context.countMissedAudioSteps(100 - 1e-8, .125), 0);
    assert.equal(context.countMissedAudioSteps(99, .125), 8);
    assert.equal(context.countMissedAudioSteps(99.99, .125), 1);
    assert.equal(context.audioSchedulingStats.lateTicks, 2);
    assert.equal(context.audioSchedulingStats.skippedSteps, 9);
    assert.equal(context.audioSchedulingStats.maxLatenessMs, 1000);
    for (const value of [null, undefined, NaN, Infinity]) assert.equal(context.countMissedAudioSteps(value, .125), 0);
    for (const duration of [0, -1, NaN, Infinity]) assert.equal(context.countMissedAudioSteps(99, duration), 0);
});

for (const layer of ['L', 'X']) {
    for (const delay of [.01, .3, 10, 3600]) {
        test(`${layer} skips ${delay}s of missed steps and preserves pattern phase`, () => {
            const calls = [];
            const prefix = `bastardLoop${layer}`;
            const context = fixture({
                [prefix + 'SampleBuffer']: {}, [prefix + 'NextStepTime']: 100 - delay,
                [prefix + 'NextStepIndex']: 7, [prefix + 'SlideCarryIndex']: 7,
                [`isBastardLoop${layer}Running`]: () => true,
                isBastardLoopLUsingSynth: () => false,
                [`getBastardLoop${layer}PatternLength`]: () => 16,
                [`getBastardLoop${layer}StepDurationSeconds`]: () => .125,
                [`getBastardLoop${layer}Step`]: () => ({ note: 'C3', rest: false }),
                [`getBastardLoop${layer}LevelValue`]: () => 1,
                [`scheduleBastardLoop${layer}Voice`]: (step, when) => calls.push(when),
                [`syncBastardLoop${layer}EditorUi`]() {},
                stopOscillatorsByRole() {}
            });
            vm.runInContext(functionSource(`scheduleBastardLoop${layer}Steps`), context);
            context[`scheduleBastardLoop${layer}Steps`]();
            const skipped = Math.ceil((delay - .000001) / .125);
            assert.ok(calls.length > 0 && calls.length <= Math.ceil(scheduleAheadTime / .125), calls.length);
            assert.deepEqual(calls, futureStepTimes(100 - delay + skipped * .125, .125));
            assert.ok(calls.every(when => when >= 100 - .000001 && when < 100 + scheduleAheadTime));
            assert.equal(context[prefix + 'NextStepIndex'], (7 + skipped + calls.length) % 16);
            assert.equal(context[prefix + 'SlideCarryIndex'], -1);
            assert.equal(context.audioSchedulingStats.skippedSteps, skipped);
        });
    }
}

test('L synth recovery releases the old voice without replaying missed notes', () => {
    const stopped = [];
    const calls = [];
    const context = fixture({
        bastardLoopLNextStepTime: 90, bastardLoopLNextStepIndex: 0, bastardLoopLSlideCarryIndex: -1,
        isBastardLoopLRunning: () => true, isBastardLoopLUsingSynth: () => true,
        getBastardLoopLPatternLength: () => 16, getBastardLoopLStepDurationSeconds: () => .125,
        getBastardLoopLStep: () => ({ note: 'C3' }), getBastardLoopLLevelValue: () => 1,
        scheduleBastardLoopLVoice: (step, when) => calls.push(when),
        stopOscillatorsByRole: (...args) => stopped.push(args), syncBastardLoopLEditorUi() {}
    });
    vm.runInContext(functionSource('scheduleBastardLoopLSteps'), context);
    context.scheduleBastardLoopLSteps();
    assert.deepEqual(stopped, [['bastardloopl', 100]]);
    assert.deepEqual(calls, futureStepTimes(100, .125));
    assert.equal(context.audioSchedulingStats.skippedSteps, 80);
});

test('drums drop stale triggers and use a fixed scheduling window even when work advances audio time', () => {
    const calls = [];
    let now = 100;
    const context = fixture({
        audioContext: { get currentTime() { return now; } },
        drumMachinePlaying: true, drumMachineNextStepTime: 90, drumMachineCurrentStep: 3,
        drumMachineExtraTracks: {},
        getDrumMachineStepDuration: () => .125, getDrumMachinePatternLength: () => 16,
        scheduleDrumMachineRepeats() {}, scheduleDrumMachineHatStep() {},
        scheduleDrumMachineVisualStep: (index, when) => { calls.push({ index, when }); now += 1; if (calls.length > 8) throw new Error('Unbounded scheduling'); }
    });
    vm.runInContext(functionSource('scheduleDrumMachine'), context);
    context.scheduleDrumMachine();
    const expectedTimes = futureStepTimes(100, .125);
    assert.deepEqual(calls, expectedTimes.map((when, index) => ({ index: 3 + index, when })));
    assert.equal(context.drumMachineCurrentStep, (3 + expectedTimes.length) % 16);
    assert.equal(context.audioSchedulingStats.skippedSteps, 80);
});

test('drum-loop clock catches up phase without triggering synth or grain voices', () => {
    const calls = [];
    const context = fixture({
        sequencerBPM: 120, sequencerNextStepTime: 90, sequencerCurrentStep: 3,
        sequencerSteps: Array.from({ length: 16 }, () => ({ enabled: true, pitch: 'C3', volume: 80 })),
        sequencerPlaying: true, seqGrainsEnabled: true, window: {},
        queueSequencerPlayheadPaint() {},
        normalizeSequencerSteps: () => 16, getPatternLengthSteps: () => 16,
        getClickGuardSeconds: () => .005, stopOscillatorsByRole() {},
        playOscillatorNote: (note, when) => calls.push(when),
        startGrainStream: (note, when) => calls.push(when), setTimeout: () => 1
    });
    vm.runInContext(functionSource('scheduleSequencer'), context);
    context.scheduleSequencer();
    const expectedTimes = futureStepTimes(100, .125);
    assert.deepEqual(calls, [], 'the drum clock must not create melodic voices');
    assert.equal(context.sequencerCurrentStep, (3 + expectedTimes.length) % 16);
    assert.equal(context.audioSchedulingStats.skippedSteps, 80);
});

test('granular streams discard a backlog rather than clamping hundreds of grains to now', () => {
    const calls = [];
    const grain = { note: 'C3', velocity: 1, nextTime: 90 };
    const context = fixture({
        activeGrains: new Map([['keyboard:C3', grain]]), GRAIN_SCHEDULER_INTERVAL: 10,
        stopGrainScheduler() {}, getGranularKeyboardNoteFrequency: () => 130,
        withModulationEvaluationTime: (when, callback) => callback(), getGranularLayerSettings: () => [{}],
        getGranularLayerScheduleIntervalSeconds: () => .01,
        playGrain: (note, when) => calls.push(when), setTimeout: () => 1
    });
    vm.runInContext(functionSource('scheduleActiveGrains'), context);
    context.scheduleActiveGrains();
    assert.ok(calls.length >= Math.floor(scheduleAheadTime / .01) && calls.length <= Math.ceil(scheduleAheadTime / .01) + 1, calls.length);
    assert.ok(calls.every(when => when >= 100 - .000001 && when < 100 + scheduleAheadTime));
    assert.ok(Math.abs(grain.nextTime - (100 + calls.length * .01)) < .000001);
    assert.equal(context.audioSchedulingStats.skippedSteps, 1000);
});

test('Fourier optimisation preserves every float32 coefficient for all waveforms and sync modes', () => {
    const context = { oscillatorFourierBasis: null, audioContext: { createPeriodicWave: (real, imag) => ({ real, imag }) } };
    vm.createContext(context);
    vm.runInContext(functionSource('sampleOscillatorWaveform'), context);
    vm.runInContext(functionSource('buildOscillatorPeriodicWave'), context);
    for (const waveform of ['sine', 'triangle', 'square', 'pulse', 'supersaw', 'organ', 'vocal', 'metal', 'sawtooth']) {
        for (const ratio of [1, .731, 3.189]) {
            const shapePercent = 37.123456;
            const actual = context.buildOscillatorPeriodicWave(waveform, shapePercent, ratio);
            const real = new Float32Array(97);
            const imag = new Float32Array(97);
            for (let harmonic = 1; harmonic <= 96; harmonic += 1) {
                let cosine = 0;
                let sine = 0;
                for (let frame = 0; frame < 512; frame += 1) {
                    const phase = frame / 512;
                    const sample = context.sampleOscillatorWaveform(waveform, phase * ratio, { shapePercent });
                    const angle = Math.PI * 2 * harmonic * phase;
                    cosine += sample * Math.cos(angle);
                    sine += sample * Math.sin(angle);
                }
                real[harmonic] = 2 / 512 * cosine;
                imag[harmonic] = -2 / 512 * sine;
            }
            assert.deepEqual(Array.from(actual.real), Array.from(real), `${waveform}/${ratio} real`);
            assert.deepEqual(Array.from(actual.imag), Array.from(imag), `${waveform}/${ratio} imag`);
        }
    }
});

test('each wave samples only 512 points and reuses the fixed Fourier basis', () => {
    let samples = 0;
    const context = { oscillatorFourierBasis: null, audioContext: { createPeriodicWave: () => ({}) },
        sampleOscillatorWaveform: () => { samples += 1; return .1; } };
    vm.createContext(context);
    vm.runInContext(functionSource('buildOscillatorPeriodicWave'), context);
    context.buildOscillatorPeriodicWave('vocal', 50);
    const basis = context.oscillatorFourierBasis;
    assert.equal(samples, 512);
    context.buildOscillatorPeriodicWave('metal', 60, 2);
    assert.equal(samples, 1024);
    assert.equal(context.oscillatorFourierBasis, basis);
});

test('one modulation update evaluates every held voice at the same audio-clock instant', () => {
    let clock = 100;
    const times = [];
    const context = { modulationEvaluationTime: null, audioContext: { get currentTime() { clock += .01; return clock; } },
        applyingSynthPopupPreset: false, activeOscVoices: new Map([['C3', { note: 'C3' }], ['E3', { note: 'E3' }]]),
        osc1Config: {}, osc2Config: {}, osc3Config: {},
        getOscillatorVoiceFrequencies: () => ({}), configureOscillatorWaveAndPitch: () => times.push(context.getModulationEvaluationTime()) };
    vm.createContext(context);
    for (const name of ['getModulationEvaluationTime', 'withModulationEvaluationTime', 'refreshActiveOscillatorVoices']) {
        vm.runInContext(functionSource(name), context);
    }
    context.refreshActiveOscillatorVoices();
    assert.equal(times.length, 6);
    assert.ok(times.every(time => time === times[0]));
    assert.equal(context.modulationEvaluationTime, null);
});
