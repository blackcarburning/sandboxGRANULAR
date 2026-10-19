const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:8765/mygrain/';
const legacyDirectory = process.env.MYGRAIN_LEGACY_DIR;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const requests = [];
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
            if (new URL(request.url()).origin !== new URL(base).origin) return route.abort();
            requests.push(request.url());
            return route.continue();
        });
        async function start() {
            await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        }
        async function setSlider(id, value) {
            await page.locator(`#${id}`).evaluate((element, value) => { element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
        }
        await page.goto(`${base}?q-length-decay-check=1`, { waitUntil: 'load' });
        await start();
        const layouts = [];
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            for (const [field, id] of [['sampleLength', 'performanceBastardLoopQSampleLength'], ['sampleDecay', 'performanceBastardLoopQSampleDecay']]) {
                const slider = page.locator(`#${id}`);
                await slider.scrollIntoViewIfNeeded();
                const bounds = await slider.boundingBox();
                assert.ok(bounds && bounds.width > 80 && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
                await page.touchscreen.tap(bounds.x + bounds.width * .35, bounds.y + bounds.height / 2);
                const value = await page.evaluate(field => mygrainQ.state[field], field);
                assert.ok(value > .1 && value < .8);
                assert.equal(await page.locator(`#${id}Value`).textContent(), `${Math.round(value * 100)}%`);
            }
            await page.locator('#performanceBastardLoopQEditBtn').scrollIntoViewIfNeeded();
            await page.locator('#performanceBastardLoopQEditBtn').tap();
            if (!await page.locator('#bastardLoopQPlaybackSettings').evaluate(element => element.open)) await page.locator('#bastardLoopQPlaybackSettings > summary').tap();
            assert.equal(await page.locator('#bastardLoopQSampleLength').isVisible(), true);
            assert.equal(await page.locator('#bastardLoopQSampleDecay').isVisible(), true);
            await setSlider('bastardLoopQSampleLength', .4);
            await setSlider('bastardLoopQSampleDecay', .25);
            assert.equal(await page.locator('#performanceBastardLoopQSampleLength').inputValue(), '0.4');
            assert.equal(await page.locator('#performanceBastardLoopQSampleDecay').inputValue(), '0.25');
            assert.equal(await page.evaluate(() => document.querySelector('.q-shell').scrollWidth <= document.querySelector('.q-shell').clientWidth + 1), true);
            await page.locator('#bastardLoopQCloseBtn').tap();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            layouts.push(viewport);
        }
        const legacySource = legacyDirectory ? fs.readFileSync(path.join(legacyDirectory, 'q-card.js'), 'utf8') : null;
        const audio = await page.evaluate(async legacySource => {
            let LegacyController;
            if (legacySource) {
                const legacyRoot = { MygrainQTheory };
                new Function('window', legacySource)(legacyRoot);
                LegacyController = legacyRoot.MygrainQ.Controller;
            }
            const results = [];
            for (const instrument of ['piano', 'strings']) {
                const piano = new MygrainQ.Piano({ context: () => audioContext });
                piano.select(instrument);
                await piano.ensure([{ notes: [48], velocity: 96 }]);
                const selected = piano.source(48, 96);
                for (const sampleRate of [44100, 48000]) for (const duration of [.5, .05]) {
                    async function render(sampleLength, sampleDecay, Controller = MygrainQ.Controller) {
                        const context = new OfflineAudioContext(2, sampleRate, sampleRate);
                        const controller = new Controller({ context: () => context, length: () => 16, bpm: () => 120 });
                        Object.assign(controller.state, { instrument, sampleLength, sampleDecay, enabled: true });
                        controller.ensureGraph = () => ({ input: context.destination });
                        controller.piano.source = () => selected;
                        controller.voice(48, 96, .05, duration, { preview: true });
                        const voice = [...controller.voices][0];
                        const end = voice.end;
                        const buffer = await context.startRendering();
                        const pcm = buffer.getChannelData(0);
                        let power = 0;
                        let last = 0;
                        let latePower = 0;
                        for (let frame = 0; frame < pcm.length; frame += 1) {
                            power += pcm[frame] ** 2;
                            if (Math.abs(pcm[frame]) > 1e-9) last = frame / sampleRate;
                            if (frame / sampleRate > end + .002) latePower += pcm[frame] ** 2;
                        }
                        return { end, power, last, latePower, pcm };
                    }
                    const full = await render(1, 1);
                    if (LegacyController) {
                        const legacy = await render(1, 1, LegacyController);
                        let difference = 0;
                        for (let frame = 0; frame < full.pcm.length; frame += 1) difference = Math.max(difference, Math.abs(full.pcm[frame] - legacy.pcm[frame]));
                        if (difference > 1e-6) throw new Error(`Legacy envelope changed: ${instrument} ${sampleRate} ${difference}`);
                    }
                    for (const [sampleLength, sampleDecay] of [[.25, 1], [1, .25], [.25, .25]]) {
                        const shortened = await render(sampleLength, sampleDecay);
                        if (!(shortened.power > 0 && shortened.power < full.power && shortened.end < full.end && shortened.latePower === 0 && shortened.last <= shortened.end)) throw new Error('Q shortening did not remove the dry sample tail');
                        results.push({ instrument, sampleRate, duration, sampleLength, sampleDecay, fullEnd: full.end, end: shortened.end, last: shortened.last, power: shortened.power, silentAfterEnd: shortened.latePower === 0, legacyCompared: Boolean(LegacyController) });
                    }
                }
            }
            mygrainQ.sync();
            return results;
        }, legacySource);
        const live = await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true });
            syncPatternLengthControls(16, { skipSave: true });
            mygrainQ.state.instrument = 'piano';
            mygrainQ.state.sampleLength = 1;
            mygrainQ.state.sampleDecay = 1;
            mygrainQ.state.sequence = Array(64).fill(null);
            mygrainQ.state.sequence[0] = MygrainQTheory.normalizeStep({ root: 48, notes: [48], gate: 16 });
            mygrainQ.setEnabled(true);
            await mygrainQ.preparePlayback();
            if (!mygrainQ.start(audioContext.currentTime + .02)) throw new Error('Q did not start');
            await new Promise(resolve => setTimeout(resolve, 160));
            const origin = mygrainQ.origin;
            const cache = mygrainQ.piano.cache;
            const bank = mygrainQ.state.bank;
            for (const [id, value] of [['performanceBastardLoopQSampleLength', '.05'], ['performanceBastardLoopQSampleDecay', '.1']]) {
                const slider = document.getElementById(id);
                slider.value = value;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
            await new Promise(resolve => setTimeout(resolve, 80));
            const result = { running: mygrainQ.running, sameOrigin: mygrainQ.origin === origin, sameCache: mygrainQ.piano.cache === cache, sameBank: mygrainQ.state.bank === bank,
                noHangingVoice: [...mygrainQ.voices].every(voice => voice.start > audioContext.currentTime || voice.end <= audioContext.currentTime) };
            mygrainQ.stop();
            mygrainQ.setEnabled(false);
            return result;
        });
        assert.equal(live.running && live.sameOrigin && live.sameCache && live.sameBank && live.noHangingVoice, true);
        await setSlider('performanceBastardLoopQSampleLength', .4);
        await setSlider('performanceBastardLoopQSampleDecay', .25);
        await page.reload({ waitUntil: 'load' });
        await start();
        assert.deepEqual(await page.evaluate(() => [mygrainQ.state.sampleLength, mygrainQ.state.sampleDecay]), [.4, .25]);
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, layouts, audio, live, reload: true, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
