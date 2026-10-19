const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const adapter = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');

function extractFunction(name) {
    let start = html.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
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

function fixture(names = []) {
    const calls = { grain: [], oscillator: [], sample: [], release: [], ready: [], save: 0, stop: 0, status: [] };
    const buttons = Array.from({ length: 2 }, () => ['osc', 'grain', 'piano', 'strings'].map(source => ({
        dataset: { keyboardSound: source }, attributes: {}, selected: false,
        classList: { toggle(name, selected) { this.selected = selected; } },
        setAttribute(name, value) { this.attributes[name] = value; }
    }))).flat();
    const player = {
        noteOn: async (...args) => { calls.sample.push(args); },
        noteOff: (...args) => calls.release.push(args),
        stop: () => { calls.stop += 1; },
        prepare: async (...args) => calls.ready.push(args)
    };
    const context = {
        keyboardSoundSource: 'grain', keyboardSoundSelectionToken: 0, keyboardInteractionEpoch: 0,
        keyboardVoiceOutputs: new Map(),
        arpEnabled: false, keyboardArpTransportPlaying: false,
        keyboardSoundReadiness: 'idle', keyboardSoundPreparation: null,
        keyboardSamplePlayer: player, keyboardSamplePlayerContext: null,
        activeGrains: new Map(), activeOscVoices: new Map(),
        heldNotes: new Set(['C4']), activeKeyCount: 1,
        document: { querySelectorAll: selector => selector === '[data-keyboard-sound]' ? buttons : [], getElementById: () => null },
        audioContext: { currentTime: 1 }, granularLayersEnabled: true,
        startGrainStream: (...args) => calls.grain.push(args),
        playOscillatorNote: (...args) => calls.oscillator.push(args),
        stopGrainStream: (...args) => calls.release.push(['grain', ...args]),
        stopOscillatorNote: (...args) => calls.release.push(['osc', ...args]),
        ensureSynthVoicePathAudible: options => calls.ready.push(options),
        setGranularLayersEnabled: value => { context.granularLayersEnabled = value; },
        getKeyboardSamplePlayer: () => player,
        hasAnyPerformanceLayerSoloSelection: () => false,
        getKeyboardNoteFrequency: () => 440 * 2 ** ((72 - 69) / 12),
        makePerformanceStreamId: (role, note) => `${role}:${note}`,
        ensureAudioReadyForKeyInteraction: async () => true,
        prepareKeyboardSound: async source => calls.ready.push(source),
        syncKeyboardSoundControls: () => {}, warmKeyboardSound: () => {},
        saveState: () => { calls.save += 1; },
        setStatus: (...args) => calls.status.push(args),
        stopArpeggiatorPlayback() {}
    };
    vm.createContext(context);
    vm.runInContext(['normalizeKeyboardSoundSource', 'isKeyboardSoundRole', 'getKeyboardSamplePitches', 'silenceKeyboardVoiceOutputs', 'stopKeyboardArpTransport', ...names].map(extractFunction).join('\n'), context);
    return { context, calls, player, buttons };
}

test('legacy and invalid sound choices default to Grain; only the four supported values survive', () => {
    const { context } = fixture();
    for (const source of [undefined, null, '', 'invalid', {}, 'PIANO']) assert.equal(context.normalizeKeyboardSoundSource(source), 'grain');
    for (const source of ['osc', 'grain', 'piano', 'strings']) assert.equal(context.normalizeKeyboardSoundSource(source), source);
});

for (const source of ['osc', 'grain', 'piano', 'strings']) {
    test(`${source} is synchronized across both sound switches with one selected option each`, () => {
        const { context, buttons } = fixture(['syncKeyboardSoundControls']);
        context.keyboardSoundSource = source;
        context.syncKeyboardSoundControls();
        assert.equal(buttons.filter(button => button.attributes['aria-pressed'] === 'true').length, 2);
        for (const button of buttons) assert.equal(button.attributes['aria-pressed'], String(button.dataset.keyboardSound === source));
    });
}

test('changing sounds cancels keyboard and arp voices without touching sequencer or Q backing', () => {
    const { context, calls } = fixture(['syncKeyboardSoundControls', 'stopKeyboardSounds', 'setKeyboardSoundSource']);
    context.activeGrains = new Map([['keyboard:C4', { role: 'keyboard', note: 'C4' }], ['sequencer:C4', { role: 'sequencer', note: 'C4' }]]);
    context.activeOscVoices = new Map([['arp:D4', { role: 'arp', note: 'D4' }], ['sequencer:D4', { role: 'sequencer', note: 'D4' }]]);
    context.setKeyboardSoundSource('strings');
    assert.equal(context.keyboardSoundSource, 'strings');
    assert.equal(context.heldNotes.size, 0);
    assert.equal(context.activeKeyCount, 0);
    assert.equal(calls.stop, 1);
    assert.equal(calls.release.length, 2);
    assert.ok(calls.release.every(args => args[2]?.role !== 'sequencer'));
    assert.equal(calls.save, 1);
});

test('restoring the same source refreshes switches without killing held notes or saving', () => {
    const { context, calls } = fixture(['syncKeyboardSoundControls', 'stopKeyboardSounds', 'setKeyboardSoundSource']);
    context.setKeyboardSoundSource('grain', { skipSave: true });
    assert.equal(calls.stop, 0);
    assert.equal(calls.save, 0);
    assert.equal(context.heldNotes.size, 1);
});

for (const source of ['piano', 'strings']) {
    test(`${source} uses the independent sample player, shifted keyboard pitch, velocity, and audio time`, async () => {
        const { context, calls } = fixture(['playKeyboardSound']);
        context.keyboardSoundSource = source;
        context.playKeyboardSound('C4', 2, .5, { role: 'keyboard' });
        await Promise.resolve();
        const [key, pitch, options] = calls.sample[0];
        assert.equal(key, 'keyboard:C4');
        assert.ok(Math.abs(pitch - 72) < 1e-9);
        assert.equal(options.instrument, source);
        assert.equal(options.velocity, 64);
        assert.equal(options.startTime, 2);
    });
}

test('releasing sample notes and keyboard arp uses the same voice IDs without releasing Q', () => {
    const { context, calls } = fixture(['stopKeyboardSound']);
    context.stopKeyboardSound('C4', null, { role: 'arp', streamId: 'arp-stream', immediate: true });
    assert.equal(calls.release.at(-1)[0], 'arp:C4');
    assert.equal(calls.release.at(-1)[1].immediate, true);
    assert.equal(calls.release[0][2].streamId, 'arp-stream');
});

test('sample player connects independently to the keyboard capture tap and common audible path', () => {
    const { context, player } = fixture(['getKeyboardSamplePlayer', 'getKeyboardSampleOutputNode', 'getKeyboardSampleSoloGain']);
    const output = {}, capture = {};
    context.preFilterGainNode = output;
    context.keyboardGrainCaptureGain = capture;
    context.keyboardSampleOutputBuses = new Map();
    context.audioContext.createGain = () => ({ connections: [], connect(destination) { this.connections.push(destination); } });
    let host;
    context.window = { MygrainQ: { createKeyboardPlayer: specification => { host = specification; return player; } } };
    assert.equal(context.getKeyboardSamplePlayer(), player);
    assert.equal(host.context(), context.audioContext);
    const pianoOutput = host.output('piano');
    const stringsOutput = host.output('strings');
    assert.notEqual(pianoOutput, stringsOutput);
    assert.deepEqual(pianoOutput.connections, [output]);
    assert.deepEqual(stringsOutput.connections, [output]);
    assert.equal(host.output('piano'), pianoOutput);
    assert.equal(host.capture(), capture);
    vm.runInContext(extractFunction('getKeyboardSampleVolume'), context);
    context.document.getElementById = id => ({ value: id === 'performanceKeyboardStringsVolume' ? '27' : '0' });
    assert.equal(host.volume('piano'), 0);
    assert.equal(host.volume('strings'), .27);
    assert.equal(context.getKeyboardSamplePlayer(), player);
});

test('Q sound selection warms the visible keyboard at the actual playing velocity before reporting ready', async () => {
    const { context, calls } = fixture(['prepareKeyboardSound']);
    context.keyboardSoundSource = 'strings';
    context.document.querySelectorAll = () => [{ dataset: { note: 'C4' } }, { dataset: { note: 'D4' } }];
    context.getKeyboardNoteFrequency = note => note === 'C4' ? 261.6255653005986 : 293.6647679174076;
    await context.prepareKeyboardSound('strings');
    assert.equal(calls.ready.length, 2);
    assert.equal(calls.ready[0][0], 'strings');
    assert.ok(Math.abs(calls.ready[0][1] - 60) < 1e-9);
    assert.ok(Math.abs(calls.ready[1][1] - 62) < 1e-9);
    assert.ok(calls.ready.every(args => args[2] === 127));
});

test('keyboard sample preparation starts a bounded parallel batch instead of serial network waits', async () => {
    const { context, player } = fixture(['prepareKeyboardSound']);
    context.keyboardSoundSource = 'piano';
    context.document.querySelectorAll = () => Array.from({ length: 8 }, (_, index) => ({ dataset: { note: `C${index}` } }));
    context.getKeyboardNoteFrequency = note => 440 * 2 ** ((24 + Number(note.slice(1)) * 3 - 69) / 12);
    const releases = [];
    let active = 0;
    let peak = 0;
    player.prepare = async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => releases.push(resolve));
        active -= 1;
    };
    const preparation = context.prepareKeyboardSound('piano');
    try {
        assert.equal(active, 3);
        while (releases.length) {
            releases.splice(0).forEach(resolve => resolve());
            await new Promise(setImmediate);
        }
        await preparation;
        assert.equal(peak, 3);
    } finally {
        context.keyboardSoundSource = 'grain';
        releases.splice(0).forEach(resolve => resolve());
        await preparation;
    }
});

test('sample warmup excludes horizontally clipped and hidden keys instead of filling the cache with the entire bank', () => {
    const { context } = fixture();
    const rectangle = (left, right, height = 100) => ({ left, right, width: right - left, height });
    context.window = { innerWidth: 390 };
    context.document.getElementById = () => ({
        getBoundingClientRect: () => rectangle(-100, 700),
        parentElement: { getBoundingClientRect: () => rectangle(20, 360) }
    });
    context.document.querySelectorAll = () => [
        ['C1', rectangle(-50, 0)], ['C2', rectangle(20, 50)],
        ['C3', rectangle(330, 380)], ['C4', rectangle(380, 430)],
        ['C5', rectangle(100, 140, 0)]
    ].map(([note, bounds]) => ({ dataset: { note }, getBoundingClientRect: () => bounds }));
    context.getKeyboardNoteFrequency = note => 440 * 2 ** (((Number(note.slice(1)) + 1) * 12 - 69) / 12);
    assert.deepEqual(Array.from(context.getKeyboardSamplePitches()).map(Math.round), [36, 48]);
});

test('both keyboard status displays remain loading until every visible sample finishes and repeated warmups share work', async () => {
    const { context, player } = fixture(['syncKeyboardSoundControls', 'prepareKeyboardSound']);
    const statuses = [{ dataset: {} }, { dataset: {} }];
    const keys = [{ dataset: { note: 'C4' } }, { dataset: { note: 'D4' } }];
    context.keyboardSoundSource = 'strings';
    context.document.querySelectorAll = selector => selector === '[data-keyboard-sound-status]' ? statuses : selector === '#keyboardContainer .key' ? keys : [];
    context.getKeyboardNoteFrequency = note => 440 * 2 ** (((note === 'C4' ? 60 : 62) - 69) / 12);
    const releases = [];
    player.prepare = () => new Promise(resolve => releases.push(resolve));
    const first = context.prepareKeyboardSound('strings');
    const second = context.prepareKeyboardSound('strings');
    assert.equal(releases.length, 2);
    assert.ok(statuses.every(status => status.dataset.keyboardSoundReadiness === 'loading'));
    releases[0]({});
    await new Promise(setImmediate);
    assert.ok(statuses.every(status => status.dataset.keyboardSoundReadiness === 'loading'));
    releases[1]({});
    await Promise.all([first, second]);
    assert.ok(statuses.every(status => status.dataset.keyboardSoundReadiness === 'ready'));
    assert.ok(statuses.every(status => /Q Strings ready for visible keys/.test(status.textContent)));
});

test('failed warmup stops further background requests and can be retried', async () => {
    const { context, player } = fixture(['prepareKeyboardSound']);
    context.keyboardSoundSource = 'piano';
    context.document.querySelectorAll = () => Array.from({ length: 8 }, (_, index) => ({ dataset: { note: `C${index}` } }));
    context.getKeyboardNoteFrequency = note => 440 * 2 ** ((24 + Number(note.slice(1)) * 3 - 69) / 12);
    let loads = 0;
    player.prepare = async () => { loads += 1; throw new Error('Sample unavailable'); };
    await assert.rejects(context.prepareKeyboardSound('piano'), /Sample unavailable/);
    assert.equal(loads, 3);
    assert.equal(context.keyboardSoundReadiness, 'error');
    player.prepare = async () => ({});
    await context.prepareKeyboardSound('piano');
    assert.equal(context.keyboardSoundReadiness, 'ready');
});

test('first engine initialization warms the restored sample source without waiting for the first played note', () => {
    assert.match(html, /const restored = restoreState\(\);\s*warmKeyboardSound\(\);/);
    assert.match(extractFunction('updateOctaveDisplay'), /warmKeyboardSound\(\)/);
    assert.match(extractFunction('rebuildAudioEngineGraph'), /warmKeyboardSound\(\)/);
});

test('slower old source preparation cannot overwrite the latest selected sound or status', async () => {
    const { context, calls } = fixture(['syncKeyboardSoundControls', 'stopKeyboardSounds', 'setKeyboardSoundSource', 'selectKeyboardSoundFromUi']);
    let finish;
    context.prepareKeyboardSound = source => source === 'piano' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
    const oldSelection = context.selectKeyboardSoundFromUi('piano');
    await new Promise(setImmediate);
    await context.selectKeyboardSoundFromUi('strings');
    finish();
    await oldSelection;
    assert.equal(context.keyboardSoundSource, 'strings');
    assert.equal(calls.save, 1);
    assert.equal(calls.status.length, 1);
    assert.match(calls.status[0][0], /Q Strings/);
});

test('engine guards isolate only keyboard/arp selection and leave other synth roles unchanged', () => {
    const grain = extractFunction('startGrainStream');
    const oscillator = extractFunction('playOscillatorNote');
    for (const source of ['osc', 'grain', 'piano', 'strings']) {
        for (const role of ['keyboard', 'arp', 'sequencer']) {
            const { context } = fixture();
            context.options = { role };
            context.keyboardSoundSource = source;
            assert.equal(vm.runInContext("isKeyboardSoundRole(options.role || 'keyboard') && keyboardSoundSource !== 'grain'", context), role !== 'sequencer' && source !== 'grain');
            assert.equal(vm.runInContext("isKeyboardSoundRole(options.role || 'keyboard') && keyboardSoundSource !== 'osc'", context), role !== 'sequencer' && source !== 'osc');
        }
    }
    assert.match(grain, /isKeyboardSoundRole\(options.role \|\| 'keyboard'\) && keyboardSoundSource !== 'grain'/);
    assert.match(oscillator, /isKeyboardSoundRole\(options.role \|\| 'keyboard'\) && keyboardSoundSource !== 'osc'/);
    assert.match(oscillator, /if \(isKeyboardSoundRole\(role\) && keyboardGrainCaptureGain\) oscMixer.connect\(keyboardGrainCaptureGain\)/);
});

test('saved source remains backward compatible and Song-part restore cannot change a live K take', () => {
    assert.match(extractFunction('saveState'), /modes:\s*\{\s*keyboardSoundSource,/);
    assert.match(extractFunction('restoreState'), /if \(bastardLoopKRecordingState === 'idle'\) \{\s*setKeyboardSoundSource\(state.modes\?\.keyboardSoundSource, \{ skipSave: true \}\)/);
    assert.match(adapter, /prepared.modes = \{\s*keyboardSoundSource: 'grain'/);
});

test('panic, focus loss, page hide and Stop All cancel independently held sample voices', () => {
    assert.match(extractFunction('panicAllNotes'), /keyboardSamplePlayer\?\.stop\(\)/);
    assert.match(extractFunction('pausePerformanceForFocusLoss'), /keyboardSamplePlayer\?\.stop\(\)/);
    assert.match(extractFunction('stopAllPerformancePlayback'), /stopKeyboardArpTransport\(\)/);
    assert.match(extractFunction('stopKeyboardArpTransport'), /stopKeyboardSounds\(\{ immediate: true \}\)/);
    assert.match(extractFunction('stopKeyboardSounds'), /keyboardSamplePlayer\?\.stop\(\)/);
    assert.match(html, /addEventListener\('pagehide', \(\) => keyboardSamplePlayer\?\.stop\(\)\)/);
    assert.match(extractFunction('setHoldEnabled'), /heldNotes.forEach\(note => \{\s*stopKeyboardSound\(note\)/);
});

test('keyboard touch guards preserve rapid Record K and other control clicks after playing a key', () => {
    const { context } = fixture(['isKeyboardDirectManipulationTarget']);
    context.directManipulationSelector = '.key, .keyboard, .source-waveform-canvas, input[type="range"]';
    context.touchStartPositions = new Map();
    context.lastTouchEnd = 100;
    context.DOUBLE_TAP_TIMEOUT = 300;
    context.Date = { now: () => 200 };
    const handlers = {};
    context.document.addEventListener = (name, handler) => { handlers[name] = handler; };
    const start = html.indexOf("document.addEventListener('touchmove',");
    const end = html.indexOf('// --- Debug Functions ---', start);
    vm.runInContext(html.slice(start, end), context);
    const target = control => ({ closest(selector) {
        if (selector === '.keyboard-section') return {};
        if (selector === context.directManipulationSelector) return {};
        return { matches: () => control === 'key' || control === 'range' };
    } });
    for (const control of ['button', 'select', 'link', 'label']) {
        let prevented = false;
        const event = { target: target(control), touches: [{ identifier: 1, clientY: 10 }], changedTouches: [], preventDefault: () => { prevented = true; } };
        handlers.touchmove(event);
        handlers.touchend(event);
        assert.equal(prevented, false, `${control} must retain native click behavior`);
        assert.equal(context.lastTouchEnd, 100);
    }
    let prevented = false;
    handlers.touchend({ target: target('key'), changedTouches: [], preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'Actual key double taps remain guarded');
    assert.equal(context.lastTouchEnd, 200);
});
