const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.WAV_BROWSER_TEST_URL;
if (!base || !/^https?:\/\/(?:127\.0\.0\.1:\d+|localhost:\d+|openclaw\.blackcarburning\.com)\/mygrain\/$/.test(base)) {
    throw new Error('Use the isolated test server or the read-only live check.');
}

function fixtureWav() {
    const sampleRate = 16000;
    const samples = sampleRate * 3;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(samples * 2, 40);
    for (let sample = 0; sample < samples; sample += 1) {
        wav.writeInt16LE(Math.round(Math.sin(sample * Math.PI * 440 / sampleRate) * 6000), 44 + sample * 2);
    }
    return wav;
}

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const errors = [];
    const writes = [];
    const wav = fixtureWav();
    const headers = { 'Access-Control-Allow-Origin': '*' };
    const counters = { list: 0, preview: 0, broken: 0, download: 0 };
    const files = ['big.wav', 'broken.wav'].map(name => ({ name, size: 64000000, url: `https://openclaw.blackcarburning.com/mygrain-wavs/retry-fixture-${name}` }));
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.addInitScript(() => { delete window.showSaveFilePicker; });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) {
                writes.push(request.url());
                return route.abort();
            }
            if (request.url().includes('/mygrain-wavs/api/list')) {
                counters.list += 1;
                if (counters.list === 1) return route.fulfill({ status: 503, headers, body: 'Temporary fixture failure' });
                await new Promise(resolve => setTimeout(resolve, 200));
                return route.fulfill({ headers, json: { ok: true, files } });
            }
            if (request.url().includes('/mygrain-wavs/retry-fixture-')) {
                const preview = request.resourceType() === 'media' || request.url().includes('mygrain-preview-retry=');
                const key = preview ? request.url().includes('broken') ? 'broken' : 'preview' : 'download';
                counters[key] += 1;
                if (key === 'broken' || counters[key] === 1) {
                    return route.fulfill({ status: 503, headers, body: 'Temporary fixture failure' });
                }
                await new Promise(resolve => setTimeout(resolve, 200));
                return route.fulfill({ headers, contentType: 'audio/wav', body: wav });
            }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await page.evaluate(() => {
            window.wavRecoveryMessages = [];
            const status = document.getElementById('wavRepositoryBrowserStatus');
            new MutationObserver(() => window.wavRecoveryMessages.push(status.textContent)).observe(status, { childList: true });
        });
        await page.click('#performanceWavBrowserBtn');
        await page.waitForFunction(() => document.querySelectorAll('#wavRepositoryBrowserList audio').length === 2);
        assert.equal(counters.list, 2);
        assert.ok(await page.evaluate(() => wavRecoveryMessages.some(message => /Load WAV list:.*Retrying/.test(message))));
        const audios = page.locator('#wavRepositoryBrowserList audio');
        await audios.nth(0).evaluate(audio => { audio.play().catch(() => {}); });
        await page.waitForFunction(() => wavRecoveryMessages.some(message => /Preview ready: big.wav \(retry succeeded\)/.test(message)));
        assert.equal(counters.preview, 2);
        assert.ok(await audios.nth(0).evaluate(audio => audio.readyState >= 3 && !audio.paused));
        await audios.nth(0).evaluate(audio => audio.pause());
        await audios.nth(1).evaluate(audio => { audio.play().catch(() => {}); });
        await page.waitForFunction(() => wavRecoveryMessages.some(message => /Preview failed for broken.wav.*Automatic retry also failed/.test(message)));
        assert.equal(counters.broken, 2);
        const download = page.waitForEvent('download');
        await page.locator('#wavRepositoryBrowserList .sample-browser-card').nth(0).getByRole('button', { name: 'Download WAV' }).click();
        const result = await download;
        assert.equal(result.suggestedFilename(), 'big.wav');
        assert.equal(counters.download, 2);
        assert.ok(await page.evaluate(() => wavRecoveryMessages.some(message => /Download big.wav:.*Retrying/.test(message))));
        await page.waitForFunction(() => /Download ready/.test(document.getElementById('wavRepositoryBrowserStatus').textContent));
        await audios.nth(0).evaluate(audio => { audio.play().catch(() => {}); });
        await page.click('#wavRepositoryBrowserCloseBtn');
        assert.ok(await audios.nth(0).evaluate(audio => audio.paused));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => openWavRepositoryBrowser());
        await page.waitForFunction(() => document.querySelectorAll('#wavRepositoryBrowserList audio').length === 2);
        await audios.nth(1).evaluate(audio => { audio.play().catch(() => {}); });
        await page.waitForFunction(() => /Preview failed for broken.wav/.test(document.getElementById('wavRepositoryBrowserStatus').textContent));
        const bounds = await page.locator('#wavRepositoryBrowserOverlay .sample-browser-shell').evaluate(shell => ({ width: shell.clientWidth, scroll: shell.scrollWidth, left: shell.getBoundingClientRect().left, right: shell.getBoundingClientRect().right, viewport: innerWidth }));
        assert.ok(bounds.scroll <= bounds.width + 1);
        assert.ok(bounds.left >= 0 && bounds.right <= bounds.viewport + 1);
        assert.ok(await page.locator('#wavRepositoryBrowserStatus').evaluate(status => status.scrollWidth <= status.clientWidth + 1));
        await page.screenshot({ path: '/tmp/mygrain-wav-retry-mobile.png' });
        await page.click('#wavRepositoryBrowserCloseBtn');
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, listRetry: true, nativePreviewRetry: true, exhaustedPreviewRetry: true, downloadRetry: true, closeStopsPlayback: true, mobile: true, counters, pageErrors: errors, productionWrites: writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
