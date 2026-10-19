const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
            return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && typeof configureOscillatorWaveAndPitch === 'function');
        const results = await page.evaluate(async () => {
            stateSaveSuspended = true;
            const results = [];
            for (const sampleRate of [44100, 48000]) {
                for (const waveform of ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'metal']) {
                    for (const sync of [false, true]) {
                        oscillatorWaveCache.clear();
                        hardSyncWaveCache.clear();
                        const offline = new OfflineAudioContext(2, Math.round(sampleRate * .15), sampleRate);
                        audioContext = offline;
                        const shape = getSynthWaveShapePercent();
                        const reference = offline.createOscillator();
                        const actual = offline.createOscillator();
                        const ownFrequency = 440;
                        const masterFrequency = sync ? 220 : null;
                        let referenceWave;
                        if (sync) {
                            referenceWave = createHardSyncPeriodicWave(waveform, ownFrequency / masterFrequency, shape);
                            reference.setPeriodicWave(referenceWave);
                            reference.frequency.value = masterFrequency;
                        } else {
                            referenceWave = createOscillatorPeriodicWave(waveform, shape);
                            if (['sine', 'triangle', 'sawtooth', 'square'].includes(waveform)) reference.type = getNativeOscillatorWaveform(waveform);
                            else reference.setPeriodicWave(referenceWave);
                            reference.frequency.value = ownFrequency;
                        }
                        for (let index = 0; index < 200; index += 1) {
                            cacheOscillatorPeriodicWave(oscillatorWaveCache, `fixture-${index}`, {});
                            cacheOscillatorPeriodicWave(hardSyncWaveCache, `fixture-${index}`, {});
                        }
                        configureOscillatorWaveAndPitch(actual, { waveform }, ownFrequency, masterFrequency);
                        const merger = offline.createChannelMerger(2);
                        reference.connect(merger, 0, 0);
                        actual.connect(merger, 0, 1);
                        merger.connect(offline.destination);
                        reference.start();
                        actual.start();
                        const rendered = await offline.startRendering();
                        const referenceSamples = rendered.getChannelData(0);
                        const actualSamples = rendered.getChannelData(1);
                        let difference = 0;
                        let energy = 0;
                        for (let index = 0; index < rendered.length; index += 1) {
                            difference = Math.max(difference, Math.abs(referenceSamples[index] - actualSamples[index]));
                            energy += actualSamples[index] * actualSamples[index];
                        }
                        results.push({ sampleRate, waveform, sync, difference, rms: Math.sqrt(energy / rendered.length),
                            oscillatorCacheSize: oscillatorWaveCache.size, hardSyncCacheSize: hardSyncWaveCache.size });
                    }
                }
            }
            oscillatorWaveCache.clear();
            hardSyncWaveCache.clear();
            return results;
        });
        for (const result of results) {
            assert.equal(result.difference, 0, JSON.stringify(result));
            assert.ok(result.rms > .01, JSON.stringify(result));
            assert.equal(result.oscillatorCacheSize, 128);
            assert.equal(result.hardSyncCacheSize, 128);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ pass: true, results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
