const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const utils = require('../mygrain-utils.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const kinds = ['generated', 'mic', 'grainAMic', 'grainBMic', 'output'];

test('default tabbed layout exposes grain features and source route groups can wrap on phones', () => {
    assert.match(html, /<body>/);
    assert.doesNotMatch(html, /<body[^>]*class="[^"]*\bsimplified-ui\b/);
    const grainTab = html.slice(html.indexOf('<div class="tab-content active" id="grain-tab">'),
        html.indexOf('<!-- Filter Tab -->'));
    for (const id of ['grainEnvelopeShape', 'grainEnvelopeSkew', 'grainReverseProbability',
        'grainPitchQuantization', 'grainStereoPosition', 'grainStereoScatter', 'grainFreeze', 'grainTimingJitter']) {
        assert.match(grainTab, new RegExp(`id="${id}"`));
    }
    assert.match(html, /\.source-loop-lfo-row \.button-group \{[^}]*flex-wrap: wrap;/);
    assert.match(html, /\.source-loop-controls input\[type="range"\],[\s\S]*?min-width: 0;/);
    assert.match(html, /\.top-section \{\s*display: grid;[^}]*align-items: start;/);
});

function functionSource(name) {
    let start = html.indexOf(`        function ${name}(`);
    if (start < 0) start = html.indexOf(`        async function ${name}(`);
    assert.ok(start >= 0, `missing runtime function ${name}`);
    const end = html.indexOf('\n        }', start);
    return html.slice(start, end + '\n        }'.length);
}

function runtime() {
    const elements = {};
    for (const match of html.matchAll(/<input type="range" id="([^"]+)"[^>]*value="([^"]+)"/g)) {
        elements[match[1]] = {
            value: match[2], defaultValue: match[2],
            dispatchEvent() {}
        };
    }
    for (const kind of kinds) elements[kind + 'SizeIndependent'] = { checked: false };
    elements.grainFreeze = { checked: false };
    elements.grainEnvelopeShape = { value: 'hann' };
    elements.grainPitchQuantization = { value: 'off' };
    elements.noiseType = { value: 'none' };
    const sources = [];
    const gains = [];
    const panners = [];
    const reverseWork = [];
    function node() {
        return {
            connections: [], disconnected: false,
            connect(target) { this.connections.push(target); },
            disconnect() { this.disconnected = true; }
        };
    }
    const audio = {
        currentTime: 10,
        sampleRate: 48000,
        createGain() {
            const gain = node();
            gain.gain = {
                value: 1, curves: [], values: [], ramps: [],
                setValueCurveAtTime(curve, time, duration) { this.curves.push({ curve, time, duration }); },
                setValueAtTime(value, time) { this.values.push({ value, time }); },
                linearRampToValueAtTime(value, time) { this.ramps.push({ value, time }); }
            };
            gains.push(gain);
            return gain;
        },
        createStereoPanner() {
            const panner = node();
            panner.pan = { value: 0 };
            panners.push(panner);
            return panner;
        },
        createBufferSource() {
            const source = node();
            source.playbackRate = { value: 1 };
            source.start = (...args) => { source.started = args; };
            source.stop = (time) => { source.stopped = time; };
            sources.push(source);
            return source;
        },
        createBuffer(channels, length, sampleRate) {
            const data = Array.from({ length: channels }, () => new Float32Array(length));
            return {
                numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
                getChannelData: (channel) => data[channel],
                copyFromChannel: (target, channel, start) => target.set(data[channel].subarray(start, start + target.length)),
                copyToChannel: (input, channel, start) => data[channel].set(input, start)
            };
        }
    };
    const context = vm.createContext({
        document: { getElementById: (id) => elements[id], querySelectorAll: () => [] },
        console, Map, WeakMap, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
        Event: class {}, mygrainUtils: utils, audioContext: audio,
        grainEnvelopeCache: new Map(), reversedGrainBuffers: new WeakMap(),
        reversedGrainPreparations: new WeakMap(), reversePreparationQueue: [], reversePreparationScheduled: false,
        frozenGrainSnapshots: new Map(), latestGrainSnapshots: new Map(),
        effectiveGrainWindows: new Map(), waveformTraceCache: new WeakMap(),
        GRANULAR_SOURCE_KINDS: kinds, pendingLayerWindowRandomization: false,
        activeGrainNodes: 0, MAX_GRAIN_NODES: 1000, activeGrains: new Map(),
        lfoEnabled: {}, lfo2Enabled: {}, lfo3Enabled: {},
        lfoInverted: {}, lfo2Inverted: {}, lfo3Inverted: {},
        canPlayGrains: () => true, baseFrequency: 440, keyboardVolumeBias: 0,
        getKeyboardNoteFrequency: () => 440,
        getFadeSecondsForDuration: () => 0.001,
        getSecondaryGrainSynthVoices: () => [],
        getGrainLayerGain: () => 1,
        getModulatedValue: (id) => Number(elements[id]?.value ?? 0),
        getAvailableGranularSources: () => context.available,
        getGranularSourceGainMap: (available, gain) => new Map(available.map((source) => [source, gain / available.length])),
        granularOutputGain: {}, setTimeout: () => 1,
        requestIdleCallback: (callback) => { reverseWork.push(callback); return reverseWork.length; },
        getSourceSlotConfig: (kind) => ({
            startId: kind + 'LoopStart', endId: kind + 'LoopEnd',
            buffer: () => context.available.find((source) => source.kind === kind)?.buffer,
            setBuffer: (buffer) => { context.available.find((source) => source.kind === kind).buffer = buffer; },
            dbKey: () => kind
        }),
        getSourceBuffer: (kind) => context.available.find((source) => source.kind === kind)?.buffer,
        drawSourceWaveform() {}
    });
    context.available = [];
    [
        'getLoopRange', 'getLoopTimingForBuffer', 'drawSourceWaveform', 'resolveContinuousLoopPosition', 'trackEffectiveGrainWindow', 'getCachedGrainEnvelope', 'applyGrainEnvelope',
        'scheduleReversePreparationWork', 'prepareReversedGrainBuffer', 'prepareAvailableReversedGrains',
        'getReversedGrainBuffer', 'quantizeGrainPlaybackRate', 'syncGrainFreeze',
        'playGrain', 'randomizeLayerWindows', 'setLfoRouteState', 'setLfoInvertState', 'clearModulationForParam',
        'gatherGrainControls', 'applyGrainControls', 'resetGrainControls'
    ].forEach((name) => vm.runInContext(functionSource(name), context));
    function addSource(kind, duration = 1) {
        const buffer = audio.createBuffer(2, Math.round(duration * 48000), 48000);
        buffer.getChannelData(0).set([0.1, 0.2, 0.3]);
        const source = {
            kind, buffer, startId: kind + 'LoopStart', endId: kind + 'LoopEnd',
            sizeId: kind + 'GrainSize', speedId: kind + 'Stretch'
        };
        context.available.push(source);
        return source;
    }
    return {
        context, elements, sources, gains, panners, addSource, reverseWork,
        finishReversePreparation() { while (reverseWork.length > 0) reverseWork.shift()(); }
    };
}

function consumedSourceDuration(source) {
    return (source.stopped - source.started[0]) * source.playbackRate.value;
}

test('all five static waveform panels expose size, inheritance, speed and three start/end routes', () => {
    for (const kind of kinds) {
        const canvasStart = html.indexOf(`<canvas id="${kind}WaveformCanvas"`);
        const nextPanel = html.indexOf('<div class="source-waveform-panel">', canvasStart);
        const gridEnd = html.indexOf('<div class="source-seed-group" aria-label="FM drum loop generator">', canvasStart);
        const panel = html.slice(canvasStart, nextPanel >= 0 ? Math.min(nextPanel, gridEnd) : gridEnd);
        assert.equal([...panel.matchAll(/<input type="range"/g)].length, 4, `${kind} has four literal panel sliders`);
        assert.equal([...panel.matchAll(/<button class="lfo-toggle"/g)].length, 12, `${kind} has twelve literal panel LFO buttons`);
        assert.equal([...panel.matchAll(/<button class="inv-toggle"/g)].length, 12, `${kind} has twelve literal panel inversion buttons`);
        assert.match(html, new RegExp(`id="${kind}GrainSize" min="1" max="500" value="100"`));
        assert.match(html, new RegExp(`id="${kind}Stretch" min="0.25" max="4" value="1"`));
        assert.match(html, new RegExp(`id="${kind}SizeIndependent"`));
        assert.match(html, new RegExp(`id="${kind}EffectiveWindow"`));
        for (const suffix of ['LoopStart', 'LoopEnd', 'GrainSize', 'Stretch']) {
            for (const lfo of [1, 2, 3]) {
                for (const button of ['lfo-toggle', 'inv-toggle']) {
                    assert.match(html, new RegExp(`class="${button}" data-param="${kind}${suffix}" data-lfo="${lfo}"`));
                }
            }
        }
        assert.match(html, new RegExp(`${kind}GrainSize: \\{ min: 1, max: 500 \\}`));
        assert.match(html, new RegExp(`${kind}Stretch: \\{ min: 0.25, max: 4 \\}`));
        assert.ok(html.includes(`'${kind}GrainSize'`));
        assert.ok(html.includes(`'${kind}Stretch'`));
    }
    assert.match(html, /suffix = 'x'/);
    assert.match(html, /GRANULAR_LFO_MODULATION_SCALES\[kind \+ suffix\] = 0\.12/);
});

test('rate-aware windows expand crossing bounds and cap duration even for sub-millisecond buffers', () => {
    for (const duration of [0, 1 / 48000, 0.005, 0.1, 2]) {
        for (const rate of [0.25, 1, 4, 32]) {
            const window = utils.resolveSampleWindow({
                bufferDuration: duration, playbackRate: rate, grainSizeSeconds: 0.5,
                startPct: 0.99, endPct: 0.98, positionPct: 1,
                sprayAmount: 1, randomValue: 1
            });
            assert.ok(window.startTime >= 0);
            assert.ok(window.endTime <= duration + 1e-12);
            assert.ok(window.playPosition >= window.startTime - 1e-12);
            assert.ok(window.playPosition + window.sourceDuration <= window.endTime + 1e-12);
            assert.ok(window.grainSizeSeconds * rate <= duration + 1e-12);
        }
    }
});

test('live start/end LFO crossings and minimum-region expansion cannot mutate or degenerate an active grain', () => {
    const r = runtime();
    const { buffer } = r.addSource('generated', 0.2);
    r.elements.generatedSizeIndependent.checked = true;
    let firstSchedule;
    const settings = [
        [95, 96, 20, 4],
        [96, 95, 20, 4],
        [95, 5, 20, 4],
        [100, 100, 20, 4],
        [20, 80, 500, 4]
    ];
    settings.forEach(([start, end, size, speed], index) => {
        r.context.audioContext.currentTime = 10 + index * 0.001;
        r.elements.generatedLoopStart.value = String(start);
        r.elements.generatedLoopEnd.value = String(end);
        r.elements.generatedGrainSize.value = String(size);
        r.elements.generatedStretch.value = String(speed);
        r.context.playGrain('A4');
        const source = r.sources.at(-1);
        const snapshot = r.context.latestGrainSnapshots.get('generated');
        const boundedStart = snapshot.loopRange.startPct * buffer.duration;
        const boundedEnd = snapshot.loopRange.endPct * buffer.duration;
        assert.ok(boundedStart >= 0);
        assert.ok(boundedEnd <= buffer.duration);
        assert.ok(boundedEnd > boundedStart);
        assert.ok(source.started[1] >= boundedStart - 1e-12);
        assert.ok(source.started[1] + consumedSourceDuration(source) <= boundedEnd + 1e-12);
        assert.equal(source.loop, false);
        if (index === 0) {
            firstSchedule = { start: [...source.started], stop: source.stopped, rate: source.playbackRate.value };
        } else {
            assert.ok(r.context.audioContext.currentTime < r.sources[0].stopped, 'LFO crossings occur during the first grain');
        }
    });
    assert.deepEqual(r.sources[0].started, firstSchedule.start);
    assert.equal(r.sources[0].stopped, firstSchedule.stop);
    assert.equal(r.sources[0].playbackRate.value, firstSchedule.rate);
    const firstCurve = r.sources[0].connections[0].connections[0].gain.curves[0].curve;
    assert.equal(firstCurve[0], 0);
    assert.equal(firstCurve.at(-1), 0);
});

test('scheduler uses independent per-slot duration/speed and separate click-safe envelopes', () => {
    const r = runtime();
    for (const [index, kind] of kinds.entries()) {
        r.addSource(kind);
        r.elements[kind + 'SizeIndependent'].checked = true;
        r.elements[kind + 'GrainSize'].value = String(10 + index * 20);
        r.elements[kind + 'Stretch'].value = String(0.5 + index * 0.5);
        // Mock modulated endpoint values; their order is deliberately crossed.
        r.elements[kind + 'LoopStart'].value = '75';
        r.elements[kind + 'LoopEnd'].value = '25';
    }
    r.context.playGrain('A4', 10);
    assert.equal(r.sources.length, 5);
    r.sources.forEach((source, index) => {
        const duration = (10 + index * 20) / 1000;
        assert.equal(source.playbackRate.value, 0.5 + index * 0.5);
        assert.ok(Math.abs(source.stopped - source.started[0] - duration) < 1e-12);
        assert.ok(source.started[1] >= 0.25);
        assert.equal(source.started.length, 2, 'wall-clock stop avoids cross-engine start duration interpretation');
        assert.ok(source.started[1] + consumedSourceDuration(source) <= 0.75 + 1e-12);
        assert.equal(source.loop, false);
        const envelope = source.connections[0].connections[0].gain.curves[0];
        assert.equal(envelope.duration, duration);
        assert.equal(envelope.curve[0], 0);
        assert.equal(envelope.curve.at(-1), 0);
    });
    assert.equal(r.gains[0].gain.curves.length, 0, 'common gain is amplitude only');
});

test('inheritance keeps global and secondary voice sizes meaningful for older patches', () => {
    const r = runtime();
    r.addSource('generated');
    r.elements.grainSize.value = '123';
    r.context.playGrain('A4');
    assert.ok(Math.abs(r.sources[0].stopped - 10 - 0.123) < 1e-12);
    r.context.getSecondaryGrainSynthVoices = () => [{
        label: 'A', rate: 1, density: 1, sourceMode: 'all', mix: 1,
        gainTrim: 1, positionOffset: 0, sizeSeconds: 0.037, spread: 0
    }];
    r.context.playGrain('A4');
    assert.ok(Math.abs(r.sources.at(-1).stopped - 10 - 0.037) < 1e-12);
});

test('size input and size LFO routes activate independence, while inheritance and old imports clear size routes', () => {
    const r = runtime();
    r.context.saveState = () => {};
    for (const element of Object.values(r.elements)) {
        element.listeners = {};
        element.addEventListener = (type, callback) => {
            element.listeners[type] = callback;
        };
    }
    const start = html.indexOf('        GRANULAR_SOURCE_KINDS.forEach((kind) => {', html.indexOf('        function syncGrainFreeze('));
    const end = html.indexOf("\n        document.getElementById('grainFreeze').addEventListener('change', saveState);", start);
    vm.runInContext(html.slice(start, end), r.context);
    for (const kind of kinds) {
        r.elements[kind + 'GrainSize'].listeners.input();
        assert.equal(r.elements[kind + 'SizeIndependent'].checked, true);
        r.elements[kind + 'SizeIndependent'].checked = false;
        r.context.setLfoRouteState(kind + 'GrainSize', '2', true);
        assert.equal(r.elements[kind + 'SizeIndependent'].checked, true);
        assert.equal(r.context.lfo2Enabled[kind + 'GrainSize'], true);
        r.elements[kind + 'SizeIndependent'].checked = false;
        r.elements[kind + 'SizeIndependent'].listeners.change();
        assert.equal(r.context.lfo2Enabled[kind + 'GrainSize'], false);
        r.context.setLfoRouteState(kind + 'GrainSize', '3', true);
        assert.equal(r.context.gatherGrainControls().independentSizes[kind], true);
    }
    r.context.applyGrainControls(undefined);
    for (const kind of kinds) {
        assert.equal(r.elements[kind + 'SizeIndependent'].checked, false);
        assert.equal(r.context.lfo3Enabled[kind + 'GrainSize'], false);
    }
    const presetApplication = functionSource('applyPreset');
    assert.ok(presetApplication.indexOf('applyGrainControls(preset.grainControls)') >
        presetApplication.indexOf('// Apply LFO3 inverted states'), 'independence flags restore after route activation');
});

test('pitch scales quantize the combined source pitch/speed and stereo controls remain bounded', () => {
    const r = runtime();
    r.addSource('generated', 2);
    r.elements.grainPitchQuantization.value = 'major';
    r.elements.generatedStretch.value = '1.3';
    r.context.getKeyboardNoteFrequency = () => 440 * Math.pow(2, 3.2 / 12);
    r.elements.grainStereoPosition.value = '80';
    r.elements.panSpread.value = '100';
    r.elements.grainStereoScatter.value = '100';
    r.context.Math.random = () => 0.9;
    r.context.playGrain('A4');
    assert.ok(Math.abs(r.sources[0].playbackRate.value - Math.pow(2, 7 / 12)) < 1e-12);
    assert.equal(r.panners[0].pan.value, 0.8);
    assert.ok(r.panners.every((panner) => panner.pan.value >= -1 && panner.pan.value <= 1));
    r.elements.grainPitchQuantization.value = 'off';
    assert.equal(r.context.quantizeGrainPlaybackRate(1.123), 1.123);
    r.elements.grainPitchQuantization.value = 'minor-pentatonic';
    assert.ok(Math.abs(r.context.quantizeGrainPlaybackRate(Math.pow(2, -2.1 / 12)) - Math.pow(2, -2 / 12)) < 1e-12);
    r.elements.grainPitchQuantization.value = 'octaves-fifths';
    assert.ok(Math.abs(r.context.quantizeGrainPlaybackRate(Math.pow(2, 5 / 12)) - Math.pow(2, 7 / 12)) < 1e-12);
});

test('position-linked stereo follows actual sprayed per-source playback position, not the base slider', () => {
    const r = runtime();
    r.addSource('generated');
    r.elements.generatedLoopStart.value = '20';
    r.elements.generatedLoopEnd.value = '80';
    r.elements.position.value = '50';
    r.elements.spray.value = '100';
    r.elements.panSpread.value = '0';
    r.elements.grainStereoPosition.value = '100';
    r.context.Math.random = () => 0.9;
    r.context.playGrain('A4');
    const normalized = (r.sources[0].started[1] - 0.2) / 0.6;
    const expected = normalized * 2 - 1;
    assert.ok(Math.abs(r.panners[1].pan.value - expected) < 1e-12);
    assert.ok(expected > 0.6, 'spray moves the actual position away from the centered base slider');
    assert.equal(r.panners[0].pan.value, 0, 'common panner has no base-slider position bias');
    r.elements.grainStereoPosition.value = '-100';
    r.context.playGrain('A4');
    assert.ok(Math.abs(r.panners.at(-1).pan.value + expected) < 1e-12);
});

test('continuous source positions wrap in the available start span instead of sticking near the region end', () => {
    const r = runtime();
    r.addSource('generated');
    r.elements.generatedSizeIndependent.checked = true;
    r.elements.generatedGrainSize.value = '400';
    r.elements.position.value = '0';
    [10.61, 10.71, 10.81].forEach((time) => {
        r.context.audioContext.currentTime = time;
        r.context.playGrain('A4', time, 1, { continuousLoop: true, streamStartTime: 10 });
    });
    r.sources.forEach((source, index) => {
        assert.ok(Math.abs(source.started[1] - (0.01 + index * 0.1)) < 1e-12);
        assert.ok(source.started[1] + consumedSourceDuration(source) <= 1 + 1e-12);
    });
    const tinyPosition = r.context.resolveContinuousLoopPosition({
        startTime: 0.2, endTime: 0.20000001, sourceDuration: 0
    }, 0, 10.1, 10, 1);
    assert.ok(tinyPosition >= 0.2 && tinyPosition <= 0.20000001);
    assert.equal(r.context.resolveContinuousLoopPosition({
        startTime: 0.2, endTime: 0.3, sourceDuration: 0.1
    }, 0.5, 10.1, 10, 1), 0.2);
});

test('duplicate route and inversion controls share state and aria-pressed', () => {
    const buttons = Array.from({ length: 3 }, () => ({
        active: false, pressed: '',
        classList: { toggle(name, active) { buttons.find((button) => button.classList === this).active = active; } },
        setAttribute(name, value) { this.pressed = value; }
    }));
    const context = vm.createContext({
        document: { querySelectorAll: () => buttons },
        lfoEnabled: {}, lfo2Enabled: {}, lfo3Enabled: {},
        lfoInverted: {}, lfo2Inverted: {}, lfo3Inverted: {}
    });
    vm.runInContext(functionSource('setLfoRouteState') + '\n' + functionSource('setLfoInvertState'), context);
    context.setLfoRouteState('generatedLoopStart', '3', true);
    assert.equal(context.lfo3Enabled.generatedLoopStart, true);
    assert.ok(buttons.every((button) => button.active && button.pressed === 'true'));
    context.setLfoInvertState('generatedLoopStart', '2', false);
    assert.equal(context.lfo2Inverted.generatedLoopStart, false);
    assert.ok(buttons.every((button) => !button.active && button.pressed === 'false'));
});

test('reverse buffers are weakly cached, reverse offsets remain inside the mirrored region', async () => {
    const r = runtime();
    const { buffer } = r.addSource('mic', 0.005);
    r.elements.micSizeIndependent.checked = true;
    r.elements.micGrainSize.value = '500';
    r.elements.micStretch.value = '4';
    r.elements.grainReverseProbability.value = '100';
    const preparation = r.context.prepareReversedGrainBuffer(buffer);
    r.finishReversePreparation();
    await preparation;
    r.context.playGrain('A4');
    r.context.playGrain('A4');
    assert.notEqual(r.sources[0].buffer, buffer);
    assert.equal(r.sources[0].buffer, r.sources[1].buffer);
    assert.equal(r.sources[0].buffer.getChannelData(0).at(-1), buffer.getChannelData(0)[0]);
    for (const source of r.sources) {
        assert.ok(source.started[1] >= 0);
        assert.ok(source.started[1] + consumedSourceDuration(source) <= buffer.duration + 1e-12);
        assert.ok(Math.abs(source.stopped - 10 - buffer.duration / 4) < 1e-12);
    }
});

test('reverse preparation is chunked and deduplicated off the hot path, including newly replaced buffers', async () => {
    const r = runtime();
    const { buffer } = r.addSource('generated', 4);
    r.elements.grainReverseProbability.value = '100';
    let allocations = 0;
    const createBuffer = r.context.audioContext.createBuffer;
    r.context.audioContext.createBuffer = (...args) => { allocations++; return createBuffer(...args); };
    const preparation = r.context.prepareReversedGrainBuffer(buffer);
    assert.equal(r.context.prepareReversedGrainBuffer(buffer), preparation);
    assert.equal(allocations, 0, 'even allocation is deferred until idle work');
    r.context.playGrain('A4');
    assert.equal(allocations, 0, 'a cold reverse roll does not copy or allocate an audio buffer');
    assert.equal(r.sources[0].buffer, buffer, 'cold grains safely remain forward');
    assert.equal(r.reverseWork.length, 1, 'one cooperative idle job services all queued chunks');
    r.reverseWork.shift()();
    assert.equal(allocations, 1);
    assert.equal(r.context.reversedGrainBuffers.has(buffer), false, 'large buffers need multiple bounded chunks');
    r.finishReversePreparation();
    const reversed = await preparation;
    assert.equal(allocations, 1);
    assert.equal(reversed.getChannelData(0).at(-1), buffer.getChannelData(0)[0]);
    r.context.playGrain('A4');
    assert.equal(r.sources[1].buffer, reversed);
    assert.equal(allocations, 1, 'warm grains reuse the weakly cached buffer');
    const replacement = createBuffer(2, 96000, 48000);
    r.context.available[0].buffer = replacement;
    r.context.prepareAvailableReversedGrains();
    assert.equal(allocations, 1);
    r.finishReversePreparation();
    assert.notEqual(r.context.reversedGrainBuffers.get(replacement), reversed);
    assert.equal(allocations, 2);
    assert.match(functionSource('updateSourceAvailability'), /prepareAvailableReversedGrains\(\)/);
    assert.match(functionSource('normalizeAudio'), /prepareAvailableReversedGrains\(\)/);
});

test('reverse preparation aborts superseded buffers before allocating and unused reverse stays allocation-free', async () => {
    const r = runtime();
    const { buffer } = r.addSource('generated');
    r.context.prepareAvailableReversedGrains();
    assert.equal(r.reverseWork.length, 0, 'default zero-probability playback does not double source memory');
    const preparation = r.context.prepareReversedGrainBuffer(buffer);
    let allocations = 0;
    r.context.audioContext.createBuffer = () => { allocations++; throw new Error('should not allocate'); };
    r.context.available = [];
    r.finishReversePreparation();
    assert.equal(await preparation, null);
    assert.equal(allocations, 0);
    assert.equal(r.context.reversedGrainBuffers.has(buffer), false);
});

test('freeze snapshots hold continuous playhead and modulated window, but reject replaced buffers', () => {
    const r = runtime();
    r.addSource('generated', 2);
    const options = { continuousLoop: true, streamStartTime: 9 };
    r.context.playGrain('A4', 10, 1, options);
    const offset = r.sources[0].started[1];
    r.elements.grainFreeze.checked = true;
    r.context.syncGrainFreeze();
    r.elements.generatedLoopStart.value = '80';
    r.elements.generatedLoopEnd.value = '100';
    r.elements.generatedSizeIndependent.checked = true;
    r.elements.generatedGrainSize.value = '500';
    r.elements.generatedStretch.value = '4';
    r.context.playGrain('A4', 11, 1, options);
    assert.equal(r.sources[1].started[1], offset);
    const frozenWindow = r.context.frozenGrainSnapshots.get('generated').loopRange;
    assert.ok(r.sources[1].started[1] + consumedSourceDuration(r.sources[1]) <= frozenWindow.endPct * 2 + 1e-12);
    r.elements.generatedSizeIndependent.checked = false;
    r.elements.generatedStretch.value = '1';
    r.context.available = [];
    r.addSource('generated', 1);
    r.context.playGrain('A4', 12, 1, options);
    assert.ok(r.sources[2].started[1] >= 0.8);
    r.elements.grainFreeze.checked = false;
    r.context.syncGrainFreeze();
    assert.equal(r.context.frozenGrainSnapshots.size, 0);
});

test('freeze snapshots the actual current continuous playhead, not a scheduled future grain or sequencer position', () => {
    const r = runtime();
    r.addSource('generated', 2);
    r.context.activeGrains.set('keyboard', { continuousLoop: true });
    r.context.playGrain('A4', 10.1, 1, { continuousLoop: true, streamStartTime: 9 });
    const scheduledPosition = r.sources[0].started[1];
    r.context.playGrain('A4', 10.05, 1, { continuousLoop: false });
    r.context.audioContext.currentTime = 10.025;
    r.elements.generatedLoopStart.value = '20';
    r.elements.generatedLoopEnd.value = '80';
    r.elements.grainFreeze.checked = true;
    r.context.syncGrainFreeze();
    const snapshot = r.context.frozenGrainSnapshots.get('generated');
    assert.equal(snapshot.loopRange.startPct, 0.2);
    assert.equal(snapshot.loopRange.endPct, 0.8);
    const currentPosition = utils.resolveLoopedPlayPosition({
        startTime: 0.4, endTime: 1.5, positionPct: Number(r.elements.position.value) / 100,
        elapsedSeconds: 1.025, playbackRate: 1
    });
    const expected = Math.max(0.4, Math.min(1.5, currentPosition));
    assert.ok(Math.abs(snapshot.playPosition - expected) < 1e-12);
    assert.notEqual(snapshot.playPosition, scheduledPosition);
    assert.notEqual(snapshot.playPosition, 0.4, 'freeze is not a reset to the region start');
});

test('grain curve cache is bounded, noise is enveloped and trapezoid respects short attack/release', () => {
    const r = runtime();
    const curve = r.context.getCachedGrainEnvelope(0.1, 0.01, 0.01);
    assert.equal(r.context.getCachedGrainEnvelope(0.1, 0.01, 0.01), curve);
    r.elements.grainEnvelopeShape.value = 'trapezoid';
    for (let i = 0; i < 300; i++) r.context.getCachedGrainEnvelope(0.1, i / 1000, (300 - i) / 1000);
    assert.ok(r.context.grainEnvelopeCache.size <= 128);
    r.elements.noiseType.value = 'white';
    r.elements.noiseMix.value = '100';
    r.context.whiteNoiseBuffer = r.context.audioContext.createBuffer(1, 100, 48000);
    r.context.playGrain('A4');
    assert.equal(r.sources.length, 1);
    assert.equal(r.sources[0].connections[0].gain.curves.length, 1);
    const slowAttack = utils.createGrainEnvelopeCurve('trapezoid', 0.5, 128, 0.8, 0.2);
    const fastAttack = utils.createGrainEnvelopeCurve('trapezoid', 0.5, 128, 0.1, 0.1);
    assert.ok(slowAttack[20] < fastAttack[20]);
    const forward = utils.createGrainEnvelopeCurve('exponential', 0.5);
    const reverse = utils.createGrainEnvelopeCurve('reverse-exponential', 0.5);
    assert.ok(forward[20] > forward[100]);
    assert.ok(reverse[20] < reverse[100]);
    const skewedGaussian = utils.createGrainEnvelopeCurve('gaussian', 0.1);
    assert.ok(skewedGaussian[1] < 0.1, 'extreme Gaussian skew still has a smooth leading edge');
});

test('sample and noise envelopes share linear safety ramps for tiny grains and cached curves for longer grains', () => {
    const r = runtime();
    r.addSource('generated', 0.005);
    r.elements.generatedSizeIndependent.checked = true;
    r.elements.generatedGrainSize.value = '500';
    r.elements.generatedStretch.value = '4';
    r.context.playGrain('A4');
    const sampleEnvelope = r.sources[0].connections[0].connections[0].gain;
    assert.equal(sampleEnvelope.curves.length, 0);
    assert.equal(sampleEnvelope.values[0].value, 0);
    assert.deepEqual(sampleEnvelope.ramps.map((ramp) => ramp.value), [1, 0]);
    assert.ok(sampleEnvelope.ramps[0].time > 10 && sampleEnvelope.ramps[0].time < r.sources[0].stopped);
    assert.equal(sampleEnvelope.ramps[1].time, r.sources[0].stopped);
    r.elements.noiseType.value = 'white';
    r.elements.noiseMix.value = '100';
    r.elements.grainSize.value = '1';
    r.context.whiteNoiseBuffer = r.context.audioContext.createBuffer(1, 2400, 48000);
    r.context.playGrain('A4');
    const noiseEnvelope = r.sources[1].connections[0].gain;
    assert.equal(noiseEnvelope.curves.length, 0);
    assert.deepEqual(noiseEnvelope.ramps.map((ramp) => ramp.value), [1, 0]);
    assert.equal(noiseEnvelope.ramps[1].time, r.sources[1].stopped);
    const tiny = r.context.audioContext.createGain().gain;
    r.context.applyGrainEnvelope(tiny, 1 / 48000, 1, 1, 10);
    assert.equal(tiny.curves.length, 0);
    assert.ok(tiny.ramps.every((ramp) => ramp.time > 10 && ramp.time <= 10 + 1 / 48000));
    const long = r.context.audioContext.createGain().gain;
    r.context.applyGrainEnvelope(long, 0.1, 0.01, 0.01, 10);
    assert.equal(long.curves.length, 1);
    assert.equal(long.ramps.length, 0);
    r.context.audioContext.sampleRate = 1000;
    const fewSamples = r.context.audioContext.createGain().gain;
    r.context.applyGrainEnvelope(fewSamples, 0.003, 0.01, 0.01, 10);
    assert.equal(fewSamples.curves.length, 0);
    assert.equal(fewSamples.ramps.length, 2);
});
test('explicit randomization pairs windows/sizes for all slots after asynchronous generation', () => {
    const r = runtime();
    r.addSource('mic', 0.005);
    r.context.randomizeLayerWindows();
    for (const kind of kinds) {
        assert.ok(Number(r.elements[kind + 'LoopStart'].value) < Number(r.elements[kind + 'LoopEnd'].value));
        assert.equal(r.elements[kind + 'SizeIndependent'].checked, true);
    }
    assert.ok(Number(r.elements.micGrainSize.value) <= 2);
    const handler = html.slice(html.indexOf("document.getElementById('randomizeBtn').addEventListener"));
    assert.match(handler, /await generateSourceWithPlaybackRestart\([\s\S]*?sourceBlueprint\s*\}\);\s*randomizeLayerWindows\(\);/);
    assert.match(html, /RANDOMIZE_SKIP_SLIDERS\.add\(kind \+ suffix\)/);
    assert.doesNotMatch(functionSource('setSourceBuffer'), /resetSourceLoopPoints\(kind\)/);
});

test('Generate Sample commit keeps paired source windows, layer size and speed', async () => {
    const r = runtime();
    r.addSource('generated', 1);
    r.context.sourceMutationSerial = 0;
    r.context.MAX_SAMPLE_DURATION_SECONDS = 300;
    r.context.syncLegacyAudioBuffer = () => {};
    r.context.updateLoopLabels = () => {};
    r.context.drawWaveforms = () => {};
    r.context.updateSourceAvailability = () => {};
    r.context.setStatus = () => {};
    r.context.saveAudioBufferToDB = async () => {};
    r.elements.generatedLoopStart.value = '16';
    r.elements.generatedLoopEnd.value = '66';
    r.elements.generatedGrainSize.value = '44';
    r.elements.generatedStretch.value = '1.3';
    r.elements.generatedSizeIndependent.checked = true;
    vm.runInContext(functionSource('setSourceBuffer') + '\n' + functionSource('applyLoadedAudioBuffer'), r.context);
    const replacement = r.context.audioContext.createBuffer(2, 96000, 48000);
    await r.context.applyLoadedAudioBuffer(replacement, 'Generated Sample', 'generated');
    assert.equal(r.context.getSourceBuffer('generated'), replacement);
    assert.equal(r.elements.generatedLoopStart.value, '16');
    assert.equal(r.elements.generatedLoopEnd.value, '66');
    assert.equal(r.elements.generatedGrainSize.value, '44');
    assert.equal(r.elements.generatedStretch.value, '1.3');
    assert.equal(r.elements.generatedSizeIndependent.checked, true);
    assert.match(functionSource('generateRandomSourceSample'), /await applyLoadedAudioBuffer\(buffer, sourceLabel, 'generated'\)/);
    assert.match(functionSource('generateStandaloneSource'), /await generateSourceWithPlaybackRestart/);
});

test('grain settings are whitelisted, persisted and reset to safe old-patch defaults', () => {
    const r = runtime();
    r.context.applyGrainControls({
        envelope: 'triangle', quantization: 'major', freeze: true,
        independentSizes: { generated: true, mic: 'true', unknown: true }
    });
    const settings = r.context.gatherGrainControls();
    assert.equal(settings.envelope, 'triangle');
    assert.equal(settings.independentSizes.generated, true);
    assert.equal(settings.independentSizes.mic, false);
    assert.equal(settings.freeze, true);
    r.context.applyGrainControls({ envelope: 'injected', quantization: 'invalid', freeze: 'true' });
    assert.equal(r.elements.grainEnvelopeShape.value, 'hann');
    assert.equal(r.elements.grainPitchQuantization.value, 'off');
    assert.equal(r.elements.grainFreeze.checked, false);
    r.elements.generatedGrainSize.value = '333';
    r.elements.generatedStretch.value = '4';
    r.context.resetGrainControls();
    assert.equal(r.elements.generatedGrainSize.value, '100');
    assert.equal(r.elements.generatedStretch.value, '1');
    assert.equal(r.elements.generatedSizeIndependent.checked, false);
    assert.match(functionSource('gatherPreset'), /grainControls: gatherGrainControls\(\)/);
    assert.match(functionSource('applyPreset'), /applyGrainControls\(preset\.grainControls\)/);
    assert.match(functionSource('saveState'), /grainControls: gatherGrainControls\(\)/);
    assert.match(functionSource('restoreState'), /applyGrainControls\(state\.grainControls\)/);
});

test('visualization uses modulated boundaries, cached traces and throttled refreshes', () => {
    assert.match(functionSource('drawSourceWaveform'), /getLoopRange\(config\.startId, config\.endId, \{ modulated: true \}\)/);
    assert.match(functionSource('drawSourceWaveform'), /waveformTraceCache\.get\(buffer\)/);
    assert.match(functionSource('drawSourceWaveform'), /waveformTraceCache\.set\(buffer, trace\)/);
    assert.match(html, /Date\.now\(\) - lastWaveformModulationDraw >= 100/);
    assert.match(html, /GRANULAR_SOURCE_KINDS\.forEach\(drawSourceWaveform\)/);
    assert.match(functionSource('scheduleActiveGrains'), /getModulatedValue\('grainTimingJitter'\)/);
});

test('rate-expanded playback regions appear on the waveform and expire without rescanning samples', () => {
    const r = runtime();
    const { buffer } = r.addSource('generated');
    r.elements.generatedLoopStart.value = '25';
    r.elements.generatedLoopEnd.value = '30';
    r.elements.generatedEffectiveWindow = { textContent: '' };
    const strokes = [];
    const paint = {
        fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        strokeRect(...args) { strokes.push(args); }
    };
    const getConfig = r.context.getSourceSlotConfig;
    r.context.getSourceSlotConfig = (kind) => ({
        ...getConfig(kind), color: '#00d4ff',
        canvas: { offsetWidth: 200, offsetHeight: 80, getContext: () => paint }
    });
    r.context.updateLoopLabels = () => {};
    const getData = buffer.getChannelData;
    let sampleReads = 0;
    buffer.getChannelData = (channel) => { sampleReads++; return getData(channel); };
    r.context.trackEffectiveGrainWindow('generated', buffer, 0.2, 0.5, 10.1);
    r.context.drawSourceWaveform('generated');
    r.context.trackEffectiveGrainWindow('generated', buffer, 0.6, 0.8, 10.2);
    r.context.drawSourceWaveform('generated');
    assert.equal(strokes.at(-1)[0], 40);
    assert.ok(Math.abs(strokes.at(-1)[2] - 120) < 1e-9);
    assert.match(r.elements.generatedEffectiveWindow.textContent, /20\.000–80\.000%/);
    assert.equal(sampleReads, 1);
    r.context.audioContext.currentTime = 10.3;
    r.context.drawSourceWaveform('generated');
    assert.equal(r.context.effectiveGrainWindows.size, 0);
    assert.equal(sampleReads, 1);
});

test('raw loop percentages have no independent one-percent floor and collapsed bounds resolve within the buffer', () => {
    const r = runtime();
    r.elements.generatedLoopStart.value = '100';
    r.elements.generatedLoopEnd.value = '100';
    const range = r.context.getLoopRange('generatedLoopStart', 'generatedLoopEnd');
    assert.equal(range.startPct, 1);
    assert.equal(range.endPct, 1);
    for (const duration of [0.005, 1]) {
        const bounds = r.context.getLoopTimingForBuffer({ duration }, 'generatedLoopStart', 'generatedLoopEnd');
        assert.ok(bounds.start >= 0);
        assert.ok(bounds.start < bounds.end);
        assert.ok(bounds.end <= duration);
    }
});
