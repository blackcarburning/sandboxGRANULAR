const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createKeyboardPlayer } = require('../q-card.js');

const html = fs.readFileSync(process.env.MYGRAIN_ARP_SOURCE || path.join(__dirname, '../index.html'), 'utf8');
const transportStartBufferSeconds = Number(html.match(/const TRANSPORT_START_BUFFER_SECONDS = ([\d.]+);/)[1]);

function useRealTransportTiming(context) {
    context.TRANSPORT_START_BUFFER_SECONDS = transportStartBufferSeconds;
    context.SCHEDULE_AHEAD_TIME = Number(html.match(/const SCHEDULE_AHEAD_TIME = ([\d.]+);/)[1]);
    vm.runInContext([
        'getBufferedTransportStartTime', 'getTransportGridPosition', 'setTransportEpoch',
        'getSharedLoopTransportOriginTime', 'getTransportLoopOriginTime', 'withBufferedTransportStart',
        'resolveTransportLaneStart', 'getTransportClockBpm', 'getTransportScheduleHorizon',
        'getTransportPreparationLeadSeconds', 'startTransportSource',
        'cancelPreparedTransportStarts', 'startTransportChordLayer'
    ].map(extractFunction).join('\n'), context);
}

function extractFunction(name) {
    let start = html.indexOf(`function ${name}(`);
    if (start < 0) return '';
    if (html.slice(start - 6, start) === 'async ') start -= 6;
    let parentheses = 0;
    let body = -1;
    for (let index = html.indexOf('(', start); index < html.length; index += 1) {
        if (html[index] === '(') parentheses += 1;
        if (html[index] === ')') parentheses -= 1;
        if (html[index] === '{' && parentheses === 0) { body = index; break; }
    }
    let braces = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') braces += 1;
        if (html[index] === '}') braces -= 1;
        if (braces === 0) return html.slice(start, index + 1);
    }
    throw new Error(`Unclosed ${name}`);
}

function element(note = '') {
    const classes = new Set();
    const handlers = new Map();
    return {
        dataset: { note }, handlers,
        classList: {
            add: value => classes.add(value), remove: value => classes.delete(value),
            contains: value => classes.has(value),
            toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); }
        },
        setAttribute() {}, addEventListener: (name, handler) => handlers.set(name, handler),
        hasPointerCapture: () => false, setPointerCapture() {},
        dispatch(name, extra = {}) { handlers.get(name)?.({ preventDefault() {}, pointerId: 1, button: 0, ...extra }); }
    };
}

function fixture(source = 'osc') {
    const keys = ['C4', 'E4', 'G4'].map(element);
    const buttons = new Map(['holdBtn', 'arpBtn', 'seqPlayBtn'].map(id => [id, element()]));
    const timers = new Map();
    let nextTimerId = 1;
    const played = [];
    const samples = new Map();
    const pending = new Map();
    const context = {
        console, window: {}, keys, keyLastTouchTime: new Map(), DOUBLE_TAP_TIMEOUT: 300,
        holdEnabled: false, arpEnabled: false, keyboardArpTransportPlaying: false,
        keyboardPlaybackAuthorized: false,
        keyboardInteractionEpoch: 0, keyboardVoiceOutputs: new Map(),
        restartPerformanceOnFocusReturn: false, restartBastardLoopOnFocusReturn: false, restartDrumMachineOnFocusReturn: false,
        keyboardSoundSource: source, keyboardSoundSelectionToken: 0,
        keyboardSoundReadiness: 'ready', keyboardSoundPreparation: null,
        activeKeyCount: 0, currentGrainNote: null, heldNotes: new Set(),
        activeGrains: new Map(), activeOscVoices: new Map(),
        retiringOscillatorVoices: new Set(), scheduledGrainVoices: new Set(),
        retiredTransportVoices: new Set(), retiredTransportGraphs: new Set(),
        finalKickBypassDelay: null, finalKickBypassMasterGain: null,
        finalKickBypassPanner: null, finalAmplifierNode: null,
        drumMachineDirectDelayLatencyNode: null, drumMachineDirectReverbLatencyNode: null,
        drumMachineDirectDelaySendGainNode: null, drumMachineDirectReverbSendGainNode: null,
        drumMachineBusGainNode: null, drumMachineKickBypassGainNode: null,
        audioSchedulingStats: { lateTicks: 0, skippedSteps: 0, maxLatenessMs: 0 },
        audioContext: { currentTime: 1, sampleRate: 48000 }, granularLayersEnabled: true,
        arpTimerId: null, arpCurrentNote: null, arpNextStepTime: null, arpMode: 'up',
        arpStepIndex: 0, arpDirection: 1, arpLastRandomIndex: null,
        sequencerPlaying: false, transportLoopStartTime: null,
        sequencerBPM: 120, sequencerTimerId: null,
        bastardLoopTransportStartTime: null, drumMachineTransportStartTime: null,
        generatedDryLoopStartTime: null, generatedDrySource: null,
        bastardLoopLTransportActive: false, bastardLoopXTransportActive: false,
        isOutputRecordingArmed: false, generatedLoopTransportEnabled: true,
        bastardLoopPlaying: false, drumMachinePlaying: false,
        bastardLoopBuffer: null, bastardLoop2Buffer: null, bastardLoop3Buffer: null,
        bastardLoopVBuffer: null, bastardLoopPBuffer: null, bastardLoopOBuffer: null,
        bastardLoopXSampleBuffer: null, bastardLoopMBuffer: null, bastardLoopMPlusBuffer: null,
        bastardLoopKBuffer: null, dropboxSampleLayerBuffer: null,
        drumMachineKickPattern: [], drumMachineSnarePattern: [], drumMachineHatPattern: [],
        drumMachinePercPattern: [], drumMachineExtraTracks: {}, finalFxPlacementLfoEnabled: false,
        sidebarTransportLastPressedAt: 0,
        drumMachineReverbTailUntil: 0, delayFeedbackGain: null,
        document: {
            getElementById: id => buttons.get(id),
            querySelectorAll: selector => selector.includes('.key.active') ? keys.filter(key => key.classList.contains('active')) : [],
            querySelector: selector => keys.find(key => selector.includes(`"${key.dataset.note}"`))
        },
        isAudioGraphReady: () => true, ensureAudioReadyForKeyInteraction: async () => true,
        ensureForegroundAudioReady: async () => true,
        notifyKeyboardRepositoryKeyPress: async () => {}, scheduleKeyboardRepositoryRecordingStop() {},
        syncPerformanceControlState() {}, syncKeyboardSoundControls() {},
        syncArpModeControls() {}, normalizeArpMode: value => value,
        ensureSynthVoicePathAudible() {}, warmKeyboardSound() {},
        getKeyboardNoteFrequency: note => ({ C4: 261.626, E4: 329.628, G4: 391.995 })[note],
        getKeyboardNoteMidi: note => 69 + 12 * Math.log2(context.getKeyboardNoteFrequency(note) / 440),
        makePerformanceStreamId: (role, note) => `${role}:${note}`,
        getArpGrainStreamId: note => `arp:${note}`,
        getBufferedTransportStartTime: () => context.audioContext.currentTime,
        resolveTransportLaneStart(referenceTime = null) {
            return { time: Number.isFinite(referenceTime) ? referenceTime : context.getBufferedTransportStartTime(), index: 0 };
        },
        getTransportScheduleHorizon: now => now + .008,
        withBufferedTransportStart(referenceTime, operation) {
            const deadline = Number.isFinite(referenceTime) ? referenceTime : context.audioContext.currentTime + transportStartBufferSeconds;
            context.transportSync.startTime = deadline;
            context.transportSync.depth += 1;
            try {
                return operation(deadline);
            } finally {
                context.transportSync.depth -= 1;
                context.scheduleArpeggiatorPlayback();
            }
        },
        prewarmTransportBuffers() {}, hasSharedRhythmClockWork: () => false,
        ensureSharedRhythmClockRunning() {}, scheduleSequencer() {},
        stopGrainScheduler() {},
        releaseTransportOscillatorVoice() {},
        getTransportLoopOriginTime: () => null, getClickGuardSeconds: () => .008,
        getArpeggiatorStepSeconds: () => .1,
        setTimeout(callback, delay) {
            const timerId = nextTimerId;
            nextTimerId += 1;
            timers.set(timerId, { callback, delay, when: context.audioContext.currentTime + (Number(delay) || 0) / 1000 });
            return timerId;
        },
        clearTimeout: id => timers.delete(id),
        startGrainStream(note, time, velocity, options = {}) {
            if (context.keyboardSoundSource !== 'grain') return;
            const role = options.role || 'keyboard';
            context.activeGrains.set(`${role}:${note}`, { note, role });
            played.push({ source: 'grain', note, role, time, scheduledAt: context.audioContext.currentTime });
        },
        playOscillatorNote(note, time, velocity, options = {}) {
            if (context.keyboardSoundSource !== 'osc') return;
            const role = options.role || 'keyboard';
            context.activeOscVoices.set(`${role}:${note}`, { note, role });
            played.push({ source: 'osc', note, role, time, scheduledAt: context.audioContext.currentTime });
        },
        stopGrainStream: (note, options = {}) => context.activeGrains.delete(options.streamId || `${options.role || 'keyboard'}:${note}`),
        stopOscillatorNote: (note, time, options = {}) => context.activeOscVoices.delete(options.voiceId || `${options.role || 'keyboard'}:${note}`),
        safeDisconnectNode: output => { output.disconnected = true; },
        setStatus() {}, saveState() {}, updateEffects() {}, restartInternalEffectOscillators() {},
        startSequencer() { context.sequencerPlaying = true; return true; },
        stopSequencer() { context.sequencerPlaying = false; },
        startAllBastardLoopLayers: () => true, stopAllBastardLoopLayers() {},
        stopDrumMachine() {}, stopSourceCardAudition() {},
        stopAllGrains() { context.activeGrains.clear(); },
        stopAllOscillators() { context.activeOscVoices.clear(); },
        isBastardLoopLRunning: () => false, isBastardLoopXRunning: () => false,
        isBastardLoopVCutPreviewRunning: () => false, hasPlayableBastardLoopLTransportSource: () => false,
        clearAllPerformanceSoloStates: () => false
    };
    context.keyboardSamplePlayer = {
        voices: samples,
        noteOn: async (key, pitch, options) => {
            samples.set(key, options);
            played.push({ source: options.instrument, note: key.split(':')[1], role: key.split(':')[0], time: options.startTime, scheduledAt: context.audioContext.currentTime });
        },
        noteOff(key) { samples.delete(key); pending.delete(key); },
        stop() { samples.clear(); pending.clear(); }
    };
    context.getKeyboardSamplePlayer = () => context.keyboardSamplePlayer;
    vm.createContext(context);
    vm.runInContext(html.match(/const transportSync = [\s\S]*?;/)[0].replace('const transportSync =', 'globalThis.transportSync ='), context);
    const names = [
        'cancelScheduledTransportOscillators', 'stopScheduledGrainVoices', 'flushTransportBypassDelay',
        'getTransportOutputLatencySeconds', 'resetTransportSynchronization', 'stopRetiredTransportVoices',
        'getTransportClockBpm', 'countMissedAudioSteps', 'retireTransportVoice',
        'flushTransportSendLatency', 'updateTransportSendLatency',
        'normalizeKeyboardSoundSource', 'isKeyboardSoundRole', 'playKeyboardSound', 'stopKeyboardSound',
        'stopKeyboardSounds', 'silenceKeyboardVoiceOutputs', 'stopKeyboardArpTransport', 'setKeyboardSoundSource',
        'selectKeyboardSoundFromUi',
        'getKeyboardActiveNotes', 'getArpeggiatorNotes', 'stopArpeggiatorPlayback', 'isArpeggiatorPlaying',
        'resetArpeggiatorSequenceState', 'getNextArpeggiatorNote', 'scheduleArpeggiatorPlayback',
        'startArpeggiatorPlayback', 'setHoldEnabled', 'setArpeggiatorEnabled', 'setArpMode',
        'rescheduleArpeggiatorPlaybackIfActive', 'stopHeldKeyboardPlaybackPreserveSelection',
        'startHeldKeyboardPlayback', 'playLoopAndHeldKeys', 'stopLoopAndHeldKeys',
        'stopAllPerformancePlayback', 'restartAllTransport', 'handleSidebarTransportToggle',
        'pausePerformanceForFocusLoss', 'resumePerformanceAfterFocusReturn', 'panicAllNotes'
    ];
    vm.runInContext(names.map(extractFunction).join('\n'), context);
    const inputStart = html.indexOf('keys.forEach(key => {');
    vm.runInContext(html.slice(inputStart, html.indexOf('// --- Slider Listeners ---', inputStart)), context);
    const advance = (seconds = .1) => {
        const targetTime = context.audioContext.currentTime + seconds;
        let scheduled = [...timers.entries()].filter(([, timer]) => timer.when <= targetTime).sort((first, second) => first[1].when - second[1].when);
        while (scheduled.length) {
            const [timerId, timer] = scheduled[0];
            context.audioContext.currentTime = timer.when;
            timers.delete(timerId);
            timer.callback();
            scheduled = [...timers.entries()].filter(([, pendingTimer]) => pendingTimer.when <= targetTime).sort((first, second) => first[1].when - second[1].when);
        }
        context.audioContext.currentTime = targetTime;
    };
    const press = async (index = 0) => { keys[index].dispatch('keydown', { key: 'Enter' }); await new Promise(setImmediate); };
    const release = (index = 0) => keys[index].dispatch('keyup', { key: 'Enter' });
    const voices = () => context.activeGrains.size + context.activeOscVoices.size + samples.size + pending.size;
    return { context, keys, timers, played, samples, pending, advance, press, release, voices };
}

function useRealArpClock(context) {
    context.sequencerBPM = 120;
    context.ARP_CLOCK_MULTIPLIER_OPTIONS = [{ value: .5 }, { value: 1 }, { value: 2 }];
    context.arpClockMultiplierIndex = 1;
    context.syncArpClockControls = () => {};
    vm.runInContext(['getArpeggiatorStepSeconds', 'getArpClockMultiplierOption', 'getArpClockMultiplierValue', 'setArpClockMultiplier'].map(extractFunction).join('\n'), context);
}

for (const source of ['osc', 'grain', 'piano', 'strings']) {
    test(`${source}: fresh keys audition only arp before Play and survive Stop/replay`, async () => {
        const setup = fixture(source);
        const { context, played, press, release, advance, voices } = setup;
        context.setArpeggiatorEnabled(true);
        for (const index of [0, 1, 2]) { await press(index); release(index); }
        assert.equal(context.heldNotes.size, 3);
        assert.ok(voices() > 0, 'fresh latched chord must arpeggiate before Play');
        assert.equal(context.sequencerPlaying, false);
        assert.equal(context.bastardLoopPlaying, false);
        assert.equal(context.drumMachinePlaying, false);
        assert.equal(context.holdEnabled, true);
        context.setArpMode('down', { skipSave: true });
        context.rescheduleArpeggiatorPlaybackIfActive();
        context.startHeldKeyboardPlayback();
        for (let step = 0; step < 4; step += 1) advance();
        assert.ok(played.length >= 4);
        assert.ok(played.every(voice => voice.role === 'arp' && voice.source === source));
        context.stopLoopAndHeldKeys({ silent: true });
        assert.equal(voices(), 0);
        assert.equal(context.arpEnabled, true, 'Stop retains arp mode');
        assert.equal(context.heldNotes.size, 3, 'Stop retains chord selection');
        const stoppedCount = played.length;
        context.setArpMode('up', { skipSave: true });
        advance();
        assert.equal(played.length, stoppedCount);
        context.playLoopAndHeldKeys({ silent: true });
        assert.equal(played.at(-1).role, 'arp');
        context.stopAllPerformancePlayback({ silent: true });
        assert.equal(voices(), 0);
        assert.equal(context.arpEnabled, true);
        advance();
        assert.equal(voices(), 0);
    });

    test(`${source}: enabling arp immediately replaces sounding held notes without a drone`, async () => {
        const { context, played, press, release, voices } = fixture(source);
        context.setHoldEnabled(true);
        await press(); release();
        assert.ok(voices() > 0);
        context.setArpeggiatorEnabled(true);
        assert.equal(voices(), 1);
        assert.equal(context.sequencerPlaying, false);
        assert.equal(played.at(-1).role, 'arp');
        assert.equal(context.heldNotes.size, 1);
        const before = played.length;
        context.setArpeggiatorEnabled(true);
        assert.ok(played.length >= before);
        assert.equal(voices(), 1);
        assert.equal(played.at(-1).role, 'arp');
    });
}

test('Stop cancels pending audio/recording gestures and ignores physical releases from the old epoch', async () => {
    const { context, press, release, played, voices } = fixture();
    context.setArpeggiatorEnabled(true);
    context.playLoopAndHeldKeys({ silent: true });
    let finishAudio;
    context.ensureAudioReadyForKeyInteraction = () => new Promise(resolve => { finishAudio = resolve; });
    const gesture = press();
    context.stopAllPerformancePlayback({ silent: true });
    finishAudio(true);
    await gesture;
    assert.equal(played.length, 0);
    release();
    assert.equal(context.heldNotes.size, 0);
    context.ensureAudioReadyForKeyInteraction = async () => true;
    await press();
    const selectedBeforeStop = [...context.heldNotes];
    context.stopAllPerformancePlayback({ silent: true });
    release();
    assert.deepEqual([...context.heldNotes], selectedBeforeStop, 'old release cannot alter the selected chord after Stop');
    assert.equal(voices(), 0);
    const stoppedCount = played.length;
    let finishRecording;
    context.notifyKeyboardRepositoryKeyPress = () => new Promise(resolve => { finishRecording = resolve; });
    const recordingGesture = press();
    await new Promise(setImmediate);
    context.stopAllPerformancePlayback({ silent: true });
    finishRecording();
    await recordingGesture;
    await new Promise(setImmediate);
    assert.equal(played.length, stoppedCount);
});

test('rapid overlapping releases, unlatching, Hold off and sound changes cannot resurrect direct voices', async () => {
    const { context, keys, press, release, played, voices, advance } = fixture('strings');
    context.setArpeggiatorEnabled(true);
    context.playLoopAndHeldKeys({ silent: true });
    await press(); release();
    keys[0].dispatch('pointerup'); keys[0].dispatch('touchend');
    assert.equal(context.heldNotes.size, 1);
    await press(); release();
    assert.equal(context.heldNotes.size, 0);
    advance();
    assert.equal(voices(), 0);
    context.setKeyboardSoundSource('piano');
    await press(1);
    context.setKeyboardSoundSource('osc');
    release(1);
    assert.deepEqual([...context.heldNotes], ['E4'], 'a pressed arp key remains selected across source changes');
    context.setHoldEnabled(false);
    assert.equal(context.arpEnabled, false);
    assert.equal(context.keyboardArpTransportPlaying, false);
    assert.ok(played.every(voice => voice.role === 'arp'));
    assert.equal(voices(), 0);
});

test('Stop All kills pending sampled requests and output tails, not just the current arp note', () => {
    const { context, pending, voices } = fixture('piano');
    context.setArpeggiatorEnabled(true);
    context.heldNotes.add('C4');
    context.playLoopAndHeldKeys({ silent: true });
    pending.set('arp:G4', {});
    const output = { gain: { cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } } };
    context.keyboardVoiceOutputs.set(output, { note: 'G4', role: 'arp' });
    context.stopAllPerformancePlayback({ silent: true });
    assert.equal(voices(), 0);
    assert.equal(output.gain.value, 0);
    assert.equal(output.disconnected, true);
    assert.equal(context.keyboardVoiceOutputs.size, 0);
});

test('keyboard-only Stop leaves non-keyboard voices and independent Q backing owned by their transports', () => {
    const { context } = fixture();
    context.activeGrains.set('sequencer:C4', { role: 'sequencer', note: 'C4' });
    context.activeOscVoices.set('loopL:E4', { role: 'loopL', note: 'E4' });
    let backingStops = 0;
    context.window.mygrainQ = { hasAudio: () => true, stop: () => { backingStops += 1; } };
    context.stopLoopAndHeldKeys({ silent: true });
    assert.equal(context.activeGrains.size, 1);
    assert.equal(context.activeOscVoices.size, 1);
    assert.equal(backingStops, 0);
});

test('visible sidebar Start arms an empty keyboard arp; automatic global restarts do not', async () => {
    const { context, press, release, played } = fixture();
    context.setArpeggiatorEnabled(true);
    context.restartAllTransport({ silent: true });
    assert.equal(played.length, 0);
    assert.equal(context.keyboardArpTransportPlaying, false);
    context.handleSidebarTransportToggle();
    assert.equal(context.keyboardArpTransportPlaying, true);
    await press(); release();
    assert.equal(played.at(-1).role, 'arp');
    context.handleSidebarTransportToggle();
    assert.equal(context.keyboardArpTransportPlaying, false);
    assert.equal(context.arpEnabled, true);
});

test('both visible build markers identify NAV.1 while transport and keyboard cachebusters retain their own versions', () => {
    assert.equal((html.match(/Build <strong>v2026\.10\.19\.NAV\.1<\/strong>/g) || []).length, 2);
    assert.match(html, /song-beta-clock\.js\?v=20261018-transport-sync-1/);
    assert.match(html, /q-card\.js\?v=20261016-k-keyboard-19/);
    assert.match(html, /const cacheBuster = '2026-10-19-desktop-nav-startup-1'/);
});

for (const source of ['osc', 'grain', 'piano', 'strings']) {
    for (const [down, up] of [['keydown', 'keyup'], ['pointerdown', 'pointerup'], ['touchstart', 'touchend']]) {
        for (const stage of ['audio', 'recording']) {
            test(`${source}: Hold retains quick ${down} release during ${stage} startup and can unlatch`, async () => {
                const { context, keys, voices } = fixture(source);
                context.setHoldEnabled(true);
                let finish;
                const pending = new Promise(resolve => { finish = resolve; });
                const method = stage === 'audio' ? 'ensureAudioReadyForKeyInteraction' : 'notifyKeyboardRepositoryKeyPress';
                context[method] = () => pending;
                keys[0].dispatch(down, { key: 'Enter' });
                if (stage === 'recording') await new Promise(setImmediate);
                keys[0].dispatch(up, { key: 'Enter' });
                finish(true);
                await new Promise(setImmediate);
                assert.equal(voices(), 1);
                assert.equal(context.heldNotes.has('C4'), true);
                assert.equal(context.activeKeyCount, 0, 'released pending key must latch without remaining physically down');
                keys[0].dispatch(up, { key: 'Enter' });
                assert.equal(voices(), 1, 'duplicate release cannot cancel Hold');
                context[method] = async () => true;
                keys[0].dispatch('keydown', { key: 'Enter' });
                await new Promise(setImmediate);
                keys[0].dispatch('keyup', { key: 'Enter' });
                assert.equal(context.heldNotes.size, 0);
                assert.equal(voices(), 0);
            });
        }
    }

    test(`${source}: active arp can become Hold sustain, but arp toggles cannot undo Stop`, async () => {
        const { context, press, release, played, voices, advance } = fixture(source);
        context.setArpeggiatorEnabled(true);
        for (const index of [0, 1, 2]) { await press(index); release(index); }
        assert.equal(voices(), 1);
        const arpCount = played.length;
        context.setArpeggiatorEnabled(false);
        assert.equal(context.holdEnabled, true);
        assert.equal(context.keyboardArpTransportPlaying, false);
        assert.equal(voices(), 3);
        assert.ok(played.slice(arpCount).every(voice => voice.role === 'keyboard' && voice.source === source));
        context.setArpeggiatorEnabled(true);
        assert.equal(voices(), 1, 're-enabling arp auditions only its single voice');
        context.stopLoopAndHeldKeys({ silent: true });
        assert.equal(voices(), 0);
        context.setArpeggiatorEnabled(false);
        assert.equal(voices(), 0, 'arp-off cannot restore a chord silenced by Stop');
        context.setArpeggiatorEnabled(true);
        assert.equal(voices(), 0, 'arp-on cannot restore a chord silenced by Stop');
        context.playLoopAndHeldKeys({ silent: true });
        advance(transportStartBufferSeconds);
        assert.equal(voices(), 1);
        context.setHoldEnabled(false);
        assert.equal(voices(), 0);
    });
}

for (const action of ['stop', 'hold-off', 'source']) {
    for (const stage of ['audio', 'recording']) {
        test(`${action} invalidates a quick Hold release still pending ${stage} startup`, async () => {
            const { context, keys, played, voices } = fixture('strings');
            context.setHoldEnabled(true);
            let finish;
            const pending = new Promise(resolve => { finish = resolve; });
            const method = stage === 'audio' ? 'ensureAudioReadyForKeyInteraction' : 'notifyKeyboardRepositoryKeyPress';
            context[method] = () => pending;
            keys[0].dispatch('keydown', { key: 'Enter' });
            if (stage === 'recording') await new Promise(setImmediate);
            keys[0].dispatch('keyup', { key: 'Enter' });
            if (action === 'stop') context.stopAllPerformancePlayback({ silent: true });
            if (action === 'hold-off') context.setHoldEnabled(false);
            if (action === 'source') context.setKeyboardSoundSource('piano');
            finish(true);
            await new Promise(setImmediate);
            assert.equal(voices(), 0);
            assert.equal(played.length, 0);
            assert.equal(context.heldNotes.size, 0);
        });
    }
}

test('a quick pending Hold tap under arp auditions as soon as ready and stays silent after Stop', async () => {
    const { context, keys, played, voices } = fixture('strings');
    context.setArpeggiatorEnabled(true);
    let finish;
    context.ensureAudioReadyForKeyInteraction = () => new Promise(resolve => { finish = resolve; });
    keys[0].dispatch('pointerdown');
    keys[0].dispatch('pointerup');
    finish(true);
    await new Promise(setImmediate);
    assert.equal(context.heldNotes.size, 1);
    assert.ok(voices() > 0);
    assert.equal(context.sequencerPlaying, false);
    assert.ok(played.every(voice => voice.role === 'arp'));
    context.stopLoopAndHeldKeys({ silent: true });
    assert.equal(voices(), 0);
});

for (const source of ['osc', 'grain', 'piano', 'strings']) {
    test(`${source}: Hold-off after Stop/Play clears restored keyboard voices but preserves independent sequencer audio`, async () => {
        const { context, press, release, samples } = fixture(source);
        context.setHoldEnabled(true);
        await press(); release();
        context.stopLoopAndHeldKeys({ silent: true });
        context.playLoopAndHeldKeys({ silent: true });
        assert.equal(context.sequencerPlaying, true, 'Play starts the independent loop as well as restoring held keys');
        const output = { gain: { cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } } };
        context.keyboardVoiceOutputs.set(output, { note: 'C4', role: 'keyboard' });
        context.activeOscVoices.set('sequencer:E3', { note: 'E3', role: 'sequencer' });
        context.activeGrains.set('sequencer:E3', { note: 'E3', role: 'sequencer' });
        context.setHoldEnabled(false);
        assert.equal(context.heldNotes.size, 0);
        assert.equal(context.activeKeyCount, 0);
        assert.equal(samples.size, 0);
        assert.equal(context.keyboardVoiceOutputs.size, 0);
        assert.equal(output.gain.value, 0);
        assert.equal(output.disconnected, true);
        assert.deepEqual([...context.activeOscVoices.keys()], ['sequencer:E3']);
        assert.deepEqual([...context.activeGrains.keys()], ['sequencer:E3']);
        assert.equal(context.sequencerPlaying, true, 'Hold-off must not mute backing transport');
    });
}

test('Play without a chord stays armed for future notes, and Stop disarms it without disabling arp', async () => {
    const { context, press, release, played, voices } = fixture('piano');
    context.setArpeggiatorEnabled(true);
    context.playLoopAndHeldKeys({ silent: true });
    assert.equal(context.isArpeggiatorPlaying(), true);
    assert.equal(voices(), 0);
    await press(); release();
    assert.ok(played.length > 0);
    assert.ok(played.every(voice => voice.role === 'arp'));
    context.stopAllPerformancePlayback({ silent: true });
    assert.equal(context.isArpeggiatorPlaying(), false);
    assert.equal(context.arpEnabled, true);
    assert.equal(voices(), 0);
});

test('the shared keyboard voice entrypoint rejects direct arp-mode voices and unauthorized arp callbacks', () => {
    const { context, played, voices } = fixture();
    context.setArpeggiatorEnabled(true);
    context.playKeyboardSound('C4');
    context.playKeyboardSound('C4', null, 1, { role: 'arp' });
    assert.equal(played.length, 0);
    context.playLoopAndHeldKeys({ silent: true });
    context.playKeyboardSound('C4');
    assert.equal(played.length, 0);
    context.playKeyboardSound('C4', null, 1, { role: 'arp' });
    assert.equal(voices(), 1);
    context.stopLoopAndHeldKeys({ silent: true });
    context.playKeyboardSound('C4', null, 1, { role: 'arp' });
    assert.equal(voices(), 0);
});

test('focus recovery resumes a gestured arp audition, but cannot undo Stop', async () => {
    const { context, press, release, played, voices } = fixture();
    context.setArpeggiatorEnabled(true);
    await press();
    context.pausePerformanceForFocusLoss();
    await context.resumePerformanceAfterFocusReturn();
    assert.ok(played.length > 0);
    assert.equal(context.keyboardArpTransportPlaying, true);
    assert.equal(context.sequencerPlaying, false);
    release();
    context.playLoopAndHeldKeys({ silent: true });
    context.pausePerformanceForFocusLoss();
    let finishResume;
    context.ensureForegroundAudioReady = () => new Promise(resolve => { finishResume = resolve; });
    const resume = context.resumePerformanceAfterFocusReturn();
    context.stopAllPerformancePlayback({ silent: true });
    const count = played.length;
    finishResume(true);
    await resume;
    assert.equal(played.length, count);
    assert.equal(voices(), 0);
    assert.equal(context.keyboardArpTransportPlaying, false);
});

for (const source of ['osc', 'grain', 'piano', 'strings']) {
    for (const [down, up] of [['keydown', 'keyup'], ['pointerdown', 'pointerup'], ['touchstart', 'touchend']]) {
        test(`${source}: ${down} auditions arp before Play without starting any backing transport`, async () => {
            const { context, keys, played, voices } = fixture(source);
            const rejectBacking = () => assert.fail('keyboard audition must not start backing transport');
            context.startSequencer = rejectBacking;
            context.startAllBastardLoopLayers = rejectBacking;
            context.startDrumMachine = rejectBacking;
            context.window.mygrainQ = { start: rejectBacking, play: rejectBacking };
            context.setArpeggiatorEnabled(true);
            keys[0].dispatch(down, { key: 'Enter' });
            await new Promise(setImmediate);
            assert.equal(voices(), 1, 'note sounds on key-down, not only after release');
            keys[0].dispatch(up, { key: 'Enter' });
            assert.equal(voices(), 1);
            assert.equal(context.heldNotes.has('C4'), true);
            assert.equal(context.holdEnabled, true);
            assert.ok(played.every(voice => voice.role === 'arp' && voice.source === source));
            assert.equal(context.sequencerPlaying, false);
            assert.equal(context.bastardLoopPlaying, false);
            assert.equal(context.drumMachinePlaying, false);
        });
    }

    test(`${source}: keyboard-only arp follows existing BPM and multiplier without changing either`, async () => {
        const { context, press, release, played, advance, timers } = fixture(source);
        useRealArpClock(context);
        context.setArpeggiatorEnabled(true);
        await press(); release();
        for (const [bpm, multiplier, seconds] of [[120, 1, .125], [80, 1, .1875], [80, 2, .09375]]) {
            context.sequencerBPM = bpm;
            context.setArpClockMultiplier(multiplier, { skipSave: true });
            context.rescheduleArpeggiatorPlaybackIfActive();
            advance(Math.max(0, context.arpNextStepTime - context.audioContext.currentTime));
            const previous = played.at(-1).time;
            assert.equal([...timers.values()].at(-1).delay, 8);
            advance(seconds);
            assert.equal(played.at(-1).time - previous, seconds);
            assert.equal(context.sequencerBPM, bpm);
            assert.equal(context.getArpClockMultiplierValue(), multiplier);
        }
        assert.equal(context.sequencerPlaying, false);
    });

    for (const action of ['stopLoopAndHeldKeys', 'stopAllPerformancePlayback', 'panicAllNotes']) {
        test(`${source}: ${action} stays silent through settings and stale callbacks until a fresh key`, async () => {
            const { context, press, release, played, advance, timers, voices } = fixture(source);
            useRealArpClock(context);
            context.setArpeggiatorEnabled(true);
            await press(); release();
            const stale = [...timers.values()];
            context.pausePerformanceForFocusLoss();
            context[action]({ silent: true, immediate: true });
            await context.resumePerformanceAfterFocusReturn();
            const stoppedCount = played.length;
            assert.equal(voices(), 0);
            assert.equal(context.keyboardArpTransportPlaying, false);
            assert.equal(context.keyboardPlaybackAuthorized, false);
            context.setArpMode('down', { skipSave: true });
            context.sequencerBPM = 80;
            context.setArpClockMultiplier(2, { skipSave: true });
            context.rescheduleArpeggiatorPlaybackIfActive();
            context.setArpeggiatorEnabled(false);
            context.setArpeggiatorEnabled(true);
            context.setHoldEnabled(true);
            for (const timer of stale) timer.callback();
            advance();
            assert.equal(voices(), 0);
            assert.equal(played.length, stoppedCount);
            await press(1); release(1);
            assert.ok(voices() > 0);
            assert.ok(played.slice(stoppedCount).every(voice => voice.role === 'arp'));
            assert.equal(context.sequencerPlaying, false);
        });
    }
}

function coldSamplePlayer(context) {
    const sources = [];
    const output = {};
    const capture = {};
    const node = properties => ({
        connect() {}, disconnect() { this.disconnected = true; }, ...properties
    });
    Object.assign(context.audioContext, {
        state: 'running', sampleRate: 48000,
        createBufferSource() {
            const source = node({ playbackRate: {}, start() { this.started = true; }, stop() { this.stopped = true; } });
            sources.push(source);
            return source;
        },
        createGain: () => node({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } })
    });
    const player = createKeyboardPlayer({ context: () => context.audioContext, output: () => output, capture: () => capture });
    let finish;
    let ready = false;
    const loading = new Promise(resolve => { finish = () => { ready = true; resolve(); }; });
    const selected = { sample: { midi: 60 }, buffer: { length: 480000, numberOfChannels: 2 }, duration: 10, offset: 0, loopStart: .1, loopEnd: 1 };
    for (const { piano } of player.samplers.values()) {
        piano.segment = () => ready ? selected : null;
        piano.ensure = () => loading;
        piano.source = () => selected;
    }
    context.keyboardSamplePlayer = player;
    return { player, sources, finish };
}

for (const from of ['osc', 'grain', 'piano', 'strings']) {
    for (const to of ['osc', 'grain', 'piano', 'strings'].filter(source => source !== from)) {
        for (const playing of [true, false]) {
            for (const action of ['setKeyboardSoundSource', 'selectKeyboardSoundFromUi']) {
                test(`${from} → ${to}: ${action} preserves ${playing ? 'playing' : 'stopped'} arp chord, highlights and clock`, async () => {
                    const { context, keys, press, release, advance, played, voices, timers } = fixture(from);
                    useRealArpClock(context);
                    context.sequencerBPM = 93;
                    context.arpClockMultiplierIndex = 2;
                    context.prepareKeyboardSound = async () => {};
                    const rejectBacking = () => assert.fail('switching arp sources must not start backing');
                    context.startSequencer = rejectBacking;
                    context.startAllBastardLoopLayers = rejectBacking;
                    context.startDrumMachine = rejectBacking;
                    context.window.mygrainQ = { start: rejectBacking, play: rejectBacking, stop: rejectBacking };
                    context.setArpeggiatorEnabled(true);
                    for (const index of [0, 1, 2]) { await press(index); release(index); }
                    if (!playing) context.stopLoopAndHeldKeys({ silent: true });
                    const selection = context.heldNotes;
                    const selected = [...selection];
                    const highlighted = keys.map(key => key.classList.contains('active'));
                    const clock = [context.arpTimerId, context.arpNextStepTime, context.arpStepIndex, context.arpDirection, context.arpLastRandomIndex, context.transportLoopStartTime];
                    const epoch = context.keyboardInteractionEpoch;
                    const count = played.length;
                    await context[action](to);
                    assert.equal(context.keyboardSoundSource, to);
                    assert.equal(context.heldNotes, selection);
                    assert.deepEqual([...context.heldNotes], selected);
                    assert.deepEqual(keys.map(key => key.classList.contains('active')), highlighted);
                    assert.deepEqual([context.arpTimerId, context.arpNextStepTime, context.arpStepIndex, context.arpDirection, context.arpLastRandomIndex, context.transportLoopStartTime], clock);
                    assert.equal(context.keyboardInteractionEpoch, epoch);
                    assert.equal(context.keyboardArpTransportPlaying, playing);
                    assert.equal(context.keyboardPlaybackAuthorized, playing);
                    assert.equal(context.holdEnabled, true);
                    assert.equal(context.arpEnabled, true);
                    assert.equal(context.sequencerBPM, 93);
                    assert.equal(context.getArpClockMultiplierValue(), 2);
                    assert.equal(voices(), 0, 'outgoing voices are immediately silenced');
                    assert.equal(timers.size, playing ? 1 : 0);
                    advance(context.getArpeggiatorStepSeconds());
                    if (playing) {
                        assert.equal(voices(), 1);
                        assert.equal(played.at(-1).source, to);
                    } else {
                        assert.equal(voices(), 0);
                        assert.equal(played.length, count);
                        context.playLoopAndHeldKeys({ silent: true });
                        advance(transportStartBufferSeconds);
                        assert.equal(played.at(-1).source, to);
                    }
                    assert.ok(played.every(voice => voice.role === 'arp'));
                    assert.equal(context.sequencerPlaying, false);
                    assert.equal(context.bastardLoopPlaying, false);
                    assert.equal(context.drumMachinePlaying, false);
                    context.stopLoopAndHeldKeys({ silent: true });
                    assert.deepEqual([...context.heldNotes], selected);
                    assert.deepEqual(keys.map(key => key.classList.contains('active')), highlighted);
                    context.panicAllNotes({ immediate: true });
                    advance();
                    assert.equal(voices(), 0);
                    assert.equal(context.heldNotes.size, 0);
                    assert.ok(keys.every(key => !key.classList.contains('active')));
                });
            }
        }

        test(`${from} → ${to}: physically pressed arp keys latch on keydown and survive switching`, async () => {
            const { context, keys, press, release, advance, played } = fixture(from);
            context.setArpeggiatorEnabled(true);
            await press(); release();
            await press(1);
            const epoch = context.keyboardInteractionEpoch;
            context.setKeyboardSoundSource(to);
            assert.equal(context.activeKeyCount, 1);
            assert.equal(context.keyboardInteractionEpoch, epoch);
            assert.deepEqual([...context.heldNotes], ['C4', 'E4']);
            assert.ok(keys[0].classList.contains('active'));
            assert.ok(keys[1].classList.contains('active'));
            advance();
            assert.equal(played.at(-1).source, to);
            release(1);
            assert.equal(context.activeKeyCount, 0);
            assert.deepEqual([...context.heldNotes], ['C4', 'E4']);
            assert.ok(played.every(voice => voice.role === 'arp'));
            context.stopLoopAndHeldKeys({ silent: true });
            await press(2); release(2);
            assert.equal(context.keyboardArpTransportPlaying, true, 'a fresh chord still auditions after Stop');
            assert.equal(played.at(-1).source, to);
            context.panicAllNotes({ immediate: true });
        });

        test(`${from} → ${to}: arp-off Hold keeps K.12 source-change cleanup and fresh-key behavior`, async () => {
            const { context, keys, press, release, voices, played } = fixture(from);
            context.setHoldEnabled(true);
            await press(); release();
            assert.equal(voices(), 1);
            context.setKeyboardSoundSource(to);
            assert.equal(context.holdEnabled, true);
            assert.equal(context.arpEnabled, false);
            assert.equal(context.heldNotes.size, 0);
            assert.equal(voices(), 0);
            assert.ok(keys.every(key => !key.classList.contains('active')));
            await press(1); release(1);
            assert.deepEqual([...context.heldNotes], ['E4']);
            assert.equal(played.at(-1).source, to);
            assert.equal(played.at(-1).role, 'keyboard');
            context.panicAllNotes({ immediate: true });
        });
    }
}

for (const finalSource of ['osc', 'grain', 'piano', 'strings']) {
    for (const playing of [true, false]) {
        test(`rapid UI switches and late loads preserve ${playing ? 'active' : 'stopped'} arp on ${finalSource}`, async () => {
            const { context, press, release, advance, played, keys } = fixture('piano');
            const { player, sources, finish } = coldSamplePlayer(context);
            const prepare = vm.runInContext(`(${extractFunction('prepareKeyboardSound')})`, context);
            context.getKeyboardSamplePitches = () => [60, 64, 67];
            context.prepareKeyboardSound = source => ['piano', 'strings'].includes(source) ? prepare(source) : Promise.resolve();
            context.setArpeggiatorEnabled(true);
            for (const index of [0, 1, 2]) { await press(index); release(index); }
            if (!playing) context.stopLoopAndHeldKeys({ silent: true });
            const oldRequests = [...player.pending.values()];
            const selections = [];
            for (const source of ['strings', 'piano', 'osc', 'grain', 'strings', 'piano', finalSource]) {
                selections.push(context.selectKeyboardSoundFromUi(source));
                await new Promise(setImmediate);
                advance();
            }
            assert.ok(oldRequests.every(request => player.pending.get(request.key) !== request));
            finish();
            await Promise.all(selections);
            await new Promise(setImmediate);
            advance();
            await new Promise(setImmediate);
            assert.equal(context.keyboardSoundSource, finalSource);
            assert.equal(context.keyboardArpTransportPlaying, playing);
            assert.deepEqual([...context.heldNotes], ['C4', 'E4', 'G4']);
            assert.ok(keys.every(key => key.classList.contains('active')));
            assert.ok([...player.activeVoices].every(voice => voice.instrument === finalSource && voice.key.startsWith('arp:')));
            assert.equal(player.pending.size, 0);
            if (playing && ['piano', 'strings'].includes(finalSource)) {
                assert.equal([...player.activeVoices].filter(voice => !voice.released).length, 1);
            } else {
                assert.equal(sources.length, 0, 'late superseded samples cannot create old-source voices');
            }
            if (playing && ['osc', 'grain'].includes(finalSource)) assert.equal(played.at(-1).source, finalSource);
            assert.ok(played.every(voice => voice.role === 'arp'));
            context.panicAllNotes({ immediate: true });
            assert.equal(player.activeVoices.size, 0);
            assert.equal(player.pending.size, 0);
        });
    }
}

test('arp source cleanup silences keyboard tails and pending loads without touching Q, K or independent voices', async () => {
    const { context, press, release, pending, samples } = fixture('strings');
    context.setArpeggiatorEnabled(true);
    await press(); release();
    context.activeGrains.set('sequencer:C4', { note: 'C4', role: 'sequencer' });
    context.activeOscVoices.set('loopL:E4', { note: 'E4', role: 'loopL' });
    const isolated = { q: { playing: true, instrument: 'piano', mix: .23, solo: true }, k: { recording: 'recording', buffer: {} } };
    context.window.mygrainQ = isolated.q;
    context.bastardLoopKRecordingState = isolated.k.recording;
    context.bastardLoopKBuffer = isolated.k.buffer;
    const before = JSON.stringify(isolated);
    pending.set('arp:G4', {});
    const output = { gain: { cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } } };
    context.keyboardVoiceOutputs.set(output, { role: 'arp', note: 'G4' });
    context.setKeyboardSoundSource('piano');
    assert.equal(samples.size, 0);
    assert.equal(pending.size, 0);
    assert.equal(output.gain.value, 0);
    assert.equal(output.disconnected, true);
    assert.equal(context.keyboardVoiceOutputs.size, 0);
    assert.deepEqual([...context.activeGrains.keys()], ['sequencer:C4']);
    assert.deepEqual([...context.activeOscVoices.keys()], ['loopL:E4']);
    assert.equal(JSON.stringify(isolated), before);
    assert.equal(context.bastardLoopKRecordingState, isolated.k.recording);
    assert.equal(context.bastardLoopKBuffer, isolated.k.buffer);
    context.stopLoopAndHeldKeys({ silent: true });
});

test('late grain preparation cannot reroute audio after a newer sampled source selection', async () => {
    const { context } = fixture('osc');
    let finish;
    let reroutes = 0;
    context.getAllGranularSources = () => [];
    context.setGranularLayersEnabled = () => {};
    context.loadBuiltInDemoSample = () => new Promise(resolve => { finish = resolve; });
    context.ensureGranularVoicePathAudible = () => { reroutes += 1; };
    context.getKeyboardSamplePitches = () => [60];
    context.keyboardSamplePlayer.prepare = async () => ({});
    vm.runInContext(extractFunction('prepareKeyboardSound'), context);
    const grain = context.selectKeyboardSoundFromUi('grain');
    await new Promise(setImmediate);
    await context.selectKeyboardSoundFromUi('strings');
    finish();
    await grain;
    assert.equal(context.keyboardSoundSource, 'strings');
    assert.equal(context.keyboardSoundReadiness, 'ready');
    assert.equal(reroutes, 0);
});

for (const source of ['piano', 'strings']) {
    for (const action of ['stop', 'stop-all', 'panic', 'source', 'hold-off', 'arp-off']) {
        test(`${source}: late cold sample completion cannot resurrect canceled arp after ${action}`, async () => {
            const { context, press, release, timers, advance } = fixture(source);
            const { player, sources, finish } = coldSamplePlayer(context);
            context.setArpeggiatorEnabled(true);
            await press(); release();
            assert.ok(player.pending.size > 0);
            assert.equal(sources.length, 0);
            const canceledRequests = [...player.pending.values()];
            const stale = [...timers.values()];
            if (action === 'stop') context.stopLoopAndHeldKeys({ silent: true });
            if (action === 'stop-all') context.stopAllPerformancePlayback({ silent: true });
            if (action === 'panic') context.panicAllNotes({ immediate: true });
            if (action === 'source') context.setKeyboardSoundSource('osc');
            if (action === 'hold-off') context.setHoldEnabled(false);
            if (action === 'arp-off') context.setArpeggiatorEnabled(false);
            assert.ok(canceledRequests.every(request => player.pending.get(request.key) !== request));
            finish();
            await new Promise(setImmediate);
            for (const timer of stale) timer.callback();
            advance();
            assert.ok([...player.activeVoices].every(voice => voice.key.startsWith('keyboard:')));
            if (action === 'arp-off') {
                assert.equal(player.activeVoices.size, 1, 'active arp-off intentionally restores direct Hold sustain');
            } else {
                assert.equal(sources.length, 0, 'canceled load must not even create an audio source');
                assert.equal(player.activeVoices.size, 0);
                assert.equal(player.pending.size, 0);
                assert.equal(context.keyboardArpTransportPlaying, action === 'source');
            }
            if (action === 'stop' || action === 'stop-all' || action === 'panic') {
                await press(1); release(1);
                assert.ok([...player.activeVoices].some(voice => voice.key.startsWith('arp:')));
            }
            player.stop();
        });
    }
}

for (const source of ['osc', 'grain', 'piano', 'strings']) {
    for (const mode of ['direct', 'hold', 'arp']) {
        for (const [down, up] of [['pointerdown', 'pointerup'], ['keydown', 'keyup']]) {
            test(`${source}: ready ${mode} ${down} ${mode === 'arp' ? 'queues buffered rhythm before release' : 'sounds before release without transport pre-roll'}`, async () => {
                const { context, keys, played, voices } = fixture(source);
                useRealTransportTiming(context);
                if (mode === 'hold') context.setHoldEnabled(true);
                if (mode === 'arp') context.setArpeggiatorEnabled(true);
                const pressedAt = context.audioContext.currentTime;
                assert.equal(context.getBufferedTransportStartTime(), pressedAt + transportStartBufferSeconds);
                keys[0].dispatch(down, { key: 'Enter' });
                await new Promise(setImmediate);
                assert.equal(context.activeKeyCount, 1);
                assert.equal(played.length, 1, 'the first note must dispatch while the key is still down');
                assert.equal(played[0].source, source);
                assert.equal(played[0].role, mode === 'arp' ? 'arp' : 'keyboard');
                assert.equal(played[0].time ?? pressedAt, mode === 'arp' ? pressedAt + transportStartBufferSeconds : pressedAt);
                assert.equal(context.heldNotes.has('C4'), mode !== 'direct', 'Hold membership starts on keydown');
                const clock = [context.arpTimerId, context.arpNextStepTime, context.arpStepIndex];
                keys[0].dispatch(down, { key: 'Enter' });
                await new Promise(setImmediate);
                assert.equal(played.length, 1, 'duplicate downs must not retrigger or toggle the pressed key');
                assert.equal(context.activeKeyCount, 1);
                keys[0].dispatch(up, { key: 'Enter' });
                keys[0].dispatch('lostpointercapture');
                assert.equal(context.activeKeyCount, 0);
                assert.deepEqual([context.arpTimerId, context.arpNextStepTime, context.arpStepIndex], clock, 'release must not restart the arp clock');
                assert.equal(voices(), mode === 'direct' ? 0 : 1);
                if (mode !== 'direct') {
                    keys[0].dispatch(down, { key: 'Enter' });
                    await new Promise(setImmediate);
                    assert.equal(context.heldNotes.size, 0, 'a new tap removes an already selected note');
                    assert.equal(voices(), 0);
                    keys[0].dispatch(up, { key: 'Enter' });
                    assert.equal(context.heldNotes.size, 0, 'toggle release must not add the note back');
                }
                context.panicAllNotes({ immediate: true });
            });
        }
    }

    test(`${source}: adding a keydown chord member preserves the running arp BPM and phase`, async () => {
        const { context, press, release, played, advance } = fixture(source);
        useRealArpClock(context);
        context.setArpeggiatorEnabled(true);
        await press();
        const clock = [context.arpTimerId, context.arpNextStepTime, context.arpStepIndex, context.transportLoopStartTime];
        const count = played.length;
        await press(1);
        assert.deepEqual([...context.heldNotes], ['C4', 'E4']);
        assert.deepEqual([context.arpTimerId, context.arpNextStepTime, context.arpStepIndex, context.transportLoopStartTime], clock);
        assert.equal(played.length, count, 'chord changes must not create a direct drone or extra off-clock step');
        release(); release(1);
        assert.deepEqual([context.arpTimerId, context.arpNextStepTime, context.arpStepIndex, context.transportLoopStartTime], clock);
        advance(context.getArpeggiatorStepSeconds());
        assert.equal(played.at(-1).time, clock[1]);
        advance(context.getArpeggiatorStepSeconds());
        assert.equal(played.at(-1).note, 'E4');
        assert.equal(played.at(-1).time, clock[1] + context.getArpeggiatorStepSeconds());
        context.panicAllNotes({ immediate: true });
    });

    for (const mode of ['direct', 'hold', 'arp']) {
        test(`${source}: ready ${mode} K capture starts before keydown audio`, async () => {
            const { context, keys, played } = fixture(source);
            const events = [];
            Object.assign(context, {
                keyboardRepositoryRecordingState: 'armed', isOutputRecording: false,
                clearKeyboardRepositoryStopTimer() {}, disarmOutputRecordingArm() {},
                setKeyboardRepositoryRecordingState: state => { context.keyboardRepositoryRecordingState = state; },
                startOutputRecording(target) {
                    assert.equal(target, 'keyboard-repo');
                    assert.equal(played.length, 0);
                    context.isOutputRecording = true;
                    events.push('capture');
                },
                startKeyboardRepositoryMetronome: () => events.push('metronome'),
                stopKeyboardRepositoryMetronome() {}
            });
            vm.runInContext(['startKeyboardRepositoryRecordingFromKey', 'notifyKeyboardRepositoryKeyPress'].map(extractFunction).join('\n'), context);
            if (mode === 'hold') context.setHoldEnabled(true);
            if (mode === 'arp') context.setArpeggiatorEnabled(true);
            keys[0].dispatch('pointerdown');
            await new Promise(setImmediate);
            assert.deepEqual(events, ['capture', 'metronome']);
            assert.equal(context.keyboardRepositoryRecordingState, 'recording');
            assert.equal(played.length, 1);
            assert.equal(played[0].time ?? context.audioContext.currentTime, context.audioContext.currentTime);
            keys[0].dispatch('pointerup');
            assert.equal(context.notifyKeyboardRepositoryKeyPress(), undefined, 'ongoing capture does not add an async readiness barrier');
            context.panicAllNotes({ immediate: true });
        });
    }
}

test('explicit and shared-transport arp starts retain their requested safety pre-roll', () => {
    const { context, played, advance } = fixture('piano');
    useRealTransportTiming(context);
    const stepSeconds = context.getArpeggiatorStepSeconds();
    const assertScheduledWindow = (events, start, now) => {
        const expectedCount = Math.ceil((now + context.SCHEDULE_AHEAD_TIME - start) / stepSeconds - .000001);
        assert.equal(events.length, expectedCount);
        assert.ok(events.length <= Math.ceil(context.SCHEDULE_AHEAD_TIME / stepSeconds));
        events.forEach((voice, index) => {
            assert.ok(Math.abs(voice.time - (start + index * stepSeconds)) < .000001);
            assert.ok(voice.time >= voice.scheduledAt && voice.time < voice.scheduledAt + context.SCHEDULE_AHEAD_TIME);
        });
    };
    context.setArpeggiatorEnabled(true);
    context.heldNotes.add('C4');
    context.keyboardArpTransportPlaying = true;
    const requestedStart = context.getBufferedTransportStartTime();
    context.startArpeggiatorPlayback(requestedStart);
    assertScheduledWindow(played, requestedStart, context.audioContext.currentTime);
    assert.equal(played[0].time, requestedStart);
    assert.equal(context.transportSync.lanes.arp.nextTime, requestedStart);
    assert.equal(context.arpNextStepTime, requestedStart + stepSeconds);
    advance(transportStartBufferSeconds);
    assertScheduledWindow(played, requestedStart, context.audioContext.currentTime);
    assert.equal(played[0].time, requestedStart);
    context.sequencerPlaying = true;
    const joinCount = played.length;
    const joinStart = context.audioContext.currentTime + transportStartBufferSeconds;
    context.startArpeggiatorPlayback();
    assert.ok(Math.abs(context.transportSync.lanes.arp.nextTime - joinStart) < .000001);
    assertScheduledWindow(played.slice(joinCount), joinStart, context.audioContext.currentTime);
    assert.ok(Math.abs(context.arpNextStepTime - (joinStart + stepSeconds)) < .000001);
    context.sequencerPlaying = false;
    let effectsStartTime;
    context.restartInternalEffectOscillators = when => { effectsStartTime = when; };
    const sharedStart = context.audioContext.currentTime + transportStartBufferSeconds;
    const sharedCount = played.length;
    assert.equal(context.restartAllTransport({ silent: true, keyboardPlay: true }), true);
    assert.equal(context.arpNextStepTime, sharedStart);
    assert.equal(context.transportSync.origin, sharedStart);
    assert.equal(context.transportSync.startTime, sharedStart);
    assert.equal(context.transportSync.depth, 0);
    assert.equal(effectsStartTime, sharedStart);
    assert.equal(played.length, sharedCount);
    assert.throws(() => context.restartAllTransport({ startTime: context.audioContext.currentTime + .01 }), /Transport deadline expired/);
    assert.equal(context.arpNextStepTime, sharedStart);
    assert.equal(played.length, sharedCount);
    advance(transportStartBufferSeconds);
    assertScheduledWindow(played.slice(sharedCount), sharedStart, context.audioContext.currentTime);
    assert.equal(played[sharedCount].time, sharedStart);
    context.panicAllNotes({ immediate: true });
});

test('keyboard AudioContext requests interactive latency while preserving the live transport safety buffer', async () => {
    const { context } = fixture();
    useRealTransportTiming(context);
    let options;
    context.audioSchedulingStats = {};
    context.bindAudioContextLifecycle = () => {};
    context.window.AudioContext = class {
        constructor(requested) {
            options = requested;
            this.state = 'running';
            this.currentTime = 1;
        }
    };
    vm.runInContext(extractFunction('createAudioContextInstance'), context);
    await context.createAudioContextInstance();
    assert.equal(options.latencyHint, 'interactive');
    assert.equal(context.getBufferedTransportStartTime(), context.audioContext.currentTime + transportStartBufferSeconds);
    vm.runInContext(extractFunction('notifyKeyboardRepositoryKeyPress'), context);
    context.keyboardRepositoryRecordingState = 'idle';
    assert.equal(context.notifyKeyboardRepositoryKeyPress(), undefined);
});
