const test = require('node:test');
const assert = require('node:assert/strict');
const debugStorage = require('../audio-debug-storage');

function report(time = 1792087200000) {
    const phone = { schemaVersion: 1, history: [{ state: 'running' }], incidents: [{ capture: { audio: { state: 'running', sampleRate: 44100 } } }] };
    return { schemaVersion: 1, application: 'MYGRAIN', build: 'test-build-before-crash', captureTime: new Date(time).toISOString(),
        currentState: { audioContext: { state: 'running', currentTime: '7200.1' }, phoneDiagnostics: phone },
        phoneDiagnostics: phone, recentLogs: [{ gains: { master: 0.8 }, phoneDiagnostics: phone }], debugConsoleText: 'Fault before the restart',
        debugConsoleEvents: [{ message: 'Synthetic crackle' }], userAgent: 'iPhone', platform: 'iPhone' };
}

function stored(id, time = 1792087200000) {
    const capture = report(time);
    return { id, startedAt: capture.captureTime, savedAt: capture.captureTime, captureTime: capture.captureTime,
        build: capture.build, reason: 'periodic', receipt: null, data: debugStorage.packReport(capture) };
}

function memoryStorage(initial = []) {
    const records = new Map(initial.map(record => [record.id, record]));
    return { records, writes: 0,
        async list() { return [...records.values()]; },
        async save(record) {
            this.writes += 1;
            records.set(record.id, record);
            const retained = [record, ...[...records.values()].filter(entry => entry.id !== record.id)
                .sort((first, second) => second.savedAt.localeCompare(first.savedAt))].slice(0, debugStorage.limits.sessions);
            for (const id of records.keys()) if (!retained.some(entry => entry.id === id)) records.delete(id);
            return retained;
        },
        async remove(id) { records.delete(id); },
        async markSubmitted(id, receipt, captureTime) {
            const existing = records.get(id);
            if (!existing || existing.captureTime !== captureTime) return null;
            const updated = { ...existing, receipt };
            records.set(id, updated);
            return updated;
        }
    };
}

function fixture(options = {}) {
    let instant = 1792087200000;
    let audioStarted = true;
    let captures = 0;
    const storage = options.storage || memoryStorage(options.records);
    const journal = debugStorage.createJournal({ storage, host: {}, id: 'current-page', now: () => instant,
        shouldCapture: () => audioStarted, getReport: () => { captures += 1; return report(instant); }, ...options });
    return { storage, journal, advance: milliseconds => { instant += milliseconds; },
        get captures() { return captures; }, set audioStarted(value) { audioStarted = value; } };
}

test('opening a restarted page recovers the original capture without writing or starting audio', async () => {
    const previous = stored('crashed-session');
    const { journal, storage } = fixture({ records: [previous], shouldCapture: () => false });
    await journal.ready;
    await journal.sample();
    assert.equal(storage.writes, 0);
    assert.equal(journal.state().records[0].current, false);
    assert.equal(journal.read('crashed-session').build, 'test-build-before-crash');
    assert.equal(journal.read('crashed-session').debugConsoleText, 'Fault before the restart');
    assert.equal(journal.read('crashed-session').currentState.audioContext.currentTime, '7200.1');
    assert.equal(journal.read('crashed-session').phoneDiagnostics.incidents.length, 1);
    assert.equal(journal.read('crashed-session'), journal.read('crashed-session'));
});

test('repeated empty restarts do not overwrite or evict the fault log', async () => {
    const storage = memoryStorage([stored('crashed-session')]);
    for (let boot = 0; boot < 10; boot += 1) {
        const { journal } = fixture({ storage, id: `empty-boot-${boot}`, shouldCapture: () => false });
        await journal.ready;
        await journal.sample();
        assert.equal(journal.state().records.length, 1);
        assert.equal(journal.state().records[0].id, 'crashed-session');
    }
    assert.equal(storage.writes, 0);
});

test('slow recovery remains explicitly loading until prior sessions have been read', async () => {
    let finish;
    const storage = memoryStorage();
    storage.list = () => new Promise(resolve => { finish = resolve; });
    const { journal } = fixture({ storage });
    assert.equal(journal.state().loaded, false);
    assert.equal(journal.state().available, false);
    finish([stored('delayed-recovery')]);
    await journal.ready;
    assert.equal(journal.state().loaded, true);
    assert.equal(journal.state().records[0].id, 'delayed-recovery');
});

test('checkpoints use the existing probe, save at five-second cadence and require started audio', async () => {
    const setup = fixture();
    await setup.journal.ready;
    setup.audioStarted = false;
    await setup.journal.sample();
    assert.equal(setup.storage.writes, 0);
    setup.audioStarted = true;
    await setup.journal.sample();
    assert.equal(setup.storage.writes, 1);
    for (let second = 1; second <= 9; second += 1) { setup.advance(1000); await setup.journal.sample(); }
    assert.equal(setup.storage.writes, 2);
    assert.equal(setup.captures, 2);
    assert.equal(setup.journal.state().lastSavedAt, setup.storage.records.get('current-page').savedAt);
});

test('urgent faults checkpoint at most once a second rather than per warning or audio callback', async () => {
    const setup = fixture();
    await setup.journal.ready;
    await setup.journal.sample();
    for (let index = 0; index < 100; index += 1) { setup.advance(1); setup.journal.request('audio-clock-not-advancing'); await setup.journal.sample(); }
    assert.equal(setup.storage.writes, 1);
    setup.advance(900);
    await setup.journal.sample();
    assert.equal(setup.storage.writes, 2);
    assert.equal(setup.storage.records.get('current-page').reason, 'audio-clock-not-advancing');
});

test('active sessions are bounded at three and new boots preserve two preceding logs', async () => {
    const storage = memoryStorage();
    for (let session = 0; session < 8; session += 1) {
        const { journal } = fixture({ storage, id: `session-${session}`, now: () => 1792087200000 + session * 10000 });
        await journal.ready;
        await journal.sample();
        assert.ok(storage.records.size <= 3);
    }
    assert.deepEqual([...storage.records.keys()], ['session-5', 'session-6', 'session-7']);
});

test('two simulated hours retain one current record and bounded data, not an append-only journal', async () => {
    const setup = fixture();
    await setup.journal.ready;
    for (let second = 0; second < 7200; second += 1) { setup.advance(1000); await setup.journal.sample(); }
    assert.equal(setup.storage.writes, 1440);
    assert.equal(setup.storage.records.size, 1);
    assert.ok(new Blob([setup.storage.records.get('current-page').data]).size < debugStorage.limits.bytes);
});

test('packing removes redundant snapshots without mutating the live capture', () => {
    const original = report();
    const capture = JSON.parse(debugStorage.packReport(original));
    assert.equal(capture.currentState.phoneDiagnostics, undefined);
    assert.equal(capture.recentLogs[0].phoneDiagnostics, undefined);
    assert.equal(capture.phoneDiagnostics.incidents.length, 1);
    assert.ok(original.currentState.phoneDiagnostics);
    assert.ok(original.recentLogs[0].phoneDiagnostics);
});

test('oversized local captures are shortened explicitly while preserving the latest incident', () => {
    const original = report();
    original.debugConsoleText = 'x'.repeat(3 * 1024 * 1024);
    original.phoneDiagnostics.history = Array.from({ length: 180 }, (unused, index) => ({ index }));
    original.phoneDiagnostics.incidents = Array.from({ length: 5 }, (unused, index) => ({ index }));
    const packed = debugStorage.packReport(original);
    const capture = JSON.parse(packed);
    assert.ok(new Blob([packed]).size <= debugStorage.limits.bytes);
    assert.equal(capture.phoneDiagnostics.localCheckpointShortened, true);
    assert.equal(capture.phoneDiagnostics.history.length, 60);
    assert.deepEqual(capture.phoneDiagnostics.incidents.map(entry => entry.index), [2, 3, 4]);
    assert.equal(original.phoneDiagnostics.history.length, 180);
});

test('an unshrinkable capture fails without replacing a valid previous checkpoint', async () => {
    const setup = fixture();
    await setup.journal.ready;
    await setup.journal.sample();
    const original = setup.storage.records.get('current-page');
    const oversized = report();
    oversized.phoneDiagnostics.application = { huge: 'x'.repeat(3 * 1024 * 1024) };
    assert.equal(await setup.journal.checkpoint('too-large', { force: true, report: oversized }), false);
    assert.equal(setup.storage.records.get('current-page'), original);
    assert.match(setup.journal.state().error, /too large/);
});

test('missing diagnostic data cannot replace a usable checkpoint or claim a successful save', async () => {
    const setup = fixture();
    await setup.journal.ready;
    await setup.journal.sample();
    const before = setup.storage.records.get('current-page');
    assert.equal(await setup.journal.checkpoint('missing-data', { force: true, report: { ...report(), phoneDiagnostics: null } }), false);
    assert.equal(setup.storage.records.get('current-page'), before);
    assert.match(setup.journal.state().error, /not ready/);
});

test('storage failures are explicit, preserve older data and do not create a write-retry storm', async () => {
    const storage = memoryStorage([stored('crashed-session')]);
    const originalSave = storage.save;
    let attempts = 0;
    storage.save = async () => { attempts += 1; throw new Error('QuotaExceededError'); };
    const setup = fixture({ storage });
    await setup.journal.ready;
    await setup.journal.sample();
    for (let tick = 0; tick < 59; tick += 1) { setup.advance(1000); await setup.journal.sample(); }
    assert.equal(attempts, 1);
    assert.match(setup.journal.state().error, /Quota/);
    assert.ok(setup.journal.read('crashed-session'));
    storage.save = originalSave;
    setup.advance(1000);
    assert.ok(await setup.journal.sample());
    assert.equal(storage.records.get('current-page').reason, 'storage-retry');
    assert.equal(setup.journal.state().error, '');
});

test('unavailable or blocked storage resolves readiness with a warning instead of breaking the app', async () => {
    const { journal } = fixture({ storage: { list: async () => { throw new Error('IndexedDB unavailable'); } } });
    assert.equal(await journal.ready, false);
    assert.equal(journal.state().available, false);
    assert.match(journal.state().error, /unavailable/);
    assert.equal(await journal.checkpoint('manual', { force: true }), false);
});

test('corrupt stored data is not exported, but does not disable new checkpointing', async () => {
    const setup = fixture({ records: [{ ...stored('broken'), data: 'invalid JSON' }, stored('good')] });
    await setup.journal.ready;
    assert.equal(setup.journal.read('broken'), null);
    assert.ok(setup.journal.read('good'));
    assert.match(setup.journal.state().warning, /unreadable/);
    await setup.journal.sample();
    assert.equal(setup.storage.writes, 1);
});

test('saved-log submission stores its receipt and retains the original capture across restarts', async () => {
    const storage = memoryStorage([stored('crashed-session')]);
    const { journal } = fixture({ storage });
    await journal.ready;
    const before = storage.records.get('crashed-session').data;
    const receipt = { ok: true, logId: 'audio-20261015T170000Z-0123456789abcdef' };
    assert.equal(await journal.markSubmitted('crashed-session', receipt, journal.read('crashed-session').captureTime), true);
    const restarted = fixture({ storage, id: 'restarted' }).journal;
    await restarted.ready;
    assert.equal(restarted.state().records[0].receipt.logId, receipt.logId);
    assert.equal(storage.records.get('crashed-session').data, before);
});

test('a receipt for an older capture never marks newer unsent data as submitted', async () => {
    const setup = fixture();
    await setup.journal.ready;
    await setup.journal.sample();
    const originalTime = setup.journal.read('current-page').captureTime;
    setup.advance(5000);
    await setup.journal.sample();
    assert.equal(await setup.journal.markSubmitted('current-page', { logId: 'old' }, originalTime), false);
    assert.equal(setup.journal.state().records[0].receipt, null);
});

test('clear deletes only the selected session and never other recovered logs', async () => {
    const setup = fixture({ records: [stored('previous-one'), stored('previous-two')] });
    await setup.journal.ready;
    await setup.journal.sample();
    assert.equal(await setup.journal.remove('previous-one'), true);
    assert.equal(setup.journal.read('previous-one'), null);
    assert.ok(setup.journal.read('previous-two'));
    assert.ok(setup.journal.read('current-page'));
    await setup.journal.remove();
    assert.equal(setup.journal.read('current-page'), null);
    assert.ok(setup.journal.read('previous-two'));
});

test('in-flight checkpoints cannot resurrect a cleared current log', async () => {
    const storage = memoryStorage();
    const originalSave = storage.save;
    let finish;
    storage.save = record => new Promise(resolve => { finish = async () => resolve(await originalSave.call(storage, record)); });
    const { journal } = fixture({ storage });
    await journal.ready;
    const saving = journal.checkpoint();
    await new Promise(setImmediate);
    const forced = journal.checkpoint('mark', { force: true });
    const clearing = journal.remove();
    await new Promise(setImmediate);
    await finish();
    await Promise.all([saving, forced, clearing]);
    assert.equal(storage.records.size, 0);
});

test('slow writes coalesce periodic requests and one latest forced checkpoint', async () => {
    const storage = memoryStorage();
    const originalSave = storage.save;
    let finish;
    storage.save = record => new Promise(resolve => { finish = async () => resolve(await originalSave.call(storage, record)); });
    const setup = fixture({ storage });
    await setup.journal.ready;
    const first = setup.journal.checkpoint();
    await new Promise(setImmediate);
    const waiting = [];
    for (let call = 0; call < 20; call += 1) waiting.push(setup.journal.checkpoint('mark', { force: true }));
    await new Promise(setImmediate);
    await finish();
    await first;
    await new Promise(setImmediate);
    await finish();
    await Promise.all(waiting);
    assert.equal(storage.writes, 2);
});
