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

function node() {
    return {
        outputs: new Set(), stops: 0,
        connect(destination) { this.outputs.add(destination); },
        disconnect(destination) {
            if (destination === undefined) this.outputs.clear();
            else if (!this.outputs.delete(destination)) throw new Error('Not connected');
        },
        start() {},
        stop() { this.stops += 1; }
    };
}

function fixture() {
    let source = node();
    const context = {
        audioContext: { createGain: node, createConstantSource: node },
        getBastardLoopXFilterCutoff: () => 1800,
        getBastardLoopXFilterLfoDepthHz: () => 1200,
        getBastardLoopXFilterLfoInvert: () => false,
        ensureBastardLoopXFilterLfoSource: () => source,
        safeDisconnectNode: target => target?.disconnect(),
        rampBastardLoopXDelayParam() {}
    };
    vm.createContext(context);
    for (const name of ['destroyBastardLoopXVoiceLfo', 'attachBastardLoopXFilterLfoToVoice']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, source, replaceSource: next => { source = next; } };
}

test('10,000 ended X notes leave no connections on the shared LFO', () => {
    const { context, source } = fixture();
    for (let index = 0; index < 10000; index += 1) {
        const voice = { filterNodes: [{ frequency: {} }] };
        context.attachBastardLoopXFilterLfoToVoice(voice);
        assert.equal(source.outputs.size, 1);
        const offset = voice.filterLfoOffsetSource;
        context.destroyBastardLoopXVoiceLfo(voice);
        assert.equal(source.outputs.size, 0);
        assert.equal(offset.stops, 1);
        assert.equal(offset.outputs.size, 0);
        assert.equal(voice.filterLfoSourceNode, null);
    }
    assert.equal(source.stops, 0);
});

test('ending one X voice preserves the other active voice and the LFO phase', () => {
    const { context, source } = fixture();
    const first = { filterNodes: [{ frequency: {} }] };
    const second = { filterNodes: [{ frequency: {} }] };
    context.attachBastardLoopXFilterLfoToVoice(first);
    context.attachBastardLoopXFilterLfoToVoice(second);
    const secondDepth = second.filterLfoDepthGain;
    context.destroyBastardLoopXVoiceLfo(first);
    assert.deepEqual([...source.outputs], [secondDepth]);
    assert.equal(secondDepth.outputs.size, 1);
    assert.equal(source.stops, 0);
    context.destroyBastardLoopXVoiceLfo(first);
    assert.deepEqual([...source.outputs], [secondDepth]);
});

test('LFO reattachment disconnects the old source without duplicating connections', () => {
    const { context, source, replaceSource } = fixture();
    const voice = { filterNodes: [{ frequency: {} }] };
    context.attachBastardLoopXFilterLfoToVoice(voice);
    context.attachBastardLoopXFilterLfoToVoice(voice);
    assert.equal(source.outputs.size, 1);
    const nextSource = node();
    replaceSource(nextSource);
    context.attachBastardLoopXFilterLfoToVoice(voice);
    assert.equal(source.outputs.size, 0);
    assert.equal(nextSource.outputs.size, 1);
    context.destroyBastardLoopXVoiceLfo(voice);
    assert.equal(nextSource.outputs.size, 0);
});

test('voice cleanup still completes after the shared LFO was already disconnected', () => {
    const { context, source } = fixture();
    const voice = { filterNodes: [{ frequency: {} }] };
    context.attachBastardLoopXFilterLfoToVoice(voice);
    const depth = voice.filterLfoDepthGain;
    const offset = voice.filterLfoOffsetSource;
    source.disconnect();
    assert.doesNotThrow(() => context.destroyBastardLoopXVoiceLfo(voice));
    assert.equal(depth.outputs.size, 0);
    assert.equal(offset.stops, 1);
    assert.equal(offset.outputs.size, 0);
    assert.equal(voice.filterLfoDepthGain, null);
});

function waveFixture() {
    let created = 0;
    const limit = html.match(/const MAX_OSCILLATOR_WAVE_CACHE_ENTRIES = (\d+);/);
    assert.ok(limit, 'Wave caches have an explicit bound');
    const context = {
        audioContext: { sampleRate: 48000, createPeriodicWave: () => ({ id: ++created }) },
        MAX_OSCILLATOR_WAVE_CACHE_ENTRIES: Number(limit[1]),
        hardSyncWaveCache: new Map(), oscillatorWaveCache: new Map(),
        oscillatorFourierBasis: null,
        sampleOscillatorWaveform: (waveform, phase) => phase * 2 - 1
    };
    vm.createContext(context);
    for (const name of ['buildOscillatorPeriodicWave', 'cacheOscillatorPeriodicWave', 'createOscillatorPeriodicWave', 'createHardSyncPeriodicWave']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, creations: () => created };
}

for (const cacheName of ['oscillatorWaveCache', 'hardSyncWaveCache']) {
    test(`${cacheName} remains bounded across 10,000 continuously modulated shapes`, () => {
        const { context } = waveFixture();
        const cache = context[cacheName];
        for (let index = 0; index < 10000; index += 1) {
            const wave = { index };
            assert.equal(context.cacheOscillatorPeriodicWave(cache, String(index), wave), wave);
            assert.ok(cache.size <= context.MAX_OSCILLATOR_WAVE_CACHE_ENTRIES);
        }
        assert.equal(cache.size, context.MAX_OSCILLATOR_WAVE_CACHE_ENTRIES);
        assert.equal(cache.has('0'), false);
        assert.equal(cache.has('9999'), true);
    });
}

for (const [factoryName, cacheName, args] of [
    ['createOscillatorPeriodicWave', 'oscillatorWaveCache', ['pulse', 50.123456]],
    ['createHardSyncPeriodicWave', 'hardSyncWaveCache', ['sawtooth', 1.234, 50.123456]]
]) {
    test(`${factoryName} uses the bounded cache and reuses identical waves`, () => {
        const { context, creations } = waveFixture();
        const cache = context[cacheName];
        for (let index = 0; index < context.MAX_OSCILLATOR_WAVE_CACHE_ENTRIES; index += 1) {
            cache.set(String(index), { context: context.audioContext, wave: {} });
        }
        const wave = context[factoryName](...args);
        assert.equal(cache.size, context.MAX_OSCILLATOR_WAVE_CACHE_ENTRIES);
        assert.equal(cache.has('0'), false);
        assert.equal(context[factoryName](...args), wave);
        assert.equal(creations(), 1);
        const oldContext = context.audioContext;
        context.audioContext = { ...oldContext };
        assert.notEqual(context[factoryName](...args), wave);
        assert.equal(cache.size, context.MAX_OSCILLATOR_WAVE_CACHE_ENTRIES);
        assert.equal(creations(), 2);
    });
}

for (const waveform of ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'metal']) {
    test(`${waveform} configures the same sound without building discarded native waves`, () => {
        const calls = [];
        const customWave = {};
        const syncWave = {};
        const context = {
            getSynthWaveShapePercent: () => 50.123456,
            createOscillatorPeriodicWave: (...args) => { calls.push(args); return customWave; },
            createHardSyncPeriodicWave: (...args) => { calls.push(args); return syncWave; },
            getNativeOscillatorWaveform: value => value
        };
        vm.createContext(context);
        vm.runInContext(functionSource('configureOscillatorWaveAndPitch'), context);
        const oscillator = { frequency: {}, setPeriodicWave(wave) { this.wave = wave; } };
        context.configureOscillatorWaveAndPitch(oscillator, { waveform }, 440);
        const native = ['sine', 'triangle', 'sawtooth', 'square'].includes(waveform);
        assert.equal(calls.length, native ? 0 : 1);
        assert.equal(oscillator.frequency.value, 440);
        if (native) assert.equal(oscillator.type, waveform);
        else assert.equal(oscillator.wave, customWave);
        calls.length = 0;
        context.configureOscillatorWaveAndPitch(oscillator, { waveform }, 440, 220);
        assert.equal(calls.length, 1);
        assert.equal(calls[0][1], 2);
        assert.equal(oscillator.wave, syncWave);
        assert.equal(oscillator.frequency.value, 220);
    });
}
