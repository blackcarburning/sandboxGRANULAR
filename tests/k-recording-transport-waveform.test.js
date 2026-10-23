const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const adapterSource = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');

function extractFunction(name, source = html, method = false) {
    const signature = method ? `${name}(` : `function ${name}(`;
    let start = source.indexOf(signature);
    assert.notEqual(start, -1, `Missing ${name}`);
    const asynchronous = source.slice(start - 6, start) === 'async ';
    if (asynchronous) start -= 6;
    let parentheses = 0;
    let bodyStart = -1;
    for (let index = source.indexOf('(', start); index < source.length; index += 1) {
        if (source[index] === '(') parentheses += 1;
        if (source[index] === ')') parentheses -= 1;
        if (source[index] === '{' && parentheses === 0) { bodyStart = index; break; }
    }
    let braces = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') braces += 1;
        if (source[index] === '}') braces -= 1;
        if (braces === 0) {
            const body = source.slice(start, index + 1);
            return method ? body.replace(/^(async )?/, `${asynchronous ? 'async ' : ''}function `) : body;
        }
    }
    throw new Error(`Unclosed ${name}`);
}

function load(context, names, source = html) {
    vm.createContext(context);
    vm.runInContext(names.map(name => extractFunction(name, source)).join('\n'), context);
    return context;
}

function audioBuffer(channels, sampleRate = 8) {
    const data = channels.map(channel => Float32Array.from(channel));
    return {
        length: data[0].length, numberOfChannels: data.length, sampleRate,
        duration: data[0].length / sampleRate,
        getChannelData: channel => data[channel]
    };
}

function recordingFixture(overrides = {}) {
    const timers = new Map();
    const calls = { capture: [], restart: [], held: [], monitor: [], applied: [], statuses: [], stops: 0, arpStops: 0, prepared: [], history: [] };
    const buffer = audioBuffer([[0, .2, -.2, 0]]);
    const context = {
        getKeyboardDecaySeconds: () => 0,
        AbortController, MediaRecorder: class {},
        console: { error() {} },
        document: { getElementById: () => ({ value: '300' }) },
        window: {
            setTimeout(callback, delay) { const timerId = timers.size + 1; timers.set(timerId, { callback, delay }); return timerId; },
            MygrainSongClock: { prepareCapture: async () => {} },
            mygrainCardHistory: { busy: false, recordK(action) { calls.history.push('Record to K'); return action(); } },
            mygrainSongBetaAdapter: { setKeyboardRecordingMonitor: enabled => calls.monitor.push(enabled) }
        },
        audioContext: { state: 'running', currentTime: 10 },
        keyboardGrainCaptureGain: { name: 'keyboard-only' }, keyboardRecordingGainNode: { name: 'post-record-level' },
        arpEnabled: false, holdEnabled: false, heldNotes: new Set(), keyboardSoundSource: 'grain', keyboardPlaybackAuthorized: false,
        startHeldKeyboardPlayback: time => { calls.held.push(time); return true; },
        prepareKeyboardSound: async sound => calls.prepared.push(sound),
        stopKeyboardArpTransport: () => { calls.arpStops++; },
        syncKeyboardRecordingLevel() {}, prewarmTransportBuffers() {}, getTransportPreparationLeadSeconds: () => .3,
        ensureAudioReadyForKeyInteraction: async () => true,
        clampBpmValue: Number,
        getBastardLoopKRecordingSteps: () => 32,
        getBastardLoopKRecordingDurationSeconds: () => 1.6,
        formatBastardLoopKRecordingSteps: () => '32 steps',
        bastardLoopMRecordingState: 'idle', bastardLoopMPlusRecordingState: 'idle',
        bastardLoopKRecordingState: 'idle', bastardLoopKRecordingToken: 0,
        bastardLoopKRecordingAbortController: null,
        bastardLoopKCountInTimerIds: [],
        bastardLoopKRecordingCancelled: false, bastardLoopKRecordingStartsFullLoop: false, bastardLoopKRecordingArp: false, bastardLoopKRecordingHeld: false,
        bastardLoopKSourceBpm: 300, sequencerBPM: 300,
        bastardLoopPlaying: false, sequencerPlaying: false, drumMachinePlaying: false,
        isArpeggiatorPlaying: () => false,
        performanceSourceLayerSolo: ['generated'], grainLayerSolo: ['grainA'], loopLayerSolo: [],
        performanceSourceLayerSoloSnapshot: { oscillatorsEnabled: true },
        oscillatorsEnabled: true, generatedSampleLayerEnabled: true, generatedDryLoopEnabled: true,
        stopBastardLoopK: () => assert.fail('Arming must not stop the current K backing'),
        stopAllPerformancePlayback() { calls.stops++; context.bastardLoopPlaying = false; context.sequencerPlaying = false; context.drumMachinePlaying = false; },
        setOscillatorsEnabled: () => assert.fail('Capture must not change the audible mix'),
        setGranularLayersEnabled: () => assert.fail('Capture must not change the audible mix'),
        setGeneratedSampleLayerEnabled: () => assert.fail('Capture must not change the audible mix'),
        setGeneratedDryLoopEnabled: () => assert.fail('Capture must not change the audible mix'),
        syncBastardLoopKUi() {}, syncPerformanceControlState() {}, saveState() {},
        setStatus: (...args) => calls.statuses.push(args),
        recordKeyboardKAtTime: async (...args) => {
            calls.capture.push(args);
            return { audioBuffer: buffer, captureStartTime: 10 };
        },
        restartAllTransport: options => { calls.restart.push(options); context.bastardLoopPlaying = true; return true; },
        startBastardLoopKMetronome() {},
        getBastardLoopKInputGainPercent: () => 100,
        applyLinearGainToAudioBuffer: () => assert.fail('Live recording level must not be applied again after capture'),
        createFixedLengthAudioBufferFromSource: (captured, trim, duration) => {
            assert.equal(captured, buffer); assert.ok(Math.abs(trim - .88) < 1e-9); assert.equal(duration, 1.6);
            return captured;
        },
        applyRecordedBastardLoopKBuffer: async (...args) => calls.applied.push(args),
        clearBastardLoopKRecordTimers() { timers.clear(); },
        ...overrides
    };
    load(context, ['beginBastardLoopKRecording', 'cancelBastardLoopKRecording', 'finalizeBastardLoopKRecordingSession']);
    return { context, timers, calls, buffer };
}

test('K arming stops the backing for count-in without modifying solo or layer enables', async () => {
    const { context, calls } = recordingFixture({ bastardLoopPlaying: true });
    const solo = context.performanceSourceLayerSolo;
    const snapshot = context.performanceSourceLayerSoloSnapshot;
    assert.equal(await context.beginBastardLoopKRecording({ startFullLoop: true }), true);
    assert.equal(context.bastardLoopPlaying, false);
    assert.equal(calls.stops, 1);
    assert.equal(context.performanceSourceLayerSolo, solo);
    assert.equal(context.performanceSourceLayerSoloSnapshot, snapshot);
    assert.deepEqual(context.grainLayerSolo, ['grainA']);
    assert.equal(context.oscillatorsEnabled, true);
    assert.ok(Math.abs(calls.capture[0][0] - 10.88) < 1e-9);
    assert.equal(calls.capture[0][1], 1.6);
    assert.equal(calls.capture[0][2], context.bastardLoopKRecordingAbortController.signal);
    assert.equal(context.bastardLoopKRecorderStartTime, calls.capture[0][0]);
    assert.deepEqual(calls.monitor, [true]);
    assert.deepEqual(calls.history, [], 'Arming/count-in must not create history');
});

test('K recording waits for pending history before stopping playback or arming capture', async () => {
    const { context, calls } = recordingFixture();
    context.window.mygrainCardHistory.busy = true;
    assert.equal(await context.beginBastardLoopKRecording(), false);
    assert.equal(calls.stops, 0);
    assert.equal(calls.capture.length, 0);
    assert.equal(context.bastardLoopKRecordingState, 'idle');
    assert.match(calls.statuses.at(-1)[0], /Undo\/Redo/);
});

test('a completed K take cannot be applied or journaled into a changed account history or audio context', async () => {
    for (const target of ['history', 'audio']) {
        const { context, calls, timers } = recordingFixture();
        await context.beginBastardLoopKRecording();
        if (target === 'history') context.window.mygrainCardHistory = { ...context.window.mygrainCardHistory };
        else context.audioContext = { ...context.audioContext };
        await timers.get(context.bastardLoopKRecordStopTimerId).callback();
        assert.equal(calls.applied.length, 0);
        assert.equal(calls.history.length, 0);
        assert.equal(context.bastardLoopKRecordingState, 'idle');
        assert.match(calls.statuses.at(-1)[0], /Account or audio changed/);
    }
});

test('K completion is the only recording-phase history exception; an amendment cannot block saving the captured take', () => {
    function fixture(overrides = {}) {
        return load({
            initializing: false, window: { mygrainAccounts: { authenticated: true }, mygrainSongBeta: { editing: { id: 'amending' } } },
            isAudioGraphReady: () => true, engineStarting: false, stateSaveSuspended: false,
            isRecording: false, isOutputRecording: false, isOutputRecordingArmed: false,
            bastardLoopMRecordingState: 'idle', bastardLoopMPlusRecordingState: 'idle', bastardLoopKRecordingState: 'processing',
            megaRandomizeInFlight: false, drumMachineLoadInFlight: false,
            bastardLoopGenerationInFlight: false, bastardLoop2GenerationInFlight: false, bastardLoop3GenerationInFlight: false,
            bastardLoopVGenerationInFlight: false, bastardLoopPGenerationInFlight: false, bastardLoopOGenerationInFlight: false,
            dropboxSampleLayerLoadInFlight: false, ...overrides
        }, ['assertReady'], adapterSource);
    }
    const context = fixture();
    assert.throws(() => context.assertReady(), /Finish recording/, 'Travel keeps its original recording/amendment guard');
    assert.doesNotThrow(() => context.assertReady(true));
    for (const phase of ['countin', 'recording']) assert.throws(() => fixture({ bastardLoopKRecordingState: phase }).assertReady(true), /Finish recording/);
    for (const override of [{ isRecording: true }, { bastardLoopMRecordingState: 'recording' }, { bastardLoopMPlusRecordingState: 'recording' }, { megaRandomizeInFlight: true }, { drumMachineLoadInFlight: true }]) {
        assert.throws(() => fixture(override).assertReady(true), /Finish recording|Wait for the current/);
    }
});

test('K restarts the current pattern on the take downbeat whether loops, sequencer, drums or song were active', async () => {
    for (const active of [null, 'bastardLoopPlaying', 'sequencerPlaying', 'drumMachinePlaying', 'song']) {
        const { context, calls, timers } = recordingFixture(active && active !== 'song' ? { [active]: true } : {});
        if (active === 'song') context.window.mygrainSongBeta = { playing: true, stop() { this.playing = false; } };
        await context.beginBastardLoopKRecording({ startFullLoop: true });
        await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
        assert.equal(calls.restart.length, 1, String(active));
        assert.equal(calls.stops, 1);
         assert.ok(Math.abs(calls.restart[0].startTime - 10.88) < 1e-9);
    }
});

test('Record K explicitly authorizes configured arp on the capture downbeat and releases only its live arp at handover', async () => {
    const { context, calls, timers } = recordingFixture({ arpEnabled: true, holdEnabled: true, keyboardSoundSource: 'piano' });
    await context.beginBastardLoopKRecording({ startFullLoop: true });
    assert.deepEqual(calls.prepared, ['piano']);
    assert.equal(calls.restart.length, 0, 'count-in cannot start arp immediately');
    await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
    assert.equal(calls.restart[0].keyboardPlay, true);
    assert.equal(calls.restart[0].startTime, calls.capture[0][0]);
    await timers.get(context.bastardLoopKRecordStopTimerId).callback();
    assert.equal(calls.arpStops, 1);
    assert.equal(context.bastardLoopKRecordingArp, false);
    assert.equal(context.arpEnabled, true);
    assert.equal(context.holdEnabled, true);
    assert.equal(calls.stops, 1, 'handover must not stop backing');
});

test('ordinary keyboard takes do not authorize or stop an unrelated arp', async () => {
    const { context, calls, timers } = recordingFixture();
    await context.beginBastardLoopKRecording({ startFullLoop: true });
    await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
    assert.equal(calls.restart[0].keyboardPlay, false);
    await timers.get(context.bastardLoopKRecordStopTimerId).callback();
    assert.equal(calls.arpStops, 0);
    assert.deepEqual(calls.prepared, []);
});

test('held non-arp chords restart on the capture downbeat from stopped/running playback, then hand over to K', async () => {
    for (const running of [false, true]) {
        const notes = new Set(['C4', 'E4', 'G4']);
        const { context, calls, timers } = recordingFixture({ holdEnabled: true, heldNotes: notes, bastardLoopPlaying: running, keyboardSoundSource: 'strings' });
        assert.equal(await context.beginBastardLoopKRecording(), true);
        assert.equal(calls.stops, 1);
        assert.equal(calls.held.length, 0, 'No immediate restart during count-in');
        assert.deepEqual(calls.prepared, ['strings']);
        await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
        assert.equal(calls.restart[0].startTime, calls.capture[0][0]);
        assert.deepEqual(calls.held, [calls.capture[0][0]]);
        assert.equal(context.keyboardPlaybackAuthorized, true);
        await timers.get(context.bastardLoopKRecordStopTimerId).callback();
        assert.equal(calls.arpStops, 1, 'Shared keyboard stop prevents live-chord doubling');
        assert.equal(context.bastardLoopKRecordingHeld, false);
        assert.equal(calls.applied.length, 1);
        assert.equal(context.heldNotes, notes);
        assert.equal(context.holdEnabled, true);
        assert.equal(context.arpEnabled, false);
    }
});

test('held-only recording can schedule its chord without starting backing transport', async () => {
    const { context, calls, timers } = recordingFixture({ holdEnabled: true, heldNotes: new Set(['C4']) });
    await context.beginBastardLoopKRecording({ startFullLoop: false });
    await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
    assert.equal(calls.restart.length, 0);
    assert.deepEqual(calls.held, [calls.capture[0][0]]);
});

test('empty Hold selection leaves ordinary manual recording unchanged', async () => {
    const { context, calls, timers } = recordingFixture({ holdEnabled: true });
    await context.beginBastardLoopKRecording();
    await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
    await timers.get(context.bastardLoopKRecordStopTimerId).callback();
    assert.deepEqual(calls.held, []);
    assert.deepEqual(calls.prepared, []);
    assert.equal(calls.arpStops, 0);
});

test('held recording cancellation/failure drops owned playback without applying a take or clearing its chord', async () => {
    for (const failure of ['countin', 'live', 'capture', 'start']) {
        const notes = new Set(['C4']);
        const { context, calls, timers } = recordingFixture({ holdEnabled: true, heldNotes: notes });
        if (failure === 'capture') context.recordKeyboardKAtTime = async () => { throw new Error('capture interrupted'); };
        if (failure === 'start') context.startHeldKeyboardPlayback = () => false;
        await context.beginBastardLoopKRecording();
        if (failure !== 'capture') {
            const prepare = timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback;
            if (failure === 'countin') { context.cancelBastardLoopKRecording({ silent: true }); await prepare(); }
            else { await prepare(); if (failure === 'live') context.cancelBastardLoopKRecording({ silent: true }); }
        }
        await Promise.resolve();
        assert.equal(context.bastardLoopKRecordingState, 'idle', failure);
        assert.equal(context.bastardLoopKRecordingHeld, false, failure);
        assert.equal(calls.arpStops, 1, failure);
        assert.equal(context.heldNotes, notes);
        assert.equal(calls.applied.length, 0);
        assert.equal(calls.history.length, 0);
        if (failure === 'countin') assert.equal(calls.held.length, 0, 'Stale timer cannot resurrect a cancelled chord');
    }
});

test('failed held instrument preparation leaves the currently playing chord and previous take untouched', async () => {
    const { context, calls } = recordingFixture({ holdEnabled: true, heldNotes: new Set(['C4']),
        prepareKeyboardSound: async () => { throw new Error('Instrument unavailable'); } });
    assert.equal(await context.beginBastardLoopKRecording(), false);
    assert.equal(calls.stops, 0);
    assert.equal(calls.capture.length, 0);
});

test('cancelling or failing a recorded arp releases its live playback permission and preserves setup', async () => {
    for (const fail of [false, true]) {
        const { context, calls, timers } = recordingFixture({ arpEnabled: true, holdEnabled: true });
        if (fail) context.recordKeyboardKAtTime = async () => { throw new Error('capture interrupted'); };
        await context.beginBastardLoopKRecording({ startFullLoop: true });
        if (!fail) {
            await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
            await timers.get(context.bastardLoopKRecordStartTimerId).callback();
            context.cancelBastardLoopKRecording({ silent: true });
        }
        await Promise.resolve();
        assert.equal(calls.arpStops, 1);
        assert.equal(context.bastardLoopKRecordingArp, false);
        assert.equal(context.arpEnabled, true);
        assert.equal(calls.applied.length, 0);
        assert.equal(calls.history.length, 0, 'Cancelled/failed capture must preserve the Redo branch');
    }
});

test('failed arp instrument preparation leaves existing playback and the previous take untouched', async () => {
    const { context, calls } = recordingFixture({ arpEnabled: true, holdEnabled: true,
        prepareKeyboardSound: async () => { throw new Error('Piano unavailable'); } });
    assert.equal(await context.beginBastardLoopKRecording(), false);
    assert.equal(calls.stops, 0);
    assert.equal(calls.capture.length, 0);
    assert.equal(context.bastardLoopKRecordingState, 'idle');
});

test('an armed Song cache does not replace the current pattern during a keyboard take', async () => {
    const { context, calls, timers } = recordingFixture();
    context.window.mygrainSongBeta = { armed: true, song: { parts: [{ id: 'part' }] }, playing: false,
        playSong() { assert.fail('Record K must use the current pattern, not a Song cache'); } };
    await context.beginBastardLoopKRecording({ startFullLoop: true });
    assert.ok(timers.get(context.bastardLoopKRecordLoopTransportTimerId).delay < timers.get(context.bastardLoopKRecordStartTimerId).delay);
    await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
    assert.equal(calls.restart.length, 1);
});

test('capture processing does not apply gain twice or trim count-in audio; preserves the exact frame buffer', async () => {
    const { context, calls, timers, buffer } = recordingFixture();
    await context.beginBastardLoopKRecording({ startFullLoop: true });
    await timers.get(context.bastardLoopKRecordStopTimerId).callback();
    assert.equal(calls.applied[0][0], buffer);
    assert.equal(calls.applied[0][1].joinSharedTransport, true);
    assert.deepEqual(calls.history, ['Record to K']);
    assert.equal(context.bastardLoopKRecordingState, 'idle');
    assert.deepEqual(calls.monitor, [true, false]);
    assert.deepEqual(context.performanceSourceLayerSolo, ['generated']);
});

test('cancelled count-in cannot start stale backing and capture failure finalizes cleanly', async () => {
    const { context, calls, timers } = recordingFixture();
    await context.beginBastardLoopKRecording({ startFullLoop: true });
    const startBacking = timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback;
    assert.equal(context.cancelBastardLoopKRecording(), true);
    await startBacking();
    assert.equal(calls.restart.length, 0);
    assert.deepEqual(calls.monitor, [true, false]);
    assert.equal(context.bastardLoopKRecordingState, 'idle');
    const failed = recordingFixture({ recordKeyboardKAtTime: async () => { throw new Error('capture failed'); } });
    await failed.context.beginBastardLoopKRecording({ startFullLoop: true });
    await Promise.resolve();
    assert.equal(failed.context.bastardLoopKRecordingState, 'idle');
    assert.deepEqual(failed.calls.monitor, [true, false]);
    assert.match(failed.calls.statuses.at(-1)[0], /capture failed/);
});

test('a missed transport deadline cancels the take, stops scheduled backing and preserves the previous audio', async () => {
    const { context, calls, timers } = recordingFixture({ restartAllTransport() { throw new Error('Transport deadline expired'); } });
    await context.beginBastardLoopKRecording({ startFullLoop: true });
    await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
    assert.equal(context.bastardLoopKRecordingState, 'idle');
    assert.equal(context.bastardLoopPlaying, false);
    assert.equal(calls.stops, 2);
    assert.equal(calls.applied.length, 0);
    assert.match(calls.statuses.at(-1)[0], /take cancelled.*pattern could not start/);
});

test('cancelling the final count-in beat also stops already scheduled future sources', async () => {
    const { context, calls, timers } = recordingFixture();
    await context.beginBastardLoopKRecording({ startFullLoop: true });
    await timers.get(context.bastardLoopKRecordLoopTransportTimerId).callback();
    assert.equal(context.bastardLoopPlaying, true);
    context.cancelBastardLoopKRecording();
    assert.equal(context.bastardLoopPlaying, false);
    assert.equal(calls.stops, 2);
    assert.equal(calls.applied.length, 0);
});

test('unsupported recording fails before stopping current playback or counting in', async () => {
    const { context, calls } = recordingFixture({ bastardLoopPlaying: true });
    context.window.MygrainSongClock.prepareCapture = async () => { throw new Error('Worklet unavailable'); };
    assert.equal(await context.beginBastardLoopKRecording(), false);
    assert.equal(calls.stops, 0);
    assert.equal(calls.capture.length, 0);
    assert.equal(context.bastardLoopPlaying, true);
});

test('missing keyboard capture bus fails closed rather than recording the final backing mix', async () => {
    const { context, calls } = recordingFixture({ keyboardGrainCaptureGain: null });
    assert.equal(await context.beginBastardLoopKRecording({ startFullLoop: true }), false);
    assert.equal(calls.capture.length, 0);
});

function transportFixture(overrides = {}) {
    const calls = { starts: 0, stops: 0, ready: 0, songStops: 0 };
    const context = {
        getKeyboardDecaySeconds: () => 0,
        window: {}, bastardLoopPlaying: false, bastardLoopKBuffer: {}, bastardLoopKSource: null,
        ensureAudioReadyForKeyInteraction: async () => true,
        setBastardLoopPlaying: enabled => { context.bastardLoopPlaying = enabled; calls.stops += 1; },
        ensureBastardLoopKReadyForTransport: () => { calls.ready += 1; },
        startAllBastardLoopsFromUi: async () => { context.bastardLoopPlaying = true; calls.starts += 1; return true; },
        setLoopLayerSolo() {}, setStatus() {}, syncBastardLoopKUi() {}, ...overrides
    };
    load(context, ['toggleBastardLoopKTransportFromUi']);
    return { context, calls };
}

test('K shared transport repeatedly stops and starts even with a muted/missing K source', async () => {
    const { context, calls } = transportFixture();
    for (let cycle = 0; cycle < 3; cycle += 1) {
        await context.toggleBastardLoopKTransportFromUi();
        assert.equal(context.bastardLoopPlaying, true);
        await context.toggleBastardLoopKTransportFromUi();
        assert.equal(context.bastardLoopPlaying, false);
    }
    assert.deepEqual(calls, { starts: 3, stops: 3, ready: 3, songStops: 0 });
});

test('K card can start other backing without a K recording and stop an active song', async () => {
    const { context, calls } = transportFixture({ bastardLoopKBuffer: null });
    await context.toggleBastardLoopKTransportFromUi();
    assert.equal(calls.starts, 1);
    assert.equal(calls.ready, 0);
    context.bastardLoopPlaying = false;
    context.window.mygrainSongBeta = { playing: true, stop() { this.playing = false; calls.songStops += 1; } };
    await context.toggleBastardLoopKTransportFromUi();
    assert.equal(calls.songStops, 1);
    assert.equal(calls.stops, 1);
});

test('K UI reflects shared transport rather than the existence of a K source or recording', () => {
    const button = { classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } };
    const source = extractFunction('syncBastardLoopKUi');
    const context = {
        getKeyboardDecaySeconds: () => 0,
        window: {}, document: { getElementById: id => id === 'performanceBastardLoopKStartBtn' ? button : null },
        bastardLoopPlaying: true, bastardLoopKRawBuffer: null, bastardLoopKBuffer: null,
        bastardLoopKSource: null, bastardLoopKRecordingState: 'idle', bastardLoopKRecordingStartsFullLoop: false
    };
    for (const match of source.matchAll(/\b((?:get|format|describe)\w+|updateBastardLoopKPitchControls|drawBastardLoopKWaveform)\(/g)) {
        context[match[1]] ||= () => 0;
    }
    load(context, ['syncBastardLoopKUi']);
    context.syncBastardLoopKUi();
    assert.equal(button.textContent, 'Stop Bastardloops');
    assert.equal(button.disabled, false);
    context.bastardLoopPlaying = false;
    context.syncBastardLoopKUi();
    assert.equal(button.textContent, 'Start Bastardloops');
    assert.equal(button.disabled, false);
    context.window.mygrainSongBeta = { playing: true, stop() { this.playing = false; } };
    context.syncBastardLoopKUi();
    assert.equal(button.textContent, 'Stop Bastardloops');
});

test('recordLiveOutputBuffer records only the selected bus and disconnects only its own tap', async () => {
    const connections = [];
    const sourceNode = { connect: destination => connections.push(['connect', destination]), disconnect: destination => connections.push(['disconnect', destination]) };
    const destination = { stream: {} };
    let recorder;
    let stopRecorder;
    const rendered = audioBuffer([[.1, -.1, .2, -.2]]);
    const context = {
        getKeyboardDecaySeconds: () => 0,
        audioContext: { state: 'running', currentTime: 5, createMediaStreamDestination: () => destination, decodeAudioData: async () => rendered },
        finalAmplifierNode: { connect: () => assert.fail('Backing mix must not enter keyboard capture') },
        chooseRecordingMimeType: () => '', Blob, DOMException,
        MediaRecorder: class {
            constructor() { recorder = this; }
            start() { this.state = 'recording'; }
            stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['pcm']) }); this.onstop(); }
        },
        setTimeout: callback => { stopRecorder = callback; }, clearTimeout() {}
    };
    load(context, ['recordLiveOutputBuffer']);
    const captured = context.recordLiveOutputBuffer(1, { sourceNode });
    stopRecorder();
    assert.equal((await captured).audioBuffer, rendered);
    assert.deepEqual(connections, [['connect', destination], ['disconnect', destination]]);
    assert.equal(recorder.state, 'inactive');
    await assert.rejects(context.recordLiveOutputBuffer(1, { sourceNode: null }), /Start MYGRAIN/);
});

test('cancelled capture stops its recorder immediately and removes the capture connection and stop timer', async () => {
    const controller = new AbortController();
    let recorder;
    let connections = 0;
    let disconnects = 0;
    let cleared = 0;
    const sourceNode = { connect() { connections += 1; }, disconnect() { disconnects += 1; } };
    const context = {
        getKeyboardDecaySeconds: () => 0,
        audioContext: { state: 'running', currentTime: 5, createMediaStreamDestination: () => ({ stream: {} }) },
        finalAmplifierNode: null, chooseRecordingMimeType: () => '', DOMException,
        MediaRecorder: class {
            constructor() { recorder = this; }
            start() { this.state = 'recording'; }
            stop() { this.state = 'inactive'; this.onstop(); }
        },
        setTimeout: () => 42, clearTimeout: timerId => { assert.equal(timerId, 42); cleared += 1; }
    };
    load(context, ['recordLiveOutputBuffer']);
    const pending = context.recordLiveOutputBuffer(60, { sourceNode, signal: controller.signal });
    assert.equal(recorder.state, 'recording');
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(recorder.state, 'inactive');
    assert.equal(connections, 1);
    assert.equal(disconnects, 1);
    assert.equal(cleared, 1);
    await assert.rejects(context.recordLiveOutputBuffer(60, { sourceNode, signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(connections, 1);
});

test('only keyboard and keyboard-arp grains feed the capture bus, while every role retains its audible route', () => {
    const source = extractFunction('playGrain');
    const routing = source.slice(source.indexOf('            mixer.connect(outputGain);'), source.indexOf('            let sourcesRemaining'));
    for (const role of [undefined, 'keyboard', 'arp', 'sequencer', 'bastardloopl', 'bastardloopl-preview']) {
        const targets = [];
        const context = {
        getKeyboardDecaySeconds: () => 0,
            isKeyboardSoundRole: role => role === 'keyboard' || role === 'arp',
            options: { role }, mixer: { connect() {} }, outputGain: { connect: target => targets.push(target) },
            granularOutputGain: { name: 'audible' }, keyboardGrainCaptureGain: { name: 'capture' }
        };
        vm.runInNewContext(routing, context);
        assert.equal(targets[0], context.granularOutputGain);
        assert.equal(targets.includes(context.keyboardGrainCaptureGain), role === undefined || role === 'keyboard' || role === 'arp', String(role));
    }
});

test('real grain streams schedule keyboard capture sends and release every voice connection on repeated key release', () => {
    const nodes = [];
    const sources = [];
    const timers = new Map();
    let nextTimerId = 0;
    const parameter = () => ({ value: 1, setValueAtTime() {}, setValueCurveAtTime() {} });
    const node = () => {
        const result = {
            gain: parameter(), pan: parameter(), playbackRate: parameter(), targets: new Set(),
            connect(target) { this.targets.add(target); }, disconnect() { this.targets.clear(); },
            start() {}, stop() {}
        };
        nodes.push(result);
        return result;
    };
    const sourceInfo = { buffer: { duration: 1 } };
    const layer = { key: 'main', intervalSeconds: .1, decaySeconds: .02, smoothing: .1, blend: .2, width: 0, panBias: 0, volume: 1 };
    const context = {
        getKeyboardDecaySeconds: () => 0,
        audioContext: {
            currentTime: 1, sampleRate: 48000, createGain: node, createStereoPanner: node,
            createBufferSource() { const source = node(); sources.push(source); return source; }
        },
        granularOutputGain: { name: 'audible' }, keyboardGrainCaptureGain: { name: 'capture' },
        activeGrains: new Map(), activeGrainNodes: 0, MAX_GRAIN_NODES: 128,
        GRAIN_SCHEDULER_LOOKAHEAD: .05, GRAIN_SCHEDULER_INTERVAL: 25,
        grainSchedulerTimerId: null, currentGrainNote: null, lpfEnabled: false,
        makePerformanceStreamId: (role, note) => `${role}:${note}`,
        getGrainTimingMode: () => 'synth', getGrainModeProfile: () => ({}),
        getGranularKeyboardNoteFrequency: () => 220,
        getClickGuardSeconds: () => .005,
        withModulationEvaluationTime: (time, callback) => callback(),
        getGranularLayerSettings: () => [layer],
        getModulatedValue: () => 0,
        getGrainLayerGain: () => 1,
        getGranularKeyboardVolumeBiasGain: () => 1,
        getAvailableGranularSources: () => [sourceInfo],
        getGranularSourceGainMap: () => new Map([[sourceInfo, 1]]),
        resolveGranularLayerSampleWindow: () => ({
            grainDuration: .1, attackSeconds: .01, sourceDuration: .1,
            playOffset: 0, playbackRate: 1, releaseSeconds: .02
        }),
        getFadeSecondsForDuration: () => .005,
        applyFilterEnvelope: () => 0,
        countMissedAudioSteps: () => 0,
        document: { getElementById: () => null },
        setTimeout(callback) { nextTimerId += 1; timers.set(nextTimerId, callback); return nextTimerId; },
        stopGrainScheduler() { timers.delete(context.grainSchedulerTimerId); context.grainSchedulerTimerId = null; },
        console: { error: (...args) => assert.fail(String(args)), warn() {} }
    };
    context.keyboardSoundSource = 'grain';
    load(context, ['isKeyboardSoundRole', 'canPlayGrains', 'startGrainStream', 'stopGrainStream', 'scheduleActiveGrains', 'playGrain', 'getGranularLayerScheduleIntervalSeconds']);
    for (let cycle = 0; cycle < 10; cycle += 1) {
        for (const role of ['keyboard', 'arp', 'sequencer']) {
            const firstNode = nodes.length;
            context.startGrainStream('C1', null, 1, { role });
            assert.equal(context.activeGrains.size, 1);
            assert.equal(context.activeGrainNodes, 1);
            const voiceNodes = nodes.slice(firstNode);
            const output = voiceNodes.find(entry => entry.targets.has(context.granularOutputGain));
            assert.ok(output);
            assert.equal(output.targets.has(context.keyboardGrainCaptureGain), role === 'keyboard' || role === 'arp');
            context.stopGrainStream('C1', { role, immediate: true });
            sources.at(-1).onended();
            assert.equal(context.activeGrains.size, 0);
            assert.equal(context.activeGrainNodes, 0);
            assert.ok(voiceNodes.every(entry => entry.targets.size === 0));
            for (const callback of timers.values()) callback();
            timers.clear();
            assert.equal(context.activeGrainNodes, 0);
        }
    }
    assert.equal(sources.length, 30);
});

test('restart-all recognizes a K-only arrangement as playable backing', () => {
    let starts = 0;
    const context = {
        getKeyboardDecaySeconds: () => 0,
        isAudioGraphReady: () => true, audioContext: { currentTime: 1 }, window: {},
        sequencerPlaying: false, arpEnabled: false, holdEnabled: false, bastardLoopPlaying: false, drumMachinePlaying: false,
        bastardLoopBuffer: null, bastardLoop2Buffer: null, bastardLoop3Buffer: null,
        bastardLoopVBuffer: null, bastardLoopPBuffer: null, bastardLoopOBuffer: null,
        bastardLoopXSampleBuffer: null, bastardLoopMBuffer: null, bastardLoopMPlusBuffer: null,
        bastardLoopKBuffer: {}, dropboxSampleLayerBuffer: null,
        hasPlayableBastardLoopLTransportSource: () => false,
        drumMachineKickPattern: [], drumMachineSnarePattern: [], drumMachineHatPattern: [], drumMachinePercPattern: [], drumMachineExtraTracks: {},
        getBufferedTransportStartTime: () => 1.04,
        restartInternalEffectOscillators() {}, finalFxPlacementLfoEnabled: false,
        startSequencer: () => { context.sequencerPlaying = true; },
        startAllBastardLoopLayers: () => { starts += 1; return true; },
        updateEffects() {}, syncPerformanceControlState() {}
    };
    load(context, ['restartAllTransport']);
    assert.equal(context.restartAllTransport({ silent: true }), true);
    assert.equal(starts, 1);
});

function songMonitorFixture() {
    const gain = { value: .73, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } };
    const context = { audioContext: { currentTime: 2, destination: {} }, finalAmplifierNode: { gain } };
    vm.createContext(context);
    vm.runInContext(`let keyboardRecordingMonitorEnabled = false; let songOutputIsolation = null;\n${extractFunction('setKeyboardRecordingMonitor', adapterSource)}\n${extractFunction('isolateSongOutput', adapterSource)}`, context);
    return { context, gain };
}

test('song output isolation unmutes only during K recording and restores the original output gain', () => {
    const { context, gain } = songMonitorFixture();
    const restore = context.isolateSongOutput();
    assert.equal(gain.value, 0);
    context.setKeyboardRecordingMonitor(true);
    assert.equal(gain.value, .73);
    context.setKeyboardRecordingMonitor(false);
    assert.equal(gain.value, 0);
    restore();
    assert.equal(gain.value, .73);
    context.setKeyboardRecordingMonitor(true);
    const recordingRestore = context.isolateSongOutput();
    assert.equal(gain.value, .73);
    recordingRestore();
    recordingRestore();
    assert.equal(gain.value, .73);
});

test('cached and stored song schedulers preserve K monitoring and restore isolation on stop/failure', async () => {
    for (const name of ['scheduleSong', 'scheduleStoredSong']) {
        for (const fails of [false, true]) {
            const { context, gain } = songMonitorFixture();
            const playback = { stop() {} };
            let destination;
            const schedule = (...args) => { destination = args[name === 'scheduleSong' ? 4 : 5]; if (fails) throw new Error('schedule failed'); return playback; };
            context.MygrainSongClock = { schedule, scheduleStored: schedule };
            vm.runInContext(extractFunction(name, adapterSource, true), context);
            context.setKeyboardRecordingMonitor(true);
            if (fails) {
                await assert.rejects(async () => context[name]([], new Map(), () => {}, { aborted: false }), /schedule failed/);
            } else {
                const result = await context[name]([], new Map(), () => {}, { aborted: false });
                assert.equal(gain.value, .73);
                assert.ok(destination);
                context.setKeyboardRecordingMonitor(false);
                assert.equal(gain.value, 0);
                result.stop();
            }
            assert.equal(gain.value, .73);
        }
    }
});

test('recorded K joins backing loops but must not start live loops over a cached song', async () => {
    for (const playingSong of [false, true]) {
        let joined = 0;
        const context = {
        getKeyboardDecaySeconds: () => 0,
            window: { mygrainSongBeta: { playing: playingSong } },
            document: { getElementById: () => ({ value: '120' }) }, MAX_SAMPLE_DURATION_SECONDS: 120,
            clampBpmValue: Number, sequencerBPM: 120, BASTARD_LOOP_K_AUDIO_BUFFER_KEY: 'K',
            rerenderBastardLoopKFromRaw() {}, saveAudioBufferToDB: async () => {},
            bastardLoopPlaying: false, ensureBastardLoopKReadyForTransport() {},
            getSharedLoopTransportOriginTime: () => 3,
            setBastardLoopPlaying: () => { joined += 1; return true; },
            syncBastardLoopKUi() {}, setStatus() {}
        };
        load(context, ['applyRecordedBastardLoopKBuffer']);
        await context.applyRecordedBastardLoopKBuffer(audioBuffer([[.2, -.2, .1, -.1]]), { joinSharedTransport: true });
        assert.equal(joined, playingSong ? 0 : 1);
    }
});

function waveformFixture() {
    const strokes = [];
    const text = [];
    const drawing = {
        setTransform() {}, fillRect() {}, beginPath() {}, stroke() {},
        moveTo: (...args) => strokes.push(['move', ...args]),
        lineTo: (...args) => strokes.push(['line', ...args]),
        fillText: value => text.push(value)
    };
    const canvas = {
        clientWidth: 4, clientHeight: 80,
        getContext: () => drawing, setAttribute(name, value) { this[name] = value; }
    };
    const status = {};
    const context = {
        getKeyboardDecaySeconds: () => 0,
        document: { getElementById: id => id === 'performanceBastardLoopKWaveform' ? canvas : status },
        window: { devicePixelRatio: 2 }, bastardLoopKBuffer: null, bastardLoopKRawBuffer: null
    };
    load(context, ['drawBastardLoopKWaveform']);
    return { context, canvas, status, strokes, text };
}

test('K waveform shows an accessible empty state, restored raw audio and rendered stereo peaks at responsive resolution', () => {
    const { context, canvas, status, strokes, text } = waveformFixture();
    context.drawBastardLoopKWaveform();
    assert.match(status.textContent, /Empty/);
    assert.match(text[0], /Record the keyboard/);
    assert.match(canvas['aria-label'], /no recording/);
    assert.equal(canvas.width, 8);
    const raw = audioBuffer([[.1, -.2, .3, -.4]]);
    context.bastardLoopKRawBuffer = raw;
    context.drawBastardLoopKWaveform();
    assert.match(status.textContent, /0.50s/);
    assert.equal(strokes.length, 8);
    context.bastardLoopKBuffer = audioBuffer([[0, 0, 0, 0], [1, -1, .5, -.5]]);
    context.drawBastardLoopKWaveform();
    assert.deepEqual(strokes[8], ['move', 0, 0]);
    assert.deepEqual(strokes[11], ['line', 1, 80]);
    context.drawBastardLoopKWaveform();
    assert.equal(strokes.length, 16);
    canvas.clientWidth = 8;
    context.drawBastardLoopKWaveform();
    assert.equal(canvas.width, 16);
    assert.equal(strokes.length, 32);
});

test('K normalize re-renders waveform from scaled PCM and clear resets it to empty without affecting backing', async () => {
    const { context, status, strokes } = waveformFixture();
    context.bastardLoopKRawBuffer = audioBuffer([[.1, -.2, .1, -.1]]);
    context.bastardLoopKBuffer = context.bastardLoopKRawBuffer;
    Object.assign(context, {
        audioContext: {}, BASTARD_LOOP_K_AUDIO_BUFFER_KEY: 'K', bastardLoopKRecordingState: 'idle',
        applyLinearGainToAudioBuffer: (buffer, gain) => audioBuffer(Array.from({ length: buffer.numberOfChannels }, (_, channel) => Array.from(buffer.getChannelData(channel), value => value * gain))),
        rerenderBastardLoopKFromRaw() { context.bastardLoopKBuffer = context.bastardLoopKRawBuffer; },
        syncBastardLoopKUi: context.drawBastardLoopKWaveform,
        stopBastardLoopK() {}, destroyBastardLoopKFilterLfoSource() {},
        saveAudioBufferToDB: async () => {}, clearAudioBufferFromDB: async () => {},
        syncPerformanceControlState() {}, saveState() {}, setStatus() {}, bastardLoopPlaying: true
    });
    load(context, ['normalizeBastardLoopKRawBuffer', 'normalizeBastardLoopKBuffer', 'clearBastardLoopK']);
    context.drawBastardLoopKWaveform();
    assert.equal(await context.normalizeBastardLoopKBuffer(), true);
    assert.ok(Math.abs(context.bastardLoopKBuffer.getChannelData(0)[1] + .99) < 1e-6);
    assert.equal(strokes.length, 16);
    assert.equal(await context.normalizeBastardLoopKBuffer(), false);
    await context.clearBastardLoopK();
    assert.match(status.textContent, /Empty/);
    assert.equal(context.bastardLoopPlaying, true);
});

test('K raw restore/render refreshes its waveform even when the legacy UI refresh batch is skipped', () => {
    const { context, status } = waveformFixture();
    context.bastardLoopKRawBuffer = audioBuffer([[.2, -.2, .1, -.1]]);
    Object.assign(context, {
        audioContext: {}, bastardLoopKMetadata: null, bastardLoopKSourceBpm: 120, bastardLoopPlaying: false,
        renderBastardLoopKBuffer: () => context.bastardLoopKRawBuffer,
        syncBastardLoopKTempo() {}, syncBastardLoopKUi: () => assert.fail('skipUi must not depend on the legacy UI refresh batch')
    });
    load(context, ['rerenderBastardLoopKFromRaw']);
    assert.equal(context.rerenderBastardLoopKFromRaw({ skipUi: true }), context.bastardLoopKRawBuffer);
    assert.match(status.textContent, /0.50s recorded/);
    context.bastardLoopKRawBuffer = null;
    assert.equal(context.rerenderBastardLoopKFromRaw({ skipUi: true }), null);
    assert.match(status.textContent, /Empty/);
});

test('inline entrypoint scripts and the song adapter parse', () => {
    let parsed = 0;
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=/.test(script[1]) || /\btype\s*=\s*["']application\//.test(script[1])) continue;
        new vm.Script(script[2], { filename: `index-inline-${parsed}.js` });
        parsed += 1;
    }
    assert.ok(parsed > 0);
    new vm.Script(adapterSource, { filename: 'song-beta-adapter.js' });
});
