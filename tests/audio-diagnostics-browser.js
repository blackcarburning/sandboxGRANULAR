const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const expectedBuild = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/Build <strong>(v[^<]+)<\/strong>/)[1];
const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const [sampleRate, missingApis, viewport] of [[44100, true, { width: 390, height: 844 }], [48000, false, { width: 844, height: 390 }]]) {
            const context = await browser.newContext({ viewport, userAgent, isMobile: true, hasTouch: true, acceptDownloads: true });
            await context.addInitScript(({ rate, missing }) => {
                const NativeContext = window.AudioContext;
                window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                window.debugPermissionRequests = 0;
                if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
                    debugPermissionRequests += 1;
                    return Promise.reject(new Error('Diagnostics must never request microphone permission'));
                };
                if (missing) {
                    Object.defineProperty(performance, 'memory', { get: () => undefined });
                    Object.defineProperty(navigator, 'audioSession', { get: () => undefined });
                    Object.defineProperty(navigator, 'standalone', { get: () => true });
                    Object.defineProperty(window.AudioContext.prototype, 'outputLatency', { get: () => undefined });
                    window.AudioContext.prototype.getOutputTimestamp = undefined;
                    window.PerformanceObserver = undefined;
                }
            }, { rate: sampleRate, missing: missingApis });
            const page = await context.newPage();
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => phoneAudioDiagnostics?.snapshot().monitorRunning);
            const before = await page.evaluate(() => phoneAudioDiagnostics.snapshot());
            assert.equal(before.build, expectedBuild);
            assert.equal(before.environment.reportedIOS, '18.6');
            assert.equal(before.environment.appleMobile, true);
            assert.equal(before.audio.state, 'not-started');
            assert.match(await page.locator('#debugConsoleOutput').inputValue(), /iPhone \/ Browser Diagnostics/);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                const tone = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const data = tone.getChannelData(0);
                for (let frame = 0; frame < data.length; frame += 1) data[frame] = .1 * Math.sin(2 * Math.PI * 110 * frame / audioContext.sampleRate);
                bastardLoopBuffer = tone;
                bastardLoopEnabled = true;
                bastardLoopXSampleBuffer = tone;
                bastardLoopXEnabled = true;
                bastardLoopXSequence = Array.from({ length: 64 }, () => ({ note: 'C3', rest: false, slide: false, accent: false, ratchet: 1 }));
                grainASampleBuffer = tone;
                grainBSampleBuffer = tone;
                syncLegacyAudioBuffer();
                drumMachineKickBuffer = tone;
                drumMachineKickPattern = Array.from({ length: 64 }, (unused, index) => index % 4 === 0);
                for (const [id, value] of Object.entries({ performanceBastardLoopLevel: 40, performanceBastardLoopXLevel: 40,
                    performanceBastardLoopXDecay: 50, grainSynthAVolume: 60, grainSynthBVolume: 60 })) document.getElementById(id).value = String(value);
                setOscillatorsEnabled(true, { silent: true, skipSave: true });
                setGranularLayersEnabled(true, { silent: true, skipSave: true });
                setGranularLayerMuted('A', false, { silent: true, skipSave: true });
                setGranularLayerMuted('B', false, { silent: true, skipSave: true });
                for (const note of ['C3', 'G3']) playOscillatorNote(note);
                startGrainStream('C3');
                const origin = audioContext.currentTime + .1;
                if (!startBastardLoop(origin, { skipUi: true }) || !startBastardLoopX(origin, { skipUi: true }) ||
                    !startDrumMachine(origin, { silent: true, skipSave: true })) throw new Error('Diagnostic audio fixture did not start');
                window.diagnosticCopy = '';
                Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { diagnosticCopy = text; } }, configurable: true });
            });
            await page.waitForTimeout(12000);
            await page.waitForFunction(() => phoneAudioDiagnostics.snapshot().timing.lastProbe?.state === 'running');
            const until = await page.evaluate(() => Math.max(0, phoneAudioDiagnostics.snapshot().timing.lastProbe.performanceTime + 950 - performance.now()));
            await page.waitForTimeout(until);
            await page.evaluate(() => { const end = performance.now() + 450; while (performance.now() < end) {} });
            await page.waitForTimeout(1200);
            const active = await page.evaluate(() => phoneAudioDiagnostics.snapshot());
            assert.equal(active.audio.sampleRate, sampleRate);
            assert.ok(active.application.buffers.estimatedPCMBytes > 0);
            assert.ok(active.application.buffers.uniqueBuffers < 10);
            assert.equal(active.application.counts.oscillatorVoices, 2);
            assert.equal(active.application.counts.grainStreams, 1);
            for (const layer of ['A', 'X', 'drums', 'granular', 'oscillators']) assert.ok(active.application.playback.activeLayers.includes(layer), layer);
            assert.ok(active.timing.delayedOver120ms >= 1);
            assert.ok(active.timing.maximumDelayMs >= 250);
            assert.ok(active.history.length >= 2);
            assert.ok(active.history.at(-1).knownPCMBytes > 0);
            if (missingApis) {
                assert.equal(active.heap.available, false);
                assert.equal(active.audio.outputLatencyMs, null);
                assert.equal(active.audio.outputTimestamp.available, false);
                assert.equal(active.longTasks.available, false);
                assert.equal(active.environment.standalone, true);
            }
            await page.locator('#markAudioProblemBtn').tap();
            const marked = await page.evaluate(() => ({ capture: phoneAudioDiagnostics.snapshot(), running: Boolean(bastardLoopSource) && bastardLoopXTransportActive,
                time: audioContext.currentTime, state: audioContext.state }));
            assert.equal(marked.capture.incidents.length, 1);
            assert.equal(marked.running, true);
            assert.equal(marked.state, 'running');
            await page.evaluate(() => { document.getElementById('debugConsoleOutput').value = 'STALE DEBUG TEXT'; });
            await page.locator('#copyDebugConsoleBtn').tap();
            const copied = await page.evaluate(() => diagnosticCopy);
            assert.ok(!copied.includes('STALE DEBUG TEXT'));
            for (const text of [expectedBuild, 'reported iOS=18.6', 'Marked crackle snapshots:', 'user-marked-crackle', '10-second resource timeline:', 'estimatedPCMBytes']) assert.ok(copied.includes(text), text);
            await page.evaluate(async () => { await audioContext.suspend(); });
            await page.waitForFunction(() => phoneAudioDiagnostics.snapshot().events.some(entry => entry.type === 'audio-state' && entry.state === 'suspended'));
            const suspended = await page.evaluate(() => phoneAudioDiagnostics.snapshot());
            assert.equal(suspended.audio.state, 'suspended');
            assert.ok(suspended.events.some(entry => entry.type === 'audio-state' && entry.state === 'suspended'));
            await page.waitForTimeout(1100);
            assert.equal(await page.evaluate(() => audioContext.state), 'suspended');
            await page.evaluate(async () => { await audioContext.resume(); });
            await page.evaluate(() => phoneAudioDiagnostics.record('escape-check', { message: '<img src=x onerror="throw Error(1)">' }));
            const safe = await page.evaluate(() => {
                const holder = document.createElement('div');
                holder.innerHTML = formatDebugInfo(captureAudioDebug());
                return { noImage: holder.querySelector('img') === null, escaped: holder.innerHTML.includes('&lt;img') };
            });
            assert.deepEqual(safe, { noImage: true, escaped: true });
            await page.evaluate(() => toggleDebugPanel());
            await page.waitForTimeout(2200);
            assert.match(await page.locator('#debugContent').innerText(), /Phone \/ Audio Diagnostics/);
            assert.ok(await page.evaluate(() => debugLogs.length >= 1 && debugLogs.length <= 4));
            await page.evaluate(() => toggleDebugPanel());
            const downloadEvent = page.waitForEvent('download');
            await page.evaluate(() => downloadDebugLog());
            const download = await downloadEvent;
            const downloadPath = await download.path();
            const downloaded = JSON.parse(fs.readFileSync(fs.existsSync(downloadPath) ? downloadPath : `/tmp/snap-private-tmp/snap.chromium${downloadPath}`, 'utf8'));
            assert.equal(downloaded.phoneDiagnostics.build, expectedBuild);
            assert.equal(downloaded.currentState.phoneDiagnostics.incidents.length, 1);
            assert.ok(downloaded.phoneDiagnostics.events.some(entry => entry.type === 'audio-state' && entry.state === 'suspended'));
            assert.ok(downloaded.debugConsoleText.includes('user-marked-crackle'));
            if (process.env.MYGRAIN_DIAGNOSTIC_OUTPUT) {
                fs.writeFileSync(path.join(process.env.MYGRAIN_DIAGNOSTIC_OUTPUT, `phone-debug-${sampleRate}.json`), JSON.stringify(downloaded, null, 2));
                await page.locator('#debugConsoleCard').screenshot({ path: path.join(process.env.MYGRAIN_DIAGNOSTIC_OUTPUT, `debug-console-${sampleRate}.png`) });
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            assert.equal(await page.evaluate(() => debugPermissionRequests), 0);
            await page.locator('#clearDebugConsoleBtn').tap();
            assert.equal(await page.evaluate(() => phoneAudioDiagnostics.snapshot().incidents.length), 0);
            assert.equal(await page.evaluate(() => debugLogs.length), 0);
            assert.equal(await page.evaluate(() => phoneAudioDiagnostics.snapshot().monitorRunning), true);
            results.push({ sampleRate, missingApis, viewport, snapshotBytes: copied.length, events: downloaded.phoneDiagnostics.events.length,
                history: downloaded.phoneDiagnostics.history.length, maximumDelayMs: downloaded.phoneDiagnostics.timing.maximumDelayMs,
                copiedFresh: true, downloaded: true, microphoneRequests: 0 });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ pass: true, expectedBuild, emulationOnly: true, results, errors, writes }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
