(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MygrainDrumTone = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function cutoffHz(percent, maximum = 20000) {
        const value = Math.max(0, Math.min(100, Number(percent) || 0));
        return 20 * Math.pow(maximum / 20, value / 100);
    }

    function connect(context, input, destination, options = {}) {
        const finish = source => typeof options.connectOutput === 'function' ? options.connectOutput(source, destination) : source.connect(destination);
        const cutoff = Math.max(0, Math.min(100, Number(options.cutoff ?? 100)));
        const envelope = options.accent ? Math.max(0, Math.min(1, Number(options.envAmount) || 0)) : 0;
        if (cutoff >= 100 && envelope === 0) {
            finish(input);
            return [];
        }
        const maximum = Math.min(20000, context.sampleRate * .45);
        const base = cutoffHz(cutoff, maximum);
        const peak = base * Math.pow(maximum / base, envelope);
        const start = Math.max(0, Number(options.start) || 0);
        const attack = Math.min(.003, Math.max(.001, (options.duration || .1) * .05));
        const end = start + Math.max(attack + .006, Number(options.duration) || .1);
        const filters = [];
        let previous = input;
        const stages = globalThis.mygrainPower?.isLive(context) ? 1 : 4;
        for (let stage = 0; stage < stages; stage += 1) {
            const filter = context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.Q.value = 20 * Math.log10(1 / (2 * Math.cos((2 * stage + 1) * Math.PI / (4 * stages))));
            filter.frequency.setValueAtTime(base, start);
            if (peak > base) {
                filter.frequency.exponentialRampToValueAtTime(peak, start + attack);
                filter.frequency.exponentialRampToValueAtTime(base, end);
            }
            previous.connect(filter);
            previous = filter;
            filters.push(filter);
        }
        finish(previous);
        return filters;
    }

    const SAMPLE_LANES = Object.freeze(['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc']);
    const MAX_NORMALIZE_GAIN = Math.pow(10, 24 / 20);
    function sampleState(value, fresh = false) {
        if (value != null && (value.version !== 1 || !value.lanes || typeof value.lanes !== 'object' || Array.isArray(value.lanes))) throw new Error('Unsupported drum sample processing. Reload MYGRAIN.');
        if (value != null && ((value.snareDrive != null && !['smooth', 'legacy'].includes(value.snareDrive)) || (value.autoNormalize != null && typeof value.autoNormalize !== 'boolean'))) throw new Error('Invalid drum sample processing controls.');
        const lanes = Object.fromEntries(SAMPLE_LANES.map(kind => {
            const lane = value?.lanes?.[kind];
            if (lane != null && (typeof lane !== 'object' || Array.isArray(lane) || (lane.enabled != null && typeof lane.enabled !== 'boolean'))) throw new Error('Invalid drum sample lane.');
            const gain = lane?.gain ?? 1;
            if (typeof gain !== 'number' || !Number.isFinite(gain) || gain <= 0 || gain > MAX_NORMALIZE_GAIN) throw new Error('Invalid drum normalization gain.');
            const peak = lane?.peak ?? null;
            if (peak !== null && (typeof peak !== 'number' || !Number.isFinite(peak) || peak < 0)) throw new Error('Invalid drum sample peak.');
            return [kind, { enabled: lane?.enabled === true, gain, peak }];
        }));
        return { version: 1, autoNormalize: value?.autoNormalize !== false, snareDrive: value?.snareDrive === 'smooth' || (value == null && fresh) ? 'smooth' : 'legacy', lanes };
    }

    async function analyzeSample(buffer, yieldWork = () => new Promise(resolve => setTimeout(resolve, 0))) {
        let peak = 0, energy = 0, count = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let offset = 0; offset < data.length; offset += 131072) {
                const end = Math.min(data.length, offset + 131072);
                for (let i = offset; i < end; i++) {
                    const value = data[i];
                    if (!Number.isFinite(value)) throw new Error('Drum sample contains invalid audio.');
                    peak = Math.max(peak, Math.abs(value)); energy += value * value; count++;
                }
                if (end < data.length) await yieldWork();
            }
        }
        const rms = Math.sqrt(energy / Math.max(1, count));
        // Do not turn effectively silent recordings into loud noise.
        const quiet = peak < .001 || rms < .000316227766;
        return { enabled: !quiet, peak, gain: quiet ? 1 : Math.min(MAX_NORMALIZE_GAIN, Math.pow(10, -6 / 20) / peak) };
    }

    function sampleGain(state, kind) {
        const lane = state?.lanes?.[kind === 'roll' ? 'snare' : kind];
        return lane?.enabled === true ? lane.gain : 1;
    }

    const snareCurves = new Map();
    function snareCurve(amount) {
        const depth = Math.round(Math.max(0, Math.min(1, Number(amount) || 0)) * 1000) / 1000;
        if (snareCurves.has(depth)) return snareCurves.get(depth);
        const curve = new Float32Array(2049), drive = 1 + 8 * depth, scale = Math.tanh(drive);
        for (let i = 0; i < curve.length; i++) {
            const x = 2 * i / (curve.length - 1) - 1;
            curve[i] = (1 - depth) * x + depth * Math.tanh(x * drive) / scale;
        }
        if (snareCurves.size >= 128) snareCurves.delete(snareCurves.keys().next().value);
        snareCurves.set(depth, curve);
        return curve;
    }

    function sampleRenderState(state, assets = []) {
        const modes = state?.modes || {}, processing = sampleState(modes.drumMachineSampleProcessing);
        if (modes.drumMachineEnabled !== true || Number(state?.sliders?.performanceDrumMachineLevel ?? 65) <= 0) return null;
        const keys = new Set(assets.map(asset => asset.key));
        const gains = {};
        let snareActive = false;
        for (const kind of SAMPLE_LANES) {
            const name = kind[0].toUpperCase() + kind.slice(1), extra = modes.drumMachineExtraTracks?.[kind];
            const pattern = ['clap', 'cymbals', 'etc'].includes(kind) ? extra?.pattern : modes[`drumMachine${name}Pattern`];
            const roll = kind === 'snare' && modes.drumMachineRoll?.pattern?.some(Boolean);
            const level = extra ? extra.level ?? 1 : Number(state?.sliders?.[`drumMachine${name}Level`] ?? 100) / 100;
            if (!keys.has('drum' + name) || !(pattern?.some(Boolean) || roll) || level <= 0) continue;
            if (kind === 'snare') snareActive = true;
            const gain = sampleGain(processing, kind);
            if (gain !== 1) gains[kind] = gain;
        }
        const smooth = snareActive && processing.snareDrive === 'smooth' && Number(state?.sliders?.drumMachineSnareDistortion ?? 0) > 0;
        return Object.keys(gains).length || smooth ? { version: 1, gains, ...(smooth ? { snareDrive: 'smooth' } : {}) } : null;
    }

    return { cutoffHz, connect, SAMPLE_LANES, MAX_NORMALIZE_GAIN, sampleState, analyzeSample, sampleGain, snareCurve, sampleRenderState };
});
