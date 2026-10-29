const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const theory = require('../q-theory.js');
const { createKeyboardPlayer } = require('../q-card.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const instruments = ['piano', 'strings'];
const controlId = instrument => `performanceKeyboard${instrument === 'piano' ? 'Piano' : 'Strings'}Volume`;
const manifests = Object.fromEntries(instruments.map(instrument => [instrument,
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', theory.instruments[instrument].repository, 'manifest.json'), 'utf8'))]));

function extract(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(`Unclosed ${name}`);
}

function audioGraph() {
    const context = { currentTime: 1, state: 'running', sampleRate: 48000, nodes: [] };
    function node(kind) {
        const result = {
            kind, inputs: new Set(), outputs: new Set(), connectCalls: 0,
            connect(destination) {
                this.connectCalls += 1;
                this.outputs.add(destination);
                destination.inputs.add(this);
                return destination;
            },
            disconnect(destination) {
                for (const output of this.outputs) {
                    if (destination && output !== destination) continue;
                    output.inputs.delete(this);
                    this.outputs.delete(output);
                }
            },
            sample() {
                if (kind === 'source') {
                    return context.currentTime >= this.startTime && context.currentTime < this.stopTime ? .2 : 0;
                }
                const input = [...this.inputs].reduce((total, source) => total + source.sample(), 0);
                return input * (this.gain ? this.gain.at(context.currentTime) : 1);
            }
        };
        context.nodes.push(result);
        return result;
    }
    context.createGain = () => {
        const result = node('gain');
        result.gain = {
            value: 1, events: [],
            setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); },
            linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); },
            cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); },
            at(time) {
                let previous = { value: this.value, time: 0 };
                for (const event of this.events) {
                    if (time < event.time) {
                        return event.type === 'ramp'
                            ? previous.value + (event.value - previous.value) * (time - previous.time) / (event.time - previous.time)
                            : previous.value;
                    }
                    previous = event;
                }
                return previous.value;
            }
        };
        return result;
    };
    context.createBufferSource = () => Object.assign(node('source'), {
        playbackRate: {}, startTime: Infinity, stopTime: Infinity,
        start(time) { this.startTime = time; },
        stop(time = context.currentTime) { this.stopTime = time; }
    });
    context.createAnalyser = () => Object.assign(node('analyser'), {
        getFloatTimeDomainData(data) { data.fill(this.sample()); }
    });
    context.destination = node('destination');
    return context;
}

function loadSamples(player) {
    for (const [instrument, entry] of player.samplers) {
        const samples = manifests[instrument].samples.map(sample => ({ ...sample, offset: 44100, frames: 441000 }));
        entry.piano.restored({ sampleRate: 48000, length: 528000, numberOfChannels: 2 },
            { version: 1, instrument: theory.instruments[instrument].id, sampleRate: 44100, samples });
    }
    return player;
}

function fixture() {
    const audioContext = audioGraph();
    let displayTime = 0;
    const controls = new Map();
    const solos = new Set();
    for (const instrument of instruments) {
        const id = controlId(instrument);
        const card = {
            mounted: false,
            querySelector() { return this.mounted ? {} : null; },
            insertAdjacentHTML(position, markup) {
                this.mounted = true;
                for (const match of markup.matchAll(/\bid="([^"]+)"/g)) {
                    const attributes = {};
                    controls.set(match[1], {
                        style: {}, textContent: '', visible: true, attributes,
                        getAttribute(name) { return attributes[name]; },
                        setAttribute(name, value) { attributes[name] = value; }
                    });
                }
                this.markup = markup;
            }
        };
        controls.set(id, { value: '100', closest: () => card });
    }
    const context = vm.createContext({
        audioContext, keyboardSamplePlayer: null, keyboardSamplePlayerContext: null,
        keyboardSampleOutputBuses: new Map(), keyboardSoundPreparation: null, keyboardSoundReadiness: 'idle',
        preFilterGainNode: audioContext.createGain(), masterGain: audioContext.createGain(),
        keyboardGrainCaptureGain: audioContext.createGain(),
        performanceMixerVuTapState: new Map(), performanceMixerVuTimerId: null, performanceVuPaintState: new WeakMap(),
        performance: {now:()=>displayTime}, performanceVuSubscriptions: [], performanceControlsReady: true,
        performanceVuLevel: 0, performanceVuPeakLevel: 0,
        performanceOutputVuShell: null, performanceOutputVuFill: null, performanceOutputVuPeak: null, performanceOutputVuValue: null,
        performanceMixerVuShell: null, performanceMixerVuFill: null, performanceMixerVuPeak: null, performanceMixerVuValue: null,
        activeGrains: new Map(), activeOscVoices: new Map(), stopScheduledGrainVoices(){}, stopRetiredTransportVoices(){},
        hasAnyPerformanceLayerSoloSelection: () => solos.size > 0,
        hasPerformanceSourceLayerSolo: instrument => solos.has(instrument),
        document: { getElementById: id => controls.get(id) || null },
        isPerformanceElementVisible: element => Boolean(element?.visible),
        window: { MygrainQ: { createKeyboardPlayer } }
    });
    for (const name of ['getKeyboardSampleVolume', 'getKeyboardSampleSoloGain', 'getKeyboardSampleOutputNode',
        'getKeyboardSamplePlayer', 'syncKeyboardSampleMixControls', 'getPerformanceMixerVuDomIds',
        'ensurePerformanceMixerVuCardsMounted', 'disconnectPerformanceMixerVuTap', 'syncPerformanceMixerVuTap',
        'updatePerformanceMixerVuChannel', 'resetPerformanceMixerVuChannelDisplay', 'updatePerformanceVuDisplay',
        'stopPerformanceMixerVuMeters', 'isKeyboardSoundRole', 'stopKeyboardSounds']) {
        vm.runInContext(extract(name), context);
    }
    vm.runInContext(html.match(/const PERFORMANCE_MIXER_VU_CHANNELS = \[[\s\S]*?\n        \];/)[0], context);
    const channels = vm.runInContext('PERFORMANCE_MIXER_VU_CHANNELS', context)
        .filter(channel => instruments.some(instrument => channel.controlId === controlId(instrument)));
    context.ensurePerformanceMixerVuCardsMounted();
    const player = loadSamples(context.getKeyboardSamplePlayer());
    const update = () => { displayTime += 500; channels.forEach(channel => context.updatePerformanceMixerVuChannel(channel)); };
    const state = instrument => context.performanceMixerVuTapState.get(controlId(instrument));
    const value = instrument => controls.get(`${controlId(instrument)}VuValue`).textContent;
    return { context, controls, solos, player, channels, update, state, value };
}

function close(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} !== ${expected}`);
}

test('Piano and Strings mount distinct accessible VUs and stay silent before any notes', () => {
    const { context, controls, channels, update, value } = fixture();
    assert.equal(channels.length, 2);
    for (const instrument of instruments) {
        assert.match(controls.get(controlId(instrument)).closest().markup, /role="meter"/);
        assert.equal(channels.find(channel => channel.controlId === controlId(instrument)).getNode(), null);
    }
    update();
    context.ensurePerformanceMixerVuCardsMounted();
    assert.equal(context.keyboardSampleOutputBuses.size, 0);
    for (const instrument of instruments) assert.equal(value(instrument), '-inf dB');
});

test('each post-envelope/post-volume instrument bus has unity gain and exactly one audible route with independent K capture', async () => {
    const { context, player, update, state } = fixture();
    const voices = await Promise.all(instruments.map(instrument => player.noteOn(`keyboard:${instrument}`, 60, { instrument })));
    context.audioContext.currentTime = 1.1;
    const audibleBefore = context.preFilterGainNode.sample();
    const captureBefore = context.keyboardGrainCaptureGain.sample();
    update();
    for (const voice of voices) {
        const bus = context.keyboardSampleOutputBuses.get(voice.instrument).node;
        assert.deepEqual([...voice.gain.outputs], [voice.mixGain]);
        assert.deepEqual([...voice.mixGain.outputs], [bus, context.keyboardGrainCaptureGain]);
        assert.deepEqual([...bus.outputs], [context.preFilterGainNode, state(voice.instrument).analyser]);
        assert.equal(bus.gain.value, 1);
        assert.equal(state(voice.instrument).analyser.outputs.size, 0);
        assert.equal(bus.outputs.has(context.keyboardGrainCaptureGain), false);
    }
    for (let index = 0; index < 10; index += 1) update();
    close(context.preFilterGainNode.sample(), audibleBefore);
    close(context.keyboardGrainCaptureGain.sample(), captureBefore);
    close(audibleBefore, captureBefore);
    context.stopPerformanceMixerVuMeters();
    for (const instrument of instruments) {
        assert.deepEqual([...context.keyboardSampleOutputBuses.get(instrument).node.outputs], [context.preFilterGainNode]);
    }
    close(context.preFilterGainNode.sample(), audibleBefore);
    close(context.keyboardGrainCaptureGain.sample(), captureBefore);
    update();
    close(context.preFilterGainNode.sample(), audibleBefore);
});

test('simultaneous notes sum on their own stable bus without duplicate connections or cross-instrument metering', async () => {
    const { context, player, update, state, value } = fixture();
    const first = await player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    context.audioContext.currentTime = 1.1;
    update();
    const bus = state('piano').node;
    const analyser = state('piano').analyser;
    const single = analyser.sample();
    const second = await player.noteOn('keyboard:E4', 64, { instrument: 'piano' });
    context.audioContext.currentTime = 1.2;
    update();
    assert.equal(state('piano').node, bus);
    assert.equal(state('piano').analyser, analyser);
    close(analyser.sample(), single * 2);
    assert.equal(value('strings'), '-inf dB');
    const connections = bus.connectCalls;
    update();
    assert.equal(bus.connectCalls, connections);
    first.source.onended();
    update();
    close(analyser.sample(), single);
    assert.equal(player.activeVoices.has(second), true);
    assert.equal(first.mixGain.outputs.size, 0);
});

test('volume, mute, instrument solo and external solo affect measured samples only through the existing voice mix gains', async () => {
    const { context, controls, solos, player, update, state, value } = fixture();
    await Promise.all(instruments.map(instrument => player.noteOn(instrument, 60, { instrument })));
    context.audioContext.currentTime = 1.1;
    update();
    const full = state('piano').analyser.sample();
    controls.get(controlId('piano')).value = '50';
    context.syncKeyboardSampleMixControls();
    context.audioContext.currentTime += .02;
    update();
    close(state('piano').analyser.sample(), full / 2);
    controls.get(controlId('piano')).value = '0';
    context.syncKeyboardSampleMixControls();
    context.audioContext.currentTime += .02;
    update();
    assert.equal(value('piano'), '-inf dB');
    assert.notEqual(value('strings'), '-inf dB');
    controls.get(controlId('piano')).value = '100';
    for (const selected of ['piano', 'strings', 'osc', null]) {
        solos.clear();
        if (selected) solos.add(selected);
        context.syncKeyboardSampleMixControls();
        context.audioContext.currentTime += .02;
        update();
        for (const instrument of instruments) {
            assert.equal(value(instrument) !== '-inf dB', !selected || selected === instrument);
        }
    }
});

test('scheduled arp notes meter their real envelope and release, then Stop silences both buses without destroying them', async () => {
    const { context, player, update, state, value } = fixture();
    const voice = await player.noteOn('arp:C4', 60, { instrument: 'strings', startTime: 2, duration: .1 });
    update();
    assert.equal(value('strings'), '-inf dB');
    context.audioContext.currentTime = 2.05;
    update();
    const peak = state('strings').analyser.sample();
    assert.ok(peak > 0);
    context.audioContext.currentTime = voice.releaseStart + voice.release / 2;
    update();
    close(state('strings').analyser.sample(), peak / 2);
    context.audioContext.currentTime = voice.end + .01;
    voice.source.onended();
    update();
    assert.equal(value('strings'), '-inf dB');
    await player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    await player.noteOn('keyboard:E4', 64, { instrument: 'strings' });
    context.audioContext.currentTime += .1;
    update();
    const bus = state('strings').node;
    context.stopKeyboardSounds({ immediate: true });
    update();
    assert.equal(player.activeVoices.size, 0);
    assert.equal(state('strings').node, bus);
    for (const instrument of instruments) assert.equal(value(instrument), '-inf dB');
});

test('hidden meters and audio context replacement clean up taps without rerouting capture or retaining old buses', async () => {
    const { context, controls, player, update, state, value } = fixture();
    await player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    context.audioContext.currentTime = 1.1;
    update();
    const oldBus = state('piano').node;
    controls.get(`${controlId('piano')}VuShell`).visible = false;
    update();
    assert.equal(oldBus.outputs.size, 1);
    controls.get(`${controlId('piano')}VuShell`).visible = true;
    update();
    assert.notEqual(value('piano'), '-inf dB');
    context.audioContext = audioGraph();
    context.preFilterGainNode = context.audioContext.createGain();
    context.keyboardGrainCaptureGain = context.audioContext.createGain();
    const replacement = loadSamples(context.getKeyboardSamplePlayer());
    assert.notEqual(replacement, player);
    assert.equal(player.activeVoices.size, 0);
    assert.equal(oldBus.outputs.size, 0);
    assert.equal(context.keyboardSampleOutputBuses.size, 0);
    update();
    assert.equal(value('piano'), '-inf dB');
    await replacement.noteOn('keyboard:D4', 62, { instrument: 'piano' });
    context.audioContext.currentTime = 1.1;
    update();
    assert.notEqual(state('piano').node, oldBus);
    assert.notEqual(value('piano'), '-inf dB');
});

test('audible destination changes preserve the instrument bus and analyser without adding a second audio route', async () => {
    const { context, player, update, state } = fixture();
    await player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    update();
    const bus = state('piano').node;
    const analyser = state('piano').analyser;
    context.preFilterGainNode = null;
    assert.equal(context.getKeyboardSampleOutputNode('piano'), bus);
    assert.deepEqual([...bus.outputs], [analyser, context.masterGain]);
    context.masterGain = null;
    assert.equal(context.getKeyboardSampleOutputNode('piano'), bus);
    assert.deepEqual([...bus.outputs], [analyser, context.audioContext.destination]);
    assert.equal(context.keyboardGrainCaptureGain.inputs.size, 1);
});

test('the keyboard player still accepts zero-argument output hosts and passes the instrument to instrument-aware hosts', async () => {
    const audioContext = audioGraph();
    const output = audioContext.createGain();
    const capture = audioContext.createGain();
    const calls = [];
    const player = loadSamples(createKeyboardPlayer({
        context: () => audioContext,
        output: instrument => { calls.push(instrument); return output; },
        capture: () => capture
    }));
    for (const instrument of instruments) {
        const voice = await player.noteOn(instrument, 60, { instrument });
        assert.deepEqual([...voice.gain.outputs], [output, capture]);
    }
    assert.deepEqual(calls, instruments);
    const legacy = loadSamples(createKeyboardPlayer({ context: () => audioContext, output: () => output }));
    const voice = await legacy.noteOn('legacy', 60, { instrument: 'piano' });
    assert.deepEqual([...voice.gain.outputs], [output]);
});
