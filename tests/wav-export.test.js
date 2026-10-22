const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.WAV_EXPORT_SOURCE || path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('        async function renderLiveOutputBarsBuffer(options = {}) {');
const end = html.indexOf('\n        async function renderDawReadyBarsExport()', start);

function fixture(overrides = {}) {
    const events = [];
    const state = {
        audioContext: { state: 'running', currentTime: 5, async resume() { events.push('resume'); this.state = 'running'; this.currentTime = 10; } },
        canPlayGrains: () => true, hasPlayableBastardLoopLTransportSource: () => false,
        hasPlayableBastardLoopXSequence: () => false, hasPlayableDrumMachinePattern: () => false,
        syncPerformanceExportBars: () => 1, performanceExportBars: { value: 1 }, DEFAULT_EXPORT_BARS: 1,
        saveState() {}, clampBpmValue: () => 120, sequencerBPM: 120,
        document: { getElementById: () => ({ value: 120 }) },
        sequencerPlaying: false, bastardLoopPlaying: false, drumMachinePlaying: false,
        isArpeggiatorPlaying: () => false, generatedLoopTransportEnabled: false,
        arpEnabled: false, holdEnabled: false, window: {},
        updateEffects() {}, syncPerformanceControlState() {}, delayMs: async () => {},
        EXPORT_RENDER_SETTLE_MS: 90, EXPORT_RENDER_LEAD_IN_SECONDS: .18, EXPORT_RENDER_TAIL_SECONDS: .06,
        getBufferedTransportStartTime: time => time, restartInternalEffectOscillators() {},
        prewarmTransportBuffers() {},
        getTransportOutputLatencySeconds: () => 0,
        withBufferedTransportStart: (time, callback) => callback(),
        finalFxPlacementLfoEnabled: false, updateFinalFxPlacementLfo() {},
        recordLiveOutputBuffer: async (duration, options) => {
            events.push(['record', duration, options.captureStartTime]);
            return { audioBuffer: {}, captureStartTime: options.captureStartTime };
        },
        sliceAudioBuffer: (buffer, offset, duration) => ({ offset, duration }),
        startSequencer: time => events.push(['sequencer', time]),
        startArpeggiatorPlayback: time => events.push(['arp', time]),
        stopSequencer: () => events.push('stop-sequencer'),
        stopArpeggiatorPlayback: () => events.push('stop-arp'),
        stopAllBastardLoopLayers: () => events.push('stop-loops'),
        startDrumMachine: time => events.push(['drums', time]),
        stopDrumMachine: () => events.push('stop-drums'),
        ...overrides
    };
    for (const suffix of ['', '2', '3', 'V', 'P', 'O', 'M', 'MPlus', 'K']) {
        for (const property of ['Buffer', 'Source']) state[`bastardLoop${suffix}${property}`] ??= null;
        state[`bastardLoop${suffix}Enabled`] ??= false;
    }
    for (const suffix of ['A', 'B', 'C', 'V', 'P', 'O', 'L', 'X', 'M', 'MPlus', 'K']) {
        const name = { A: 'startBastardLoop', B: 'startBastardLoop2', C: 'startBastardLoop3' }[suffix] || `startBastardLoop${suffix}`;
        state[name] = time => events.push([suffix, time]);
    }
    for (const name of ['bastardLoopLEnabled', 'bastardLoopXEnabled', 'bastardLoopLTransportActive', 'bastardLoopLSchedulerTimerId', 'bastardLoopXTransportActive', 'bastardLoopXSchedulerTimerId', 'drumMachineEnabled', 'dropboxSampleLayerEnabled']) state[name] ??= false;
    for (const name of ['bastardLoopXSampleBuffer', 'dropboxSampleLayerBuffer', 'dropboxSampleLayerRawBuffer', 'dropboxSampleLayerSource']) state[name] ??= null;
    state.startDropboxSampleLayer = time => events.push(['sample', time]);
    const context = vm.createContext(state);
    vm.runInContext(html.slice(start, end), context);
    return { events, context };
}

test('stopped export starts enabled loaded loops after the capture is attached and restores stop', async () => {
    const { context, events } = fixture({ bastardLoopEnabled: true, bastardLoopBuffer: {} });
    await context.renderLiveOutputBarsBuffer();
    assert.ok(events.find(event => event[0] === 'A'));
    assert.ok(events.findIndex(event => event[0] === 'record') < events.findIndex(event => event[0] === 'A'));
    assert.equal(events.at(-1), 'stop-loops');
});

test('already-playing loop export restarts after capture and leaves transport playing', async () => {
    const { context, events } = fixture({ bastardLoopPlaying: true, bastardLoopEnabled: true, bastardLoopBuffer: {}, bastardLoopSource: {} });
    await context.renderLiveOutputBarsBuffer();
    assert.equal(events.filter(event => event === 'stop-loops').length, 1);
    assert.ok(events.findIndex(event => event[0] === 'record') < events.findIndex(event => event[0] === 'A'));
    assert.notEqual(events.at(-1), 'stop-loops');
});

test('stopped export resumes the context before determining capture timing', async () => {
    const { context, events } = fixture({ bastardLoopEnabled: true, bastardLoopBuffer: {} });
    context.audioContext.state = 'suspended';
    await context.renderLiveOutputBarsBuffer();
    assert.equal(events[0], 'resume');
    assert.equal(events.find(event => event[0] === 'record')[2], 10);
});

test('stopped export starts enabled drum patterns and restores stopped drums', async () => {
    const { context, events } = fixture({ drumMachineEnabled: true, hasPlayableDrumMachinePattern: () => true });
    await context.renderLiveOutputBarsBuffer();
    assert.ok(events.find(event => event[0] === 'drums'));
    assert.equal(events.at(-1), 'stop-drums');
});

test('explicit stem render does not auto-start unrelated loaded loops', async () => {
    const { context, events } = fixture({ bastardLoopEnabled: true, bastardLoopBuffer: {} });
    await context.renderLiveOutputBarsBuffer({ forceSequencer: true });
    assert.ok(events.find(event => event[0] === 'sequencer'));
    assert.equal(events.some(event => event[0] === 'A'), false);
});

test('stopped export restores loop transport if recording fails', async () => {
    const { context, events } = fixture({ bastardLoopEnabled: true, bastardLoopBuffer: {}, recordLiveOutputBuffer: async () => { throw new Error('capture failed'); } });
    await assert.rejects(context.renderLiveOutputBarsBuffer(), /capture failed/);
    assert.equal(events.at(-1), 'stop-loops');
});

test('stopped export keeps disabled loop layers disabled', async () => {
    const { context, events } = fixture({ bastardLoopEnabled: false, bastardLoopBuffer: {} });
    await context.renderLiveOutputBarsBuffer();
    assert.equal(events.some(event => event[0] === 'A'), false);
});
