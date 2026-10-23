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
    function normalize(value, legacy = {}, metadata = null) {
        if (value != null && (value.version !== 1 || !Array.isArray(value.tracks) || value.tracks.length !== COUNT)) throw new Error('Unsupported K multitrack recorder settings.');
        const number = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
        let legacySteps = legacy.bastardLoopKRecordingSteps;
        // Old recording length selected the NEXT take, not the existing take's
        // playback period. Conversion must never crop that audio to a new setting.
        if (Number.isSafeInteger(metadata?.recordingSteps) && metadata.recordingSteps > 0) legacySteps = metadata.recordingSteps;
        else if (Number.isFinite(metadata?.durationSeconds) && metadata.durationSeconds > 0) {
            const inferred = metadata.durationSeconds * (Number(legacy.bastardLoopKSourceBpm) || 120) / 60 * 4;
            legacySteps = Math.round(inferred) > 0 && Math.abs(inferred - Math.round(inferred)) < .001 ? Math.round(inferred) : null;
        }
        return { version: 1, selected: Number.isInteger(value?.selected) ? Math.max(0, Math.min(4, value.selected)) : 0,
            tracks: Array.from({ length: COUNT }, (_, index) => {
                const track = value?.tracks[index] || {};
                return { level: number(track.level, 1, 0, 1), mute: track.mute === true, pan: number(track.pan, 0, -1, 1),
                    steps: steps(track.steps ?? (index === 0 && !value ? legacySteps : null)),
                    sourceBpm: number(track.sourceBpm, index === 0 ? Number(legacy.bastardLoopKSourceBpm) || 120 : 120, 40, 300),
                    metadata: copy(track.metadata || (index === 0 ? metadata : null)) };
            }) };
    }
    function convertSnapshot(original) {
        const modes = original.state?.modes || {};
        if (modes.kMultitrack != null) { normalize(modes.kMultitrack); return { snapshot: original, changed: false }; }
        // Only metadata changes: preserve every source WAV and all non-K settings.
        const snapshot = copy(original);
        const legacy = { ...modes };
        if (!Object.hasOwn(legacy, 'bastardLoopKRecordingSteps')) {
            const loops = Number(snapshot.state.sliders?.performanceBastardLoopKRecordLength);
            legacy.bastardLoopKRecordingSteps = Number.isInteger(loops) && loops > 1 && loops <= 8 ? loops * Number(snapshot.state.patternLength) : null;
        }
        const asset = snapshot.assets?.find(asset => asset.key === 'bastardK');
        const metadata = snapshot.extra?.metadata?.bastardK || (asset ? { durationSeconds: asset.frames / asset.sampleRate } : null);
        snapshot.state.modes.kMultitrack = normalize(null, legacy, metadata);
        for (let index = 1; index < COUNT; index++) {
            const key = rawKey(index);
            if (snapshot.assets?.some(asset => asset.key === key) || snapshot.extra?.audioSlots?.[key]) throw new Error('Unversioned K multitrack audio cannot be converted safely.');
            if (snapshot.extra?.audioSlots) snapshot.extra.audioSlots[key] = false;
        }
        return { snapshot, changed: true };
    }
    function create(host) {
        let config = normalize(), voices = new Map();
        const tracks = config.tracks.map(track => ({ ...track, raw: null, rendered: null, padded: null, paddedSource: null, paddedFrames: 0 }));
        const api = {
            tracks, get selected() { return config.selected; }, get voices() { return voices; },
            settings() { return normalize({ version: 1, selected: config.selected, tracks }); },
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
                const buffer = track.rendered || track.raw, context = host.context();
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
            rate(track) { return host.bpm() / track.sourceBpm * host.pitchRate(); },
            stop(options = {}) {
                const context = host.context(), boundary = host.boundary?.();
                for (const voice of voices.values()) {
                    const end = Number.isFinite(boundary) ? Math.max(context?.currentTime || 0, boundary)
                        : (context?.currentTime || 0) + (options.fade === false ? 0 : .012);
                    try { voice.gain.gain.cancelScheduledValues(end); voice.gain.gain.setValueAtTime(voice.gain.gain.value, end); voice.gain.gain.linearRampToValueAtTime(0, end + .005); voice.source.stop(end + .006); }
                    catch { voice.dispose(); }
                }
                voices = new Map(); host.published?.(voices); host.filters?.([]);
            },
            start(startTime = null) {
                const context = host.context();
                if (!context) return false;
                if (!api.hasAudio() || host.masterGain() <= 0) { api.stop({ fade: false }); return false; }
                // Allocate/validate every period before replacing the playing graph.
                const buffers = tracks.map(track => api.bufferFor(track));
                const timing = host.timing(startTime); api.stop({ fade: false });
                try {
                    tracks.forEach((track, index) => {
                        const buffer = buffers[index]; if (!buffer) return;
                        const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
                        const filters = host.route(gain, pan);
                        const period = Math.min(buffer.duration, api.period(track)), rate = api.rate(track);
                        const time = Math.max(timing.time, Number.isFinite(timing.origin) ? timing.origin : timing.time);
                        const offset = Number.isFinite(timing.origin) ? (Math.max(0, time - timing.origin) * rate) % period : 0;
                        source.patternSectionBuffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = period; source.playbackRate.value = rate;
                        gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(host.masterGain() * track.level * (track.mute ? 0 : 1), time + .012);
                        pan.pan.value = track.pan; source.connect(gain);
                        let disposed = false;
                        const voice = { source, gain, pan, filters, index, dispose() {
                            if (disposed) return; disposed = true;
                            source.onended = null; source.disconnect(); gain.disconnect(); pan.disconnect(); host.disconnectFilters(filters);
                            try { source.buffer = null; } catch {} source.patternSectionBuffer = null;
                            if (voices.get(index) === voice) { voices.delete(index); host.published?.(voices); }
                        } };
                        source.onended = voice.dispose; voices.set(index, voice);
                        host.envelope?.(filters, time, period / rate); host.startSource(source, time, offset);
                    });
                    host.filters?.([...voices.values()].flatMap(voice => voice.filters)); host.published?.(voices);
                    return voices.size > 0;
                } catch (error) { api.stop({ fade: false }); throw error; }
            },
            mix() {
                const context = host.context(); if (!context) return;
                for (const [index, voice] of voices) {
                    const track = tracks[index];
                    voice.gain.gain.setTargetAtTime(host.masterGain() * track.level * (track.mute ? 0 : 1), context.currentTime, .01);
                    voice.pan.pan.setTargetAtTime(track.pan, context.currentTime, .01);
                }
                host.filters?.([...voices.values()].flatMap(voice => voice.filters));
            },
            tempo() {
                const context = host.context(); if (!context) return;
                for (const [index, voice] of voices) voice.source.playbackRate.setTargetAtTime(api.rate(tracks[index]), context.currentTime, .01);
            },
            release() { api.stop({ fade: false }); for (const track of tracks) { track.raw = track.rendered = track.padded = track.paddedSource = null; } }
        };
        return api;
    }
    const exports = { COUNT, rawKey, dbKey, normalize, convertSnapshot, create };
    if (typeof module === 'object' && module.exports) module.exports = exports;
    else root.MygrainKMultitrack = Object.freeze(exports);
})(typeof window === 'undefined' ? globalThis : window);
