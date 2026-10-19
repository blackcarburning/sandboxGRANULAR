const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const duration = Number(process.env.MYGRAIN_PROFILE_SECONDS || 30);
const baseline = process.env.MYGRAIN_RESOURCE_BASELINE === '1';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        page.setDefaultTimeout(120000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
            return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.MYGRAIN_CPU_THROTTLE || 4) });
        const setup = await page.evaluate(() => {
            stopAllPerformancePlayback({ silent: true });
            stateSaveSuspended = true;
            clearAllPerformanceSoloStates({ silent: true, skipSave: true });
            for (const [id, value] of Object.entries({ osc1Wave: 'vocal', osc2Wave: 'metal', osc3Wave: 'pulse', osc2Sync: 'osc1',
                synthWaveShape: 50, synthMod1Source: 'lfo1', synthMod1Target: 'synthWaveShape', synthMod1Amount: 65,
                performanceModAmount: 100, osc1Level: 70, osc2Level: 70, osc3Level: 60 })) {
                const element = document.getElementById(id);
                if (!element) throw new Error(`Missing control ${id}`);
                element.value = String(value);
                element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
            }
            setLfoRouteState('osc2Detune', '2', true);
            setOscillatorsEnabled(true, { silent: true, skipSave: true });
            for (const note of ['C3', 'E3', 'G3', 'B3']) playOscillatorNote(note);
            const build = audioContext.createPeriodicWave.bind(audioContext);
            window.workloadBuilds = 0;
            audioContext.createPeriodicWave = (...args) => { workloadBuilds += 1; return build(...args); };
            window.workloadTimings = [];
            let previous = performance.now();
            window.workloadTimer = setInterval(() => {
                const now = performance.now();
                workloadTimings.push(now - previous);
                previous = now;
            }, 10);
            return { voices: activeOscVoices.size, modulated: hasActiveSynthLfoRouting(), waveforms: [osc1Config.waveform, osc2Config.waveform, osc3Config.waveform] };
        });
        assert.deepEqual(setup.waveforms, ['vocal', 'metal', 'pulse']);
        assert.equal(setup.voices, 4);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        await page.waitForTimeout(duration * 1000);
        const { profile } = await cdp.send('Profiler.stop');
        if (process.env.MYGRAIN_PROFILE_OUTPUT) fs.writeFileSync(process.env.MYGRAIN_PROFILE_OUTPUT, JSON.stringify(profile));
        const functions = {};
        for (const node of profile.nodes) {
            const name = node.callFrame.functionName || '(anonymous)';
            functions[name] = (functions[name] || 0) + (node.hitCount || 0);
        }
        const timing = await page.evaluate(() => {
            clearInterval(workloadTimer);
            stopModulationLoop();
            const sorted = workloadTimings.slice().sort((first, second) => first - second);
            return { callbacks: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)],
                p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1), over120ms: sorted.filter(value => value > 120).length,
                builds: workloadBuilds, oscillatorCache: oscillatorWaveCache.size, syncCache: hardSyncWaveCache.size };
        });
        const recovery = await page.evaluate(() => {
            stopAllPerformancePlayback({ silent: true });
            stopSharedRhythmClockIfIdle();
            const calls = [];
            const originalVoice = scheduleBastardLoopXVoice;
            scheduleBastardLoopXVoice = (step, when) => calls.push(when);
            const tone = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
            bastardLoopXSampleBuffer = tone;
            bastardLoopXEnabled = true;
            document.getElementById('performanceBastardLoopXLevel').value = '70';
            bastardLoopXSequence = Array.from({ length: 64 }, () => ({ note: 'C3', rest: false, accent: false, slide: false, ratchet: 1 }));
            bastardLoopXTransportActive = true;
            bastardLoopXNextStepIndex = 0;
            const now = audioContext.currentTime;
            bastardLoopXNextStepTime = now - 10;
            try { scheduleBastardLoopXSteps(); }
            finally { scheduleBastardLoopXVoice = originalVoice; bastardLoopXTransportActive = false; }
            return { calls: calls.length, stale: calls.filter(when => when < now - .001).length, firstOffset: calls.length ? calls[0] - now : null };
        });
        if (!baseline) {
            assert.ok(timing.p95 < 120, JSON.stringify(timing));
            assert.equal(recovery.stale, 0, JSON.stringify(recovery));
            assert.ok(recovery.calls < 8, JSON.stringify(recovery));
            const diagnostics = await page.evaluate(() => ({ capture: captureAudioDebug().scheduling,
                console: buildDebugConsoleText(), panel: formatDebugInfo(captureAudioDebug()) }));
            assert.ok(diagnostics.capture.skippedSteps >= 80);
            assert.ok(diagnostics.capture.maxLatenessMs >= 9990);
            assert.match(diagnostics.console, /Scheduling: lateTicks=\d+ skippedSteps=\d+ maxLateness=/);
            assert.match(diagnostics.panel, /Skipped stale steps:/);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ baseline, duration, setup, timing, recovery,
            topFunctions: Object.entries(functions).sort((first, second) => second[1] - first[1]).slice(0, 18), errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
