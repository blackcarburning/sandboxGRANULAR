// Execute production grain admission, envelopes and scheduler with a deterministic
// audio clock. In browser PCM tests the nodes themselves are native Web Audio.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function sources(filename = path.join(__dirname, '../index.html')) {
    const html = fs.readFileSync(filename, 'utf8');
    const names = ['getConcurrentGrainSourceCount', 'playGrain', 'getGranularLayerIntervalSeconds', 'getGranularLayerScheduleIntervalSeconds', 'scheduleActiveGrains'];
    const code = names.map(name => {
        const start = html.search(new RegExp('^        function ' + name + '\\(', 'm'));
        if (start < 0) throw Error(name);
        return html.slice(start, html.indexOf('\n        }', start) + 10);
    }).join('\n');
    return { code, cap: Number(html.match(/const MAX_GRAIN_NODES = (\d+)/)[1]),
        lookahead: Number(html.match(/const GRAIN_SCHEDULER_LOOKAHEAD = ([\d.]+)/)[1]) };
}
function fixture(config, native = null) {
    let clock = 0, maxPool = 0;
    const starts = [], stops = [];
    const parameter = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {} });
    const node = () => ({ gain: parameter(), pan: parameter(), playbackRate: parameter(), connect() {}, disconnect() {}, start() {}, stop() {} });
    // Do not disconnect native offline nodes before the offline context renders.
    // Ended sources are already silent; production cleanup is separately asserted.
    const create = name => {
        const result = native ? native[name]() : node();
        if (native) result.disconnect = () => {};
        return result;
    };
    const audioContext = { get currentTime() { return clock; }, sampleRate: native?.sampleRate || 48000,
        createGain: () => create('createGain'), createBufferSource: () => create('createBufferSource'), createStereoPanner: () => create('createStereoPanner') };
    const buffer = native ? native.createBuffer(1, 48000, 48000) : { duration: 1 };
    if (native) buffer.getChannelData(0).fill(.025); // DC exposes every envelope gap, without sine zero-crossing false positives.
    const layers = (config.layers || [
        { key: 'A', sizeSeconds: .15, blend: .36, smoothing: .48, attackSeconds: .04, decaySeconds: .095, releaseSeconds: 1.25, volume: .62 },
        { key: 'B', sizeSeconds: .21, blend: .34, smoothing: .56, attackSeconds: .065, decaySeconds: .14, releaseSeconds: 1.75, volume: .58 }
    ]).map(layer => ({ width: 0, panBias: 0, ...layer }));
    const granularOutputGain = audioContext.createGain();
    if (native) granularOutputGain.connect(native.destination);
    const activeGrains = new Map(Array.from({ length: config.notes || 1 }, (_, n) => ['keyboard:' + n,
        { note: String(n), role: 'keyboard', velocity: 1, nextTime: 0, startTime: 0, keyboardDecaySeconds: 0 }]));
    const state = { audioContext, MAX_GRAIN_NODES: config.cap, GRAIN_SCHEDULER_LOOKAHEAD: config.lookahead, GRAIN_SCHEDULER_INTERVAL: 10,
        activeGrainNodes: 0, grainSchedulerTimerId: null, scheduledGrainVoices: new Set(), retiredTransportVoices: new Set(), activeGrains, granularOutputGain,
        canPlayGrains: () => true, getGrainTimingMode: () => 'synth', getGrainModeProfile: () => ({}), getGranularKeyboardNoteFrequency: () => 130.81,
        getClickGuardSeconds: () => .008, getFadeSecondsForDuration: () => .008, withModulationEvaluationTime: (t, f) => f(), getModulatedValue: () => 0,
        getGrainLayerGain: () => 1, getGranularKeyboardVolumeBiasGain: () => 1, isKeyboardSoundRole: () => true, keyboardGrainCaptureGain: null,
        whiteNoiseBuffer: null, pinkNoiseBuffer: null, document: { getElementById: () => ({ value: 'none' }) }, setTimeout: () => 0, stopGrainScheduler: () => {},
        getTransportScheduleHorizon: t => t + .35, countMissedAudioSteps: (next, step) => Math.max(0, Math.ceil((clock - next - .000001) / step)),
        hasAnyPerformanceLayerSoloSelection: () => false, getGranularLayerSettings: () => layers, getAvailableGranularSources: () => [{ buffer }],
        getGranularSourceGainMap: (items, gain) => new Map(items.map(item => [item, gain])),
        resolveGranularLayerSampleWindow: (source, layer) => ({ playbackRate: 1, playOffset: 0, sourceDuration: layer.sizeSeconds,
            grainDuration: layer.sizeSeconds, attackSeconds: layer.attackSeconds, releaseSeconds: layer.releaseSeconds }),
        startTransportSource(source, ...args) { starts.push({ t: args[0], d: args[2] }); source.start(...args); },
        scheduleTransportSourceStop(source, t) { stops.push({ source, t, done: false }); source.stop(t); }, console };
    return { state, starts, layers, run(evaluate, duration = 3) {
        evaluate(config.code, state);
        layers.forEach(layer => layer.intervalSeconds = state.getGranularLayerIntervalSeconds(layer.sizeSeconds, layer.blend, layer.smoothing));
        for (clock = 0; clock < duration; clock += .01) {
            for (const event of stops) if (!event.done && event.t <= clock) { event.done = true; event.source.onended?.(); }
            state.scheduleActiveGrains();
            maxPool = Math.max(maxPool, state.getConcurrentGrainSourceCount());
        }
        const gaps = []; let end = 0;
        for (const { t, d } of [...starts].sort((a, b) => a.t - b.t)) { if (t > end + .000001 && end > .1) gaps.push(t - end); end = Math.max(end, t + d); }
        return { sources: starts.length, maxPool, gaps: gaps.length, longestGapMs: Math.max(0, ...gaps) * 1000 };
    } };
}
module.exports = { sources, fixture, evaluate(code, state) { vm.createContext(state); vm.runInContext(code, state); } };
