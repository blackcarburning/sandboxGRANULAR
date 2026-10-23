(function () {
    'use strict';
    const theory = window.MygrainKMultitrack;
    if (!theory) throw new Error('K multitrack recorder could not load. Reload MYGRAIN.');
    let selecting = false, preparingRecord = false, restoring = false, meters = null;
    const recorder = theory.create({
        context: () => audioContext, bpm: getSharedBpmClockValue,
        memoryBudget: () => (window.matchMedia?.('(pointer: coarse)').matches ? 96 : 192) * 1048576,
        pitchRate: () => bastardLoopKPreserveDuration ? 1 : getBastardLoopKPitchRatio(),
        masterGain: () => getBastardLoopKOutputGain(), boundary: () => transportSync.handoffBoundary,
        timing: time => resolveTransportLaneStart(time, 'K'), startSource: startTransportSource,
        route(gain, pan) {
            const filters = createBastardLoopConfigurableFilters(getBastardLoopKFilterCutoff(), getBastardLoopKFilterMode());
            gain.connect(pan); connectBastardLoopFilterChain(pan, filters, preFilterGainNode || masterGain || audioContext.destination);
            return filters;
        },
        disconnectFilters: disconnectBastardLoopFilterChain, envelope: applyBastardLoopKFilterEnvelope,
        filters(filters) { smoothBastardLoopFilterCutoff(filters, getBastardLoopKFilterCutoff()); attachBastardLoopKFilterLfo(filters); },
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
        Object.assign(track, { raw: bastardLoopKRawBuffer, rendered: bastardLoopKBuffer, metadata: bastardLoopKMetadata,
            sourceBpm: bastardLoopKSourceBpm, steps: bastardLoopKRecordingSteps });
    }
    function aliases() {
        const track = recorder.tracks[recorder.selected];
        bastardLoopKRawBuffer = track.raw; bastardLoopKBuffer = track.rendered;
        bastardLoopKMetadata = track.metadata; bastardLoopKSourceBpm = track.sourceBpm; bastardLoopKRecordingSteps = track.steps;
    }
    function rebuild(preserveRendered = false) {
        for (const track of recorder.tracks) {
            if (!preserveRendered || !track.rendered) track.rendered = track.raw && audioContext ? getBastardLoopPlaybackBufferForMode(track.raw, getBastardLoopKPitchRatio(),
                { preserveDuration: bastardLoopKPreserveDuration, reversed: bastardLoopKReverse }) : null;
            track.padded = track.paddedSource = null;
        }
        aliases();
    }
    function sync() {
        const disabled = busy();
        const destination = document.getElementById('performanceKeyboardKTrack');
        if (destination) { destination.value = String(recorder.selected); destination.disabled = disabled; }
        for (const row of document.querySelectorAll('[data-k-track]')) {
            const index = Number(row.dataset.kTrack), track = recorder.tracks[index];
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
        const solo = document.getElementById('performanceKeyboardKSolo');
        if (solo) { const on = hasLoopLayerSolo('bastardk'); solo.classList.toggle('active', on); solo.setAttribute('aria-pressed', String(on)); }
    }
    function persistSelected() { stash(); return recorder.tracks[recorder.selected].raw
        ? saveAudioBufferToDB(recorder.tracks[recorder.selected].raw, theory.dbKey(recorder.selected))
        : clearAudioBufferFromDB(theory.dbKey(recorder.selected)); }
    function restoreSettings(modes = {}, preserveRendered = true) {
        restoring = true;
        try { recorder.restore(modes.kMultitrack, modes, recorder.tracks[0].metadata || bastardLoopKMetadata); rebuild(preserveRendered); }
        finally { restoring = false; }
        sync();
    }
    function select(index) {
        if (busy()) throw new Error('Finish or cancel the current K take before changing its recording destination.');
        stash(); selecting = true;
        try { recorder.select(Number(index)); aliases(); }
        finally { selecting = false; }
        drawBastardLoopKWaveform(); syncBastardLoopKUi(); saveState();
    }
    function change(index, setting, value) {
        if (!Number.isInteger(index) || index < 0 || index > 4 || !['steps', 'level', 'mute', 'pan'].includes(setting)) throw new Error('Invalid K track control.');
        if (setting !== 'mute' && !Number.isFinite(Number(value))) throw new Error('Enter a valid K track value.');
        if (busy()) throw new Error('Finish or cancel the current K take before editing its tracks.');
        if (window.mygrainCardHistory?.busy) throw new Error('Wait for the current sound change to finish.');
        const apply = () => {
            stash(); const track = recorder.tracks[index];
            if (setting === 'steps') {
                value = Number(value); if (!Number.isSafeInteger(value) || value < 1) throw new Error('Enter a positive whole number of steps.');
                const previous = track.steps;
                track.steps = value; track.padded = track.paddedSource = null;
                // Preflight a longer, silence-padded period before touching playback.
                try { recorder.bufferFor(track); } catch (error) { track.steps = previous; throw error; }
                aliases(); if (bastardLoopPlaying) recorder.start();
            } else if (setting === 'mute') track.mute = Boolean(value);
            else track[setting] = Math.max(setting === 'pan' ? -1 : 0, Math.min(1, Number(value)));
            recorder.mix(); syncBastardLoopKUi(); saveState();
        };
        return window.mygrainCardHistory ? window.mygrainCardHistory.run(`K${index + 1} ${setting}`, apply, false, false, true) : apply();
    }
    const original = { sync: syncBastardLoopKUi, stop: stopBastardLoopK, steps: setBastardLoopKRecordingSteps,
        tempo: syncBastardLoopKTempo, record: beginBastardLoopKRecording, clear: clearBastardLoopK,
        restore: restoreState, preset: applyPreset, solos: syncLoopLayerSoloButtons };
    syncBastardLoopKUi = function () { original.sync(); sync(); };
    syncLoopLayerSoloButtons = function () { original.solos(); sync(); };
    startBastardLoopK = function (time = null, options = {}) { stash(); const result = recorder.start(time); if (!options.skipUi) syncBastardLoopKUi(); return result; };
    stopBastardLoopK = function (options = {}) { recorder.stop(options); if (!options.skipUi) syncBastardLoopKUi(); };
    syncBastardLoopKTempo = function () { syncBastardLoopKInfo(); recorder.tempo(); };
    updateBastardLoopKMix = function () {
        if (bastardLoopPlaying && recorder.hasAudio() && !recorder.voices.size && getBastardLoopKLevelValue() > 0) recorder.start();
        else if (!bastardLoopPlaying) recorder.stop();
        recorder.mix(); syncBastardLoopKUi();
    };
    rerenderBastardLoopKFromRaw = function (options = {}) {
        if (restoring) return bastardLoopKBuffer;
        stash(); rebuild(); if (bastardLoopPlaying && recorder.hasAudio()) recorder.start();
        drawBastardLoopKWaveform(); if (!options.skipUi) syncBastardLoopKUi(); return bastardLoopKBuffer;
    };
    setBastardLoopKRecordingSteps = function (value, options = {}) {
        const result = original.steps(value, { ...options, skipSave: true });
        if (restoring) return result;
        recorder.tracks[recorder.selected].steps = bastardLoopKRecordingSteps;
        recorder.tracks[recorder.selected].padded = recorder.tracks[recorder.selected].paddedSource = null;
        if (bastardLoopPlaying && !restoring) recorder.start(); sync(); if (!options.skipSave) saveState(); return result;
    };
    clearBastardLoopK = async function (options = {}) {
        if (preparingRecord || bastardLoopKRecordingState === 'processing') return false;
        if (busy()) cancelBastardLoopKRecording({ silent: true });
        if (activeSourceCardAuditionKind === 'bastardk') stopSourceCardAudition();
        recorder.setBuffer(recorder.selected, null); recorder.setBuffer(recorder.selected, null, true);
        recorder.tracks[recorder.selected].metadata = null; aliases();
        await persistSelected(); if (bastardLoopPlaying) recorder.start();
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
            restoreSettings({ ...state?.modes, bastardLoopKRecordingSteps }, options.songSnapshot === true);
            if (bastardLoopPlaying && !options.songSnapshot) recorder.start();
        }
        return result;
    };
    applyPreset = function (preset, ...args) {
        const modes = preset.modes || preset;
        if (modes.kMultitrack) theory.normalize(modes.kMultitrack);
        stash(); restoring = true; let result;
        try { result = original.preset(preset, ...args); } finally { restoring = false; }
        restoreSettings(modes.kMultitrack ? modes : { ...modes, kMultitrack: recorder.settings() }, false);
        if (bastardLoopPlaying) recorder.start();
        saveState(); return result;
    };
    const api = {
        tracks: recorder.tracks, get selected() { return recorder.selected; }, get voices() { return recorder.voices; },
        hasAudio: () => recorder.hasAudio(), select, change, sync, persistSelected,
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
            restoreSettings({ ...state.modes, bastardLoopKRecordingSteps });
            drawBastardLoopKWaveform(); syncBastardLoopKUi();
        }
    };
    window.mygrainKMultitrack = api;
    const form = document.getElementById('kMultitrackTracks');
    if (form) {
        for (let index = 0; index < 5; index++) {
            const row = document.createElement('section'); row.dataset.kTrack = index; row.className = 'k-recorder-track';
            row.setAttribute('aria-label', `K track ${index + 1}`);
            row.innerHTML = `<div class="k-track-heading"><strong>K${index + 1}</strong><span data-k-track-status>Empty</span></div>
                <label><input type="radio" name="kRecordTrack" data-k-record-select aria-label="Record select K${index + 1}"> Record select</label>
                <label><input type="checkbox" data-k-mute aria-label="Mute K${index + 1}"> Mute</label>
                <label>Level <output data-k-level-value>100%</output><input type="range" min="0" max="100" value="100" data-k-level aria-label="K${index + 1} level"></label>
                <div class="k-track-vu" data-k-track-meter="${index}" role="meter" aria-label="K${index + 1} output level" aria-valuemin="-60" aria-valuemax="0" aria-valuenow="-60" aria-valuetext="Silent">
                    <div class="k-track-vu-head"><span>VU</span><span data-k-vu-value>−∞</span></div>
                    <div class="k-track-vu-bar" aria-hidden="true"><div class="k-track-vu-fill" data-k-vu-fill></div><div class="k-track-vu-peak" data-k-vu-peak></div></div>
                </div>
                <label>Pan <output data-k-pan-value>C</output><input type="range" min="-100" max="100" value="0" data-k-pan aria-label="K${index + 1} pan"></label>
                <label>Loop steps<input type="number" min="1" step="1" inputmode="numeric" data-k-steps aria-label="K${index + 1} loop length in steps"></label>`;
            row.querySelector('[data-k-record-select]').addEventListener('change', () => safe(() => select(index)));
            for (const [selector, key] of [['[data-k-mute]', 'mute'], ['[data-k-level]', 'level'], ['[data-k-pan]', 'pan'], ['[data-k-steps]', 'steps']]) {
                const update = event => safe(() => change(index, key, key === 'mute' ? event.target.checked : Number(event.target.value) / (key === 'level' || key === 'pan' ? 100 : 1)));
                row.querySelector(selector).addEventListener('change', update);
                if (key === 'level' || key === 'pan') row.querySelector(selector).addEventListener('input', update);
            }
            form.append(row);
        }
        for (const event of ['keydown', 'keyup']) form.addEventListener(event, event => event.stopPropagation());
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
