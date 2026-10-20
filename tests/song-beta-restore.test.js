const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const restoreStart = html.indexOf('        function restoreState(');
const restoreEnd = html.indexOf('        function setupStateSaving(', restoreStart);
const restoreSource = html.slice(restoreStart, restoreEnd);

test('unavailable browser storage cannot abort startup before Song Access can be opened', () => {
    const start = html.indexOf('        let dropboxEnabled = false;');
    assert.ok(start > 0);
    const source = html.slice(start, html.indexOf('        // Parameter ranges', start));
    const context = {};
    Object.defineProperty(context, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    vm.createContext(context);
    vm.runInContext(`${source}\nglobalThis.actualDropboxEnabled = dropboxEnabled;`, context);
    assert.equal(context.actualDropboxEnabled, false);
});

function restoreFixture(state, failure) {
    const logged = [];
    const context = {
        readStoredStateSnapshot: () => state,
        setBastardLoopMPlusPanPercent: () => {},
        restoreDrumMachineToneDefaults: () => {},
        normalizeStoredLfoSliderValues: () => { throw failure; },
        console: { error: (...args) => logged.push(args) }
    };
    vm.createContext(context);
    vm.runInContext(restoreSource, context);
    return { context, logged };
}

test('ordinary state restoration retains its logged false-return behavior', () => {
    const failure = new Error('Filter configuration failed');
    const { context, logged } = restoreFixture({}, failure);
    assert.equal(context.restoreState(), false);
    assert.equal(logged[0][1], failure);
});

test('song restoration can preserve the original error and stack', () => {
    const failure = new Error('Filter configuration failed');
    const { context, logged } = restoreFixture({}, failure);
    assert.throws(() => context.restoreState({ throwOnError: true }), error => error === failure);
    assert.equal(logged[0][1], failure);
});

test('missing persisted state still returns false without an exception', () => {
    const { context, logged } = restoreFixture(null, new Error('Must not be reached'));
    assert.equal(context.restoreState({ throwOnError: true }), false);
    assert.equal(logged.length, 0);
});

test('restoration prepares the saved pattern length before dispatching sequencer slider events', () => {
    const slidersEnd = restoreSource.indexOf('                // Restore select values');
    const slidersSource = `${restoreSource.slice(0, slidersEnd)}return true; } catch (error) { throw error; } }`;
    for (const [liveLength, savedLength] of [[8, 32], [32, 8]]) {
        let steps = Array.from({ length: liveLength }, () => ({}));
        const state = { patternLength: savedLength, sliders: { [`seqStep${savedLength}Pitch`]: '48', seqStep64Pitch: '52' } };
        const context = {
            readStoredStateSnapshot: () => state,
            setBastardLoopMPlusPanPercent: () => {},
            restoreDrumMachineToneDefaults: () => {},
            normalizeStoredLfoSliderValues: values => values,
            resolveStoredPatternLength: saved => saved.patternLength,
            syncPatternLengthControls: length => { steps = Array.from({ length }, () => ({})); return length; },
            document: { getElementById: id => ({ closest: () => null, dispatchEvent: () => { steps[Number(id.match(/\d+/)[0]) - 1].pitch = 'C4'; } }) },
            Event: class Event {}
        };
        vm.createContext(context);
        vm.runInContext(slidersSource, context);
        assert.equal(context.restoreState(), true);
        assert.equal(steps.length, savedLength);
        assert.equal(steps[savedLength - 1].pitch, 'C4');
    }
});

function deferredSaveFixture() {
    const start = html.indexOf('        function setupStateSaving(');
    const end = html.indexOf('        const DEFAULT_EXPORT_BARS', start);
    const handlers = new Map();
    const frames = [];
    let saves = 0;
    const context = {
        stateSaveSuspended: false,
        sourceMutationSerial: 0,
        requestAnimationFrame: callback => frames.push(callback),
        saveState: () => { if (!context.stateSaveSuspended) saves += 1; },
        document: {
            querySelectorAll: selector => selector === '.lfo-toggle, .inv-toggle' || selector === '.tab-button'
                ? [{ addEventListener: (event, handler) => handlers.set(selector, handler) }] : [],
            getElementById: id => ({ addEventListener: (event, handler) => handlers.set(id, handler) })
        }
    };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    context.setupStateSaving();
    return { context, handlers, frames, saveCount: () => saves };
}

test('restore-generated toggle and tab events do not queue autosaves', () => {
    const { context, handlers, frames, saveCount } = deferredSaveFixture();
    context.stateSaveSuspended = true;
    for (const selector of ['.lfo-toggle, .inv-toggle', '.tab-button', 'holdBtn', 'arpBtn', 'lfoModeToggle', 'lfo2ModeToggle']) {
        handlers.get(selector)();
    }
    context.stateSaveSuspended = false;
    for (const callback of frames) callback();
    assert.equal(frames.length, 0);
    assert.equal(saveCount(), 0);
});

test('a deferred user autosave cannot overwrite a later source restoration', () => {
    const { context, handlers, frames, saveCount } = deferredSaveFixture();
    handlers.get('.tab-button')();
    context.sourceMutationSerial += 1;
    frames.shift()();
    assert.equal(saveCount(), 0);
    handlers.get('holdBtn')();
    frames.shift()();
    assert.equal(saveCount(), 1);
});

test('ordinary deferred autosaving still respects suspension when the frame executes', () => {
    const { context, handlers, frames, saveCount } = deferredSaveFixture();
    handlers.get('arpBtn')();
    context.stateSaveSuspended = true;
    frames.shift()();
    assert.equal(saveCount(), 0);
});

function recallFixture(previousState, restore) {
    const source = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
    const start = source.indexOf('        recall(part, options = {}) {');
    const end = source.indexOf('        stop: stopSongAudio,', start);
    const values = new Map(previousState === null ? [] : [['state', previousState]]);
    const snapshot = { state: { patternLength: 16 }, extra: {} };
    const calls = [];
    const context = {
        isAudioGraphReady: () => true,
        audioContext: { state: 'running' },
        stateSaveSuspended: false,
        STATE_STORAGE_KEY: 'state',
        localStorage: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
            removeItem: key => values.delete(key)
        },
        batchSongUiRestore: () => ({ restore: () => calls.push('helpersRestored') }),
        stopSongAudio: () => calls.push('stopped'),
        heldNotes: new Set(['C4']),
        sourceMutationSerial: 0,
        performanceSourceLayerSolo: [],
        performanceSourceLayerSoloSnapshot: null,
        audioBindings: [],
        metadataBindings: [],
        syncLegacyAudioBuffer: () => {},
        syncPatternLengthControls: () => {},
        prepareSongState: state => state,
        restoreState: options => { assert.equal(options.throwOnError, true); assert.equal(options.state, snapshot.state); assert.equal(options.songSnapshot, true); return restore(); },
        console: { warn: () => {} }
    };
    vm.createContext(context);
    vm.runInContext(`globalThis.recall = ({${source.slice(start, end)}}).recall;`, context);
    return { context, values, calls, part: { snapshot, buffers: new Map() } };
}

test('failed song recall reports the actual error and restores the previous persisted state', () => {
    const failure = new Error('Reverb configuration failed');
    const { context, values, calls, part } = recallFixture('previous patch', () => { throw failure; });
    assert.throws(() => context.recall(part, { prepared: part }), error => {
        assert.equal(error.message, 'The part settings could not be restored (Reverb configuration failed). Playback was not started.');
        assert.equal(error.cause, failure);
        return true;
    });
    assert.equal(values.get('state'), 'previous patch');
    assert.equal(context.stateSaveSuspended, false);
    assert.deepEqual(calls, ['stopped', 'stopped', 'helpersRestored']);
});

test('failed recall does not leave a new browser patch when none existed', () => {
    const { context, values, calls, part } = recallFixture(null, () => false);
    assert.throws(() => context.recall(part, { prepared: part }), /Saved part settings are missing or unreadable/);
    assert.equal(values.has('state'), false);
    assert.equal(context.stateSaveSuspended, false);
    assert.deepEqual(calls, ['stopped', 'stopped', 'helpersRestored']);
});

test('song recall never needs browser storage, even to report restoration errors', () => {
    const failure = new Error('Original restore failure');
    const { context, part } = recallFixture(null, () => { throw failure; });
    Object.defineProperty(context, 'localStorage', { get() { throw new Error('Phone storage must not be read'); } });
    assert.throws(() => context.recall(part, { prepared: part }), error => error.cause === failure);
});

test('direct song-state restoration does not read the persisted browser patch', () => {
    const failure = new Error('Reached the supplied snapshot');
    const { context } = restoreFixture(null, failure);
    context.readStoredStateSnapshot = () => { throw new Error('Phone patch must not be read'); };
    assert.throws(() => context.restoreState({ state: {}, throwOnError: true }), error => error === failure);
});

test('pending slider updates can be flushed synchronously exactly once using their latest values', () => {
    const frames = new Map();
    let nextFrame = 0;
    const context = {
        requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: frame => frames.delete(frame)
    };
    vm.createContext(context);
    const start = html.indexOf('        const pendingSliderUpdates =');
    const end = html.indexOf('        // --- Touch Behaviour ---', start);
    vm.runInContext(html.slice(start, end), context);
    const values = [];
    const update = context.throttleSlider(event => values.push(event.value));
    update({ value: 1 });
    update({ value: 7 });
    assert.equal(frames.size, 1);
    context.flushPendingSliderUpdates();
    context.flushPendingSliderUpdates();
    assert.deepEqual(values, [7]);
    assert.equal(frames.size, 0);
    update({ value: 9 });
    [...frames.values()][0]();
    assert.deepEqual(values, [7, 9]);
    assert.equal(frames.size, 0);
});

test('hat ratchet counts use the numeric ratchet normalizer during patch and song recall', () => {
    assert.match(restoreSource, /drumMachineHatRatchetPattern = normalizeDrumMachineRatchetPattern\(state\.modes\.drumMachineHatRatchetPattern/);
    assert.match(html, /drumMachineHatRatchetPattern = normalizeDrumMachineRatchetPattern\(safePreset\.drumMachineHatRatchetPattern/);
});

function audioInventoryFixture() {
    const source = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
    const start = source.indexOf('    function validateSongAudioInventory(');
    const end = source.indexOf('    function prepareSongState(', start);
    const context = { audioBindings: [['grainASample'], ['bastardM'], ['bastardMPlusRender']] };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    const snapshot = {
        extra: { freezeStateVersion: 1, audioSlots: { grainASample: true, bastardM: false, bastardMPlusRender: false } },
        assets: [{ key: 'grainASample', path: 'audio/grainASample.wav', frames: 24000, channels: 2, sampleRate: 48000 }]
    };
    return { validate: context.validateSongAudioInventory, snapshot };
}

test('portable inventories distinguish saved grain samples from explicitly empty vocal slots', () => {
    const { validate, snapshot } = audioInventoryFixture();
    assert.doesNotThrow(() => validate(snapshot));
    snapshot.assets = [];
    snapshot.extra.audioSlots.grainASample = false;
    assert.doesNotThrow(() => validate(snapshot));
});

test('portable inventories reject missing, undeclared, duplicate or invalid sample assets', () => {
    const mutations = [
        snapshot => { snapshot.assets = []; },
        snapshot => { delete snapshot.extra.audioSlots.bastardM; },
        snapshot => { snapshot.extra.audioSlots.bastardM = true; },
        snapshot => { snapshot.extra.audioSlots.grainASample = false; },
        snapshot => { snapshot.extra.audioSlots.phoneOnly = false; },
        snapshot => { snapshot.assets.push({ ...snapshot.assets[0] }); },
        snapshot => { snapshot.assets[0].path = 'phone-cache.wav'; },
        snapshot => { snapshot.assets[0].frames = 0; },
        snapshot => { snapshot.assets[0].channels = 3; },
        snapshot => { snapshot.assets[0].sampleRate = NaN; },
        snapshot => { snapshot.extra.freezeStateVersion = 2; }
    ];
    for (const mutate of mutations) {
        const { validate, snapshot } = audioInventoryFixture();
        mutate(snapshot);
        assert.throws(() => validate(snapshot), /inventory|manifest|dimensions|newer/);
    }
});

test('legacy snapshots remain readable without an inventory but never accept unknown audio keys', () => {
    const { validate, snapshot } = audioInventoryFixture();
    delete snapshot.extra.freezeStateVersion;
    delete snapshot.extra.audioSlots;
    assert.doesNotThrow(() => validate(snapshot));
    snapshot.assets[0].key = 'phoneOnly';
    assert.throws(() => validate(snapshot), /manifest/);
});
