const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const expectedBuild = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/Build <strong>(v[^<]+)<\/strong>/)[1];
const realUpload = process.env.MYGRAIN_ALLOW_LOG_UPLOAD === '1';
const mockReference = 'audio-20261015T180000Z-0123456789abcdef';
const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

function assertRecoveredReport(actual, expected, currentAudioState = 'not-started') {
    const { recoveryDiagnostics, ...capture } = actual;
    const { recoveryDiagnostics: previousRecovery, ...original } = expected;
    assert.deepEqual(capture, original);
    assert.equal(recoveryDiagnostics.schemaVersion, 1);
    assert.equal(recoveryDiagnostics.sourceSessionId, expected.runtimeDiagnostics.sessionId);
    assert.equal(recoveryDiagnostics.sourceRuntime.sessionId, expected.runtimeDiagnostics.sessionId);
    assert.equal(recoveryDiagnostics.currentRuntime.state.audioState, currentAudioState);
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const blockedWrites = [];
    const results = [];
    try {
        for (const [sampleRate, viewport] of [[44100, { width: 390, height: 844 }], [48000, { width: 844, height: 390 }]]) {
            const context = await browser.newContext({ viewport, userAgent, isMobile: true, hasTouch: true, acceptDownloads: true });
            await context.addInitScript(rate => {
                const NativeContext = window.AudioContext;
                window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                window.diagnosticPermissionRequests = 0;
                if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
                    diagnosticPermissionRequests += 1;
                    return Promise.reject(new Error('Diagnostics must not request microphone permission'));
                };
                if (rate === 48000) {
                    const nativeTransaction = IDBDatabase.prototype.transaction;
                    IDBDatabase.prototype.transaction = function (stores, mode, options) {
                        if (this.name === 'mygrain-audio-debug-v1' && options?.durability) throw new TypeError('Synthetic legacy durability fallback');
                        return nativeTransaction.call(this, stores, mode);
                    };
                }
            }, sampleRate);
            const submitted = [];
            let mode = 'offline';
            await context.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.origin !== new URL(base).origin) return route.abort();
                if (request.method() === 'POST' && url.pathname === '/mygrain/api/debug-logs') {
                    submitted.push(request.postDataJSON());
                    if (mode === 'offline') return route.abort('internetdisconnected');
                    if (realUpload) return route.continue();
                    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, logId: mockReference, receivedAt: new Date().toISOString() }) });
                }
                if (!['GET', 'HEAD'].includes(request.method())) { blockedWrites.push(request.url()); return route.abort(); }
                return route.continue();
            });
            let page = await context.newPage();
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => persistentDebugLog?.state().available);
            assert.equal(await page.locator('#startupDebugRecovery').isVisible(), false);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(async () => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                setOscillatorsEnabled(true, { silent: true, skipSave: true });
                playOscillatorNote('C3');
                phoneAudioDiagnostics.record('synthetic-pre-crash-evidence', { message: 'Automated renderer-crash fixture, not a real iPhone report.' });
                appendDebugConsoleEvent('info', 'SYNTHETIC FAULT BEFORE RENDERER CRASH');
                localStorage.setItem('debug-recovery-settings-sentinel', 'unchanged');
                const database = await openAudioDB();
                await new Promise((resolve, reject) => {
                    const transaction = database.transaction(AUDIO_STORE_NAME, 'readwrite');
                    transaction.objectStore(AUDIO_STORE_NAME).put({ sentinel: 'audio-storage-unchanged' }, 'debug-recovery-test-sentinel');
                    transaction.oncomplete = resolve;
                    transaction.onerror = reject;
                });
                database.close();
            });
            await page.waitForFunction(() => {
                const stored = persistentDebugLog.read(persistentDebugLog.id);
                return stored?.phoneDiagnostics.events.some(event => event.type === 'synthetic-pre-crash-evidence');
            });
            const before = await page.evaluate(() => ({ id: persistentDebugLog.id, record: persistentDebugLog.state().records.find(record => record.current),
                report: persistentDebugLog.read(persistentDebugLog.id), contextState: audioContext.state, voices: activeOscVoices.size }));
            assert.equal(before.contextState, 'running');
            assert.equal(before.voices, 1);
            assert.ok(before.report.phoneDiagnostics.timing.samples > 0);
            assert.equal(submitted.length, 0);
            const failedWrite = await page.evaluate(async () => {
                const nativePut = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function (...args) {
                    const request = nativePut.apply(this, args);
                    if (this.transaction.db.name === 'mygrain-audio-debug-v1') this.transaction.abort();
                    return request;
                };
                const result = await persistentDebugLog.checkpoint('synthetic-aborted-write', { force: true });
                return { result, error: persistentDebugLog.state().error, capture: persistentDebugLog.read(persistentDebugLog.id) };
            });
            assert.equal(failedWrite.result, false);
            assert.ok(failedWrite.error);
            assert.deepEqual(failedWrite.capture, before.report);
            const cdp = await context.newCDPSession(page);
            const crashed = page.waitForEvent('crash');
            cdp.send('Page.crash').catch(() => {});
            await crashed;
            await page.close();
            for (let reboot = 0; reboot < 2; reboot += 1) {
                page = await context.newPage();
                page.setDefaultTimeout(60000);
                page.on('pageerror', error => errors.push(error.stack));
                await page.goto(base, { waitUntil: 'load' });
                await page.waitForFunction(() => persistentDebugLog?.state().available && debugLogRecoveryLoaded);
                assert.equal(await page.locator('#startupDebugRecovery').isVisible(), true);
                assert.match(await page.locator('#startupDebugRecoveryStatus').innerText(), /Recovered a log/);
                assert.equal(await page.evaluate(() => selectedDebugLogId), before.id);
                const after = await page.evaluate(id => ({ recovered: persistentDebugLog.read(id), records: persistentDebugLog.state().records,
                    state: phoneAudioDiagnostics.snapshot().audio.state, sentinel: localStorage.getItem('debug-recovery-settings-sentinel') }), before.id);
                assert.deepEqual(after.recovered, before.report);
                assert.equal(after.state, 'not-started');
                assert.equal(after.records.length, 1);
                assert.equal(after.sentinel, 'unchanged');
                assert.match(await page.locator('#debugConsoleOutput').inputValue(), /RECOVERED LOCAL LOG/);
                assert.equal(submitted.length, 0);
                if (reboot === 0) {
                    await page.waitForTimeout(6000);
                    assert.equal(await page.evaluate(() => persistentDebugLog.state().records.length), 1);
                    await page.close();
                }
            }
            await page.locator('#submitSavedDebugLogBtn').tap();
            await page.waitForFunction(() => document.getElementById('startupDebugRecoveryStatus').textContent.includes('Log submission failed:'));
            assert.equal(await page.locator('#submitSavedDebugLogBtn').isEnabled(), true);
            assertRecoveredReport(submitted[0], before.report);
            await page.reload({ waitUntil: 'load' });
            await page.waitForFunction(() => persistentDebugLog?.state().available && debugLogRecoveryLoaded);
            assert.equal(await page.evaluate(() => selectedDebugLogId), before.id);
            mode = 'success';
            await page.locator('#submitSavedDebugLogBtn').tap();
            await page.waitForFunction(() => document.getElementById('startupDebugRecoveryStatus').textContent.includes('Log saved on server.'));
            const receiptText = await page.locator('#startupDebugRecoveryStatus').innerText();
            const reference = receiptText.match(/audio-\d{8}T\d{6}Z-[a-f0-9]{16}/)[0];
            assert.equal(submitted.length, 2);
            assertRecoveredReport(submitted[1], before.report);
            assert.equal(await page.evaluate(() => phoneAudioDiagnostics.snapshot().audio.state), 'not-started');
            assert.equal(await page.evaluate(() => persistentDebugLog.state().records[0].receipt.logId), reference);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            if (process.env.MYGRAIN_DIAGNOSTIC_OUTPUT) {
                const directory = process.env.MYGRAIN_DIAGNOSTIC_OUTPUT;
                await page.screenshot({ path: path.join(directory, `startup-recovery-${sampleRate}.png`), fullPage: false });
                fs.writeFileSync(path.join(directory, `recovered-upload-${sampleRate}.json`), JSON.stringify({ reference, report: submitted[1], originalRecord: before.record }, null, 2));
            }
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => { stateSaveSuspended = true; });
            await page.waitForFunction(() => persistentDebugLog.state().records.some(record => record.current));
            assert.deepEqual(await page.evaluate(id => persistentDebugLog.read(id), before.id), before.report);
            await page.locator('#debugLogSessionSelect').selectOption(before.id);
            await page.evaluate(() => {
                Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedRecoveredDebug = value; } }, configurable: true });
            });
            await page.locator('#copyDebugConsoleBtn').tap();
            assert.match(await page.evaluate(() => copiedRecoveredDebug), /SYNTHETIC FAULT BEFORE RENDERER CRASH/);
            const downloadEvent = page.waitForEvent('download');
            await page.evaluate(() => downloadDebugLog());
            const download = await downloadEvent;
            const downloadPath = await download.path();
            const downloaded = JSON.parse(fs.readFileSync(fs.existsSync(downloadPath) ? downloadPath : `/tmp/snap-private-tmp/snap.chromium${downloadPath}`, 'utf8'));
            assertRecoveredReport(downloaded, before.report, 'running');
            await page.locator('#clearDebugConsoleBtn').tap();
            await page.waitForFunction(id => persistentDebugLog.read(id) === null, before.id);
            assert.equal(await page.evaluate(() => localStorage.getItem('debug-recovery-settings-sentinel')), 'unchanged');
            const audioSentinel = await page.evaluate(async () => {
                const database = await openAudioDB();
                const value = await new Promise((resolve, reject) => {
                    const request = database.transaction(AUDIO_STORE_NAME, 'readonly').objectStore(AUDIO_STORE_NAME).get('debug-recovery-test-sentinel');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = reject;
                });
                database.close();
                return value;
            });
            assert.deepEqual(audioSentinel, { sentinel: 'audio-storage-unchanged' });
            assert.equal(await page.evaluate(() => diagnosticPermissionRequests), 0);
            results.push({ sampleRate, viewport, build: expectedBuild, reference, checkpointTime: before.record.savedAt,
                reportCaptureTime: before.report.captureTime, realUpload, rendererCrashRecovered: true, emptyRestartsPreserved: 2,
                abortedWriteKeepsPreviousCheckpoint: true, failedUploadSurvivesReload: true, submittedWithoutStartingAudio: true, settingsAndAudioStoragePreserved: true });
            await context.close();
        }
        const unavailableContext = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent });
        await unavailableContext.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }); });
        await unavailableContext.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) && new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
        const unavailable = await unavailableContext.newPage();
        await unavailable.goto(base, { waitUntil: 'load' });
        await unavailable.waitForFunction(() => document.getElementById('debugLogPersistenceStatus').textContent.includes('Local saving unavailable'));
        assert.equal(await unavailable.evaluate(() => phoneAudioDiagnostics.snapshot().monitorRunning), true);
        await unavailableContext.close();
        assert.deepEqual(errors, []);
        assert.deepEqual(blockedWrites, []);
        console.log(JSON.stringify({ pass: true, emulationOnly: true, results, storageUnavailableWarning: true, errors, blockedWrites }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
