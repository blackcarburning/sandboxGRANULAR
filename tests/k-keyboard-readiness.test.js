const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.MYGRAIN_READINESS_SOURCE || path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('keys.forEach(key => {');
const end = html.indexOf('// --- Slider Listeners ---', start);
assert.ok(start > 0 && end > start);
const inputScript = html.slice(start, end);

function deferred() {
    let resolve;
    const promise = new Promise(finish => { resolve = finish; });
    return { promise, resolve };
}

function fixture() {
    const handlers = {};
    const classes = new Set();
    const calls = { played: [], released: [], recordingStops: 0 };
    const key = {
        dataset: { note: 'C4' },
        classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
        addEventListener: (name, handler) => { handlers[name] = handler; },
        hasPointerCapture: () => false,
        setPointerCapture: () => {}
    };
    const context = {
        keys: [key], keyLastTouchTime: new Map(), DOUBLE_TAP_TIMEOUT: 300,
        heldNotes: new Set(), holdEnabled: false, arpEnabled: false, activeKeyCount: 0,
        keyboardSoundSelectionToken: 0, keyboardInteractionEpoch: 0, isOutputRecordingArmed: false,
        audioContext: { currentTime: 1 }, getTransportLoopOriginTime: () => null,
        ensureAudioReadyForKeyInteraction: async () => true,
        notifyKeyboardRepositoryKeyPress: async () => {},
        playKeyboardSound: note => calls.played.push(note),
        stopKeyboardSound: note => calls.released.push(note),
        scheduleKeyboardRepositoryRecordingStop: () => { calls.recordingStops += 1; },
        startArpeggiatorPlayback: () => {}, setStatus: () => {}, setKeyboardRepositoryRecordingState: () => {},
        console, document: { getElementById: () => null }
    };
    vm.createContext(context);
    vm.runInContext(inputScript, context);
    const dispatch = (name, extra = {}) => handlers[name]({ preventDefault() {}, pointerId: 1, button: 0, ...extra });
    return { context, key, calls, dispatch };
}

for (const [press, release, extra] of [
    ['pointerdown', 'pointerup', {}],
    ['touchstart', 'touchend', {}],
    ['keydown', 'keyup', { key: 'Enter' }],
    ['keydown', 'keyup', { key: ' ' }]
]) {
    test(`${press} released while audio resumes cannot create a ghost note`, async () => {
        const { context, key, calls, dispatch } = fixture();
        const gate = deferred();
        context.ensureAudioReadyForKeyInteraction = () => gate.promise;
        dispatch(press, extra);
        dispatch(release, extra);
        gate.resolve(true);
        await new Promise(setImmediate);
        assert.equal(calls.played.length, 0);
        assert.equal(key.classList.contains('active'), false);
        assert.equal(context.activeKeyCount, 0);
    });
}

test('rapid release and repress preserves only the latest pending key interaction', async () => {
    const { context, calls, dispatch } = fixture();
    const first = deferred();
    const second = deferred();
    let presses = 0;
    context.ensureAudioReadyForKeyInteraction = () => ++presses === 1 ? first.promise : second.promise;
    dispatch('pointerdown');
    dispatch('pointerup');
    dispatch('pointerdown', { pointerId: 2 });
    first.resolve(true);
    await new Promise(setImmediate);
    assert.equal(calls.played.length, 0);
    second.resolve(true);
    await new Promise(setImmediate);
    assert.deepEqual(calls.played, ['C4']);
    assert.equal(context.activeKeyCount, 1);
    dispatch('pointerup', { pointerId: 2 });
    assert.equal(context.activeKeyCount, 0);
});

test('release while armed recording starts cannot leave a sounding or active key', async () => {
    const { context, key, calls, dispatch } = fixture();
    const gate = deferred();
    context.notifyKeyboardRepositoryKeyPress = () => gate.promise;
    dispatch('pointerdown');
    await new Promise(setImmediate);
    dispatch('pointerup');
    gate.resolve();
    await new Promise(setImmediate);
    assert.equal(calls.played.length, 0);
    assert.equal(key.classList.contains('active'), false);
    assert.equal(context.activeKeyCount, 0);
    assert.equal(calls.recordingStops, 1);
});

test('switching instruments while audio resumes invalidates the old gesture', async () => {
    const { context, calls, dispatch } = fixture();
    const gate = deferred();
    context.ensureAudioReadyForKeyInteraction = () => gate.promise;
    dispatch('pointerdown');
    context.keyboardSoundSelectionToken += 1;
    gate.resolve(true);
    await new Promise(setImmediate);
    assert.equal(calls.played.length, 0);
    assert.equal(context.activeKeyCount, 0);
});

test('overlapping pointer, touch and mouse releases remain idempotent', async () => {
    const { context, calls, dispatch } = fixture();
    dispatch('pointerdown');
    await new Promise(setImmediate);
    assert.equal(calls.played.length, 1);
    for (const event of ['pointerup', 'touchend', 'mouseup', 'lostpointercapture']) dispatch(event);
    assert.equal(calls.released.length, 1);
    assert.equal(context.activeKeyCount, 0);
});
