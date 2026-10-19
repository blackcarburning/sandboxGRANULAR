const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const diagnostics = require('../runtime-diagnostics');

function storage() {
    const values = new Map();
    return { values, writes: 0, get length() { return values.size; }, key: index => [...values.keys()][index],
        getItem: key => values.get(key) ?? null,
        setItem(key, value) { this.writes += 1; values.set(key, value); }, removeItem: key => values.delete(key) };
}

function target() {
    const listeners = new Map();
    return { addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
    }, removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name, details = {}) { for (const callback of listeners.get(name) || []) callback(details); } };
}

function fixture(options = {}) {
    let instant = 1792094000000;
    const timers = new Map();
    const intervals = new Map();
    let sequence = 0;
    const local = options.storage || storage();
    const tab = options.tab || storage();
    const host = { ...target(), document: { ...target(), visibilityState: 'visible', querySelector: () => null },
        navigator: { onLine: true }, location: { href: 'https://example.test/mygrain/?token=private#secret', origin: 'https://example.test' },
        performance: { getEntriesByType: () => [{ type: 'reload', redirectCount: 0, responseStatus: 200 }] },
        localStorage: local, sessionStorage: tab,
        setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: instant + delay }); return id; },
        clearTimeout: id => timers.delete(id),
        setInterval(callback) { intervals.set(++sequence, callback); return sequence; }, clearInterval: id => intervals.delete(id),
        fetch: options.fetch || (async () => ({ status: 200, ok: true, redirected: false, headers: new Headers(), url: 'https://example.test/mygrain/api/songs' })) };
    if (options.blocked) Object.defineProperty(host, 'localStorage', { get() { throw new Error('Denied'); } });
    const originalFetch = host.fetch;
    const recorder = diagnostics.createRecorder({ host, now: () => instant, id: options.id || 'test-run', build: 'test-build' });
    return { host, recorder, local, tab, intervals, timers, originalFetch,
        advance(milliseconds = 1000) {
            instant += milliseconds;
            for (const [id, timer] of timers) if (timer.at <= instant) { timers.delete(id); timer.callback(); }
        }, heartbeat() { instant += 5000; for (const callback of intervals.values()) callback(); } };
}

test('boot breadcrumbs are durable before audio or the application has initialized', () => {
    const { local, recorder } = fixture();
    const saved = JSON.parse(local.getItem(diagnostics.prefix + recorder.id));
    assert.equal(saved.events[0].type, 'boot');
    assert.equal(saved.boot.navigationType, 'reload');
    assert.equal(saved.boot.wasDiscarded, null);
    assert.equal(saved.boot.path, '/mygrain/');
    assert.equal(recorder.snapshot().persistence.available, true);
    assert.doesNotMatch(JSON.stringify(saved), /private|secret/);
});

test('same-tab recovery correlates crashes without inventing a termination reason or losing source events', () => {
    const first = fixture({ id: 'fault' });
    first.recorder.setStateProvider(() => ({ audioStarted: true, audioState: 'running', song: { amending: true } }));
    first.advance();
    first.host.emit('error', { message: 'Synthetic crash precursor', error: new Error('Synthetic crash precursor'), filename: 'https://example.test/mygrain/song-beta.js?key=private', lineno: 12 });
    first.recorder.stop();
    const second = fixture({ id: 'restart', storage: first.local, tab: first.tab });
    const recovery = second.recorder.recovery('fault');
    assert.equal(recovery.currentRuntime.boot.previousSessionId, 'fault');
    assert.equal(recovery.previousSameTab.sessionId, 'fault');
    assert.equal(recovery.recentPriorRuns[0].sessionId, 'fault');
    assert.equal(recovery.sourceRuntime.state.audioState, 'running');
    const error = recovery.sourceRuntime.events.find(entry => entry.type === 'javascript-error');
    assert.equal(error.source, '/mygrain/song-beta.js');
    assert.equal(error.line, 12);
    assert.match(error.stack, /Synthetic crash precursor/);
    assert.match(recovery.currentRuntime.limitation, /not proof of a crash/);
    assert.equal(recovery.sourceRuntime.events.some(entry => entry.type === 'pagehide'), false);
});

test('normal lifecycle persists visibility, pagehide, pageshow and offline state without ending the session', () => {
    const setup = fixture();
    setup.host.document.visibilityState = 'hidden';
    setup.host.document.emit('visibilitychange');
    setup.host.emit('pagehide', { persisted: true });
    assert.equal(JSON.parse(setup.local.getItem(diagnostics.prefix + setup.recorder.id)).state.visibility, 'hidden');
    setup.advance();
    setup.host.emit('pageshow', { persisted: true });
    setup.host.emit('offline');
    assert.equal(setup.recorder.snapshot().events.at(-2).persisted, true);
    assert.equal(setup.recorder.snapshot().events.at(-1).type, 'offline');
});

test('same-origin API diagnostics preserve response identity, request arguments, body and authentication semantics', async () => {
    const calls = [];
    const response = new Response('synthetic', { status: 423, headers: { 'Content-Type': 'application/json' } });
    const setup = fixture({ fetch: async (...args) => { calls.push(args); return response; } });
    const settings = { method: 'POST', body: 'private body', headers: { 'X-Mygrain-Song-Key': 'do-not-record' } };
    const returned = await setup.host.fetch('https://example.test/mygrain/api/songs/abcdef1234567890abcdef1234567890/lock/acquire?key=private', settings);
    assert.equal(returned, response);
    assert.equal(calls[0][1], settings);
    assert.equal(await returned.text(), 'synthetic');
    const event = setup.recorder.snapshot().events.at(-1);
    assert.equal(event.status, 423);
    assert.equal(event.path, '/mygrain/api/songs/:resource/lock/acquire');
    assert.doesNotMatch(JSON.stringify(setup.recorder.snapshot()), /private body|do-not-record|key=private/);
});

test('401 and HTML login redirects are recorded distinctly rather than treated as renderer crashes', async () => {
    const setup = fixture({ fetch: async () => ({ status: 200, ok: true, redirected: true,
        url: 'https://example.test/login?return=private', headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) }) });
    await setup.host.fetch('/mygrain/api/songs');
    const event = setup.recorder.snapshot().events.at(-1);
    assert.equal(event.destination, '/login');
    assert.equal(event.contentType, 'text/html');
    assert.equal(event.redirected, true);
    setup.advance();
    const forbidden = fixture({ fetch: async () => ({ status: 401, ok: false, headers: new Headers() }) });
    await forbidden.host.fetch('/mygrain/api/songs');
    assert.equal(forbidden.recorder.snapshot().events.at(-1).status, 401);
});

test('network failures retain original rejection identity and unrelated fetches are not instrumented', async () => {
    const error = new TypeError('Failed to fetch');
    const setup = fixture({ fetch: () => Promise.reject(error) });
    await assert.rejects(setup.host.fetch('/mygrain/api/songs'), failure => failure === error);
    assert.equal(setup.recorder.snapshot().events.at(-1).type, 'fetch-failed');
    const count = setup.recorder.snapshot().events.length;
    await assert.rejects(setup.host.fetch('https://external.test/mygrain/api/songs?token=private'));
    assert.equal(setup.recorder.snapshot().events.length, count);
});

test('promise errors and resource errors persist before the next heartbeat and redact URL secrets', () => {
    const setup = fixture();
    setup.advance();
    const failure = new Error('token=supersecret https://example.test/mygrain/api/songs?key=hidden');
    failure.stack = 'Error: synthetic\n at request (https://example.test/mygrain/song-beta.js?v=hidden:123:45)';
    setup.host.emit('unhandledrejection', { reason: failure });
    let saved = JSON.parse(setup.local.getItem(diagnostics.prefix + setup.recorder.id));
    assert.equal(saved.events.at(-1).type, 'unhandled-rejection');
    assert.doesNotMatch(JSON.stringify(saved), /supersecret|hidden/);
    assert.match(saved.events.at(-1).stack, /song-beta.js:123:45/);
    setup.advance();
    setup.host.emit('error', { target: { tagName: 'SCRIPT', src: 'https://example.test/mygrain/audio-debug-storage.js?v=secret' } });
    saved = JSON.parse(setup.local.getItem(diagnostics.prefix + setup.recorder.id));
    assert.equal(saved.events.at(-1).source, '/mygrain/audio-debug-storage.js');
    assert.equal(saved.events.at(-1).type, 'resource-error');
});

test('control diagnostics contain identifiers and disabled state, never input values or labels', () => {
    const setup = fixture();
    const control = { id: '', classList: ['performance-btn', 'song-beta-amend'], disabled: true, value: 'private', textContent: 'private' };
    setup.host.document.emit('pointerdown', { target: { closest: () => control } });
    const event = setup.recorder.snapshot().events.at(-1);
    assert.equal(event.control, 'song-beta-amend');
    assert.equal(event.disabled, true);
    assert.doesNotMatch(JSON.stringify(event), /private/);
});

test('heartbeat samples lock, busy and memory summaries; blocked provider cannot break diagnostics', () => {
    const setup = fixture();
    setup.recorder.setStateProvider(() => ({ build: 'test-new-build', song: { busy: true, lock: { verified: false, held: true }, credential: 'private' } }));
    setup.heartbeat();
    const saved = JSON.parse(setup.local.getItem(diagnostics.prefix + setup.recorder.id));
    assert.equal(saved.state.song.lock.verified, false);
    assert.equal(saved.build, 'test-new-build');
    assert.doesNotMatch(JSON.stringify(saved), /private/);
    setup.recorder.setStateProvider(() => { throw new Error('app not ready'); });
    assert.equal(setup.recorder.snapshot().state.unavailable, true);
});

test('retention is bounded and empty startups retain the latest audio fault across repeated launches', () => {
    const first = fixture({ id: 'audio-fault' });
    first.recorder.setStateProvider(() => ({ audioStarted: true }));
    first.recorder.event('javascript-error', { message: 'synthetic' });
    first.recorder.stop();
    for (let index = 0; index < 10; index += 1) {
        const next = fixture({ storage: first.local, tab: first.tab, id: `restart-${index}` });
        next.recorder.event('resource-error', { source: '[cross-origin]' }, true);
        assert.equal(next.recorder.recovery('audio-fault').sourceRuntime.sessionId, 'audio-fault');
        next.recorder.stop();
    }
    assert.ok([...first.local.values.keys()].filter(key => key.startsWith(diagnostics.prefix)).length <= diagnostics.limits.sessions);
});

test('event and byte limits hold under prolonged activity and errors are write-throttled', () => {
    const setup = fixture();
    const initialWrites = setup.local.writes;
    for (let index = 0; index < 2000; index += 1) setup.recorder.event('javascript-error', { message: 'x'.repeat(10000) }, true);
    assert.ok(setup.local.writes - initialWrites <= 1);
    setup.advance();
    const encoded = setup.local.getItem(diagnostics.prefix + setup.recorder.id);
    assert.ok(new Blob([encoded]).size <= diagnostics.limits.bytes);
    assert.ok(JSON.parse(encoded).events.length <= diagnostics.limits.events);
    for (let index = 0; index < 1440; index += 1) setup.heartbeat();
    assert.ok(setup.local.values.size <= diagnostics.limits.sessions);
    assert.equal(setup.recorder.snapshot().history.length, diagnostics.limits.history);
});

test('storage denial and quota failure leave audio settings untouched and do not retry continuously', () => {
    const denied = fixture({ blocked: true });
    assert.equal(denied.recorder.snapshot().persistence.available, false);
    assert.match(denied.recorder.snapshot().persistence.error, /unavailable/);
    const local = storage();
    local.setItem('mygrain-state', 'unchanged');
    let attempts = 0;
    const write = local.setItem;
    local.setItem = function (...args) { attempts += 1; throw new DOMException('full', 'QuotaExceededError'); };
    const setup = fixture({ storage: local });
    for (let index = 0; index < 5; index += 1) setup.heartbeat();
    assert.equal(attempts, 1);
    assert.equal(local.getItem('mygrain-state'), 'unchanged');
    local.setItem = write;
    setup.advance(60000);
    setup.heartbeat();
    assert.equal(setup.recorder.snapshot().persistence.available, true);
});

test('clearing removes only diagnostic data and stop restores fetch without touching a later wrapper', () => {
    const setup = fixture();
    setup.local.setItem('mygrain-state', 'untouched');
    setup.recorder.clear();
    assert.equal(setup.local.getItem(diagnostics.prefix + setup.recorder.id), null);
    assert.equal(setup.local.getItem('mygrain-state'), 'untouched');
    setup.recorder.stop();
    assert.equal(setup.host.fetch, setup.originalFetch);
    assert.equal(setup.intervals.size, 0);
    assert.equal(setup.timers.size, 0);
});

test('the early recorder precedes cache redirects and payloads use a separate backward-compatible recovery field', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.indexOf('src="runtime-diagnostics.js') < html.indexOf('function cacheBustMygrain'));
    assert.match(html, /id: window\.mygrainRuntimeDiagnostics\?\.id/);
    assert.match(html, /getReport: \(\) => \{\s+window\.mygrainRuntimeDiagnostics\?\.persist\(\)/);
    assert.match(html, /recoveryDiagnostics: runtime\.recovery/);
    assert.match(html, /logData\.runtimeDiagnostics = window\.mygrainRuntimeDiagnostics\.snapshot\(\)/);
    assert.match(html, /song\.memoryBudget\?\.bytes/);
});
