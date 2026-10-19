const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    const errors = [];
    const writes = [];
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) {
                writes.push(request.url());
                return route.abort();
            }
            return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        const saved = await page.evaluate(() => {
            stopAllPerformancePlayback({ silent: true });
            setLoopLayerSolo('none', { silent: true, skipSave: true });
            setBastardLoopXLevelPercent(80, { skipSave: true });
            const slider = document.getElementById('bastardLoopXAccentAmount');
            slider.value = '-60';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            saveState({ force: true });
            return JSON.parse(localStorage.getItem(STATE_STORAGE_KEY)).modes;
        });
        assert.equal(saved.bastardLoopXAccentAmount, -.6);
        await page.reload({ waitUntil: 'load' });
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        assert.equal(await page.locator('#bastardLoopXAccentAmount').inputValue(), '-60');
        assert.equal(await page.locator('#performanceBastardLoopXLevel').inputValue(), '80');
        assert.equal(await page.locator('#performanceBastardLoopXLevelMixer').inputValue(), '80');
        assert.match(await page.locator('label[for="bastardLoopXAccentAmount"]').innerText(), /Filter Accent/);

        const renders = await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true });
            stateSaveSuspended = true;
            setLoopLayerSolo('none', { silent: true, skipSave: true });
            const originalContext = audioContext;
            const originalDestination = getBastardLoopXPlaybackDestination;
            const results = [];
            async function render(sampleRate, mode, amount, accent, cutoff = 18000) {
                destroyBastardLoopXDelayBus();
                destroyBastardLoopXFilterLfoSource();
                bastardLoopXActiveVoices.clear();
                const offline = new OfflineAudioContext(1, sampleRate, sampleRate);
                Object.defineProperty(offline, 'state', { get: () => 'running' });
                audioContext = offline;
                getBastardLoopXPlaybackDestination = () => offline.destination;
                for (const [id, value] of Object.entries({
                    performanceBastardLoopXLevel: 100,
                    performanceBastardLoopXLength: 100,
                    performanceBastardLoopXDecay: 100,
                    performanceBastardLoopXAttack: 4,
                    performanceBastardLoopXStartTrim: 0,
                    performanceBastardLoopXSemitone: 0,
                    performanceBastardLoopXFilterCutoff: cutoff,
                    performanceBastardLoopXFilterEnvelope: cutoff === 18000 ? 0 : 40,
                    performanceBastardLoopXFilterLfoAmount: 0,
                    performanceBastardLoopXDelayMix: 0,
                    bastardLoopXAccentAmount: amount
                })) document.getElementById(id).value = String(value);
                document.getElementById('performanceBastardLoopXFilterMode').value = 'lowpass-48';
                bastardLoopXEnabled = true;
                bastardLoopXRootNote = 'C3';
                bastardLoopXSampleBuffer = offline.createBuffer(1, sampleRate, sampleRate);
                const samples = bastardLoopXSampleBuffer.getChannelData(0);
                for (let frame = 0; frame < samples.length; frame += 1) {
                    const time = frame / sampleRate;
                    samples[frame] = cutoff === 18000 ? .8 * Math.sin(2 * Math.PI * 110 * time)
                        : .35 * (Math.sin(2 * Math.PI * 110 * time) + Math.sin(2 * Math.PI * 1100 * time));
                }
                const step = { ...createEmptyBastardLoopXStep(), note: 'C3', accent };
                if (mode === 'sequence') scheduleBastardLoopXSingleVoice(step, .002, .125, null);
                else if (!previewBastardLoopXStep(step)) throw new Error('X audition did not start');
                const level = getBastardLoopXLevelValue();
                const envelope = getBastardLoopXFilterEnvelopeAmountForStep(step);
                const rendered = await offline.startRendering();
                const pcm = rendered.getChannelData(0);
                let peak = 0;
                let energy = 0;
                for (const value of pcm) {
                    if (!Number.isFinite(value)) throw new Error('Non-finite X sample');
                    peak = Math.max(peak, Math.abs(value));
                    energy += value * value;
                }
                return { pcm, level, envelope, peak, rms: Math.sqrt(energy / pcm.length) };
            }
            try {
                for (const sampleRate of [44100, 48000]) {
                    for (const mode of ['sequence', 'audition']) {
                        const reference = await render(sampleRate, mode, 0, false);
                        for (const amount of [-100, -50, 0, 35, 100]) {
                            for (const accent of [false, true]) {
                                const output = await render(sampleRate, mode, amount, accent);
                                let difference = 0;
                                for (let frame = 0; frame < output.pcm.length; frame += 1) {
                                    difference = Math.max(difference, Math.abs(output.pcm[frame] - reference.pcm[frame]));
                                }
                                results.push({ sampleRate, mode, amount, accent, difference,
                                    level: output.level, peak: output.peak, rms: output.rms });
                            }
                        }
                        const filter = [];
                        for (const amount of [-100, 0, 100]) {
                            const output = await render(sampleRate, mode, amount, true, 600);
                            filter.push({ amount, envelope: output.envelope, rms: output.rms });
                        }
                        results.push({ sampleRate, mode, filter });
                    }
                }
            } finally {
                destroyBastardLoopXDelayBus();
                destroyBastardLoopXFilterLfoSource();
                bastardLoopXActiveVoices.clear();
                getBastardLoopXPlaybackDestination = originalDestination;
                audioContext = originalContext;
            }
            return results;
        });
        for (const result of renders) {
            if (result.filter) {
                assert.deepEqual(result.filter.map(item => item.envelope), [0, .4, .9]);
                assert.ok(result.filter[2].rms > result.filter[0].rms * 1.03, JSON.stringify(result));
            } else {
                assert.equal(result.level, .9);
                assert.ok(result.difference < 1e-6, JSON.stringify(result));
                assert.ok(result.peak > .6 && result.peak < .81, JSON.stringify(result));
                assert.ok(result.rms > .08, JSON.stringify(result));
            }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, restoredAccent: -.6, restoredLevel: .8, renders, errors, writes }, null, 2));
        await context.close();
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
