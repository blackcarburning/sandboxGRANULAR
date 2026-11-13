'use strict';
// Real shared audio context, deterministic station and private WAV; disposable server only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const { encodeWav } = require('../radiolab.js');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19341/mygrain/';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const baseline = process.env.RADIO_BASELINE_DIR;
const output = process.env.RADIO_IDLE_OUTPUT || '/tmp/radiolab-idle-results.json';
const wav = Buffer.from(encodeWav([[Float32Array.from({ length: 24000 * 24 }, (_, i) => .2 * Math.sin(i * 2 * Math.PI * 220 / 24000))]], 24000, 1));

async function run(engine, type, viewport) {
    const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
    try {
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
        assert.equal((await context.request.post(base + 'api/auth/login', { data: { username: 'admin', password: 'isolated-radio-idle' } })).status(), 200);
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(30000);
        page.on('pageerror', error => { errors.push(error.message); console.error('PAGE', error.message); });
        await page.addInitScript(() => {
            const connect = AudioNode.prototype.connect;
            AudioNode.prototype.connect = function (node, ...args) {
                if (this instanceof MediaElementAudioSourceNode && node instanceof GainNode) window.__radioMonitorGain = node;
                if (this instanceof AudioBufferSourceNode && node === this.context.destination) window.__radioPreviewSource = this;
                return connect.call(this, node, ...args);
            };
        });
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== new URL(base).origin && !url.href.startsWith('blob:')) return route.abort();
            const filename = url.pathname === '/mygrain/' ? 'index.html' : url.pathname.split('/').at(-1);
            if (baseline && ['index.html', 'radiolab.js', 'demand-ui.js'].includes(filename)) return route.fulfill({ contentType: filename.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(path.join(baseline, filename)) });
            if (url.pathname.endsWith('/api/radiolab/stations')) return route.fulfill({ json: { stations: [{ id: 'idle-fixture', name: 'Idle fixture', streamUrl: '/mygrain/radiolab/stream/idle-fixture' }] } });
            if (url.pathname.includes('/radiolab/stream/')) return route.fulfill({ contentType: 'audio/wav', body: wav });
            if (url.pathname.endsWith('/api/radiolab/samples')) return route.fulfill({ json: { samples: [{ filename: 'idle-fixture.wav', name: 'Idle fixture', duration: 24 }] } });
            if (url.pathname.endsWith('/api/radiolab/file')) return route.fulfill({ contentType: 'audio/wav', body: wav });
            if (url.pathname.endsWith('/api/radiolab/release')) return route.fulfill({ json: { ok: true } });
            return route.continue();
        });
        await page.goto(base);
        console.log(engine, 'page loaded');
        await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
        await page.evaluate(() => mygrainCardHistory.ready);
        await page.locator('#start-btn').tap();
        console.log(engine, 'Start tapped');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
        await page.evaluate(async baseline => { stopAllPerformancePlayback({ silent: true }); await mygrainDemand.load(baseline ? 'radiolab.js?v=20261104-ftp-libraries-1' : 'radiolab.js?v=20261113-radio-idle-1'); }, Boolean(baseline));
        console.log(engine, 'RadioLab loaded');
        await page.waitForFunction(() => window.mygrainRadiolab && !mygrainRadiolab.state.busy);
        const build = await page.locator('.build-badge strong').first().textContent();
        assert.equal(build, baseline ? 'v2026.11.13.PHONE-EDGES.5' : 'v2026.11.13.RADIO-IDLE.1');
        await page.evaluate(() => mygrainJumpToButton(document.querySelector('[data-jump-target="#radiolabCard"]')));
        await page.waitForFunction(() => !document.documentElement.dataset.mygrainJumping);
        const audit = async (source, milliseconds) => {
            await page.evaluate(source => {
                const node = source === 'monitor' ? __radioMonitorGain : __radioPreviewSource;
                const analyser = audioContext.createAnalyser(), sink = audioContext.createGain();
                sink.gain.value = 0; node.connect(analyser); analyser.connect(sink); sink.connect(audioContext.destination);
                window.__audit = { start: performance.now(), samples: [] };
                const timer = setInterval(() => {
                    const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
                    __audit.samples.push({ wall: (performance.now() - __audit.start) / 1000, audio: audioContext.currentTime, peak: Math.max(...pcm.map(Math.abs)), state: audioContext.state, listening: mygrainRadiolab.state.listening, ...backgroundAudioController.diagnostics });
                }, 250);
                window.__finishAudit = () => { clearInterval(timer); try { node.disconnect(analyser); } catch {} analyser.disconnect(); sink.disconnect(); return __audit.samples; };
            }, source);
            // No interactions: another gesture would conceal the original idle suspension.
            await page.waitForTimeout(milliseconds);
            return page.evaluate(() => __finishAudit());
        };
        const checkContinuous = samples => {
            assert(samples.length > 40);
            assert(samples.every(sample => sample.state === 'running'), 'Radio audio must not be idle-suspended');
            assert(samples.at(-1).audio - samples[0].audio > (samples.at(-1).wall - samples[0].wall) * .85);
            assert(samples.filter(sample => sample.wall > 9).every(sample => sample.peak > .01), 'Final audible RadioLab route stays non-silent beyond the old cutoff');
        };
        await page.locator('#radiolabListen').tap();
        await page.waitForFunction(() => mygrainRadiolab.diagnostics.hasSignal && !mygrainRadiolab.state.busy);
        const monitor = await audit('monitor', baseline ? 12500 : 18000);
        const result = { engine, viewport, build, monitor, errors };
        if (baseline) {
            assert(monitor.some(sample => sample.idleSuspended), 'The exact baseline must reproduce the idle cutoff');
            assert.equal(monitor.at(-1).listening, false);
        } else {
            checkContinuous(monitor);
            await page.locator('#radiolabStop').tap();
            await page.waitForFunction(() => backgroundAudioController.idleSuspended, null, { timeout: 13000 });
            assert.equal(await page.evaluate(() => mygrainRadiolab.needsAudio), false);
            // A saved-file audition shares the same context, and must also outlive idle grace.
            await page.locator('#radiolabBrowser').tap();
            await page.locator('#radiolabSampleList [data-action="play"]').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
            result.preview = await audit('preview', 12500);
            checkContinuous(result.preview);
            // Natural end releases protection even with the browser left open.
            await page.waitForFunction(() => !mygrainRadiolab.state.previewing, null, { timeout: 15000 });
            await page.waitForFunction(() => backgroundAudioController.idleSuspended, null, { timeout: 13000 });
            await page.locator('#radiolabSampleList [data-action="play"]').tap();
            await page.waitForFunction(() => audioContext.state === 'running' && mygrainRadiolab.state.previewing);
            await page.locator('#radiolabBrowserClose').tap();
            assert.equal(await page.evaluate(() => mygrainRadiolab.needsAudio), false);
            await page.waitForFunction(() => backgroundAudioController.idleSuspended, null, { timeout: 13000 });
            // Retune after sleeping, without rebuilding the graph or starting main transport.
            await page.locator('#radiolabListen').tap();
            await page.waitForFunction(() => mygrainRadiolab.diagnostics.hasSignal && !mygrainRadiolab.state.busy);
            result.replay = await audit('monitor', 12500);
            checkContinuous(result.replay);
            await page.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock')));
            assert.equal(await page.evaluate(() => mygrainRadiolab.needsAudio || mygrainRadiolab.state.listening || mygrainRadiolab.state.previewing), false);
        }
        assert.deepEqual(errors, []);
        console.log('PASS', engine, viewport.width, baseline ? 'baseline cutoff reproduced' : 'monitor, saved audition, natural end, Stop, Close, retune and lock');
        await context.close();
        return result;
    } finally { await browser.close(); }
}
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.RADIO_ENGINE && process.env.RADIO_ENGINE !== engine) continue;
        for (const viewport of baseline || process.env.RADIO_PORTRAIT_ONLY ? [{ width: 390, height: 844 }] : [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            results.push(await run(engine, type, viewport));
            fs.writeFileSync(output, JSON.stringify(results, null, 2));
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
