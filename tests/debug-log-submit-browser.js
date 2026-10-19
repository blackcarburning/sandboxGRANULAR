const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const realUpload = process.env.MYGRAIN_ALLOW_LOG_UPLOAD === '1';
const expectedBuild = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/Build <strong>(v[^<]+)<\/strong>/)[1];
const mockReference = 'audio-20261015T170000Z-0123456789abcdef';
const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const blockedWrites = [];
    const results = [];
    try {
        for (const [sampleRate, viewport] of [[44100, { width: 390, height: 844 }], [48000, { width: 844, height: 390 }]]) {
            const context = await browser.newContext({ viewport, userAgent, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeContext = window.AudioContext;
                window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { throw new Error('No diagnostic microphone request is allowed'); };
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.stack));
            const requests = [];
            let mode = 'success';
            await page.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.origin !== new URL(base).origin) return route.abort();
                if (request.method() === 'POST' && url.pathname === '/mygrain/api/debug-logs') {
                    const report = request.postDataJSON();
                    requests.push(report);
                    assert.equal(request.headers()['x-mygrain-debug'], '1');
                    if (mode === 'offline') return route.abort('internetdisconnected');
                    if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Synthetic storage failure. Retry is safe.' }) });
                    if (mode === 'bad-receipt') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, logId: '<img src=x onerror=alert(1)>' }) });
                    await new Promise(resolve => setTimeout(resolve, 600));
                    if (realUpload) return route.continue();
                    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, logId: mockReference, receivedAt: new Date().toISOString() }) });
                }
                if (!['GET', 'HEAD'].includes(request.method())) { blockedWrites.push(request.url()); return route.abort(); }
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => phoneAudioDiagnostics?.snapshot().monitorRunning);
            await page.waitForTimeout(1100);
            assert.equal(requests.length, 0, 'Never auto-upload on page load');
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                window.submissionTestContext = audioContext;
                window.submissionTestTime = audioContext.currentTime;
                phoneAudioDiagnostics.record('synthetic-submission-test', { message: 'Automated phone emulation, not a real crackle report.' });
                setOscillatorsEnabled(true, { silent: true, skipSave: true });
                playOscillatorNote('C3');
                document.getElementById('debugConsoleOutput').value = 'STALE TEXT';
            });
            await page.locator('#markAudioProblemBtn').tap();
            await page.locator('#submitDebugLogBtn').tap();
            await page.waitForFunction(() => document.getElementById('submitDebugLogBtn').disabled);
            await page.evaluate(() => submitDebugLog());
            await page.waitForFunction(() => !document.getElementById('submitDebugLogBtn').disabled);
            const receiptText = await page.locator('#debugLogSubmitStatus').innerText();
            assert.match(receiptText, /Log saved on server/);
            const reference = receiptText.match(/audio-\d{8}T\d{6}Z-[a-f0-9]{16}/)[0];
            assert.equal(requests.length, 1);
            const report = requests[0];
            assert.equal(report.build, expectedBuild);
            assert.equal(report.phoneDiagnostics.environment.reportedIOS, '18.6');
            assert.equal(report.phoneDiagnostics.incidents.length, 1);
            assert.ok(report.debugConsoleText.includes('user-marked-crackle'));
            assert.ok(!report.debugConsoleText.includes('STALE TEXT'));
            const stillRunning = await page.evaluate(() => ({ sameContext: audioContext === submissionTestContext,
                state: audioContext.state, advanced: audioContext.currentTime > submissionTestTime, voices: activeOscVoices.size,
                incidents: phoneAudioDiagnostics.snapshot().incidents.length }));
            assert.equal(stillRunning.sameContext, true);
            assert.equal(stillRunning.state, 'running');
            assert.equal(stillRunning.advanced, true);
            assert.ok(stillRunning.voices > 0);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            if (process.env.MYGRAIN_DIAGNOSTIC_OUTPUT) {
                await page.locator('#debugConsoleCard').screenshot({ path: path.join(process.env.MYGRAIN_DIAGNOSTIC_OUTPUT, `submit-success-${sampleRate}.png`) });
            }
            for (const failure of ['error', 'offline', 'bad-receipt']) {
                mode = failure;
                await page.locator('#submitDebugLogBtn').tap();
                await page.waitForFunction(() => document.getElementById('debugLogSubmitStatus').textContent.includes('Log submission failed:'));
                assert.ok(await page.locator('#submitDebugLogBtn').isEnabled());
                assert.equal(await page.evaluate(() => phoneAudioDiagnostics.snapshot().incidents.length), 1);
                assert.equal(await page.locator('#debugLogSubmitStatus img').count(), 0);
            }
            assert.equal(requests.length, 4);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            if (process.env.MYGRAIN_DIAGNOSTIC_OUTPUT) {
                const directory = process.env.MYGRAIN_DIAGNOSTIC_OUTPUT;
                fs.writeFileSync(path.join(directory, `submitted-${sampleRate}.json`), JSON.stringify({ reference, report }, null, 2));
                await page.locator('#debugConsoleCard').screenshot({ path: path.join(directory, `submit-console-${sampleRate}.png`) });
            }
            results.push({ sampleRate, viewport, reference, uploadBytes: Buffer.byteLength(JSON.stringify(report)),
                realUpload, duplicateSuppressed: true, localCaptureSurvivesFailures: true, stillRunning });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(blockedWrites, []);
        console.log(JSON.stringify({ pass: true, expectedBuild, emulationOnly: true, results, errors, blockedWrites }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
