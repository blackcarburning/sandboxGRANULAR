(function () {
    'use strict';

    let keyboardRecordingMonitorEnabled = false;
    let songOutputIsolation = null;
    // Only tag unresampled, canonical PCM16 Song sources. Weak membership adds
    // no retained ZIP/PCM copy and follows the normal AudioBuffer lifetime.
    const songPcm16Sources = new WeakSet();

    function markSongPcm16Source(bytes, buffer) {
        if (bytes.byteLength !== 44 + buffer.length * buffer.numberOfChannels * 2) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint32(12, false) === 0x666d7420 && view.getUint32(16, true) === 16
            && view.getUint16(20, true) === 1 && view.getUint16(34, true) === 16
            && view.getUint32(24, true) === buffer.sampleRate && view.getUint16(22, true) === buffer.numberOfChannels
            && view.getUint32(36, false) === 0x64617461 && view.getUint32(40, true) === buffer.length * buffer.numberOfChannels * 2) {
            songPcm16Sources.add(buffer);
        }
    }

    function encodeSongSource(buffer) {
        const body = audioBufferToWav(buffer);
        if (!songPcm16Sources.has(buffer)) return body;
        // decodeAudioData maps signed PCM16 to sample / 32768. The general
        // exporter uses 32767 for positive samples and truncates, losing one
        // LSB on every recall/save. Invert the decoder for these sources so an
        // unchanged amendment retains its exact WAV bytes and cached render.
        const view = new DataView(body);
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
        let offset = 44;
        for (let frame = 0; frame < buffer.length; frame += 1) {
            for (const channel of channels) {
                const sample = Math.max(-1, Math.min(1, channel[frame]));
                view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(sample * 32768))), true);
                offset += 2;
            }
        }
        return body;
    }

    function setKeyboardRecordingMonitor(enabled) {
        keyboardRecordingMonitorEnabled = Boolean(enabled);
        if (!songOutputIsolation) return;
        const { context, output, originalGain } = songOutputIsolation;
        output.gain.cancelScheduledValues(context.currentTime);
        output.gain.setValueAtTime(keyboardRecordingMonitorEnabled ? originalGain : 0, context.currentTime);
    }

    function isolateSongOutput() {
        const isolation = { context: audioContext, output: finalAmplifierNode, originalGain: finalAmplifierNode.gain.value };
        songOutputIsolation = isolation;
        setKeyboardRecordingMonitor(keyboardRecordingMonitorEnabled);
        let restored = false;
        return () => {
            if (restored) return;
            restored = true;
            if (songOutputIsolation === isolation) songOutputIsolation = null;
            isolation.output.gain.cancelScheduledValues(isolation.context.currentTime);
            isolation.output.gain.setValueAtTime(isolation.originalGain, isolation.context.currentTime);
        };
    }

    const audioBindings = [
        ['generated', () => generatedLoopBuffer, buffer => { generatedLoopBuffer = buffer; }, GENERATED_AUDIO_BUFFER_KEY],
        ['generatedBase', () => generatedLoopBaseBuffer, buffer => { generatedLoopBaseBuffer = buffer; }],
        ['mic', () => micAudioBuffer, buffer => { micAudioBuffer = buffer; }, MIC_AUDIO_BUFFER_KEY],
        ['grainMainSample', () => grainMainSampleBuffer, buffer => { grainMainSampleBuffer = buffer; }, GRAIN_MAIN_SAMPLE_AUDIO_BUFFER_KEY],
        ['grainASample', () => grainASampleBuffer, buffer => { grainASampleBuffer = buffer; }, GRAIN_A_SAMPLE_AUDIO_BUFFER_KEY],
        ['grainBSample', () => grainBSampleBuffer, buffer => { grainBSampleBuffer = buffer; }, GRAIN_B_SAMPLE_AUDIO_BUFFER_KEY],
        ['grainAMic', () => grainSynthAMicBuffer, buffer => { grainSynthAMicBuffer = buffer; }, GRAIN_A_MIC_AUDIO_BUFFER_KEY],
        ['grainBMic', () => grainSynthBMicBuffer, buffer => { grainSynthBMicBuffer = buffer; }, GRAIN_B_MIC_AUDIO_BUFFER_KEY],
        ['bastardA', () => bastardLoopBuffer, buffer => { bastardLoopBuffer = buffer; }, BASTARD_LOOP_AUDIO_BUFFER_KEY],
        ['bastardB', () => bastardLoop2Buffer, buffer => { bastardLoop2Buffer = buffer; }, BASTARD_LOOP_2_AUDIO_BUFFER_KEY],
        ['bastardC', () => bastardLoop3Buffer, buffer => { bastardLoop3Buffer = buffer; }, BASTARD_LOOP_3_AUDIO_BUFFER_KEY],
        ['bastardV', () => bastardLoopVBuffer, buffer => { bastardLoopVBuffer = buffer; }, BASTARD_LOOP_V_AUDIO_BUFFER_KEY],
        ['bastardP', () => bastardLoopPBuffer, buffer => { bastardLoopPBuffer = buffer; }, BASTARD_LOOP_P_AUDIO_BUFFER_KEY],
        ['bastardO', () => bastardLoopOBuffer, buffer => { bastardLoopOBuffer = buffer; }, BASTARD_LOOP_O_AUDIO_BUFFER_KEY],
        ['bastardL', () => bastardLoopLSampleBuffer, buffer => { bastardLoopLSampleBuffer = buffer; }, BASTARD_LOOP_L_AUDIO_BUFFER_KEY],
        ['bastardX', () => bastardLoopXSampleBuffer, buffer => { bastardLoopXSampleBuffer = buffer; }, BASTARD_LOOP_X_AUDIO_BUFFER_KEY],
        ['bastardQ', () => window.mygrainQ?.getAudioBuffer() || null, buffer => { window.mygrainQ?.setAudioBuffer(buffer); }],
        ['bastardM', () => bastardLoopMRawBuffer, buffer => { bastardLoopMRawBuffer = buffer; }, BASTARD_LOOP_M_AUDIO_BUFFER_KEY],
        ['bastardMRender', () => bastardLoopMBuffer, buffer => { bastardLoopMBuffer = buffer; }],
        ['bastardMPlus', () => bastardLoopMPlusRawBuffer, buffer => { bastardLoopMPlusRawBuffer = buffer; }, BASTARD_LOOP_M_PLUS_AUDIO_BUFFER_KEY],
        ['bastardMPlusRender', () => bastardLoopMPlusBuffer, buffer => { bastardLoopMPlusBuffer = buffer; }],
        ['bastardK', () => bastardLoopKRawBuffer, buffer => { bastardLoopKRawBuffer = buffer; }, BASTARD_LOOP_K_AUDIO_BUFFER_KEY],
        ['bastardKRender', () => bastardLoopKBuffer, buffer => { bastardLoopKBuffer = buffer; }],
        ['dropboxSample', () => dropboxSampleLayerRawBuffer, buffer => { dropboxSampleLayerRawBuffer = buffer; }, DROPBOX_SAMPLE_LAYER_AUDIO_BUFFER_KEY],
        ['dropboxRender', () => dropboxSampleLayerBuffer, buffer => { dropboxSampleLayerBuffer = buffer; }],
        ['drumKick', () => drumMachineKickBuffer, buffer => { drumMachineKickBuffer = buffer; }, DRUM_MACHINE_KICK_AUDIO_BUFFER_KEY],
        ['drumSnare', () => drumMachineSnareBuffer, buffer => { drumMachineSnareBuffer = buffer; }, DRUM_MACHINE_SNARE_AUDIO_BUFFER_KEY],
        ['drumHat', () => drumMachineHatBuffer, buffer => { drumMachineHatBuffer = buffer; }, DRUM_MACHINE_HAT_AUDIO_BUFFER_KEY],
        ['drumPerc', () => drumMachinePercBuffer, buffer => { drumMachinePercBuffer = buffer; }, DRUM_MACHINE_PERC_AUDIO_BUFFER_KEY],
        ...Object.values(drumMachineExtraTracks).map(track => [track.kind === 'etc' ? 'drumEtc' : track.kind === 'clap' ? 'drumClap' : 'drumCymbals', () => track.buffer, buffer => { track.buffer = buffer; }, `${track.id}Buffer`]),
        // Append only: persisted Undo/Redo journals address these slots by index.
        ['keyboardSample', () => keyboardSampleBuffer, buffer => setKeyboardSampleBuffer(buffer), KEYBOARD_SAMPLE_AUDIO_BUFFER_KEY]
    ];
    const metadataBindings = [
        ['bastardA', () => bastardLoopMetadata, metadata => { bastardLoopMetadata = metadata; }],
        ['bastardB', () => bastardLoop2Metadata, metadata => { bastardLoop2Metadata = metadata; }],
        ['bastardC', () => bastardLoop3Metadata, metadata => { bastardLoop3Metadata = metadata; }],
        ['bastardV', () => bastardLoopVMetadata, metadata => { bastardLoopVMetadata = metadata; }],
        ['bastardP', () => bastardLoopPMetadata, metadata => { bastardLoopPMetadata = metadata; }],
        ['bastardO', () => bastardLoopOMetadata, metadata => { bastardLoopOMetadata = metadata; }],
        ['bastardL', () => bastardLoopLSampleMetadata, metadata => { bastardLoopLSampleMetadata = metadata; }],
        ['bastardX', () => bastardLoopXSampleMetadata, metadata => { bastardLoopXSampleMetadata = metadata; }],
        ['bastardM', () => bastardLoopMMetadata, metadata => { bastardLoopMMetadata = metadata; }],
        ['bastardMPlus', () => bastardLoopMPlusMetadata, metadata => { bastardLoopMPlusMetadata = metadata; }],
        ['bastardK', () => bastardLoopKMetadata, metadata => { bastardLoopKMetadata = metadata; }],
        ['dropboxSample', () => dropboxSampleLayerMetadata, metadata => { dropboxSampleLayerMetadata = metadata; }],
        ['mic', () => micSampleMetadata, metadata => { micSampleMetadata = metadata; }],
        ['keyboardSample', () => keyboardSampleMetadata, metadata => { keyboardSampleMetadata = metadata; }],
        ['grainMainSample', () => grainMainSampleMetadata, metadata => { grainMainSampleMetadata = metadata; }],
        ['grainASample', () => grainASampleMetadata, metadata => { grainASampleMetadata = metadata; }],
        ['grainBSample', () => grainBSampleMetadata, metadata => { grainBSampleMetadata = metadata; }],
        ['drumKick', () => drumMachineKickMetadata, metadata => { drumMachineKickMetadata = metadata; }],
        ['drumSnare', () => drumMachineSnareMetadata, metadata => { drumMachineSnareMetadata = metadata; }],
        ['drumHat', () => drumMachineHatMetadata, metadata => { drumMachineHatMetadata = metadata; }],
        ['drumPerc', () => drumMachinePercMetadata, metadata => { drumMachinePercMetadata = metadata; }],
        ...Object.values(drumMachineExtraTracks).map(track => [track.kind === 'etc' ? 'drumEtc' : track.kind === 'clap' ? 'drumClap' : 'drumCymbals', () => track.metadata, metadata => { track.metadata = metadata; }])
    ];
    let persistence = Promise.resolve();

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    const additiveSongLanes = [
        { name: 'Keyboard Sample', slots: ['keyboardSample'], settings: /^(?:keyboardSample|performanceKeyboardSample)/, references: /^keyboardsample$/i, keyboardSource: 'sample' },
        { name: 'ETC', slots: ['drumEtc'], settings: /^(?:etc|drumEtc|drumMachineEtc.*)$/i, references: /^etc$/i },
        { name: 'K', slots: ['bastardK', 'bastardKRender'], settings: /bastard(?:Loop)?K/i, references: /^(?:k|bastard(?:loop)?k)$/i },
        { name: 'M+', slots: ['bastardMPlus', 'bastardMPlusRender'], settings: /bastard(?:Loop)?MPlus/i, references: /^(?:m\+|mplus|bastard(?:loop)?mplus)$/i },
        { name: 'Q', slots: ['bastardQ'], settings: /^(?:q$|q[A-Z]|performanceQ|bastard(?:Loop)?Q)/, references: /^(?:q|bastard(?:loop)?q)$/i, emptyState: { q: null }, piano: true }
    ];

    function hasSongLaneEvidence(value, lane, reference = false) {
        if (!value || typeof value !== 'object') return reference && typeof value === 'string' && value.split(',').some(entry => lane.references.test(entry.trim()));
        return Object.entries(value).some(([key, entry]) => lane.settings.test(key)
            || (lane.keyboardSource && key === 'keyboardSoundSource' && typeof entry === 'string' && entry.toLowerCase() === lane.keyboardSource)
            || (key === 'id' && typeof entry === 'string' && lane.settings.test(entry))
            || hasSongLaneEvidence(entry, lane, reference || ['keyboardSoundSource', 'loopLayerSolo', 'performanceSourceLayerSolo', 'performanceSourceLayerSoloSnapshot'].includes(key)));
    }

    function normalizeSongAudioInventory(original) {
        const inventory = original.extra.audioSlots;
        if (original.extra.freezeStateVersion !== 1 || !inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return { snapshot: original, lanes: [] };
        const absent = [];
        for (const lane of additiveSongLanes) {
            const missing = lane.slots.filter(key => !Object.hasOwn(inventory, key));
            if (!missing.length) continue;
            const extra = Object.fromEntries(Object.entries(original.extra).filter(([key]) => key !== 'audioSlots'));
            const state = { ...original.state };
            for (const [key, empty] of Object.entries(lane.emptyState || {})) if (Object.hasOwn(state, key) && state[key] === empty) delete state[key];
            if (missing.length !== lane.slots.length || lane.slots.some(key => original.assets.some(asset => asset.key === key))
                || hasSongLaneEvidence(state, lane) || hasSongLaneEvidence(extra, lane)) {
                throw new Error(`Saved part audio inventory is incomplete for ${missing[0]}. No phone sample will be substituted.`);
            }
            absent.push(lane);
        }
        if (!absent.length) return { snapshot: original, lanes: [] };
        const snapshot = cloneJson(original);
        const defaults = prepareSongState({ modes: {}, patternLength: snapshot.state.patternLength });
        for (const lane of absent) {
            for (const key of lane.slots) snapshot.extra.audioSlots[key] = false;
            if (lane.piano) {
                if (!window.MygrainQTheory?.defaults) throw new Error('This part needs Q piano support. Reload MYGRAIN.');
                snapshot.state.q = { ...cloneJson(window.MygrainQTheory.defaults()), enabled: false };
            } else {
                for (const group of ['modes', 'sliders', 'selects']) {
                    const additions = Object.fromEntries(Object.entries(defaults[group]).filter(([key]) => lane.settings.test(key)));
                    snapshot.state[group] = { ...snapshot.state[group], ...additions };
                }
                snapshot.extra.metadata = { ...snapshot.extra.metadata, [lane.slots[0]]: null };
            }
        }
        return { snapshot, lanes: absent.map(lane => lane.name) };
    }

    function validateSongArchiveEntries(arrayBuffer, entries) {
        const bytes = new Uint8Array(arrayBuffer);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const seen = new Set();
        let offset = 0;
        while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
            const size = view.getUint32(offset + 18, true);
            const nameLength = view.getUint16(offset + 26, true);
            const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
            const end = start + size;
            const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
            if (end > bytes.length || seen.has(name) || (view.getUint16(offset + 6, true) & 9)
                || crc32(bytes.subarray(start, end)) !== view.getUint32(offset + 14, true)) throw new Error('Saved part archive is corrupt or has duplicate entries. No phone sample will be substituted.');
            seen.add(name);
            offset = end;
        }
        if (seen.size !== entries.size) throw new Error('Invalid saved song archive entries.');
    }

    function validateSongAudioEntries(snapshot, entries) {
        const paths = new Set(['song-part.json', ...snapshot.assets.map(asset => asset.path)]);
        if (entries.size !== paths.size || [...entries.keys()].some(path => !paths.has(path))) throw new Error('Invalid saved song audio manifest: unlisted or missing assets.');
        for (const asset of snapshot.assets) {
            const bytes = entries.get(asset.path);
            const invalid = () => new Error(`Saved part has missing, corrupt or mismatched audio for ${asset.key}. No phone sample will be substituted.`);
            if (!bytes || bytes.byteLength < 44) throw invalid();
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const text = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
            if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength) throw invalid();
            let format;
            let length;
            let offset = 12;
            while (offset + 8 <= bytes.byteLength) {
                const size = view.getUint32(offset + 4, true);
                if (offset + 8 + size > bytes.byteLength) throw invalid();
                if (text(offset) === 'fmt ') {
                    if (format || size < 16) throw invalid();
                    format = { encoding: view.getUint16(offset + 8, true), channels: view.getUint16(offset + 10, true),
                        sampleRate: view.getUint32(offset + 12, true), byteRate: view.getUint32(offset + 16, true),
                        blockAlign: view.getUint16(offset + 20, true), bits: view.getUint16(offset + 22, true) };
                } else if (text(offset) === 'data') {
                    if (length !== undefined) throw invalid();
                    length = size;
                }
                offset += 8 + size + (size % 2);
            }
            if (!format || format.encoding !== 1 || ![8, 16, 24, 32].includes(format.bits)
                || format.channels !== asset.channels || format.sampleRate !== asset.sampleRate
                || format.blockAlign !== format.channels * format.bits / 8 || format.byteRate !== format.sampleRate * format.blockAlign
                || length !== asset.frames * format.blockAlign) throw invalid();
        }
    }

    function validateSongAudioInventory(snapshot) {
        const allowed = new Set(audioBindings.map(([key]) => key));
        const assets = new Set();
        for (const asset of snapshot.assets) {
            if (!allowed.has(asset.key) || assets.has(asset.key) || asset.path !== `audio/${asset.key}.wav`) throw new Error('Invalid saved song audio manifest.');
            if (!Number.isSafeInteger(asset.frames) || asset.frames < 1 || ![1, 2].includes(asset.channels) || !Number.isFinite(asset.sampleRate) || asset.sampleRate < 3000 || asset.sampleRate > 384000) throw new Error(`Invalid saved audio dimensions for ${asset.key}.`);
            assets.add(asset.key);
        }
        if (snapshot.extra.freezeStateVersion !== undefined && snapshot.extra.freezeStateVersion !== 1) throw new Error('This song needs a newer MYGRAIN snapshot reader.');
        if (snapshot.extra.freezeStateVersion === 1) {
            const inventory = snapshot.extra.audioSlots;
            if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) throw new Error('Saved song audio inventory is missing.');
            for (const key of new Set([...allowed, ...Object.keys(inventory)])) {
                if (!allowed.has(key) || typeof inventory[key] !== 'boolean' || inventory[key] !== assets.has(key)) throw new Error(`Saved part audio inventory is incomplete for ${key}. No phone sample will be substituted.`);
            }
        }
        if (snapshot.state?.q) {
            if (snapshot.state.q.version !== 1 || !window.MygrainQTheory) throw new Error('This part needs Q piano support. Reload MYGRAIN.');
            window.MygrainQTheory.validateBank(snapshot.state.q, snapshot.assets.find(asset => asset.key === 'bastardQ'));
        } else if (assets.has('bastardQ')) throw new Error('Saved Q piano audio has no settings.');
    }

    function songPatternCycleMultiplier(state) {
        // Keep the grid intact. Slower enabled sequencers need more than one
        // base-grid duration to reach their last step (x2, x4, x8 / Q rate).
        const modes = state.modes || {};
        const steps = Number(state.patternLength);
        let multiplier = 1;
        for (const lane of ['L', 'X']) {
            const prefix = `bastardLoop${lane}`;
            const active = modes[`${prefix}Enabled`] === true
                && modes[`${prefix}Sequence`]?.slice(0, steps).some(step => step?.note && !step.rest);
            if (active) multiplier = Math.max(multiplier, [0.125, 0.25, 0.5, 1, 2, 4, 8][modes[`${prefix}TimingIndex`] ?? 3] || 1);
        }
        if (state.q?.enabled === true && state.q.sequence?.slice(0, steps).some(step => step?.notes?.length && !step.rest)) {
            const rate = Number(state.q.rate ?? 1);
            if ([.25, .5, 1, 2, 4].includes(rate)) multiplier = Math.max(multiplier, 1 / rate);
        }
        const roll = modes.drumMachineRoll;
        if (modes.drumMachineEnabled === true && roll?.pattern?.some(Boolean)) {
            const gcd = (a, b) => b ? gcd(b, a % b) : a;
            multiplier = (steps * multiplier / gcd(steps * multiplier, roll.length) * roll.length) / steps;
        }
        return multiplier;
    }

    function validateSongRollCycle(snapshot) {
        const roll = snapshot.state.modes.drumMachineRoll;
        window.MygrainDrumRoll.validate(roll);
        const cycle = snapshot.extra.patternCycleMultiplier ?? 1;
        const active = snapshot.state.modes.drumMachineEnabled === true && roll?.pattern?.some(Boolean);
        const valid = [1, 2, 4, 8].map(base => active ? window.MygrainDrumRoll.cycleSteps(Number(snapshot.state.patternLength) * base, roll.length) / Number(snapshot.state.patternLength) : base);
        if (!Number.isInteger(cycle) || !valid.includes(cycle)) throw new Error('Invalid saved pattern cycle length.');
    }

    function prepareSongState(state) {
        const prepared = cloneJson(state);
        prepared.modes = {
            drumMachineRoll: window.MygrainDrumRoll.normalize(),
            keyboardSoundSource: 'grain',
            keyboardSampleSourceKey: 'samples_piano', keyboardSampleMetadata: null,
            bastardLoopMPlusEnabled: false, bastardLoopMPlusLevel: .5,
            bastardLoopMPlusPan: 0,
            bastardLoopMPlusInputGain: 1, bastardLoopMPlusSourceBpm: 120,
            bastardLoopMPlusPitchSemitones: 0, bastardLoopMPlusFineCents: 0,
            bastardLoopMPlusPreserveDuration: true, bastardLoopMPlusReverse: false,
            bastardLoopMPlusFilterCutoff: 18000, bastardLoopMPlusFilterMode: 'lowpass-48',
            bastardLoopMPlusDelayDivision: '2', bastardLoopMPlusDelayFilterCutoff: 18000,
            bastardLoopMPlusDelayMix: 0, bastardLoopMPlusChorusMix: 0,
            bastardLoopMPlusRoomReverbMix: 0, bastardLoopMPlusCompressorAmount: 0,
            bastardLoopMPlusCompressorThreshold: 0, bastardLoopMPlusCompressorRatio: 1,
            bastardLoopMPlusCompressorRelease: 260, bastardLoopMPlusSummary: '',
            bastardLoopMPlusDurationSeconds: 0,
            bastardLoopKEnabled: false, bastardLoopKLevel: .5,
            bastardLoopKInputGain: 1, bastardLoopKSourceBpm: 120,
            bastardLoopKPitchSemitones: 0, bastardLoopKFineCents: 0,
            bastardLoopKPreserveDuration: true, bastardLoopKReverse: false,
            bastardLoopKFilterCutoff: 18000, bastardLoopKFilterMode: 'lowpass-48',
            bastardLoopKFilterEnvelopeAmount: 0, bastardLoopKFilterLfoWaveform: 'sine',
            bastardLoopKFilterLfoRate: '1', bastardLoopKFilterLfoAmount: 0,
            bastardLoopKFilterLfoInvert: false, bastardLoopKSummary: '',
            bastardLoopKDurationSeconds: 0, ...prepared.modes
        };
        const modes = prepared.modes;
        prepared.sliders = {
            performanceKeyboardSampleVolume: '100',
            performanceBastardLoopLReverbMix: '0',
            performanceBastardLoopLReverbSize: '45',
            performanceBastardLoopLReverbDecay: '55',
            performanceBastardLoopLReverbTone: '6400',
            performanceBastardLoopMPlusRecordLength: '1',
            performanceBastardLoopMPlusLevel: String(modes.bastardLoopMPlusLevel * 100),
            performanceBastardLoopMPlusLevelMixer: String(modes.bastardLoopMPlusLevel * 100),
            performanceBastardLoopMPlusPan: String(modes.bastardLoopMPlusPan * 100),
            performanceBastardLoopMPlusInputGain: String(modes.bastardLoopMPlusInputGain * 100),
            performanceBastardLoopMPlusSemitone: String(modes.bastardLoopMPlusPitchSemitones),
            performanceBastardLoopMPlusFineTune: String(modes.bastardLoopMPlusFineCents),
            performanceBastardLoopMPlusFilterCutoff: String(modes.bastardLoopMPlusFilterCutoff),
            performanceBastardLoopMPlusDelayFilterCutoff: String(modes.bastardLoopMPlusDelayFilterCutoff),
            performanceBastardLoopMPlusDelayMix: String(modes.bastardLoopMPlusDelayMix * 100),
            performanceBastardLoopMPlusChorusMix: String(modes.bastardLoopMPlusChorusMix * 100),
            performanceBastardLoopMPlusRoomReverbMix: String(modes.bastardLoopMPlusRoomReverbMix * 100),
            performanceBastardLoopMPlusCompressorAmount: String(modes.bastardLoopMPlusCompressorAmount * 100),
            performanceBastardLoopMPlusCompressorThreshold: String(modes.bastardLoopMPlusCompressorThreshold),
            performanceBastardLoopMPlusCompressorRatio: String(modes.bastardLoopMPlusCompressorRatio),
            performanceBastardLoopMPlusCompressorRelease: String(modes.bastardLoopMPlusCompressorRelease),
            performanceBastardLoopKRecordLength: '1',
            performanceBastardLoopKLevel: String(modes.bastardLoopKLevel * 100),
            performanceBastardLoopKLevelMixer: String(modes.bastardLoopKLevel * 100),
            performanceBastardLoopKInputGain: String(modes.bastardLoopKInputGain * 100),
            performanceBastardLoopKSemitone: String(modes.bastardLoopKPitchSemitones),
            performanceBastardLoopKFineTune: String(modes.bastardLoopKFineCents),
            performanceBastardLoopKFilterCutoff: String(modes.bastardLoopKFilterCutoff),
            performanceBastardLoopKFilterEnvelope: String(modes.bastardLoopKFilterEnvelopeAmount * 100),
            performanceBastardLoopKFilterLfoAmount: String(modes.bastardLoopKFilterLfoAmount * 100),
            ...prepared.sliders
        };
        prepared.selects = {
            performanceBastardLoopMPlusFilterMode: modes.bastardLoopMPlusFilterMode,
            performanceBastardLoopMPlusDelayDivision: modes.bastardLoopMPlusDelayDivision,
            performanceBastardLoopKFilterMode: modes.bastardLoopKFilterMode,
            performanceBastardLoopKFilterLfoWaveform: modes.bastardLoopKFilterLfoWaveform,
            performanceBastardLoopKFilterLfoRate: modes.bastardLoopKFilterLfoRate,
            ...prepared.selects
        };
        for (const id of Object.keys(prepared.sliders || {})) {
            const step = id.match(/^seqStep(\d+)(Pitch|Vol)$/);
            if (step && Number(step[1]) > Number(prepared.patternLength)) delete prepared.sliders[id];
        }
        delete prepared.selects?.songBetaSongs;
        delete prepared.selects?.songBetaArmConcurrency;
        return prepared;
    }

    function batchSongUiRestore() {
        const originals = new Map();
        for (const name of [
            'syncPerformanceControlState', 'syncPerformanceSoundControls',
            'syncBastardLoopUi', 'syncBastardLoop2Ui', 'syncBastardLoop3Ui',
            'syncBastardLoopVUi', 'syncBastardLoopPUi', 'syncBastardLoopOUi',
            'syncBastardLoopLUi', 'syncBastardLoopXUi', 'syncBastardLoopMUi', 'syncBastardLoopMPlusUi',
            'syncBastardLoopKUi',
            'syncDropboxSampleLayerUi', 'syncDrumMachineUi', 'drawWaveforms', 'updateEffects'
        ]) {
            if (typeof window[name] !== 'function') continue;
            originals.set(name, window[name]);
            window[name] = () => {};
        }
        return {
            applyEffects: () => originals.get('updateEffects')?.(),
            restore() {
                for (const [name, original] of originals) window[name] = original;
            }
        };
    }

    function stopSongAudio(options = {}) {
        if (options.hardCut) {
            stopGeneratedDryLoop({ fade: false });
            stopAllBastardLoopLayers({ fade: false, preserveTransportState: false, skipUi: true });
            stopDrumMachineVoices({ fade: false });
        }
        const selectedNotes = heldNotes;
        heldNotes = new Set();
        try {
            stopAllPerformancePlayback({ silent: true });
        } finally {
            heldNotes = selectedNotes;
        }
        stopHeldKeyboardPlaybackPreserveSelection({ immediate: true });
        stopAllGrains({ immediate: true });
        stopAllOscillators({ immediate: true });
    }

    function refreshSongAudioUi() {
        syncLegacyAudioBuffer();
        drawWaveforms();
        updateSourceAvailability();
        syncBastardLoopUi();
        syncBastardLoop2Ui();
        syncBastardLoop3Ui();
        syncBastardLoopVUi();
        syncBastardLoopPUi();
        syncBastardLoopOUi();
        syncBastardLoopLUi();
        syncBastardLoopXUi();
        syncBastardLoopMUi();
        syncBastardLoopMPlusUi();
        syncBastardLoopKUi();
        syncDropboxSampleLayerUi();
        syncDrumMachineUi();
        syncPerformanceSourceLayerSoloButtons();
        syncPerformanceControlState();
    }

    const adapter = {
        async ready() {
            const deadline = Date.now() + 15000;
            // A renderer's Start click is asynchronous. Do not rebuild the
            // same graph concurrently while that startup is still in flight.
            while (engineStarting) {
                if (Date.now() > deadline) throw new Error('Wait for MYGRAIN to finish starting its audio engine, then try again.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            await ensurePatchZipAudioReady();
            while (engineStarting || stateSaveSuspended) {
                if (Date.now() > deadline) throw new Error('Wait for MYGRAIN to finish restoring its current state, then try again.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        },

        assertNotRecording() {
            if (
                bastardLoopMRecordingState !== 'idle' ||
                bastardLoopMPlusRecordingState !== 'idle' ||
                bastardLoopKRecordingState !== 'idle' ||
                isRecording
            ) throw new Error('Finish recording before saving or replacing a part.');
        },

        async capture({ liveOnly = false } = {}) {
            if (!isAudioGraphReady() || engineStarting || stateSaveSuspended) throw new Error('Start MYGRAIN and let its current sounds finish loading before saving a part.');
            adapter.assertNotRecording();
            flushPendingSliderUpdates();
            await window.mygrainQ?.prepareCapture();
            const state = saveState({ force: true, snapshotOnly: true });
            if (!state) throw new Error('Could not capture current settings.');
            const snapshot = {
                format: 'mygrain-song-part',
                version: 1,
                createdAt: new Date().toISOString(),
                state: prepareSongState(state),
                extra: {
                    freezeStateVersion: 1,
                    patternCycleMultiplier: songPatternCycleMultiplier(state),
                    audioSlots: Object.fromEntries(audioBindings.map(([key, getBuffer]) => [key, Boolean(getBuffer())])),
                    sequencerSteps: cloneJson(sequencerSteps),
                    seqGrainsEnabled,
                    heldNotes: getArpeggiatorNotes().filter(note => noteNames.includes(note)),
                    performanceSourceLayerSolo: cloneJson(performanceSourceLayerSolo),
                    performanceSourceLayerSoloSnapshot: cloneJson(performanceSourceLayerSoloSnapshot),
                    controls: Array.from(document.querySelectorAll('input[type="checkbox"], input[type="number"], input[type="radio"]'))
                        .filter(input => input.id && !input.closest('#songBetaCard, #aiPatchCard, #bastardLoopVCutOverlay, #qArpOverlay, #qChordEditorOverlay, #drumMachineLane-roll'))
                        .map(input => ({ id: input.id, type: input.type, value: input.value, checked: input.checked })),
                    metadata: Object.fromEntries(metadataBindings.map(([key, getMetadata]) => [key, cloneJson(getMetadata())]))
                },
                assets: []
            };
            if (liveOnly) return { snapshot, buffers: new Map(audioBindings.map(([key, getBuffer]) => [key, getBuffer()])) };
            const entries = [];
            for (const [key, getBuffer] of audioBindings) {
                const buffer = getBuffer();
                if (!buffer) continue;
                const path = `audio/${key}.wav`;
                entries.push({ path, data: encodeSongSource(buffer) });
                snapshot.assets.push({ key, path, channels: buffer.numberOfChannels, frames: buffer.length, sampleRate: buffer.sampleRate });
            }
            entries.unshift({ path: 'song-part.json', data: JSON.stringify(snapshot) });
            return createStoredZip(entries);
        },

        inspectPart(arrayBuffer) {
            const entries = parseStoredZipEntries(arrayBuffer);
            validateSongArchiveEntries(arrayBuffer, entries);
            const original = JSON.parse(getZipText(entries, 'song-part.json') || 'null');
            const info = adapter.inspectSnapshot(original);
            validateSongAudioEntries(info.snapshot, entries);
            if (info.upgrade) info.upgrade.entries = entries;
            return info;
        },

        // Metadata-only inspection is for the authenticated, hash-bound server
        // manifest endpoint. Rendering/recall still validate the full archive.
        inspectSnapshot(original) {
            if (!original || original.format !== 'mygrain-song-part' || original.version !== 1 || !original.state?.modes || !original.extra || !Array.isArray(original.assets)) {
                throw new Error('This is not a supported complete song-part snapshot.');
            }
            const { snapshot, lanes } = normalizeSongAudioInventory(original);
            validateSongRollCycle(snapshot);
            if (!Array.isArray(snapshot.extra.sequencerSteps) || snapshot.extra.sequencerSteps.length !== Number(snapshot.state.patternLength)) throw new Error('Part sequencer pattern is incomplete.');
            validateSongAudioInventory(snapshot);
            const decodedBytes = snapshot.assets.reduce((bytes, asset) => bytes + Number(asset.frames) * Number(asset.channels) * 4 * Math.max(1, audioContext.sampleRate / Number(asset.sampleRate)), 0);
            if (!Number.isFinite(decodedBytes) || decodedBytes < 0) throw new Error('Invalid saved song audio dimensions.');
            return { snapshot, decodedBytes, upgrade: lanes.length ? { lanes } : null };
        },

        upgradePart(info) {
            if (!info.upgrade) throw new Error('This saved part does not need a compatibility upgrade.');
            return createStoredZip([...info.upgrade.entries].map(([path, data]) => ({ path, data: path === 'song-part.json' ? JSON.stringify(info.snapshot) : data })));
        },

        async decode(arrayBuffer, cache) {
            const { snapshot } = adapter.inspectPart(arrayBuffer);
            const entries = parseStoredZipEntries(arrayBuffer);
            const allowed = new Set(audioBindings.map(([key]) => key));
            const buffers = new Map();
            for (const asset of snapshot.assets) {
                if (!allowed.has(asset.key) || buffers.has(asset.key) || asset.path !== `audio/${asset.key}.wav`) throw new Error('Invalid saved song audio manifest.');
                const bytes = entries.get(asset.path);
                if (!bytes) throw new Error(`Saved part is missing ${asset.key}.`);
                const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
                let decoded = cache.buffers.get(digest);
                if (!decoded) {
                    cache.pending ||= new Map();
                    if (!cache.pending.has(digest)) {
                        const pending = (async () => {
                            const estimatedBytes = Number(asset.frames) * Number(asset.channels) * 4 * Math.max(1, audioContext.sampleRate / Number(asset.sampleRate));
                            if (!Number.isFinite(estimatedBytes) || estimatedBytes <= 0 || cache.bytes + (cache.reservedBytes || 0) + estimatedBytes > (cache.limitBytes ?? Infinity)) throw new Error('Invalid or oversized song source audio.');
                            cache.reservedBytes = (cache.reservedBytes || 0) + estimatedBytes;
                            try {
                                const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
                                const size = buffer.length * buffer.numberOfChannels * 4;
                                if (cache.bytes + cache.reservedBytes - estimatedBytes + size > (cache.limitBytes ?? Infinity)) throw new Error('Invalid or oversized song source audio.');
                                markSongPcm16Source(bytes, buffer);
                                cache.buffers.set(digest, buffer);
                                cache.bytes += size;
                                return buffer;
                            } finally {
                                cache.reservedBytes -= estimatedBytes;
                            }
                        })();
                        cache.pending.set(digest, pending);
                    }
                    try {
                        decoded = await cache.pending.get(digest);
                    } finally {
                        cache.pending.delete(digest);
                    }
                }
                const expectedFrames = Math.round(asset.frames * decoded.sampleRate / asset.sampleRate);
                if (decoded.numberOfChannels !== asset.channels || Math.abs(decoded.length - expectedFrames) > 1) throw new Error(`Saved audio does not match its manifest for ${asset.key}.`);
                buffers.set(asset.key, decoded);
            }
            return { snapshot, buffers };
        },

        prepare(part) {
            return {
                snapshot: cloneJson(part.snapshot),
                buffers: new Map(audioBindings.map(([key]) => {
                    const original = part.buffers.get(key);
                    const buffer = original ? cloneAudioBufferForCurrentContext(original) : null;
                    if (buffer && songPcm16Sources.has(original)) songPcm16Sources.add(buffer);
                    return [key, buffer];
                }))
            };
        },

        recall(part, options = {}) {
            if (!isAudioGraphReady() || audioContext.state !== 'running') throw new Error('Audio engine is not ready. Arm again.');
            const prepared = options.prepared || adapter.prepare(part);
            const previousSaveSuspended = stateSaveSuspended;
            const batchedRestore = batchSongUiRestore();
            let startTime;
            try {
                stopSongAudio(options);
                heldNotes.clear();
                stateSaveSuspended = true;
                sourceMutationSerial += 1;
                const snapshot = prepared.snapshot;
                performanceSourceLayerSolo = [];
                performanceSourceLayerSoloSnapshot = null;
                for (const [key, , setBuffer] of audioBindings) {
                    setBuffer(prepared.buffers.get(key) || null);
                }
                syncLegacyAudioBuffer();
                for (const [key, , setMetadata] of metadataBindings) setMetadata(snapshot.extra.metadata?.[key] || null);
                syncPatternLengthControls(snapshot.state.patternLength, { skipSave: true });
                for (const control of snapshot.extra.controls || []) {
                    const input = document.getElementById(control.id);
                    if (!input || input.closest('#songBetaCard, #aiPatchCard, #bastardLoopVCutOverlay, #qArpOverlay, #qChordEditorOverlay, #drumMachineLane-roll') || input.type !== control.type) continue;
                    if (input.type === 'checkbox' || input.type === 'radio') input.checked = Boolean(control.checked);
                    else input.value = control.value;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                try {
                    if (!restoreState({ state: prepareSongState(snapshot.state), songSnapshot: true, throwOnError: true })) throw new Error('Saved part settings are missing or unreadable');
                } catch (error) {
                    throw new Error(`The part settings could not be restored (${error.message}). Playback was not started.`, { cause: error });
                }
                sequencerSteps = cloneJson(snapshot.extra.sequencerSteps);
                normalizeSequencerSteps();
                sequencerSteps.forEach((step, index) => updateSequencerStepUI(index + 1));
                seqGrainsEnabled = snapshot.extra.seqGrainsEnabled !== false;
                document.getElementById('seqGrainsEnabled').checked = seqGrainsEnabled;
                heldNotes = new Set((snapshot.extra.heldNotes || []).filter(note => noteNames.includes(note)));
                document.querySelectorAll('.key[data-note]').forEach(key => key.classList.toggle('active', heldNotes.has(key.dataset.note)));
                performanceSourceLayerSolo = snapshot.extra.performanceSourceLayerSolo || [];
                performanceSourceLayerSoloSnapshot = snapshot.extra.performanceSourceLayerSoloSnapshot || null;
                flushPendingSliderUpdates();
                for (const [key, , setMetadata] of metadataBindings) setMetadata(snapshot.extra.metadata?.[key] || null);
                for (const [key, , setBuffer] of audioBindings) {
                    setBuffer(prepared.buffers.get(key) || null);
                }
                if (bastardLoopMRawBuffer && !bastardLoopMBuffer) rerenderBastardLoopMFromRaw({ skipUi: true });
                if (bastardLoopMPlusRawBuffer && !bastardLoopMPlusBuffer) rerenderBastardLoopMPlusFromRaw({ skipUi: true });
                if (bastardLoopKRawBuffer && !bastardLoopKBuffer) rerenderBastardLoopKFromRaw({ skipUi: true });
                if (dropboxSampleLayerRawBuffer && !dropboxSampleLayerBuffer) rerenderDropboxSampleLayerFromRaw({ skipUi: true });
                syncLegacyAudioBuffer();
                batchedRestore.applyEffects();
                if (options.start !== false) {
                    startTime = Number.isFinite(options.boundaryTime)
                        ? Math.max(audioContext.currentTime, options.boundaryTime)
                        : getBufferedTransportStartTime();
                    adapter.startAt(startTime);
                }
            } catch (error) {
                stopSongAudio();
                throw error;
            } finally {
                stateSaveSuspended = previousSaveSuspended;
                batchedRestore.restore();
            }
            refreshSongAudioUi();
            saveState();
            const persisted = audioBindings.filter(binding => binding[3]).map(([, getBuffer, , key]) => [key, getBuffer()]);
            persistence = persistence.catch(() => {}).then(async () => {
                for (const [key, buffer] of persisted) {
                    if (buffer) await saveAudioBufferToDB(buffer, key);
                    else await clearAudioBufferFromDB(key);
                }
            }).catch(error => {
                console.warn('Song part remains saved on the server; browser audio persistence failed:', error);
            });
            return startTime;
        },

        whenPersisted: () => persistence,
        stop: stopSongAudio,
        context: () => audioContext,
        output: () => finalAmplifierNode,
        startAt(startTime) {
            // A saved part explicitly authorizes its held keyboard / Arp notes,
            // including in a fresh render deck with no prior key interaction.
            restartAllTransport({ startTime, silent: true, keyboardPlay: true });
            if (!sequencerPlaying && !isArpeggiatorPlaying()) startSequencer(startTime);
            if (!arpEnabled) startHeldKeyboardPlayback(startTime);
        },
        renderPart: (part, timing, signal) => MygrainSongClock.render(audioContext, part, timing, signal),
        encodeRender: buffer => audioBufferToWav(buffer),
        decodeRender: bytes => audioContext.decodeAudioData(bytes),
        downloadLibraryAccess: access => downloadBlob(new Blob([JSON.stringify(access, null, 2)], { type: 'application/json' }), 'MYGRAIN-Song-Access.json'),
        async chooseSongExportFilename(song) {
            const name = prompt('Enter filename for song WAV export (the song/tempo postfix is added automatically):', song.name);
            if (!name?.trim()) return null;
            await adapter.ready();
            MygrainSongExport.layout(song.parts, null, audioContext.sampleRate);
            return MygrainSongExport.filename(name, song.parts);
        },
        async exportSong(parts, renders, filename, signal) {
            const result = await MygrainSongExport.wav(parts, renders, audioContext.sampleRate, signal);
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            const uploaded = await uploadWavToRepository(result.blob, filename, { signal });
            return { ...uploaded, peak: result.peak };
        },
        scheduleSong(parts, renders, onEnded, destination = audioContext.destination) {
            const context = audioContext;
            const restore = isolateSongOutput();
            try {
                const playback = MygrainSongClock.schedule(context, parts, renders, reason => { restore(); onEnded(reason); }, destination);
                const stop = playback.stop;
                playback.stop = () => { stop(); restore(); };
                return playback;
            } catch (error) {
                restore();
                throw error;
            }
        },
        async scheduleStoredSong(parts, load, onEnded, signal, destination = audioContext.destination, options = {}) {
            const context = audioContext;
            const restore = isolateSongOutput();
            try {
                const playback = await MygrainSongClock.scheduleStored(context, parts, load, reason => { restore(); onEnded(reason); }, signal, destination, options);
                const stop = playback.stop;
                playback.stop = () => { stop(); restore(); };
                return playback;
            } catch (error) { restore(); throw error; }
        },
        clockRunning: playback => audioContext?.state === 'running' && playback?.context === audioContext,
        setKeyboardRecordingMonitor,
        refreshPlaybackUi: () => syncPerformanceControlState(),
        time: () => audioContext?.currentTime || 0,
        running: () => Boolean(audioContext?.state === 'running' && (sequencerPlaying || isArpeggiatorPlaying() || bastardLoopPlaying || isBastardLoopVCutPreviewRunning() || isBastardLoopLRunning() || isBastardLoopXRunning() || drumMachinePlaying))
    };

    // Card history is deliberately separate from Song and AI take history.
    // Keep ten deltas; persist distinct PCM once and hydrate old sounds lazily.
    function installCardHistory() {
        const undo = [], redo = [], historyLimit = 10;
        const historyIdentity = () => JSON.stringify([window.mygrainAccounts?.user?.username, window.mygrainSongBeta?.lease.device.id]);
        let busy = false, restoring = false, generation = 0, initializing = true;
        let storageWarning = '', saving = Promise.resolve(), durable = true, warningShown = false;
        const store = new MygrainSongStorage.HistoryStore(historyIdentity(), window.mygrainSongBeta.lease.device.id);
        function showStorageWarning() {
            if (!warningShown && storageWarning) { warningShown = true; setStatus(storageWarning, 'error'); showSettlePopup(storageWarning); }
        }
        const warnStorage = error => {
            if (store.closed) return;
            durable = false;
            storageWarning = store.readOnly ? error.message : 'Undo/Redo works this session, but history could not be saved on this device. Browser storage may be full or unavailable.';
            showStorageWarning();
        };
        const ready = store.open().then(saved => {
            if (store.closed) return;
            if ([...saved.undo, ...saved.redo].some(entry => entry.buffers.some(change => change.index >= audioBindings.length))) throw new Error('Saved history has an unknown audio slot.');
            undo.push(...saved.undo); redo.push(...saved.redo);
        }).catch(error => { store.close(); durable = false; storageWarning = 'Saved history could not be opened. Undo/Redo will work for this session only.'; })
            .finally(() => { initializing = false; update(); });
        function persist() {
            if (!durable || store.closed) { if (!generation) showStorageWarning(); return saving; }
            const past = undo.slice(), future = redo.slice(), epoch = generation;
            saving = saving.then(async () => {
                if (epoch !== generation || !durable || store.closed) return;
                await store.save(past, future);
            }).catch(warnStorage);
            return saving;
        }
        const copy = value => value === undefined ? undefined : cloneJson(value);
        const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const status = message => setStatus(message);
        function capture() {
            flushPendingSliderUpdates();
            const state = copy(saveState({ force: true, snapshotOnly: true }));
            delete state.timestamp;
            const piano = window.mygrainQ?.piano;
            return { json: { state, sequencerSteps: copy(sequencerSteps), seqGrainsEnabled,
                heldNotes: [...heldNotes], performanceSourceLayerSolo: copy(performanceSourceLayerSolo),
                performanceSourceLayerSoloSnapshot: copy(performanceSourceLayerSoloSnapshot),
                metadata: Object.fromEntries(metadataBindings.map(([key, get]) => [key, copy(get())])),
                aiDirection: copy(window.mygrainAiPatch?.historyState?.()) },
                buffers: audioBindings.map(([, get]) => get()),
                piano: piano ? { atlas: piano.atlas, bank: piano.bank, manifest: piano.manifest, pinned: piano.pinned, cache: new Map(piano.cache) } : null };
        }
        function changes(a, b, path = [], result = []) {
            if (equal(a, b)) return result;
            if (a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') {
                for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) changes(a[key], b[key], [...path, key], result);
            } else result.push({ path, before: copy(a), after: copy(b) });
            return result;
        }
        function pianoEqual(a, b) {
            if (!a || !b) return a === b;
            return ['atlas', 'bank', 'manifest', 'pinned'].every(key => a[key] === b[key]) && a.cache.size === b.cache.size
                && [...a.cache].every(([key, value]) => b.cache.get(key) === value);
        }
        function delta(before, after, label) {
            const buffers = before.buffers.flatMap((value, index) => value === after.buffers[index] ? [] : [{ index, before: value, after: after.buffers[index] }]);
            const changedSounds = new Set(buffers.map(change => audioBindings[change.index][0]));
            const json = changes(before.json, after.json).filter(change => change.path[0] !== 'metadata');
            // A sound's provenance is atomic, including absence of startup-only flags.
            for (const [key] of metadataBindings) if (changedSounds.has(key) || !equal(before.json.metadata[key], after.json.metadata[key])) {
                json.push({ path: ['metadata', key], before: copy(before.json.metadata[key]), after: copy(after.json.metadata[key]) });
            }
            return { label, owner: historyIdentity(), json, buffers,
                piano: pianoEqual(before.piano, after.piano) ? null : { before: before.piano, after: after.piano } };
        }
        function update() {
            for (const [id, entries, verb] of [['sectionJumpUndoBtn', undo, 'Undo'], ['sectionJumpRedoBtn', redo, 'Redo']]) {
                const button = document.getElementById(id);
                if (!button) continue;
                button.disabled = initializing || busy || !entries.length;
                button.textContent = `${verb} ${entries.length}`;
                button.setAttribute('aria-label', entries.length ? `${verb}: ${entries.at(-1).label} (${entries.length} available)` : `${verb}: no changes`);
                button.title = button.getAttribute('aria-label');
            }
            window.dispatchEvent(new Event('mygrain-history-update'));
        }
        function assertReady(completedKRecording = false, aiPatch = false, draftEdit = false) {
            if (initializing) throw new Error('Restoring this device’s Undo/Redo history. Try again in a moment.');
            if (!window.mygrainAccounts?.authenticated || !isAudioGraphReady() || engineStarting || stateSaveSuspended) throw new Error('Start MYGRAIN and let its sounds finish loading first.');
            const kReady = bastardLoopKRecordingState === 'idle' || (completedKRecording && bastardLoopKRecordingState === 'processing');
            if (isRecording || isOutputRecording || isOutputRecordingArmed || bastardLoopMRecordingState !== 'idle' || bastardLoopMPlusRecordingState !== 'idle' || !kReady
                || window.mygrainSongBeta?.busy || window.mygrainSongBeta?.playing || (window.mygrainSongBeta?.editing && !completedKRecording && !draftEdit) || (window.mygrainAiPatch?.busy && !aiPatch) || megaRandomizeInFlight) throw new Error('Finish recording, randomisation or Song operations first.');
            if (draftEdit && window.mygrainSongBeta?.editing && !window.mygrainSongBeta.canEditSong()) throw new Error(window.mygrainSongBeta.lease.message || 'Song editing access is no longer verified. Reconnect before changing this amendment.');
            if (drumMachineLoadInFlight || bastardLoopGenerationInFlight || bastardLoop2GenerationInFlight || bastardLoop3GenerationInFlight || bastardLoopVGenerationInFlight || bastardLoopPGenerationInFlight || bastardLoopOGenerationInFlight || dropboxSampleLayerLoadInFlight) throw new Error('Wait for the current sound load to finish.');
        }
        function run(label, action, completedKRecording = false, aiPatch = false, draftEdit = false) {
            if (restoring || window.__mygrainSongRenderDeck) return action();
            // Internal calls within a larger generation are part of that same step.
            // Trusted UI input is blocked by the capture listener while it settles.
            if (busy) return action();
            assertReady(completedKRecording, aiPatch, draftEdit);
            const before = capture(), epoch = generation;
            busy = true; update();
            function finish(commit = true) {
                try {
                    if (!commit || epoch !== generation) return;
                    const entry = delta(before, capture(), label);
                    if (entry.json.length || entry.buffers.length || entry.piano) {
                        undo.push(entry); if (undo.length > historyLimit) undo.shift(); redo.length = 0;
                        persist();
                    }
                } finally { busy = false; update(); }
            }
            try {
                const result = action();
                if (result?.then) return Promise.resolve(result).then(value => { finish(); return value; }, error => { finish(!aiPatch); throw error; });
                finish(); return result;
            } catch (error) { if (busy) finish(!aiPatch); throw error; }
        }
        function recordAI(mode, action) {
            // AI already validated its response before entering this boundary.
            // Do not merge it into an unrelated operation, and only journal a
            // successful apply: execute rolls failed/cancelled recipes back.
            if (busy) throw new Error('Wait for the current sound change to finish.');
            if (window.mygrainAiPatch?.busy && window.mygrainAiPatch.diagnostics().phase !== 'applying') throw new Error('Wait for the current AI operation to finish.');
            const label = { generate: 'AI generated patch', regenerate: 'AI regenerated patch', refine: 'AI refined patch', section: 'AI song section' }[mode];
            if (!label) throw new Error('Unknown AI patch operation.');
            return run(label, action, false, true);
        }
        function recordK(action) {
            // The timer that arms Record returns before capture finishes. Journal
            // only the completed replacement, while the old K PCM is still live.
            // Never fold a recording into an unrelated pending randomisation.
            // Recording an amendment is allowed; travel stays blocked until the
            // amendment is saved/cancelled and its Song reservation is verified.
            if (busy || bastardLoopKRecordingState !== 'processing') throw new Error('Wait for the current recording or sound change to finish.');
            return run('Record to K', action, true);
        }
        async function restore(entry, direction, reservationGuard) {
            reservationGuard();
            const current = capture(), target = current.json;
            for (const change of entry.json) {
                let object = target;
                for (const key of change.path.slice(0, -1)) object = object[key] ||= {};
                const key = change.path.at(-1), value = change[direction];
                if (value === undefined) delete object[key]; else object[key] = copy(value);
            }
            const buffers = current.buffers.slice();
            for (const change of entry.buffers) buffers[change.index] = change[direction];
            const piano = entry.piano ? entry.piano[direction] : current.piano;
            const account = window.mygrainAccounts.user.username, context = audioContext, epoch = generation;
            const guard = () => { reservationGuard(); if (generation !== epoch || !window.mygrainAccounts.authenticated || account !== window.mygrainAccounts.user?.username || context !== audioContext) throw new Error('Account or audio changed; history cleared.'); };
            const transport = { seq: sequencerPlaying, loops: bastardLoopPlaying, drums: drumMachinePlaying, arp: isArpeggiatorPlaying(), keys: activeKeyCount > 0, q: window.mygrainQ?.running };
            const suspended = stateSaveSuspended, batched = batchSongUiRestore();
            try {
                guard(); stopSongAudio(); stateSaveSuspended = true; sourceMutationSerial += 1;
                audioBindings.forEach(([key, , set], i) => { if (key !== 'bastardQ') set(buffers[i]); });
                metadataBindings.forEach(([key, , set]) => set(copy(target.metadata[key])));
                if (!restoreState({ state: target.state, songSnapshot: true, throwOnError: true })) throw new Error('Could not restore the previous card settings.');
                sequencerSteps = copy(target.sequencerSteps); normalizeSequencerSteps();
                sequencerSteps.forEach((step, i) => updateSequencerStepUI(i + 1));
                seqGrainsEnabled = target.seqGrainsEnabled;
                document.getElementById('seqGrainsEnabled').checked = seqGrainsEnabled;
                heldNotes = new Set(target.heldNotes);
                document.querySelectorAll('.key[data-note]').forEach(key => key.classList.toggle('active', heldNotes.has(key.dataset.note)));
                performanceSourceLayerSolo = copy(target.performanceSourceLayerSolo);
                performanceSourceLayerSoloSnapshot = copy(target.performanceSourceLayerSoloSnapshot);
                // Settings restoration may rerender buffers. Return the exact saved sounds.
                audioBindings.forEach(([key, , set], i) => { if (key !== 'bastardQ') set(buffers[i]); });
                metadataBindings.forEach(([key, , set]) => set(copy(target.metadata[key])));
                if (piano && window.mygrainQ) Object.assign(window.mygrainQ.piano, piano, { cache: new Map(piano.cache) });
                syncLegacyAudioBuffer(); batched.applyEffects();
            } finally { stateSaveSuspended = suspended; batched.restore(); }
            refreshSongAudioUi(); saveState({ force: true });
            if (entry.json.some(change => change.path[0] === 'aiDirection')) window.mygrainAiPatch?.restoreHistoryState(target.aiDirection);
            if ((transport.loops || transport.q) && window.mygrainQ?.playable()) { await window.mygrainQ.preparePlayback(); guard(); }
            if (transport.seq || transport.loops || transport.drums || transport.arp || transport.keys || transport.q) withBufferedTransportStart(null, deadline => {
                if (transport.seq) startSequencer(deadline);
                if (transport.loops) setBastardLoopPlaying(true, { silent: true, skipSave: true, startTime: deadline });
                if (transport.drums) startDrumMachine(deadline);
                if (transport.q && !transport.loops) window.mygrainQ?.start(deadline);
                if (transport.arp) { keyboardPlaybackAuthorized = true; keyboardArpTransportPlaying = true; startArpeggiatorPlayback(deadline); }
                if (transport.keys && !arpEnabled) { keyboardPlaybackAuthorized = true; startHeldKeyboardPlayback(deadline); }
            }, { reset: true });
            syncPerformanceControlState();
            for (const change of entry.buffers) {
                const key = audioBindings[change.index][3];
                if (!key) continue;
                guard();
                if (buffers[change.index]) await saveAudioBufferToDB(buffers[change.index], key); else await clearAudioBufferFromDB(key);
                guard();
            }
        }
        async function travel(direction, aiUndo = false) {
            if (busy) return;
            if (aiUndo && (window.mygrainAiPatch?.diagnostics().phase !== 'undo' || !/^AI (generated patch|regenerated patch|refined patch|song section)$/.test(undo.at(-1)?.label || ''))) return;
            const song = window.mygrainSongBeta;
            const songId = song?.song?.id || null, library = song?.key;
            const identity = historyIdentity(), session = song?.lease.session, epoch = generation, context = audioContext;
            const reservationGuard = () => {
                if (epoch !== generation || identity !== historyIdentity() || session !== song?.lease.session || !window.mygrainAccounts?.authenticated || context !== audioContext) throw new Error('Account, device or audio changed. Undo/Redo stopped.');
                if (song !== window.mygrainSongBeta || songId !== (song?.song?.id || null) || library !== song?.key) throw new Error('Song selection changed. Undo/Redo stopped; try again for the selected song.');
                if (songId && !song.canEditSong()) throw new Error(song.lease.message || 'Song editing access is no longer verified. Undo/Redo stopped.');
            };
            try {
                assertReady(false, aiUndo);
                const from = direction === 'before' ? undo : redo, to = direction === 'before' ? redo : undo;
                const entry = from.at(-1); if (!entry) return;
                if (entry.owner !== identity) throw new Error('This history belongs to another device. Reload MYGRAIN before using Undo/Redo.');
                busy = restoring = true; update();
                await saving;
                if (store.readOnly) throw store.conflict();
                if (durable) await store.check();
                // Verify the server reservation on every travel, even for the same account.
                // Reserve an unowned selected song using its existing device/session identity.
                if (songId) {
                    status('Checking Song reservation…');
                    if (song.lease.token) {
                        await song.lease.check();
                    } else await song.ensureEditing();
                }
                reservationGuard(); assertReady(false, aiUndo);
                const restoredEntry = await store.hydrate(entry, context);
                reservationGuard();
                await restore(restoredEntry, direction, reservationGuard);
                reservationGuard();
                from.pop(); to.push(restoredEntry);
                await persist();
                status(`${direction === 'before' ? 'Undid' : 'Redid'} ${entry.label}.`);
            } catch (error) {
                const owner = song?.lease.lock?.label;
                const message = owner && !song.lease.token ? `${error.message} Song reserved on ${owner}.` : error.message;
                setStatus(message, 'error'); showSettlePopup(message);
            } finally { busy = restoring = false; update(); }
        }
        const randomAction = button => button && /random|generat|samplesonly|loadrandom|re-?cut/i.test(`${button.id} ${button.dataset.qAction || ''} ${button.textContent}`) && !button.closest('#aiPatchCard, #aiSongPartsCard');
        const guardBusyInput = event => {
            if (!busy || !event.isTrusted || !randomAction(event.target.closest('button'))) return;
            event.preventDefault(); event.stopImmediatePropagation(); status('Wait for the current sound change to finish.');
        };
        for (const type of ['pointerdown', 'click', 'keydown']) document.addEventListener(type, guardBusyInput, true);
        window.addEventListener('mygrain-account-lock', () => { generation++; store.close(); undo.length = redo.length = 0; update(); });
        window.mygrainCardHistory = { ready, flush: () => saving, get warning() { return storageWarning; }, run, recordK, recordAI, undo: () => travel('before'), redo: () => travel('after'),
            // Editing live patterns, cuts and sounds is the purpose of Song Amend. Journal it
            // without unlocking Undo/Redo or asynchronous recording/Song work.
            runPatternEdit: (label, action) => run(label, action, false, false, true),
            runDraftEdit: (label, action) => run(label, action, false, false, true),
            undoAI: () => travel('before', true),
            get undoLabel() { return undo.at(-1)?.label || ''; },
            get busy() { return busy || initializing; }, get counts() { return { undo: undo.length, redo: redo.length }; } };
        document.getElementById('sectionJumpUndoBtn')?.addEventListener('click', window.mygrainCardHistory.undo);
        document.getElementById('sectionJumpRedoBtn')?.addEventListener('click', window.mygrainCardHistory.redo);
        const actions = {
            randomizeBastardLoopVCut: 'Loop V cut',
            randomizeDrumMachinePatterns: 'drum patterns', loadRandomDrumMachineSamples: 'drum sounds and patterns', loadRandomDrumMachineSamplesOnly: 'drum sounds',
            loadRandomSingleDrumMachineSample: 'drum sample', randomizeBastardLoopLPattern: 'Loop L pattern', randomizeBastardLoopXAroundNote: 'Loop X notes', randomizeBastardLoopXPattern: 'Loop X pattern',
            randomizeSynthPopupPatch: 'OSC3 sound', generateStandaloneSource: 'generated source', generatePerformanceLoop: 'generated loop', runPatchRandomization: 'random patch', runMegaRandomization: 'Mega / Sparse patch',
            loadBastardLoopLSampleFromSource: 'Loop L sound', loadBastardLoopXSampleFromSource: 'Loop X sound', loadDropboxSampleLayerFromSource: 'sample layer sound',
            generateBastardLoopWithPlaybackRestart: 'Loop A sound', generateBastardLoop2WithPlaybackRestart: 'Loop B sound', generateBastardLoop3WithPlaybackRestart: 'Loop C sound',
            generateBastardLoopVWithPlaybackRestart: 'Loop V sound', generateBastardLoopPWithPlaybackRestart: 'Loop P sound', generateBastardLoopOWithPlaybackRestart: 'Loop O sound'
        };
        const draftActions = new Set([
            'randomizeBastardLoopVCut', 'randomizeDrumMachinePatterns',
            'loadRandomDrumMachineSamples', 'loadRandomDrumMachineSamplesOnly', 'loadRandomSingleDrumMachineSample',
            'randomizeBastardLoopLPattern', 'randomizeBastardLoopXAroundNote', 'randomizeBastardLoopXPattern',
            'loadBastardLoopLSampleFromSource', 'loadBastardLoopXSampleFromSource', 'loadDropboxSampleLayerFromSource',
            'generateBastardLoopWithPlaybackRestart', 'generateBastardLoop2WithPlaybackRestart', 'generateBastardLoop3WithPlaybackRestart',
            'generateBastardLoopVWithPlaybackRestart', 'generateBastardLoopPWithPlaybackRestart', 'generateBastardLoopOWithPlaybackRestart'
        ]);
        for (const [name, label] of Object.entries(actions)) {
            const original = window[name];
            if (typeof original === 'function') window[name] = function (...args) { return run(label, () => original.apply(this, args), false, false, draftActions.has(name)); };
        }
        update();
    }

    function installSoloButtonStyles() {
        const isSoloButton = button => button.matches('.mygrain-solo-button, .performance-layer-solo-btn, .performance-mixer-solo-btn, [data-source-waveform-solo], [data-grain-layer-solo], [data-q-action="solo"], #performanceSampleSoloBtn') || /^solo\b|\bsolo (on|off)$/i.test(button.textContent.trim());
        function mark(root = document) {
            const buttons = root.matches?.('button') ? [root] : root.querySelectorAll('button');
            buttons.forEach(button => {
                if (isSoloButton(button)) button.classList.add('mygrain-solo-button');
            });
        }
        mark();
        new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) mark(node);
        }).observe(document.body, { childList: true, subtree: true });
    }

    function mountCardSolos() {
        const cards = [
            ['[aria-label="Bastardloop L controls"]', 'bastardl', 'L'], ['[aria-label="Bastardloop X controls"]', 'bastardx', 'X'],
            ['[aria-label="Bastardloop M controls"]', 'bastardm', 'M'], ['[aria-label="Bastardloop M+ controls"]', 'bastardmplus', 'MPlus'],
            ['#bastardLoopKCard', 'bastardk', 'K'], ['#performanceDrumMachineCard', 'drums', 'Drums']
        ];
        for (const [selector, key, suffix] of cards) {
            const card = document.querySelector(selector); if (!card) continue;
            const button = document.createElement('button');
            button.id = `performanceCard${suffix}SoloBtn`; button.type = 'button'; button.className = 'performance-btn performance-layer-solo-btn mygrain-solo-button';
            button.dataset.loopCardSolo = key; button.textContent = 'Solo Off'; button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', () => setLoopLayerSolo(key, { toggle: true }));
            (card.querySelector('.performance-feature-actions') || card.querySelector('.performance-layer-switches') || card).append(button);
        }
        syncLoopLayerSoloButtons();
    }

    if (!window.__mygrainSongRenderDeck) { mountCardSolos(); installSoloButtonStyles(); }

    window.mygrainSongBetaAdapter = adapter;
    if (window.__mygrainSongRenderDeck) return;
    try {
        window.mygrainSongBeta = new MygrainSongBeta.Controller(adapter);
        installCardHistory();
        window.mygrainSongBeta.run(() => window.mygrainSongBeta.refresh());
    } catch (error) {
        document.getElementById('songBetaStatus').textContent = `Song beta unavailable: ${error.message}`;
    }
})();
