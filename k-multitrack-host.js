(function () {
    'use strict';
    const theory = window.MygrainKMultitrack;
    if (!theory) throw new Error('K multitrack recorder could not load. Reload MYGRAIN.');
    let selecting = false, preparingRecord = false, restoring = false, meters = null;
    // Native convolver setup can be slow in WebKit. Prepare each audible room
    // before a transport/capture deadline; consume it exactly once in its voice.
    const preparedRooms = new Map();
    function clearPreparedRoom(track) {
        const entry = preparedRooms.get(track); if (!entry) return;
        preparedRooms.delete(track); try { entry.room.disconnect(); } catch {} entry.room.buffer = null;
    }
    function prepareRoom(track) {
        if (window.mygrainLoopFx) { clearPreparedRoom(track); return null; }
        const entry = preparedRooms.get(track), decay = track.processing.reverbDecay;
        // Render decks use a context facade; room.context is its native parent.
        if (entry && entry.context === audioContext && entry.decay === decay && track.processing.reverbMix > 0) return entry.room;
        clearPreparedRoom(track);
        if (!(track.processing.reverbMix > 0)) return null;
        const room = audioContext.createConvolver();
        try { room.buffer = window.MygrainKTrackDsp.prepare(audioContext, track.processing); }
        catch (error) { room.disconnect(); room.buffer = null; throw error; }
        preparedRooms.set(track, { room, decay, context: audioContext }); return room;
    }
    function clearPreparedRooms() { for (const track of preparedRooms.keys()) clearPreparedRoom(track); }
    function takePreparedRoom(track) { const room = prepareRoom(track); preparedRooms.delete(track); return room; }
    const recorder = theory.create({
        context: () => audioContext, bpm: getSharedBpmClockValue,
        memoryBudget: () => (window.matchMedia?.('(pointer: coarse)').matches ? 96 : 192) * 1048576,
        pitchRate: track => track.processing.preserveDuration ? 1 : 2 ** ((track.processing.semitone + track.processing.fine / 100) / 12),
        masterGain: () => getBastardLoopKOutputGain(), boundary: () => transportSync.handoffBoundary,
        timing: time => resolveTransportLaneStart(time, 'K'), startSource: startTransportSource,
        prepare: track => prepareTrack(track),
        route(gain, pan, track, index) {
            const room = takePreparedRoom(track);
            return window.MygrainKTrackDsp.create(audioContext, gain, pan, track.processing, getSharedBpmClockValue(),
                preFilterGainNode || masterGain || audioContext.destination, undefined, room, `K${index + 1}`);
        },
        idle(track) { track.rendered = track.padded = track.paddedSource = null; track.renderKey = null; },
        published(voices) {
            const first = voices.values().next().value;
            bastardLoopKSource = first?.source || null; bastardLoopKGainNode = first?.gain || null;
            bastardLoopKFilterNodes = [...voices.values()].flatMap(voice => voice.filters);
            meters?.sync(voices);
        }
    });
    function busy() { return preparingRecord || bastardLoopKRecordingState !== 'idle'; }
    function stash() {
        if (restoring || selecting) return;
        const track = recorder.tracks[recorder.selected];
        if (track.raw !== bastardLoopKRawBuffer || track.rendered !== bastardLoopKBuffer) track.padded = track.paddedSource = null;
        Object.assign(track, { raw: bastardLoopKRawBuffer, rendered: bastardLoopKBuffer === bastardLoopKRawBuffer ? track.rendered : bastardLoopKBuffer, metadata: bastardLoopKMetadata,
            sourceBpm: bastardLoopKSourceBpm, steps: bastardLoopKRecordingSteps });
    }
    function aliases() {
        const track = recorder.tracks[recorder.selected];
        bastardLoopKRawBuffer = track.raw; bastardLoopKBuffer = track.rendered || track.raw;
        const p = track.processing;
        bastardLoopKPitchSemitones = p.semitone; bastardLoopKFineCents = p.fine;
        bastardLoopKPreserveDuration = p.preserveDuration; bastardLoopKReverse = p.reverse;
        bastardLoopKFilterCutoff = p.cutoff; bastardLoopKFilterMode = p.filterMode;
        bastardLoopKFilterEnvelopeAmount = p.envelope; bastardLoopKFilterLfoWaveform = p.lfoWave;
        bastardLoopKFilterLfoRate = p.lfoDivision; bastardLoopKFilterLfoAmount = p.lfoAmount; bastardLoopKFilterLfoInvert = p.lfoInvert;
        const values = { Semitone: p.semitone, FineTune: p.fine, FilterCutoff: p.cutoff, FilterMode: p.filterMode,
            FilterEnvelope: p.envelope * 100, FilterLfoWaveform: p.lfoWave, FilterLfoRate: p.lfoDivision, FilterLfoAmount: p.lfoAmount * 100 };
        for (const [name, value] of Object.entries(values)) { const element = document.getElementById(`performanceBastardLoopK${name}`); if (element) element.value = String(value); }
        bastardLoopKMetadata = track.metadata; bastardLoopKSourceBpm = track.sourceBpm; bastardLoopKRecordingSteps = track.steps;
    }
    const renderKey = track => JSON.stringify([track.processing.semitone, track.processing.fine, track.processing.preserveDuration, track.processing.reverse]);
    function prepareTrack(track) {
        if (!track.raw || !audioContext) return track.raw;
        prepareRoom(track);
        const key = renderKey(track);
        if (track.rendered && track.renderKey === key) return track.rendered;
        const needsCopy = track.processing.reverse || (track.processing.preserveDuration && (track.processing.semitone || track.processing.fine));
        if (needsCopy) {
            const bytes = recorder.tracks.reduce((sum, t) => sum + (t.raw?.length || 0) * (t.raw?.numberOfChannels || 0) * 4
                + (t.rendered && t.rendered !== t.raw ? t.rendered.length * t.rendered.numberOfChannels * 4 : 0)
                + (t.padded?.length || 0) * (t.padded?.numberOfChannels || 0) * 4, 0);
            const budget = (window.matchMedia?.('(pointer: coarse)').matches ? 96 : 192) * 1048576;
            if (bytes + track.raw.length * track.raw.numberOfChannels * 4 * 3 > budget) throw new Error('This K track tuning needs too much audio memory. Shorten the take or use sampler pitch mode.');
        }
        // Own just this track's current render. The general synth pitch cache can
        // retain 48 variants per source, which is unsuitable for five long takes.
        let rendered = track.raw;
        const cents = track.processing.semitone * 100 + track.processing.fine;
        if (track.processing.preserveDuration && Math.abs(cents) >= .174) {
            const quantizedCents = Math.max(-4800, Math.min(4800, Math.round(cents / 25) * 25));
            rendered = pitchShiftBufferByRatioKeepDuration(track.raw, 2 ** (quantizedCents / 1200), audioContext);
        }
        if (track.processing.reverse) {
            const reversed = audioContext.createBuffer(rendered.numberOfChannels, rendered.length, rendered.sampleRate);
            for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
                const input = rendered.getChannelData(channel), output = reversed.getChannelData(channel);
                for (let frame = 0; frame < input.length; frame++) output[frame] = input[input.length - frame - 1];
            }
            rendered = reversed;
        }
        track.rendered = rendered;
        track.renderKey = key; track.padded = track.paddedSource = null;
        if (recorder.tracks[recorder.selected] === track) aliases();
        return track.rendered;
    }
    function rebuild(preserveRendered = false) {
        for (const track of recorder.tracks) {
            if (!preserveRendered || track.renderKey !== renderKey(track)) { track.rendered = null; track.renderKey = null; }
            track.padded = track.paddedSource = null;
        }
        aliases();
    }
    function sync() {
        for (const track of preparedRooms.keys()) if (!recorder.audible(track) || preparedRooms.get(track).context !== audioContext) clearPreparedRoom(track);
        const disabled = busy();
        const destination = document.getElementById('performanceKeyboardKTrack');
        if (destination) { destination.value = String(recorder.selected); destination.disabled = disabled; }
        for (const row of document.querySelectorAll('[data-k-track]')) {
            const index = Number(row.dataset.kTrack), track = recorder.tracks[index];
            row.querySelector('[data-k-enabled]').checked = track.enabled !== false;
            row.querySelector('[data-k-enabled]').disabled = disabled;
            row.classList.toggle('k-track-selected', recorder.selected === index);
            const record = row.querySelector('[data-k-record-select]');
            record.checked = index === recorder.selected; record.disabled = disabled;
            const level = row.querySelector('[data-k-level]'), pan = row.querySelector('[data-k-pan]'), length = row.querySelector('[data-k-steps]');
            if (document.activeElement !== level) level.value = String(Math.round(track.level * 100));
            if (document.activeElement !== pan) pan.value = String(Math.round(track.pan * 100));
            if (document.activeElement !== length) length.value = String(track.steps ?? track.metadata?.recordingSteps ?? (track.raw ? Math.max(1, Math.round(track.raw.duration * track.sourceBpm / 60 * 4)) : getPatternLengthSteps()));
            length.disabled = level.disabled = pan.disabled = disabled;
            row.querySelector('[data-k-mute]').checked = track.mute;
            row.querySelector('[data-k-mute]').disabled = disabled;
            row.querySelector('[data-k-level-value]').textContent = `${Math.round(track.level * 100)}%`;
            row.querySelector('[data-k-pan-value]').textContent = track.pan === 0 ? 'C' : `${Math.round(Math.abs(track.pan) * 100)}${track.pan < 0 ? 'L' : 'R'}`;
            row.querySelector('[data-k-track-status]').textContent = track.raw ? `${track.raw.duration.toFixed(2)}s recorded` : 'Empty';
        }
        syncEditor(disabled);
        const solo = document.getElementById('performanceKeyboardKSolo');
        if (solo) { const on = hasLoopLayerSolo('bastardk'); solo.classList.toggle('active', on); solo.setAttribute('aria-pressed', String(on)); }
    }
    function persistSelected() { stash(); return recorder.tracks[recorder.selected].raw
        ? saveAudioBufferToDB(recorder.tracks[recorder.selected].raw, theory.dbKey(recorder.selected))
        : clearAudioBufferFromDB(theory.dbKey(recorder.selected)); }
    function restoreSettings(modes = {}, preserveRendered = true) {
        clearPreparedRooms();
        restoring = true;
        try { recorder.restore(modes.kMultitrack, modes, recorder.tracks[0].metadata || bastardLoopKMetadata); rebuild(preserveRendered); }
        finally { restoring = false; }
        sync();
    }
    function select(index) {
        if (busy()) throw new Error('Finish or cancel the current K take before changing its recording destination.');
        stash(); selecting = true;
        try { if (activeSourceCardAuditionKind === 'bastardk') stopSourceCardAudition(); recorder.select(Number(index)); aliases(); }
        finally { selecting = false; }
        drawBastardLoopKWaveform(); syncBastardLoopKUi(); saveState();
    }
    function change(index, setting, value) {
        if (!Number.isInteger(index) || index < 0 || index > 4 || !['steps', 'level', 'mute', 'pan', 'enabled'].includes(setting)) throw new Error('Invalid K track control.');
        if (!['mute', 'enabled'].includes(setting) && !Number.isFinite(Number(value))) throw new Error('Enter a valid K track value.');
        if (busy()) throw new Error('Finish or cancel the current K take before editing its tracks.');
        if (window.mygrainCardHistory?.busy) throw new Error('Wait for the current sound change to finish.');
        const apply = () => {
            stash(); const track = recorder.tracks[index];
            if (setting === 'steps') {
                value = Number(value); if (!Number.isSafeInteger(value) || value < 1) throw new Error('Enter a positive whole number of steps.');
                const previous = track.steps;
                track.steps = value; track.padded = track.paddedSource = null;
                // Preflight a longer, silence-padded period before touching playback.
                try { if (recorder.audible(track)) recorder.bufferFor(track); } catch (error) { track.steps = previous; throw error; }
                aliases(); if (bastardLoopPlaying) recorder.restart(index);
            } else if (setting === 'mute' || setting === 'enabled') track[setting] = Boolean(value);
            else track[setting] = Math.max(setting === 'pan' ? -1 : 0, Math.min(1, Number(value)));
            if (bastardLoopPlaying && !recorder.voices.size) recorder.start(); else recorder.mix();
            aliases(); syncBastardLoopKUi(); saveState();
        };
        return window.mygrainCardHistory ? window.mygrainCardHistory.run(`K${index + 1} ${setting}`, apply, false, false, true) : apply();
    }
    const original = { sync: syncBastardLoopKUi, stop: stopBastardLoopK, steps: setBastardLoopKRecordingSteps,
        tempo: syncBastardLoopKTempo, record: beginBastardLoopKRecording, clear: clearBastardLoopK,
        restore: restoreState, preset: applyPreset, solos: syncLoopLayerSoloButtons };
    syncBastardLoopKUi = function () { original.sync(); sync(); };
    syncLoopLayerSoloButtons = function () { original.solos(); sync(); };
    startBastardLoopK = function (time = null, options = {}) { stash(); const result = recorder.start(time); if (!options.skipUi) syncBastardLoopKUi(); return result; };
    stopBastardLoopK = function (options = {}) { if (!transportSync.depth) clearPreparedRooms(); recorder.stop(options); if (!options.skipUi) syncBastardLoopKUi(); };
    syncBastardLoopKTempo = function () { syncBastardLoopKInfo(); recorder.tempo(); };
    updateBastardLoopKMix = function () {
        if (bastardLoopPlaying && recorder.hasAudio() && !recorder.voices.size && getBastardLoopKLevelValue() > 0) recorder.start();
        else if (!bastardLoopPlaying) recorder.stop();
        recorder.mix(); aliases(); syncBastardLoopKUi();
    };
    rerenderBastardLoopKFromRaw = function (options = {}) {
        if (restoring) return bastardLoopKBuffer;
        stash(); const track = recorder.tracks[recorder.selected];
        track.processing = theory.processing({ ...track.processing, semitone: bastardLoopKPitchSemitones, fine: bastardLoopKFineCents,
            preserveDuration: bastardLoopKPreserveDuration, reverse: bastardLoopKReverse });
        track.rendered = track.renderKey = track.padded = track.paddedSource = null;
        if (bastardLoopPlaying) recorder.restart(recorder.selected); aliases();
        drawBastardLoopKWaveform(); if (!options.skipUi) syncBastardLoopKUi(); return bastardLoopKBuffer;
    };
    setBastardLoopKRecordingSteps = function (value, options = {}) {
        const result = original.steps(value, { ...options, skipSave: true });
        if (restoring) return result;
        recorder.tracks[recorder.selected].steps = bastardLoopKRecordingSteps;
        recorder.tracks[recorder.selected].padded = recorder.tracks[recorder.selected].paddedSource = null;
        if (bastardLoopPlaying && !restoring) recorder.restart(recorder.selected); sync(); if (!options.skipSave) saveState(); return result;
    };
    clearBastardLoopK = async function (options = {}) {
        if (preparingRecord || bastardLoopKRecordingState === 'processing') return false;
        if (busy()) cancelBastardLoopKRecording({ silent: true });
        if (activeSourceCardAuditionKind === 'bastardk') stopSourceCardAudition();
        recorder.setBuffer(recorder.selected, null); recorder.setBuffer(recorder.selected, null, true);
        recorder.tracks[recorder.selected].metadata = null; aliases();
        await persistSelected(); if (bastardLoopPlaying) recorder.restart(recorder.selected);
        drawBastardLoopKWaveform(); syncBastardLoopKUi(); syncPerformanceControlState();
        if (!options.skipSave) saveState(); if (!options.silent) setStatus(`K${recorder.selected + 1} cleared. Other K tracks are unchanged.`);
    };
    beginBastardLoopKRecording = async function (options = {}) {
        if (busy()) return false;
        stash();
        const retained = recorder.tracks.reduce((bytes, track) => bytes + (track.raw?.length || 0) * (track.raw?.numberOfChannels || 0) * 4
            + (track.rendered !== track.raw ? (track.rendered?.length || 0) * (track.rendered?.numberOfChannels || 0) * 4 : 0), 0);
        const budget = (window.matchMedia?.('(pointer: coarse)').matches ? 96 : 192) * 1048576;
        const incoming = getBastardLoopKRecordingDurationSeconds(getSharedBpmClockValue()) * (audioContext?.sampleRate || 48000) * 2 * 4;
        if (retained + incoming * 3 > budget) { setStatus('This K take needs too much audio memory. Shorten its recording length or clear a K track first.', 'error'); return false; }
        preparingRecord = true; sync();
        try { return await original.record(options); }
        finally { preparingRecord = false; sync(); }
    };
    restoreState = function (options = {}) {
        const state = options.state || readStoredStateSnapshot();
        if (state?.modes?.kMultitrack) theory.normalize(state.modes.kMultitrack);
        restoring = true;
        let result;
        try { result = original.restore(options); }
        finally { restoring = false; }
        if (result) {
            restoreSettings({ ...state?.modes, sliders: state?.sliders, selects: state?.selects, bastardLoopKRecordingSteps }, options.songSnapshot === true);
            if (bastardLoopPlaying && !options.songSnapshot) recorder.start();
        }
        return result;
    };
    applyPreset = function (preset, ...args) {
        const modes = preset.modes || preset;
        if (modes.kMultitrack) theory.normalize(modes.kMultitrack);
        stash(); restoring = true; let result;
        try { result = original.preset(preset, ...args); } finally { restoring = false; }
        restoreSettings({ ...modes, sliders: preset.sliders, selects: preset.selects }, false);
        if (bastardLoopPlaying) recorder.start();
        saveState(); return result;
    };
    const api = {
        tracks: recorder.tracks, get selected() { return recorder.selected; }, get voices() { return recorder.voices; },
        hasAudio: () => recorder.hasAudio(), select, change, changeProcessing, sync, persistSelected,
        centrePans() { for(const track of recorder.tracks)track.pan=0;recorder.mix();syncBastardLoopKUi(); },
        prewarm() { for (const track of recorder.tracks) if (recorder.audible(track)) prepareTrack(track); else clearPreparedRoom(track); },
        get preparedReverbCount() { return preparedRooms.size; },
        takePreparedReverb() { return takePreparedRoom(recorder.tracks[recorder.selected]); },
        prepareSelected() { stash(); const buffer = prepareTrack(recorder.tracks[recorder.selected]); aliases(); return buffer; },
        captureSettings() { stash(); return recorder.settings(); }, restoreSettings,
        getBuffer(index, rendered = false) { return recorder.tracks[index][rendered ? 'rendered' : 'raw']; },
        setBuffer(index, buffer, rendered = false) { recorder.setBuffer(index, buffer, rendered); },
        refreshBuffers() { rebuild(); syncBastardLoopKUi(); },
        restoreBuffers(buffers, state) {
            buffers.forEach((buffer, index) => recorder.setBuffer(index, buffer));
            if (!state.modes?.kMultitrack && buffers[0]) recorder.tracks[0].metadata = {
                summary: state.modes?.bastardLoopKSummary || `${buffers[0].duration.toFixed(2)}s keyboard loop · restored`,
                durationSeconds: Number(state.modes?.bastardLoopKDurationSeconds) || buffers[0].duration,
                bpm: Number(state.modes?.bastardLoopKSourceBpm) || 120, sourceLabel: 'KEYBOARD'
            };
            restoreSettings({ ...state.modes, sliders: state.sliders, selects: state.selects, bastardLoopKRecordingSteps });
            drawBastardLoopKWaveform(); syncBastardLoopKUi();
        }
    };
    window.mygrainKMultitrack = api;
    const colours = ['75,211,182', '115,177,255', '213,146,255', '255,189,94', '255,126,157'];
    const form = document.getElementById('kMultitrackTracks');
    if (form) {
        for (let index = 0; index < 5; index++) {
            const row = document.createElement('section'); row.dataset.kTrack = index; row.className = 'k-recorder-track';
            row.setAttribute('aria-label', `K track ${index + 1}`); row.style.setProperty('--k-track-rgb', colours[index]);
            row.innerHTML = `<div class="k-track-heading"><strong>K${index + 1}</strong><span data-k-track-status>Empty</span></div>
                <label class="k-track-toggle"><input type="radio" name="kRecordTrack" data-k-record-select aria-label="Record select K${index + 1}"> Record select</label>
                <label class="k-track-toggle"><input type="checkbox" data-k-enabled checked aria-label="Enable K${index + 1}"> On</label>
                <label class="k-track-toggle"><input type="checkbox" data-k-mute aria-label="Mute K${index + 1}"> Mute</label>
                <label>Level <output data-k-level-value>100%</output><input type="range" min="0" max="100" value="100" data-k-level aria-label="K${index + 1} level"></label>
                <div class="k-track-vu" data-k-track-meter="${index}" role="meter" aria-label="K${index + 1} output level" aria-valuemin="-60" aria-valuemax="0" aria-valuenow="-60" aria-valuetext="Silent">
                    <div class="k-track-vu-head"><span>VU</span><span data-k-vu-value>−∞</span></div>
                    <div class="k-track-vu-bar" aria-hidden="true"><div class="k-track-vu-fill" data-k-vu-fill></div><div class="k-track-vu-peak" data-k-vu-peak></div></div>
                </div>
                <label>Pan <output data-k-pan-value>C</output><input type="range" min="-100" max="100" value="0" data-k-pan aria-label="K${index + 1} pan"></label>
                <label>Loop steps<input type="number" min="1" step="1" inputmode="numeric" data-k-steps aria-label="K${index + 1} loop length in steps"></label>`;
            // Labels own only their checkbox/radio and text. The rest of the
            // tile selects the editor without changing On, Mute or a slider.
            row.addEventListener('click', event => {
                if (event.target.closest('label, input, button, select, textarea, a')) return;
                if (recorder.selected !== index) safe(() => select(index));
            });
            row.querySelector('[data-k-record-select]').addEventListener('change', () => safe(() => select(index)));
            for (const [selector, key] of [['[data-k-enabled]', 'enabled'], ['[data-k-mute]', 'mute'], ['[data-k-level]', 'level'], ['[data-k-pan]', 'pan'], ['[data-k-steps]', 'steps']]) {
                const update = event => safe(() => change(index, key, ['mute', 'enabled'].includes(key) ? event.target.checked : Number(event.target.value) / (key === 'level' || key === 'pan' ? 100 : 1)));
                row.querySelector(selector).addEventListener('change', update);
                if (key === 'level' || key === 'pan') row.querySelector(selector).addEventListener('input', update);
            }
            form.append(row);
        }
        for (const event of ['keydown', 'keyup']) form.addEventListener(event, event => event.stopPropagation());
    }
    const editor = document.getElementById('kTrackControlSection');
    const definitions = [
        ['Tuning'], ['semitone', 'Semitone', -24, 24, 1, 1, 'st'], ['fine', 'Fine tune', -100, 100, 1, 1, 'c'],
        ['preserveDuration', 'Preserve duration', true], ['reverse', 'Reverse', true],
        ['Filter'], ['filterMode', 'Filter type', theory.filterModes], ['cutoff', 'Cutoff', 50, 18000, 10, 1, 'Hz'],
        ['resonance', 'Resonance', .1, 8, .1, 1, 'Q'], ['envelope', 'Envelope depth', 0, 100, 1, 100, '%'],
        ['envelopeDecay', 'Envelope decay', 60, 4000, 10, 1000, 'ms'], ['lfoWave', 'LFO waveform', ['sine', 'triangle', 'sawtooth', 'ramp', 'square']],
        ['lfoDivision', 'LFO beats/cycle', theory.divisions], ['lfoAmount', 'LFO depth', 0, 100, 1, 100, '%'], ['lfoInvert', 'Invert LFO', true],
        ['Effects'], ['drive', 'Drive', 0, 12, .1, 1, 'dB'], ['delayMix', 'Delay mix', 0, 60, 1, 100, '%'],
        ['delayDivision', 'Delay beats', theory.divisions], ['delayFeedback', 'Delay feedback', 0, 70, 1, 100, '%'],
        ['delayCutoff', 'Delay tone', 200, 18000, 10, 1, 'Hz'], ['reverbMix', 'Reverb mix', 0, 60, 1, 100, '%'],
        ['reverbDecay', 'Reverb decay', 200, 4000, 10, 1000, 'ms']
    ];
    function changeProcessing(key, value) {
        if (!Object.hasOwn(theory.processing(), key)) throw new Error('Unknown K track setting.');
        if (busy()) throw new Error('Finish the K take before editing its sound.');
        if (window.mygrainCardHistory?.busy) throw new Error('Wait for the current sound change to finish.');
        const apply = () => {
            stash(); const index = recorder.selected, track = recorder.tracks[index];
            const previous = { processing: track.processing, rendered: track.rendered, renderKey: track.renderKey, padded: track.padded, paddedSource: track.paddedSource };
            track.processing = theory.processing({ ...track.processing, [key]: value });
            if (['semitone', 'fine', 'preserveDuration', 'reverse'].includes(key)) track.rendered = track.renderKey = track.padded = track.paddedSource = null;
            try { if (bastardLoopPlaying) recorder.restart(index); }
            catch (error) { Object.assign(track, previous); aliases(); throw error; }
            aliases(); syncBastardLoopKUi(); saveState();
        };
        return window.mygrainCardHistory ? window.mygrainCardHistory.runDraftEdit(`K${recorder.selected + 1} ${key}`, apply) : apply();
    }
    function syncEditor(disabled) {
        if (!editor) return;
        const colour = colours[recorder.selected], p = recorder.tracks[recorder.selected].processing;
        editor.style.setProperty('--k-track-rgb', colour);
        editor.querySelector('[data-k-editor-title]').textContent = `K${recorder.selected + 1} · Filter, tuning & effects`;
        document.querySelector('#bastardLoopKCard .source-waveform-panel')?.style.setProperty('--k-track-rgb', colour);
        document.querySelector('.k-keyboard-destination')?.style.setProperty('--k-track-rgb', colour);
        for (const spec of definitions) {
            const [key, , type, , , factor = 1, unit = ''] = spec;
            if (spec.length < 3) continue;
            const input = editor.querySelector(`[data-k-processing="${key}"]`); input.disabled = disabled;
            if (document.activeElement !== input) {
                if (type === true) input.checked = p[key];
                else input.value = String(Array.isArray(type) ? p[key] : p[key] === null ? 400 : p[key] * factor);
            }
            const label = editor.querySelector(`[data-k-processing-value="${key}"]`);
            if (label) label.textContent = p[key] === null ? 'Auto (legacy)' : `${Number((p[key] * factor).toFixed(2))} ${unit}`;
        }
    }
    if (editor) {
        editor.innerHTML = '<h4 data-k-editor-title></h4><p>These settings affect only the selected K track.</p>';
        for (const spec of definitions) {
            const [key, label, type, max, step, factor = 1, unit = ''] = spec;
            if (spec.length < 3) { const title = document.createElement('h5'); title.textContent = key; editor.append(title); continue; }
            const wrapper = document.createElement('label'); wrapper.className = 'k-track-setting'; wrapper.textContent = label;
            const input = document.createElement(Array.isArray(type) ? 'select' : 'input'); input.dataset.kProcessing = key; input.id = `kTrack_${key}`;
            input.setAttribute('aria-label', `Selected K track ${label.toLowerCase()}`);
            if (Array.isArray(type)) for (const value of type) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
            else if (type === true) input.type = 'checkbox';
            else { input.type = 'range'; input.min = type; input.max = max; input.step = step; const value = document.createElement('output'); value.dataset.kProcessingValue = key; wrapper.append(value); }
            input.addEventListener('change', () => safe(() => changeProcessing(key, type === true ? input.checked : Array.isArray(type) ? input.value : Number(input.value) / factor)));
            // Sliders audition on input, using the same history guard as all draft edits.
            if (input.type === 'range') input.addEventListener('input', () => safe(() => changeProcessing(key, Number(input.value) / factor)));
            wrapper.append(input); editor.append(wrapper);
        }
        for (const type of ['keydown', 'keyup']) editor.addEventListener(type, event => event.stopPropagation());
    }
    meters = window.MygrainKTrackMeters?.create({ context: () => audioContext });
    window.mygrainKTrackMeters = meters;
    meters?.sync(recorder.voices);
    function safe(action) { try { const result = action(); result?.catch(error => { setStatus(error.message, 'error'); sync(); }); } catch (error) { setStatus(error.message, 'error'); sync(); } }
    document.getElementById('performanceKeyboardKTrack')?.addEventListener('change', event => safe(() => select(Number(event.target.value))));
    document.getElementById('performanceKeyboardKSolo')?.addEventListener('click', () => { setLoopLayerSolo('bastardk', { toggle: true }); sync(); });
    window.addEventListener('mygrain-account-lock', () => { meters?.destroy(); recorder.release(); aliases(); });
    sync();
})();
