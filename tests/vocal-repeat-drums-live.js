const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
        const errors = [];
        const writes = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
            return route.continue();
        });
        const base = 'https://openclaw.blackcarburning.com/mygrain/';
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        const features = await page.evaluate(async () => (await mygrainSongBeta.request('')).features);
        assert.equal(features.vocalRepeatRenders, 1);
        assert.equal(features.drumLaneRenders, 1);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await page.evaluate(() => openDrumMachineOverlay());
        assert.equal(await page.locator('#drumMachineOverlay .drum-machine-track-card').count(), 6);
        assert.equal(await page.locator('#drumMachineTitle').textContent(), 'Drum Machine');
        for (const [id, source] of [['drumMachineClap', 'SAMPLES_CLAP'], ['drumMachineCymbals', 'SAMPLES_CRASH']]) {
            await page.click(`#${id}BrowseBtn`);
            await page.waitForFunction(() => !dropboxSampleBrowserLoading && document.querySelector('#dropboxSampleBrowserList .sample-browser-card'));
            assert.ok(await page.evaluate(() => dropboxSampleBrowserFiles.length) > 100);
            await page.locator('#dropboxSampleBrowserList .sample-browser-card button').first().click();
            await page.waitForFunction(() => !drumMachineLoadInFlight && document.getElementById('dropboxSampleBrowserOverlay').hidden);
            assert.match(await page.locator(`#${id}Meta`).textContent(), new RegExp(source));
        }
        await page.evaluate(() => {
            closeDrumMachineOverlay();
            bastardLoopVBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
            bastardLoopVBuffer.getChannelData(0).fill(.2);
            bastardLoopVSourceBpm = 120;
            bastardLoopVMetadata = { durationSeconds: 1, bpm: 120 };
            setBastardLoopVCut({ enabled: true, start: 0, end: 5 / 16 });
            bastardLoopVCutEditor.open();
        });
        await page.click('#bastardLoopVCutRepeat');
        assert.equal(await page.evaluate(() => bastardLoopVCut.repeat), true);
        assert.equal(await page.locator('#bastardLoopVCutRepeat').getAttribute('aria-pressed'), 'true');
        await page.click('#bastardLoopVCutClose');
        await page.click('#performancePanLabResetBtn');
        assert.equal(await page.evaluate(() => document.getElementById('finalPanCenter').value), '0');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => openDrumMachineOverlay());
        await page.locator('#drumMachineCymbalsGrid').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: '/tmp/mygrain-cymbals-live-mobile.png' });
        for (const file of ['index.html', 'vocal-loop-cut.js', 'song-beta.js', 'song-beta-adapter.js']) {
            const response = await page.request.get(base + file);
            assert.equal(response.status(), 200);
            assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log('PASS: Live backend capabilities, local Clap/Cymbals sample listing and loading, six lanes, Section Repeat, previous Pan Lab reset and mobile layout.');
        console.log('PASS: Live HTML/modules match local files; no browser errors or non-read requests.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
