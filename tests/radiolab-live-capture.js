const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.RADIOLAB_TEST_URL || 'http://127.0.0.1:18840/mygrain/';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) {
    throw new Error('Live capture checks must use isolated loopback storage.');
}
const origin = new URL(base).origin;
const evidence = process.env.RADIOLAB_EVIDENCE || '/tmp/mygrain-radiolab-live-capture.json';
const stations = (process.env.RADIOLAB_CAPTURE_STATIONS || 'vesti-fm,rfi-chinese').split(',');
const results = { base, stations: [], errors: [] };

function pcmStats(bytes) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(34), 16);
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    let peak = 0;
    let energy = 0;
    for (let offset = 44; offset + 1 < bytes.length; offset += 2) {
        const value = bytes.readInt16LE(offset) / 32768;
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
    }
    return { duration: (bytes.length - 44) / (channels * 2 * sampleRate), channels, sampleRate,
        peak, rms: Math.sqrt(energy / ((bytes.length - 44) / 2)) };
}

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let closeProbes;
    try {
        const login = await context.request.post(origin + '/mygrain/api/auth/login', {
            headers: { Origin: origin }, data: { username: 'dan', password: 'charged' }
        });
        assert.equal(login.status(), 200);
        if (process.env.RADIOLAB_IPHONE_PROBE === '1') closeProbes = await require('./radiolab-iphone-probe').installIphoneProbe(context, origin, results);
        const page = await context.newPage();
        page.on('pageerror', error => results.errors.push(error.message));
        await page.goto(base, { waitUntil: 'load' });
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended
            && window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
        for (const station of stations) {
            const item = { station, targets: [] };
            results.stations.push(item);
            await page.locator('#radiolabStation').selectOption(station);
            assert.equal(await page.locator('#radiolabRecord').isEnabled(), true, 'Record must work without a separate Listen tap.');
            await page.locator('#radiolabRecord').click();
            await page.waitForFunction(() => window.mygrainRadiolab.state.recording
                && window.mygrainRadiolab.state.recordedSeconds > 0, null, { timeout: 35000 });
            await page.waitForTimeout(4200);
            await page.locator('#radiolabStop').click();
            item.state = await page.evaluate(() => window.mygrainRadiolab.state);
            item.status = await page.locator('#radiolabStatus').textContent();
            item.take = await page.locator('#radiolabTake').textContent();
            if (await page.locator('#radiolabSave').isDisabled()) {
                item.saveBlocked = true;
                continue;
            }
            await page.locator('#radiolabName').fill(`Real stream acceptance ${station}`);
            const savedResponse = page.waitForResponse(response => response.url().includes('/api/radiolab/samples')
                && response.request().method() === 'POST');
            await page.locator('#radiolabSave').click();
            const response = await savedResponse;
            const saved = await response.json();
            assert.equal(response.status(), 201, JSON.stringify(saved));
            item.filename = saved.sample.filename;
            const fileResponse = await context.request.get(origin + '/mygrain/api/radiolab/file?'
                + new URLSearchParams({ name: item.filename }), { headers: { 'X-Mygrain-User': 'dan' } });
            assert.equal(fileResponse.status(), 200);
            const body = await fileResponse.body();
            item.pcm = pcmStats(body);
            await page.locator('#radiolabBrowser').click();
            await page.waitForFunction(() => !window.mygrainRadiolab.state.busy);
            const row = page.locator(`.radiolab-sample-row[data-filename=${JSON.stringify(item.filename)}]`);
            await row.locator('[data-action="play"]').click();
            await page.waitForFunction(() => window.mygrainRadiolab.state.previewing);
            item.previewStarted = true;
            await row.locator('[data-action="play"]').click();
            for (const target of ['grainMain', 'grainA', 'grainB', 'V']) {
                await page.locator('#radiolabLoadTarget').selectOption(target);
                await row.locator('[data-action="load"]').click();
                await page.waitForFunction(expected => document.querySelector('#radiolabBrowserStatus').textContent
                    .includes(`into ${expected === 'V' ? 'Loop V' : expected}.`), target);
                const loaded = await page.evaluate(target => {
                    const buffer = target === 'grainMain' ? grainMainSampleBuffer : target === 'grainA' ? grainASampleBuffer
                        : target === 'grainB' ? grainBSampleBuffer : bastardLoopVBuffer;
                    let peak = 0;
                    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
                        for (const value of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
                    }
                    return { target, duration: buffer.duration, peak };
                }, target);
                assert.ok(Math.abs(loaded.duration - item.pcm.duration) < 0.1);
                assert.ok(Math.abs(loaded.peak - item.pcm.peak) < 0.002);
                item.targets.push(loaded);
            }
            await page.locator('#radiolabBrowserClose').click();
        }
        assert.ok(results.stations.some(item => item.pcm?.rms > 0.0001), 'At least one real feed records audible PCM.');
        if (closeProbes) assert.ok(results.iphoneProbes.length === stations.length && results.iphoneProbes.every(probe => probe.status === 200 && probe.bytes > 0 && !probe.error));
        assert.deepEqual(results.errors, []);
    } catch (error) {
        results.failure = error.stack;
        process.exitCode = 1;
    } finally {
        closeProbes?.();
        await context.close();
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    }
})();
