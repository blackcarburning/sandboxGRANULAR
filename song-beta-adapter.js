(function () {
    'use strict';

    let keyboardRecordingMonitorEnabled = false;
    let songOutputIsolation = null;

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
        ...Object.values(drumMachineExtraTracks).map(track => [track.kind === 'clap' ? 'drumClap' : 'drumCymbals', () => track.buffer, buffer => { track.buffer = buffer; }, `${track.id}Buffer`])
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
        ['grainMainSample', () => grainMainSampleMetadata, metadata => { grainMainSampleMetadata = metadata; }],
        ['grainASample', () => grainASampleMetadata, metadata => { grainASampleMetadata = metadata; }],
        ['grainBSample', () => grainBSampleMetadata, metadata => { grainBSampleMetadata = metadata; }],
        ['drumKick', () => drumMachineKickMetadata, metadata => { drumMachineKickMetadata = metadata; }],
        ['drumSnare', () => drumMachineSnareMetadata, metadata => { drumMachineSnareMetadata = metadata; }],
        ['drumHat', () => drumMachineHatMetadata, metadata => { drumMachineHatMetadata = metadata; }],
        ['drumPerc', () => drumMachinePercMetadata, metadata => { drumMachinePercMetadata = metadata; }],
        ...Object.values(drumMachineExtraTracks).map(track => [track.kind === 'clap' ? 'drumClap' : 'drumCymbals', () => track.metadata, metadata => { track.metadata = metadata; }])
    ];
    let persistence = Promise.resolve();

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    const additiveSongLanes = [
        { name: 'K', slots: ['bastardK', 'bastardKRender'], settings: /bastard(?:Loop)?K/i, references: /^(?:k|bastard(?:loop)?k)$/i },
        { name: 'M+', slots: ['bastardMPlus', 'bastardMPlusRender'], settings: /bastard(?:Loop)?MPlus/i, references: /^(?:m\+|mplus|bastard(?:loop)?mplus)$/i },
        { name: 'Q', slots: ['bastardQ'], settings: /^(?:q$|q[A-Z]|performanceQ|bastard(?:Loop)?Q)/, references: /^(?:q|bastard(?:loop)?q)$/i, emptyState: { q: null }, piano: true }
    ];

    function hasSongLaneEvidence(value, lane, reference = false) {
        if (!value || typeof value !== 'object') return reference && typeof value === 'string' && value.split(',').some(entry => lane.references.test(entry.trim()));
        return Object.entries(value).some(([key, entry]) => lane.settings.test(key)
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
                snapshot.state.q = cloneJson(window.MygrainQTheory.defaults());
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

    function prepareSongState(state) {
        const prepared = cloneJson(state);
        prepared.modes = {
            keyboardSoundSource: 'grain',
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

        async capture() {
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
                    audioSlots: Object.fromEntries(audioBindings.map(([key, getBuffer]) => [key, Boolean(getBuffer())])),
                    sequencerSteps: cloneJson(sequencerSteps),
                    seqGrainsEnabled,
                    heldNotes: getArpeggiatorNotes().filter(note => noteNames.includes(note)),
                    performanceSourceLayerSolo: cloneJson(performanceSourceLayerSolo),
                    performanceSourceLayerSoloSnapshot: cloneJson(performanceSourceLayerSoloSnapshot),
                    controls: Array.from(document.querySelectorAll('input[type="checkbox"], input[type="number"], input[type="radio"]'))
                        .filter(input => input.id && !input.closest('#songBetaCard, #bastardLoopVCutOverlay, #qArpOverlay'))
                        .map(input => ({ id: input.id, type: input.type, value: input.value, checked: input.checked })),
                    metadata: Object.fromEntries(metadataBindings.map(([key, getMetadata]) => [key, cloneJson(getMetadata())]))
                },
                assets: []
            };
            const entries = [];
            for (const [key, getBuffer] of audioBindings) {
                const buffer = getBuffer();
                if (!buffer) continue;
                const path = `audio/${key}.wav`;
                entries.push({ path, data: audioBufferToWav(buffer) });
                snapshot.assets.push({ key, path, channels: buffer.numberOfChannels, frames: buffer.length, sampleRate: buffer.sampleRate });
            }
            entries.unshift({ path: 'song-part.json', data: JSON.stringify(snapshot) });
            return createStoredZip(entries);
        },

        inspectPart(arrayBuffer) {
            const entries = parseStoredZipEntries(arrayBuffer);
            validateSongArchiveEntries(arrayBuffer, entries);
            const original = JSON.parse(getZipText(entries, 'song-part.json') || 'null');
            if (!original || original.format !== 'mygrain-song-part' || original.version !== 1 || !original.state?.modes || !original.extra || !Array.isArray(original.assets)) {
                throw new Error('This is not a supported complete song-part snapshot.');
            }
            const { snapshot, lanes } = normalizeSongAudioInventory(original);
            if (!Array.isArray(snapshot.extra.sequencerSteps) || snapshot.extra.sequencerSteps.length !== Number(snapshot.state.patternLength)) throw new Error('Part sequencer pattern is incomplete.');
            validateSongAudioInventory(snapshot);
            validateSongAudioEntries(snapshot, entries);
            const decodedBytes = snapshot.assets.reduce((bytes, asset) => bytes + Number(asset.frames) * Number(asset.channels) * 4 * Math.max(1, audioContext.sampleRate / Number(asset.sampleRate)), 0);
            if (!Number.isFinite(decodedBytes) || decodedBytes < 0) throw new Error('Invalid saved song audio dimensions.');
            return { snapshot, decodedBytes, upgrade: lanes.length ? { lanes, entries } : null };
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
                buffers: new Map(audioBindings.map(([key]) => [key, part.buffers.has(key) ? cloneAudioBufferForCurrentContext(part.buffers.get(key)) : null]))
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
                    if (!input || input.closest('#songBetaCard, #bastardLoopVCutOverlay, #qArpOverlay') || input.type !== control.type) continue;
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

        stop: stopSongAudio,
        context: () => audioContext,
        output: () => finalAmplifierNode,
        startAt(startTime) {
            restartAllTransport({ startTime, silent: true });
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

    window.mygrainSongBetaAdapter = adapter;
    if (window.__mygrainSongRenderDeck) return;
    try {
        window.mygrainSongBeta = new MygrainSongBeta.Controller(adapter);
        window.mygrainSongBeta.run(() => window.mygrainSongBeta.refresh());
    } catch (error) {
        document.getElementById('songBetaStatus').textContent = `Song beta unavailable: ${error.message}`;
    }
})();
