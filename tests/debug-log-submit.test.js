const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const reference = 'audio-20261015T170000Z-0123456789abcdef';

function functionSource(name, async = false) {
    const start = html.indexOf(`        ${async ? 'async ' : ''}function ${name}(`);
    assert.notEqual(start, -1, name);
    const end = html.indexOf('\n        }', start);
    return html.slice(start, end + '\n        }'.length);
}

function fixture(options = {}) {
    const button = { disabled: false, textContent: 'Submit Log' };
    const feedback = { textContent: '' };
    const timers = new Map();
    const requests = [];
    const context = {
        document: { getElementById: id => id === 'submitDebugLogBtn' ? button : id === 'debugLogSubmitStatus' ? feedback : null,
            querySelector: () => ({ textContent: 'v2026.10.15.LOG.1' }) },
        navigator: { userAgent: 'iPhone', platform: 'iPhone' },
        location: { href: 'https://example.test/mygrain/?v=build' },
        debugLogSubmitting: false, debugLogs: [], debugConsoleEvents: [], DEBUG_CONSOLE_MAX_EVENTS: 80,
        persistentDebugLog: null, selectedDebugLogId: 'current', updatePersistentDebugLogControls() {},
        captureAudioDebug: () => null,
        phoneAudioDiagnostics: { snapshot: () => ({ schemaVersion: 1, incidents: [{ type: 'user-marked-crackle' }] }) },
        buildDebugConsoleText: () => 'Fresh console text',
        setStatus(message) { context.status = message; },
        setTimeout(callback, delay) { assert.equal(delay, 20000); timers.set(1, callback); return 1; },
        clearTimeout(timer) { timers.delete(timer); },
        AbortController, Blob, URL,
        fetch: async (url, settings) => {
            requests.push({ url: String(url), settings });
            return { ok: true, status: 201, json: async () => ({ ok: true, logId: reference }) };
        },
        ...options,
    };
    vm.createContext(context);
    vm.runInContext(functionSource('buildDebugLogPayload'), context);
    vm.runInContext(functionSource('getDebugLogForExport'), context);
    vm.runInContext(functionSource('submitDebugLog', true), context);
    return { context, button, feedback, timers, requests };
}

test('manual submission uses fresh full diagnostics, same-origin JSON, and a server receipt', async () => {
    const { context, button, feedback, timers, requests } = fixture();
    assert.equal(requests.length, 0);
    await context.submitDebugLog();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://example.test/mygrain/api/debug-logs');
    assert.equal(requests[0].settings.method, 'POST');
    assert.equal(requests[0].settings.credentials, 'same-origin');
    assert.equal(requests[0].settings.headers['X-Mygrain-Debug'], '1');
    const report = JSON.parse(requests[0].settings.body);
    assert.equal(report.application, 'MYGRAIN');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.currentState, null);
    assert.equal(report.debugConsoleText, 'Fresh console text');
    assert.equal(report.phoneDiagnostics.incidents.length, 1);
    assert.match(feedback.textContent, new RegExp(reference));
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Submit Log');
    assert.equal(context.debugLogSubmitting, false);
    assert.equal(timers.size, 0);
});

test('submitted current report includes RadioLab diagnostics even before the main audio engine exists', async () => {
    const diagnostics = { build: 'v2026.10.17.R.7', media: { errorCode: 3 }, events: [{ type: 'error' }] };
    const { context, requests } = fixture({ window: { mygrainRadiolab: { diagnostics } } });
    await context.submitDebugLog();
    const report = JSON.parse(requests[0].settings.body);
    assert.deepEqual(report.currentState.radiolab, diagnostics);
});

test('pending submission disables the button and ignores duplicate calls', async () => {
    let finish;
    let count = 0;
    const { context, button } = fixture({ fetch: () => { count += 1; return new Promise(resolve => { finish = resolve; }); } });
    const pending = context.submitDebugLog();
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Submitting…');
    await context.submitDebugLog();
    await new Promise(setImmediate);
    assert.equal(count, 1);
    finish({ ok: true, json: async () => ({ ok: true, logId: reference }) });
    await pending;
    assert.equal(button.disabled, false);
});

test('long-session reports retain recent audio states without twenty redundant phone timelines', () => {
    const phone = { schemaVersion: 1, history: Array.from({ length: 180 }, () => ({ state: 'running', resource: 'x'.repeat(800) })),
        incidents: Array.from({ length: 5 }, () => ({ capture: { resource: 'x'.repeat(10000) } })) };
    const logs = Array.from({ length: 20 }, () => ({ gains: { masterGain: '0.8' }, phoneDiagnostics: phone }));
    const { context } = fixture({ debugLogs: logs, phoneAudioDiagnostics: { snapshot: () => phone },
        captureAudioDebug: () => ({ gains: { masterGain: '0.8' }, phoneDiagnostics: phone }) });
    const report = context.buildDebugLogPayload();
    assert.equal(report.recentLogs.length, 20);
    assert.equal(report.recentLogs[0].gains.masterGain, '0.8');
    assert.equal(report.recentLogs[0].phoneDiagnostics, undefined);
    assert.equal(report.phoneDiagnostics.history.length, 180);
    assert.equal(report.phoneDiagnostics.incidents.length, 5);
    assert.equal(logs[0].phoneDiagnostics, phone);
    assert.ok(Buffer.byteLength(JSON.stringify(report)) < 4 * 1024 * 1024);
});

for (const [status, detail] of [[403, 'Submit from the app.'], [429, 'Wait one minute.'], [507, 'Store full.'], [503, 'Storage unavailable.']]) {
    test(`HTTP ${status} leaves diagnostics intact and supports retry`, async () => {
        const capture = { schemaVersion: 1, incidents: [{ type: 'user-marked-crackle' }] };
        const { context, button, feedback } = fixture({
            phoneAudioDiagnostics: { snapshot: () => capture },
            fetch: async () => ({ ok: false, status, json: async () => ({ ok: false, error: detail }) }),
        });
        await context.submitDebugLog();
        assert.ok(feedback.textContent.includes(detail));
        assert.match(feedback.textContent, /not been cleared/);
        assert.equal(capture.incidents.length, 1);
        assert.equal(button.disabled, false);
    });
}

test('timeout aborts only the upload and clears its timer', async () => {
    const { context, timers, button, feedback } = fixture({ fetch: (url, settings) => new Promise((resolve, reject) => {
        settings.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    const pending = context.submitDebugLog();
    await new Promise(setImmediate);
    timers.get(1)();
    await pending;
    assert.match(feedback.textContent, /delivery is unconfirmed/);
    assert.equal(button.disabled, false);
    assert.equal(timers.size, 0);
});

test('network and malformed JSON responses never claim a successful write', async () => {
    for (const fetch of [async () => { throw new Error('offline'); },
        async () => ({ ok: false, status: 502, json: async () => { throw new Error('HTML response'); } }),
        async () => ({ ok: true, status: 201, json: async () => ({ ok: true, logId: '<img src=x>' }) })]) {
        const { context, feedback } = fixture({ fetch });
        await context.submitDebugLog();
        assert.match(feedback.textContent, /failed/);
        assert.ok(!feedback.textContent.includes('Log saved on server'));
    }
});

test('oversized capture is kept local without sending a request', async () => {
    const { context, requests, feedback, button } = fixture({ buildDebugConsoleText: () => 'x'.repeat(4 * 1024 * 1024) });
    await context.submitDebugLog();
    assert.equal(requests.length, 0);
    assert.match(feedback.textContent, /exceeds 4 MiB/);
    assert.equal(button.disabled, false);
});

test('capture failure leaves the log available and restores the button', async () => {
    const { context, feedback, button } = fixture({ captureAudioDebug: () => { throw new Error('capture failed'); } });
    await context.submitDebugLog();
    assert.match(feedback.textContent, /capture failed/);
    assert.equal(button.disabled, false);
});

test('a recovered log submits the original fault capture rather than the restarted engine', async () => {
    const saved = { schemaVersion: 1, application: 'MYGRAIN', build: 'original-build', captureTime: '2026-10-15T16:00:00Z',
        phoneDiagnostics: { schemaVersion: 1, audio: { currentTime: 7200 } }, debugConsoleText: 'Original crash details' };
    let marked;
    const journal = { ready: Promise.resolve(), read: id => id === 'saved' ? saved : null,
        markSubmitted: async (...args) => { marked = args; } };
    const { context, requests } = fixture({ selectedDebugLogId: 'saved', persistentDebugLog: journal,
        captureAudioDebug: () => { throw new Error('Must not capture the restarted engine'); } });
    await context.submitDebugLog();
    assert.deepEqual(JSON.parse(requests[0].settings.body), saved);
    assert.deepEqual(marked, ['saved', { ok: true, logId: reference }, saved.captureTime]);
});

test('a new manual report is checkpointed before its upload starts', async () => {
    let finishSaving;
    let savedReport;
    const journal = { ready: Promise.resolve(), checkpoint: async (reason, settings) => {
        assert.equal(reason, 'manual-submit');
        savedReport = settings.report;
        await new Promise(resolve => { finishSaving = resolve; });
        return { id: 'current-checkpoint' };
    }, markSubmitted: async () => true };
    const { context, requests, button } = fixture({ persistentDebugLog: journal });
    const pending = context.submitDebugLog();
    await new Promise(setImmediate);
    assert.equal(requests.length, 0);
    assert.equal(button.disabled, true);
    finishSaving();
    await pending;
    assert.deepEqual(JSON.parse(requests[0].settings.body), JSON.parse(JSON.stringify(savedReport)));
});

test('saved submissions append correlated restart context without replacing the original audio capture', async () => {
    const saved = { schemaVersion: 1, application: 'MYGRAIN', build: 'original-build', captureTime: '2026-10-15T16:00:00Z',
        phoneDiagnostics: { schemaVersion: 1, audio: { currentTime: 7200 } }, debugConsoleText: 'Original crash details' };
    const recovery = { schemaVersion: 1, sourceSessionId: 'saved', currentRuntime: { audioState: 'not-started' } };
    const { context, requests } = fixture({ selectedDebugLogId: 'saved',
        window: { mygrainRuntimeDiagnostics: { recovery: id => { assert.equal(id, 'saved'); return recovery; } } },
        persistentDebugLog: { ready: Promise.resolve(), read: () => saved, markSubmitted: async () => true },
        captureAudioDebug: () => { throw new Error('Do not capture new engine'); } });
    await context.submitDebugLog();
    const uploaded = JSON.parse(requests[0].settings.body);
    assert.equal(uploaded.build, saved.build);
    assert.equal(uploaded.captureTime, saved.captureTime);
    assert.equal(uploaded.phoneDiagnostics.audio.currentTime, 7200);
    assert.deepEqual(uploaded.recoveryDiagnostics, recovery);
    assert.equal(saved.recoveryDiagnostics, undefined);
});

test('an unreadable selected saved report never silently uploads current startup data instead', async () => {
    const { context, requests, feedback } = fixture({ selectedDebugLogId: 'missing', persistentDebugLog: { ready: Promise.resolve(), read: () => null } });
    await context.submitDebugLog();
    assert.equal(requests.length, 0);
    assert.match(feedback.textContent, /saved log is unavailable/);
});

test('Clear Log reports a failed persistent delete instead of claiming the saved checkpoint is gone', async () => {
    const { context } = fixture({ persistentDebugLog: { remove: async () => false },
        phoneAudioDiagnostics: { clearHistory() {} }, renderDebugConsole() {} });
    vm.runInContext(functionSource('clearDebugConsoleLog', true), context);
    await context.clearDebugConsoleLog();
    assert.match(context.status, /saved checkpoint could not be deleted/);
});

test('download and submission share the payload builder; button and accessible receipt are wired', () => {
    assert.match(functionSource('downloadDebugLog'), /const logData = getDebugLogForExport\(\)/);
    assert.match(html, /id="submitDebugLogBtn">Submit Log<\/button>/);
    assert.match(html, /id="debugLogSubmitStatus"[^>]*role="status"/);
    assert.ok(html.includes("getElementById('submitDebugLogBtn')?.addEventListener('click', submitDebugLog)"));
    for (const audioAction of ['.suspend(', '.resume(', '.close(', 'clearDebugConsoleLog(', 'saveState(', 'setInterval(']) {
        assert.ok(!functionSource('submitDebugLog', true).includes(audioAction), audioAction);
    }
});
