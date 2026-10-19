const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18766/mygrain/';
const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const results = [];
    try {
        for (const [sampleRate, viewport] of [[44100, { width: 390, height: 844 }], [48000, { width: 844, height: 390 }]]) {
            const context = await browser.newContext({ userAgent, viewport, isMobile: true, hasTouch: true, acceptDownloads: true });
            const errors = [];
            const writes = [];
            await context.addInitScript(rate => {
                const NativeContext = window.AudioContext;
                window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                window.diagnosticPermissionRequests = 0;
                if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
                    window.diagnosticPermissionRequests += 1;
                    return Promise.reject(new Error('Unexpected microphone request'));
                };
            }, sampleRate);
            await context.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.pathname === '/mygrain/api/diagnostic-fixture/lock/acquire') {
                    await route.fulfill({ status: 423, contentType: 'application/json', body: '{"ok":false,"error":"Synthetic lock refusal"}' });
                } else if (url.pathname === '/mygrain/api/diagnostic-fixture/auth') {
                    await route.fulfill({ status: 302, headers: { location: '/login?token=DO_NOT_LOG' } });
                } else if (url.pathname === '/login') {
                    await route.fulfill({ status: 200, contentType: 'text/html', body: '<form><input type="password"></form>' });
                } else if (request.method() !== 'GET' && request.method() !== 'HEAD') {
                    writes.push(url.pathname);
                    await route.abort();
                } else if (url.origin !== new URL(base).origin) {
                    await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
                } else await route.continue();
            });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => typeof persistentDebugLog !== 'undefined' && persistentDebugLog?.state().loaded);
            const first = await page.evaluate(async () => {
                localStorage.setItem('runtime-diagnostic-settings-sentinel', 'unchanged');
                const initial = window.mygrainRuntimeDiagnostics.snapshot();
                await fetch('/mygrain/api/diagnostic-fixture/lock/acquire?key=DO_NOT_LOG');
                await fetch('/mygrain/api/diagnostic-fixture/auth?key=DO_NOT_LOG');
                await new Promise(resolve => setTimeout(resolve, 300));
                window.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic early diagnostic error',
                    filename: location.origin + '/mygrain/song-beta.js?key=DO_NOT_LOG', lineno: 42,
                    error: new Error('Synthetic diagnostic stack') }));
                window.mygrainRuntimeDiagnostics.persist();
                return { id: initial.sessionId, before: initial, payload: buildDebugLogPayload(),
                    stored: JSON.parse(localStorage.getItem('mygrain-runtime-debug-v1:' + initial.sessionId)) };
            });
            assert.equal(first.before.state.audioState, 'not-started');
            assert.equal(first.before.state.startScreenVisible, true);
            assert.equal(first.payload.build, 'v2026.10.15.LOG.3');
            assert.ok(first.stored.events.some(entry => entry.type === 'api-response' && entry.status === 423));
            assert.ok(first.stored.events.some(entry => entry.type === 'api-response' && entry.redirected && entry.destination === '/login' && entry.contentType === 'text/html'));
            assert.ok(first.stored.events.some(entry => entry.type === 'javascript-error' && entry.line === 42 && entry.stack));
            assert.doesNotMatch(JSON.stringify(first.stored), /DO_NOT_LOG/);
            assert.ok(JSON.stringify(first.stored).length <= 32768);
            await page.reload({ waitUntil: 'load' });
            await page.waitForFunction(() => typeof persistentDebugLog !== 'undefined' && persistentDebugLog?.state().loaded);
            const recovered = await page.evaluate(id => ({ payload: buildDebugLogPayload(),
                recovery: window.mygrainRuntimeDiagnostics.recovery(id), state: phoneAudioDiagnostics.snapshot().audio.state }), first.id);
            assert.equal(recovered.recovery.previousSameTab.sessionId, first.id);
            assert.ok(recovered.recovery.sourceRuntime.events.some(entry => entry.type === 'javascript-error'));
            assert.equal(recovered.payload.recoveryDiagnostics.previousSameTab.sessionId, first.id);
            assert.equal(recovered.state, 'not-started');
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => typeof audioContext !== 'undefined' && audioContext?.state === 'running');
            await page.waitForFunction(() => getComputedStyle(document.getElementById('start-overlay')).display === 'none');
            const running = await page.evaluate(async () => {
                stateSaveSuspended = true;
                const tone = audioContext.createOscillator();
                const level = audioContext.createGain();
                level.gain.value = 0.05;
                tone.connect(level).connect(audioContext.destination);
                tone.start();
                window.mygrainRuntimeDiagnostics.persist();
                await persistentDebugLog.checkpoint('synthetic-runtime-check', { force: true });
                const state = window.mygrainRuntimeDiagnostics.snapshot();
                tone.stop();
                return { state, checkpoint: persistentDebugLog.read(persistentDebugLog.id), audioState: audioContext.state,
                    permissionRequests: window.diagnosticPermissionRequests,
                    sentinel: localStorage.getItem('runtime-diagnostic-settings-sentinel'),
                    overflow: document.documentElement.scrollWidth > innerWidth };
            });
            assert.equal(running.audioState, 'running');
            assert.equal(running.state.state.audioStarted, true);
            assert.equal(running.state.state.startScreenVisible, false);
            assert.equal(running.checkpoint.runtimeDiagnostics.sessionId, running.state.sessionId);
            assert.equal(running.permissionRequests, 0);
            assert.equal(running.sentinel, 'unchanged');
            assert.equal(running.overflow, false);
            assert.deepEqual(errors, []);
            assert.deepEqual(writes, []);
            results.push({ sampleRate, viewport, startupErrorsRecovered: true, lockRefusalRecorded: true, loginRedirectRecorded: true,
                preAudioRecovery: true, runningCheckpointCorrelated: true, permissionRequests: 0, productionWrites: 0 });
            await context.close();
        }
        console.log(JSON.stringify({ base, results }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
