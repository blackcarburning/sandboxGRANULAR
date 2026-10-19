const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18765/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const sampleRate of [44100, 48000]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await context.addInitScript(sampleRate => {
                const NativeContext = window.AudioContext;
                window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate }); } };
                window.webkitAudioContext = window.AudioContext;
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(45000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            async function start() {
                await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            }
            await page.goto(base, { waitUntil: 'load' });
            await start();
            const state = await page.evaluate(async () => {
                const shell = document.createElement('div');
                const fill = document.createElement('div');
                const peak = document.createElement('div');
                const label = document.createElement('span');
                shell.append(fill, peak, label);
                const observer = new MutationObserver(() => {});
                observer.observe(shell, { subtree: true, attributes: true, characterData: true, childList: true });
                for (const level of [0, 40, 40.5, 100]) {
                    updatePerformanceVuDisplay(shell, fill, peak, label, level, level, -20);
                    observer.takeRecords();
                    updatePerformanceVuDisplay(shell, fill, peak, label, level, level, -20);
                    if (observer.takeRecords().length) throw new Error('Unchanged meter values rewrote the DOM');
                }
                observer.disconnect();
                const slider = (id, value) => { const element = document.getElementById(id); element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); };
                slider('lfoRate', 120);
                slider('lfoDepth', 50);
                slider('lpfCutoff', 2000);
                setLfoRouteState('lpfCutoff', 1, true);
                slider('finalPanWidth', 100);
                slider('finalPanLfoDepth', 80);
                const filters = [];
                const pans = [];
                for (let index = 0; index < 8; index += 1) {
                    await new Promise(resolve => setTimeout(resolve, 80));
                    filters.push(lpfNodes[0].frequency.value);
                    pans.push(finalPanBaseOffsetSource.offset.value);
                }
                if (Math.max(...filters) - Math.min(...filters) < 10) throw new Error('Filter LFO stopped updating');
                if (Math.max(...pans) - Math.min(...pans) < .01) throw new Error('Pan LFO stopped updating');
                setLfoRouteState('lpfCutoff', 1, false);
                slider('finalPanLfoDepth', 0);
                slider('finalDriveSoft', 65);
                updateEffects();
                Object.assign(mygrainQ.state, { sampleLength: .3, sampleDecay: .4 });
                mygrainQ.state.sequence[0] = MygrainQTheory.normalizeStep({ root: 48, notes: [48, 52, 55] });
                mygrainQ.sync();
                saveState({ force: true });
                const curve = Array.from(finalDistortionNodes[0].curve);
                const previousNode = finalDistortionNodes[0];
                await resetEngineRoutine({ silent: true });
                updateEffects();
                const resetCurve = Array.from(finalDistortionNodes[0].curve);
                if (previousNode === finalDistortionNodes[0] || !curve.every((value, index) => value === resetCurve[index])) throw new Error('Effect cache did not follow the rebuilt graph');
                if (finalDistortionNodes.some(node => node.oversample !== '4x')) throw new Error('Effect oversampling changed');
                Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                document.dispatchEvent(new Event('visibilitychange'));
                await new Promise(resolve => setTimeout(resolve, 100));
                if (performanceMixerVuTimerId !== null) throw new Error('Meter timer continued while hidden');
                Object.defineProperty(document, 'hidden', { configurable: true, value: false });
                document.dispatchEvent(new Event('visibilitychange'));
                await ensureForegroundAudioReady({ silent: true });
                await new Promise(resolve => setTimeout(resolve, 200));
                if (!performanceMixerVuTimerId || !isAudioGraphReady()) throw new Error('Foreground meter/audio recovery failed');
                return { sampleRate: audioContext.sampleRate, filters, pans, unchangedMeterWritesSkipped: true, cacheFollowsReset: true, oversamplingUnchanged: true, foregroundRecovery: true };
            });
            await page.reload({ waitUntil: 'load' });
            await start();
            const restored = await page.evaluate(() => ({ drive: document.getElementById('finalDriveSoft').value, length: mygrainQ.state.sampleLength, decay: mygrainQ.state.sampleDecay, notes: mygrainQ.state.sequence[0].notes }));
            assert.deepEqual(restored, { drive: '65', length: .3, decay: .4, notes: [48, 52, 55] });
            results.push({ ...state, restored });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
