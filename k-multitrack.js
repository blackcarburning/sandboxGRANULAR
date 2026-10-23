(function (root) {
    'use strict';
    const COUNT = 5;
    const rawKey = index => index === 0 ? 'bastardK' : `bastardKTrack${index + 1}`;
    const dbKey = index => index === 0 ? 'bastardLoopBufferK' : `bastardLoopKTrack${index + 1}Buffer`;
    const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
    function steps(value) {
        if (value == null) return null;
        if (!Number.isSafeInteger(value) || value < 1) throw new Error('K track length must be a positive whole number of steps.');
        return value;
    }
    const numeric = (value, fallback, low, high) => Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.max(low, Math.min(high, Number(value))) : fallback;
    const filterModes = ['bypass', 'lowpass-12', 'lowpass-24', 'lowpass-48', 'lowpass-96', 'highpass-12', 'highpass-24', 'highpass-48', 'highpass-96', 'bandpass-12', 'notch-12'];
    const divisions = ['8', '4', '2', '1', '0.5', '0.25', '0.75', '0.375', '0.333333'];
    function processing(value = {}) {
        return { semitone: numeric(value.semitone, 0, -24, 24), fine: numeric(value.fine, 0, -100, 100),
            preserveDuration: value.preserveDuration !== false, reverse: value.reverse === true,
            filterMode: filterModes.includes(value.filterMode) ? value.filterMode : 'lowpass-48',
            cutoff: numeric(value.cutoff, 18000, 50, 18000), resonance: numeric(value.resonance, .707, .1, 8),
            envelope: numeric(value.envelope, 0, 0, 1), envelopeDecay: value.envelopeDecay === null ? null : numeric(value.envelopeDecay, .4, .06, 4),
            lfoWave: ['sine', 'triangle', 'sawtooth', 'ramp', 'square'].includes(value.lfoWave) ? value.lfoWave : 'sine',
            lfoDivision: divisions.includes(String(value.lfoDivision)) ? String(value.lfoDivision) : '4',
            lfoAmount: numeric(value.lfoAmount, 0, 0, 1), lfoInvert: value.lfoInvert === true,
            drive: numeric(value.drive, 0, 0, 12), delayMix: numeric(value.delayMix, 0, 0, .6),
            delayDivision: divisions.includes(String(value.delayDivision)) ? String(value.delayDivision) : '0.5',
            delayFeedback: numeric(value.delayFeedback, .25, 0, .7), delayCutoff: numeric(value.delayCutoff, 6000, 200, 18000),
            reverbMix: numeric(value.reverbMix, 0, 0, .6), reverbDecay: numeric(value.reverbDecay, 1.2, .2, 4) };
    }
    function legacyProcessing(state = {}) {
        const modes = state.modes || state, sliders = state.sliders || {}, selects = state.selects || {};
        const n = (key, fallback) => numeric(sliders[`performanceBastardLoopK${key}`], fallback, -Infinity, Infinity);
        return processing({ semitone: n('Semitone', modes.bastardLoopKPitchSemitones || 0), fine: n('FineTune', modes.bastardLoopKFineCents || 0),
            preserveDuration: modes.bastardLoopKPreserveDuration !== false, reverse: modes.bastardLoopKReverse === true,
            filterMode: selects.performanceBastardLoopKFilterMode || modes.bastardLoopKFilterMode,
            envelopeDecay: null, cutoff: n('FilterCutoff', modes.bastardLoopKFilterCutoff ?? 18000), envelope: n('FilterEnvelope', 0) / 100,
            // Preserve the former cycle-relative envelope; the host resolves this legacy marker at playback.
            lfoWave: selects.performanceBastardLoopKFilterLfoWaveform === 'ramp' ? 'square' : selects.performanceBastardLoopKFilterLfoWaveform, lfoDivision: selects.performanceBastardLoopKFilterLfoRate,
            lfoAmount: n('FilterLfoAmount', 0) / 100, lfoInvert: modes.bastardLoopKFilterLfoInvert === true });
    }
    function normalize(value, legacy = {}, metadata = null) {
        if (value != null && (![1, 2].includes(value.version) || !Array.isArray(value.tracks) || value.tracks.length !== COUNT)) throw new Error('Unsupported K multitrack recorder settings.');
        let legacySteps = legacy.bastardLoopKRecordingSteps;
        if (Number.isSafeInteger(metadata?.recordingSteps) && metadata.recordingSteps > 0) legacySteps = metadata.recordingSteps;
        else if (Number.isFinite(metadata?.durationSeconds) && metadata.durationSeconds > 0) {
            const inferred = metadata.durationSeconds * (Number(legacy.bastardLoopKSourceBpm) || 120) / 60 * 4;
            legacySteps = Math.round(inferred) > 0 && Math.abs(inferred - Math.round(inferred)) < .001 ? Math.round(inferred) : null;
        }
        const inherited = Object.keys(legacy).length ? legacyProcessing(legacy) : processing();
        return { version: 2, selected: Number.isInteger(value?.selected) ? Math.max(0, Math.min(4, value.selected)) : 0,
            tracks: Array.from({ length: COUNT }, (_, index) => {
                const track = value?.tracks[index] || {};
                return { enabled: track.enabled !== false, level: numeric(track.level, 1, 0, 1), mute: track.mute === true, pan: numeric(track.pan, 0, -1, 1),
                    steps: steps(track.steps ?? (index === 0 && !value ? legacySteps : null)),
                    sourceBpm: numeric(track.sourceBpm, index === 0 ? Number(legacy.bastardLoopKSourceBpm) || 120 : 120, 40, 300),
                    processing: processing(value?.version === 2 ? track.processing : inherited),
                    metadata: copy(track.metadata || (index === 0 ? metadata : null)) };
            }) };
    }
    function convertSnapshot(original) {
        const modes = original.state?.modes || {}, current = modes.kMultitrack;
        if (current?.version === 2) { normalize(current); return { snapshot: original, changed: false }; }
        if (current != null) normalize(current);
        // Metadata only: preserve every source WAV and all non-K settings.
        const snapshot = copy(original);
        const legacy = { ...modes, sliders: snapshot.state.sliders, selects: snapshot.state.selects };
        if (!Object.hasOwn(legacy, 'bastardLoopKRecordingSteps')) {
            const loops = Number(snapshot.state.sliders?.performanceBastardLoopKRecordLength);
            legacy.bastardLoopKRecordingSteps = Number.isInteger(loops) && loops > 1 && loops <= 8 ? loops * Number(snapshot.state.patternLength) : null;
        }
        const asset = snapshot.assets?.find(asset => asset.key === 'bastardK');
        const metadata = snapshot.extra?.metadata?.bastardK || (asset ? { durationSeconds: asset.frames / asset.sampleRate } : null);
        snapshot.state.modes.kMultitrack = normalize(current, legacy, metadata);
        if (!current) for (let index = 1; index < COUNT; index++) {
            const key = rawKey(index);
            if (snapshot.assets?.some(asset => asset.key === key) || snapshot.extra?.audioSlots?.[key]) throw new Error('Unversioned K multitrack audio cannot be converted safely.');
            if (snapshot.extra?.audioSlots) snapshot.extra.audioSlots[key] = false;
        }
        return { snapshot, changed: true };
    }
    function create(host) {
        let config = normalize(), voices = new Map(), running = false;
        const tracks = config.tracks.map(track => ({ ...track, raw: null, rendered: null, padded: null, paddedSource: null, paddedFrames: 0 }));
        const api = {
            tracks, get selected() { return config.selected; }, get voices() { return voices; },
            settings() { return normalize({ version: 2, selected: config.selected, tracks }); },
            restore(value, legacy, metadata) {
                config = normalize(value, legacy, metadata);
                config.tracks.forEach((track, index) => { Object.assign(tracks[index], track); tracks[index].padded = tracks[index].paddedSource = null; });
            },
            select(index) {
                if (!Number.isInteger(index) || index < 0 || index >= COUNT) throw new Error('Choose K track 1–5.');
                config.selected = index;
            },
            hasAudio() { return tracks.some(track => track.raw || track.rendered); },
            setBuffer(index, buffer, rendered = false) {
                tracks[index][rendered ? 'rendered' : 'raw'] = buffer || null;
                if (!rendered) tracks[index].rendered = null;
                tracks[index].padded = tracks[index].paddedSource = null;
            },
            period(track) {
                return track.steps === null ? (track.metadata?.durationSeconds || track.rendered?.duration || track.raw?.duration || .01)
                    : track.steps * 60 / track.sourceBpm / 4;
            },
            bufferFor(track) {
                const buffer = host.prepare ? host.prepare(track, tracks.indexOf(track)) : (track.rendered || track.raw), context = host.context();
                if (!buffer) return null;
                const frames = Math.max(1, Math.round(api.period(track) * buffer.sampleRate));
                if (frames <= buffer.length) return buffer;
                if (track.padded && track.paddedSource === buffer && track.paddedFrames === frames) return track.padded;
                const bytes = frames * buffer.numberOfChannels * 4;
                const retained = tracks.reduce((total, track) => total + (track.raw?.length || 0) * (track.raw?.numberOfChannels || 0) * 4
                    + (track.rendered !== track.raw ? (track.rendered?.length || 0) * (track.rendered?.numberOfChannels || 0) * 4 : 0)
                    + (track.padded?.length || 0) * (track.padded?.numberOfChannels || 0) * 4, 0);
                if (!Number.isSafeInteger(frames) || bytes + retained > host.memoryBudget()) throw new Error('This K loop length needs too much audio memory. Use a shorter track length.');
                const padded = context.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
                for (let channel = 0; channel < buffer.numberOfChannels; channel++) padded.copyToChannel(buffer.getChannelData(channel), channel);
                track.padded = padded; track.paddedSource = buffer; track.paddedFrames = frames;
                return padded;
            },
            rate(track) { return host.bpm() / track.sourceBpm * host.pitchRate(track); },
            audible(track) { return track.enabled !== false && !track.mute && track.level > 0 && host.masterGain() > 0 && Boolean(track.raw || track.rendered); },
            stopVoice(index, options = {}) {
                const voice = voices.get(index); if (!voice) return;
                voices.delete(index);
                const context = host.context(), boundary = host.boundary?.();
                const end = Number.isFinite(boundary) ? Math.max(context?.currentTime || 0, boundary)
                    : (context?.currentTime || 0) + (options.fade === false ? 0 : .012);
                try { voice.gain.gain.cancelScheduledValues(end); voice.gain.gain.setValueAtTime(voice.gain.gain.value, end); voice.gain.gain.linearRampToValueAtTime(0, end + .005); voice.source.stop(end + .006); }
                catch { voice.dispose(); }
            },
            stop(options = {}) {
                running = false;
                for (const index of [...voices.keys()]) api.stopVoice(index, options);
                host.published?.(voices);
            },
            spawn(index, buffer, timing) {
                const context = host.context(), track = tracks[index];
                const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
                let graph, disposed = false;
                const voice = { source, gain, pan, output: pan, filters: [], index, dispose() {
                    if (disposed) return; disposed = true;
                    source.onended = null;
                    try { source.disconnect(); gain.disconnect(); pan.disconnect(); } catch {}
                    if (graph?.dispose) graph.dispose(); else host.disconnectFilters?.(voice.filters);
                    try { source.buffer = null; } catch {} source.patternSectionBuffer = null;
                    if (voices.get(index) === voice) { voices.delete(index); host.published?.(voices); }
                } };
                try {
                    graph = host.route(gain, pan, track, index);
                    voice.filters = Array.isArray(graph) ? graph : graph?.filters || []; voice.graph = graph;
                    const period = Math.min(buffer.duration, api.period(track)), rate = api.rate(track);
                    const time = Math.max(timing.time, Number.isFinite(timing.origin) ? timing.origin : timing.time);
                    const offset = Number.isFinite(timing.origin) ? (Math.max(0, time - timing.origin) * rate) % period : 0;
                    source.patternSectionBuffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = period; source.playbackRate.value = rate;
                    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(host.masterGain() * track.level, time + .012);
                    pan.pan.value = track.pan; source.connect(gain); source.onended = voice.dispose; voices.set(index, voice);
                    host.envelope?.(voice.filters, time, period / rate, track); graph?.start?.(time, period / rate);
                    host.startSource(source, time, offset);
                    return voice;
                } catch (error) { voices.delete(index); try { source.stop(); } catch {} voice.dispose(); throw error; }
            },
            start(startTime = null) {
                if (!host.context()) return false;
                // Preflight only audible tracks before replacing the playing graph.
                const buffers = tracks.map(track => api.audible(track) ? api.bufferFor(track) : null);
                const timing = host.timing(startTime); api.stop({ fade: false }); running = true;
                try {
                    tracks.forEach((track, index) => { if (buffers[index]) api.spawn(index, buffers[index], timing); });
                    host.published?.(voices); return voices.size > 0;
                } catch (error) { api.stop({ fade: false }); throw error; }
            },
            restart(index) {
                if (!running || !host.context()) return;
                const track = tracks[index], buffer = api.audible(track) ? api.bufferFor(track) : null;
                api.stopVoice(index);
                if (buffer) api.spawn(index, buffer, host.timing(null));
                host.published?.(voices);
            },
            mix() {
                const context = host.context(); if (!context || !running) return;
                for (const [index, track] of tracks.entries()) {
                    let voice = voices.get(index);
                    if (!api.audible(track)) {
                        api.stopVoice(index);
                        track.padded = track.paddedSource = null;
                        host.idle?.(track, index);
                        continue;
                    }
                    if (!voice) { const buffer = api.bufferFor(track); if (buffer) voice = api.spawn(index, buffer, host.timing(null)); }
                    if (!voice) continue;
                    voice.gain.gain.setTargetAtTime(host.masterGain() * track.level, context.currentTime, .01);
                    voice.pan.pan.setTargetAtTime(track.pan, context.currentTime, .01);
                }
                host.published?.(voices);
            },
            tempo() {
                const context = host.context(); if (!context) return;
                for (const [index, voice] of [...voices]) {
                    voice.source.playbackRate.setTargetAtTime(api.rate(tracks[index]), context.currentTime, .01);
                    if (voice.graph?.tempo?.(host.bpm()) === false) api.restart(index);
                }
            },
            release() { api.stop({ fade: false }); for (const track of tracks) { track.raw = track.rendered = track.padded = track.paddedSource = null; } }
        };
        return api;
    }
    const exports = { processing, legacyProcessing, filterModes, divisions, COUNT, rawKey, dbKey, normalize, convertSnapshot, create };
    if (typeof module === 'object' && module.exports) module.exports = exports;
    else root.MygrainKMultitrack = Object.freeze(exports);
})(typeof window === 'undefined' ? globalThis : window);
