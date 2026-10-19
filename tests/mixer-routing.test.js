const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extract(name) {
    const signature = html.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
    const start = html.indexOf(signature);
    assert.ok(start >= 0, name);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(name);
}

function fixture(names, values) {
    const context = vm.createContext(values);
    names.forEach(name => vm.runInContext(extract(name), context));
    return context;
}

function soloFixture(overrides = {}) {
    const values = {
        performanceSourceLayerSolo: [], grainLayerSolo: [], loopLayerSolo: [], performanceSourceLayerSoloSnapshot: null,
        oscillatorsEnabled: true, granularLayersEnabled: true, generatedSampleLayerEnabled: true, generatedDryLoopEnabled: true,
        generatedSampleSolo: false, audioContext: null, activeGrains: new Map(), refreshes: 0,
        syncPerformanceSourceLayerSoloButtons() {}, syncGrainLayerSoloButtons() {}, syncLoopLayerSoloButtons() {},
        syncPerformanceControlState() {}, rescheduleActiveGrainsFromNow() {}, setStatus() {}, saveState() {},
        getGeneratedSampleVolumeValue: () => 0.8, getGranularSourceLevelMultiplier: () => 1,
        ...overrides
    };
    const context = vm.createContext(values);
    vm.runInContext(`
        function setOscillatorsEnabled(value) { oscillatorsEnabled = value; }
        function setGranularLayersEnabled(value) { granularLayersEnabled = value; }
        function setGeneratedSampleLayerEnabled(value) { generatedSampleLayerEnabled = value; }
        function setGeneratedDryLoopEnabled(value) { generatedDryLoopEnabled = value; }
        function updatePerformanceSoloMixGains() { refreshes += 1; }
    `, context);
    for (const name of [
        'normalizePerformanceSourceLayerSolo', 'normalizeGrainLayerSolo', 'normalizeLoopLayerSolo',
        'hasPerformanceSourceLayerSolo', 'hasGrainLayerSolo', 'hasLoopLayerSolo', 'hasAnyPerformanceLayerSoloSelection',
        'capturePerformanceSourceLayerSoloState', 'restorePerformanceSourceLayerSoloState', 'syncPerformanceLayerSoloIsolation',
        'restorePerformanceSourceLayerSolo', 'setPerformanceSourceLayerSolo', 'setLoopLayerSolo', 'setGrainLayerSolo',
        'getLoopLayerSoloGain', 'getGrainLayerSoloGain', 'getGranularSourceGainMap',
        'getOscillatorVoiceSoloTarget', 'isOscillatorVoiceAudibleUnderSolo'
    ]) vm.runInContext(extract(name), context);
    return context;
}

for (const key of ['osc', 'granular', 'sample', 'loop']) {
    test(`${key} solo joins the common group, isolates loops and restores the prior switches`, () => {
        const context = soloFixture({ oscillatorsEnabled: false, generatedDryLoopEnabled: false });
        const baseline = { ...context.capturePerformanceSourceLayerSoloState() };
        context.setPerformanceSourceLayerSolo(key, { toggle: true, silent: true });
        assert.equal(context.getLoopLayerSoloGain('drums'), 0);
        assert.equal(context.getLoopLayerSoloGain('bastarda'), 0);
        assert.equal(context.oscillatorsEnabled, key === 'osc');
        assert.equal(context.granularLayersEnabled, ['granular', 'sample'].includes(key));
        assert.equal(context.generatedDryLoopEnabled, key === 'loop');
        assert.equal(context.getGrainLayerSoloGain('A'), ['granular', 'sample'].includes(key) ? 1 : 0);
        assert.equal(context.isOscillatorVoiceAudibleUnderSolo('keyboard'), key === 'osc');
        context.setPerformanceSourceLayerSolo(key, { toggle: true, silent: true });
        assert.deepEqual({ ...context.capturePerformanceSourceLayerSoloState() }, baseline);
        assert.equal(context.getLoopLayerSoloGain('drums'), 1);
        assert.equal(context.performanceSourceLayerSoloSnapshot, null);
        assert.equal(context.refreshes, 2);
    });
}

test('source, grain and drum solos are additive across groups, not mutually exclusive', () => {
    const context = soloFixture();
    context.setPerformanceSourceLayerSolo('osc', { toggle: true, silent: true });
    context.setLoopLayerSolo('drums', { toggle: true, silent: true });
    context.setGrainLayerSolo('A', { toggle: true, silent: true });
    assert.equal(context.oscillatorsEnabled, true);
    assert.equal(context.granularLayersEnabled, true);
    assert.equal(context.getLoopLayerSoloGain('drums'), 1);
    assert.equal(context.getLoopLayerSoloGain('bastarda'), 0);
    assert.equal(context.getGrainLayerSoloGain('A'), 1);
    assert.equal(context.getGrainLayerSoloGain('B'), 0);
    context.setPerformanceSourceLayerSolo('osc', { toggle: true, silent: true });
    assert.equal(context.oscillatorsEnabled, false);
    assert.equal(context.getLoopLayerSoloGain('drums'), 1);
    context.setGrainLayerSolo('A', { toggle: true, silent: true });
    assert.equal(context.granularLayersEnabled, false);
    context.setLoopLayerSolo('drums', { toggle: true, silent: true });
    assert.deepEqual({ ...context.capturePerformanceSourceLayerSoloState() }, {
        oscillatorsEnabled: true, granularLayersEnabled: true, generatedSampleLayerEnabled: true, generatedDryLoopEnabled: true
    });
});

test('loop L synth solo keeps its oscillator path alive without leaking keyboard OSC', () => {
    const context = soloFixture();
    context.setLoopLayerSolo('bastardl', { toggle: true, silent: true });
    assert.equal(context.oscillatorsEnabled, true);
    assert.equal(context.isOscillatorVoiceAudibleUnderSolo('bastardloopl'), true);
    assert.equal(context.isOscillatorVoiceAudibleUnderSolo('keyboard'), false);
    assert.equal(context.isOscillatorVoiceAudibleUnderSolo('arp'), false);
});

test('Sample solo opens the granular bus, selects generated audio and excludes other samples', () => {
    const context = soloFixture();
    const generated = { kind: 'generated' };
    const recorded = { kind: 'grainASample' };
    context.setPerformanceSourceLayerSolo('sample', { toggle: true, silent: true });
    assert.equal(context.generatedSampleLayerEnabled, true);
    const gains = context.getGranularSourceGainMap([generated, recorded], 0.6, 'A');
    assert.equal(gains.get(generated), 0.6);
    assert.equal(gains.has(recorded), false);
    context.makeGranularSource = kind => kind === 'generated' ? generated : recorded;
    vm.runInContext(extract('getAvailableGranularSources'), context);
    assert.deepEqual(Array.from(context.getAvailableGranularSources({ mode: 'grainASample', layer: 'A' })), [generated]);
});

test('Sample and Grain A solos combine by source/layer without including Grain B recordings', () => {
    const context = soloFixture();
    const generated = { kind: 'generated' };
    const recorded = { kind: 'grainASample' };
    context.setPerformanceSourceLayerSolo('sample', { toggle: true, silent: true });
    context.setGrainLayerSolo('A', { toggle: true, silent: true });
    assert.equal(context.getGranularSourceGainMap([generated, recorded], 1, 'A').has(recorded), true);
    assert.equal(context.getGranularSourceGainMap([generated, recorded], 1, 'B').has(recorded), false);
    context.setPerformanceSourceLayerSolo('granular', { toggle: true, silent: true });
    assert.equal(context.getGranularSourceGainMap([generated, recorded], 1, 'B').has(recorded), true);
});

test('every solo change refreshes all live audio buses, including Q, drums and dry playback', () => {
    const calls = [];
    const names = ['updateSourceMixGains', 'updateGeneratedDryLoopMix', 'updateBastardLoopMix', 'updateBastardLoop2Mix',
        'updateBastardLoop3Mix', 'updateBastardLoopVMix', 'updateBastardLoopPMix', 'updateBastardLoopOMix',
        'updateBastardLoopLMix', 'updateBastardLoopXMix', 'updateBastardLoopMMix', 'updateBastardLoopMPlusMix',
        'updateDropboxSampleLayerMix', 'updateDrumMachineMix', 'syncActiveOscillatorSoloIsolation',
        'rescheduleActiveGrainsFromNow', 'restoreSoloKeyboardVoices'];
    const context = fixture(['updatePerformanceSoloMixGains'], {
        ...Object.fromEntries(names.map(name => [name, () => calls.push(name)])),
        window: { mygrainQ: { updateEffects: () => calls.push('Q') } },
        audioContext: {}, activeGrains: new Map([['C3', {}]]), oscillatorsEnabled: true
    });
    context.updatePerformanceSoloMixGains();
    assert.deepEqual(new Set(calls), new Set([...names, 'Q']));
});

test('solo restoration revives active keyboard voices, never stopped selections or already-playing voices', () => {
    const calls = [];
    const context = fixture(['restoreSoloKeyboardVoices'], {
        audioContext: { currentTime: 3 }, oscillatorsEnabled: true,
        activeGrains: new Map([
            ['keyboard-C3', { note: 'C3', role: 'keyboard', velocity: 0.7 }],
            ['keyboard-D3', { note: 'D3', role: 'keyboard', releasing: true }],
            ['keyboard-E3', { note: 'E3', role: 'keyboard', velocity: 1 }],
            ['sequencer-F3', { note: 'F3', role: 'sequencer' }]
        ]),
        activeOscVoices: new Map([['keyboard-E3', {}]]),
        makePerformanceStreamId: (role, note) => `${role}-${note}`,
        isOscillatorVoiceAudibleUnderSolo: () => true, getClickGuardSeconds: () => 0.01,
        playOscillatorNote: (...args) => calls.push(args)
    });
    context.restoreSoloKeyboardVoices();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ['C3', 3.01, 0.7]);
    context.activeGrains.clear();
    context.restoreSoloKeyboardVoices();
    assert.equal(calls.length, 1);
});

test('solo-muted held granular streams pause scheduling instead of losing the held note', () => {
    const grain = { note: 'C3', nextTime: 0, velocity: 1, role: 'keyboard' };
    const context = fixture(['scheduleActiveGrains'], {
        audioContext: { currentTime: 5 }, activeGrains: new Map([['held', grain]]),
        stopGrainScheduler() {}, GRAIN_SCHEDULER_LOOKAHEAD: 0.1, GRAIN_SCHEDULER_INTERVAL: 25,
        getGranularKeyboardNoteFrequency: () => 130.8, withModulationEvaluationTime: (time, callback) => callback(),
        getGranularLayerSettings: () => [], hasAnyPerformanceLayerSoloSelection: () => true,
        grainSchedulerTimerId: null, setTimeout: () => 1
    });
    context.scheduleActiveGrains();
    assert.equal(context.activeGrains.size, 1);
    assert.equal(grain.nextTime, 5.1);
    grain.releasing = true;
    context.scheduleActiveGrains();
    assert.equal(context.activeGrains.size, 0);
});

function transportFixture(overrides = {}) {
    const calls = [];
    const layers = ['BastardLoop', 'BastardLoop2', 'BastardLoop3', 'BastardLoopV', 'BastardLoopP', 'BastardLoopO',
        'BastardLoopL', 'BastardLoopX', 'BastardLoopM', 'BastardLoopMPlus', 'DropboxSampleLayer'];
    const values = {
        ...Object.fromEntries(layers.flatMap(name => [
            [`start${name}`, () => false], [`stop${name}`, () => calls.push(`stop${name}`)], [`sync${name}Ui`, () => {}]
        ])),
        getSharedLoopTransportOriginTime: () => null, getBufferedTransportStartTime: () => 12.5,
        queueBastardLoopXFilterLfoReset() {}, clearBastardLoopVCutPreview() {}, ensureBastardLoopXFilterLfoSource() {},
        window: { mygrainQ: { start: () => false, stop: () => calls.push('stopQ') } },
        hasPlayableDrumMachinePattern: () => true, drumMachineEnabled: true,
        startDrumMachine: (start, options) => { calls.push(['drums', start, options]); return true; },
        stopDrumMachine: options => calls.push(['stopDrums', options]),
        bastardLoopPlaying: false, bastardLoopTransportStartTime: null, bastardLoopXFilterLfoPendingStartTime: null,
        sequencerEditorPlaybackGeneration: 0, ...overrides
    };
    return { calls, context: fixture(['startAllBastardLoopLayers', 'stopAllBastardLoopLayers'], values) };
}

test('drums-only Bastardloop start uses the exact shared audio-clock origin without changing mutes/levels', () => {
    const { calls, context } = transportFixture();
    assert.equal(context.startAllBastardLoopLayers(21.25, { skipUi: true }), true);
    assert.equal(context.bastardLoopPlaying, true);
    assert.equal(context.bastardLoopTransportStartTime, 21.25);
    assert.equal(calls[0][1], 21.25);
    assert.deepEqual({ ...calls[0][2] }, { silent: true, skipSave: true, ensureAudible: false });
});

for (const overrides of [{ drumMachineEnabled: false }, { hasPlayableDrumMachinePattern: () => false }]) {
    test(`group start leaves ${overrides.drumMachineEnabled === false ? 'muted' : 'empty'} drums alone`, () => {
        const { calls, context } = transportFixture(overrides);
        assert.equal(context.startAllBastardLoopLayers(null, { skipUi: true }), false);
        assert.equal(calls.length, 0);
    });
}

test('group stop includes drums and preserves scheduled origin only when requested', () => {
    for (const preserveTransportState of [false, true]) {
        const { calls, context } = transportFixture({ bastardLoopPlaying: true, bastardLoopTransportStartTime: 3 });
        context.stopAllBastardLoopLayers({ skipUi: true, fade: false, preserveTransportState });
        const stop = calls.find(call => Array.isArray(call));
        assert.deepEqual({ ...stop[1] }, { silent: true, skipSave: true, preserveTransportState, fade: false });
        assert.equal(context.bastardLoopPlaying, preserveTransportState);
        assert.equal(context.bastardLoopTransportStartTime, preserveTransportState ? 3 : null);
    }
});

test('independent transport callers can explicitly exclude drums', () => {
    const { calls, context } = transportFixture();
    context.startAllBastardLoopLayers(5, { skipUi: true, includeDrums: false });
    context.stopAllBastardLoopLayers({ skipUi: true, includeDrums: false });
    assert.equal(calls.some(call => Array.isArray(call)), false);
});

for (const kind of ['kick', 'snare', 'perc', 'hat', 'extra']) {
    test(`drum group availability recognizes programmed ${kind}`, () => {
        const values = {
            drumMachineKickBuffer: null, drumMachineSnareBuffer: null, drumMachinePercBuffer: null,
            drumMachineKickPattern: [], drumMachineSnarePattern: [], drumMachinePercPattern: [], drumMachineHatPattern: [], drumMachineExtraTracks: {}
        };
        if (kind === 'extra') values.drumMachineExtraTracks = { rim: { buffer: {}, pattern: [true] } };
        else {
            const label = kind[0].toUpperCase() + kind.slice(1);
            values[`drumMachine${label}Pattern`] = [true];
            if (kind !== 'hat') values[`drumMachine${label}Buffer`] = {};
        }
        const context = fixture(['hasPlayableDrumMachinePattern'], values);
        assert.equal(context.hasPlayableDrumMachinePattern(), true);
    });
}

test('loaded drum buffers without playable steps do not unexpectedly program new drums', () => {
    const context = fixture(['hasPlayableDrumMachinePattern'], {
        drumMachineKickBuffer: {}, drumMachineSnareBuffer: {}, drumMachinePercBuffer: {},
        drumMachineKickPattern: [false], drumMachineSnarePattern: [false], drumMachinePercPattern: [false],
        drumMachineHatPattern: [false], drumMachineExtraTracks: { rim: { buffer: {}, pattern: [false] } }
    });
    assert.equal(context.hasPlayableDrumMachinePattern(), false);
});

test('repeated drum starts at the same origin do not reset the clock, unmute tracks or save twice', () => {
    const context = fixture(['startDrumMachine'], {
        audioContext: {}, preFilterGainNode: {}, drumMachineKickBuffer: {}, drumMachinePlaying: true,
        drumMachineTransportStartTime: 17, ensureDrumMachineStartAudibility: () => assert.fail('Already started'),
        syncPerformanceControlState: () => assert.fail('Already started')
    });
    assert.equal(context.startDrumMachine(17), true);
});

test('granular shortcut prevents duplicate setup and always recovers its buttons after an audio error', async () => {
    const buttons = [{ disabled: false }, { disabled: false }];
    const statuses = [];
    const context = fixture(['prepareGranularKeyboardFromUi'], {
        document: { querySelectorAll: () => buttons }, ensureAudioReadyForKeyInteraction: async () => false,
        setStatus: message => statuses.push(message)
    });
    assert.equal(await context.prepareGranularKeyboardFromUi(), false);
    assert.equal(buttons.every(button => !button.disabled), true);
    assert.match(statuses[0], /Audio could not start/);
    buttons[0].disabled = true;
    assert.equal(await context.prepareGranularKeyboardFromUi(), false);
    assert.equal(statuses.length, 1);
});

test('module shortcuts cover all 25 channels and remain distinct from the top slider shortcuts', () => {
    const mapping = html.match(/const PERFORMANCE_MIXER_MODULE_JUMPS = (\{[\s\S]*?\n        \});/)[1];
    const targets = vm.runInNewContext(`(${mapping})`);
    assert.equal(Object.keys(targets).length, 25);
    assert.match(extract('ensurePerformanceMixerModuleJumpButtonsMounted'), /\$\{control.id\}ModuleJumpBtn/);
    assert.match(extract('ensurePerformanceMixerModuleJumpButtonsMounted'), /card.querySelector\('\.performance-inline-mixer-actions'\)/);
    assert.match(extract('syncPerformanceMixerVuVisibility'), /ensurePerformanceMixerModuleJumpButtonsMounted/);
    assert.match(html, /id="sectionJumpGranularKeysBtn"[^>]+data-granular-keyboard-ready/);
    assert.match(html, /id="performanceGranularKeysBtn"[^>]+data-granular-keyboard-ready/);
});
