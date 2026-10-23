// Keyboard-only native widget regression. Disposable localhost accounts and actual media playback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18933/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
function wav() {
    const frames = 48000 * 3, out = Buffer.alloc(44 + frames * 2);
    out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
    out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
    out.writeUInt32LE(48000, 24); out.writeUInt32LE(96000, 28);
    out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++) out.writeInt16LE(Math.round(3000 * Math.sin(i * 2 * Math.PI * 220 / 48000)), 44 + i * 2);
    return out;
}
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.MYGRAIN_TEST_ENGINE && process.env.MYGRAIN_TEST_ENGINE !== engine) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
        try {
            for (const mobile of [false, true]) {
                if (process.env.MYGRAIN_WIDGET_CASES && !process.env.MYGRAIN_WIDGET_CASES.split(',').includes(`${engine}-${mobile ? 'phone' : 'desktop'}`)) continue;
                const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
                const username = `keywidget_${engine[0]}_${+mobile}_${Date.now()}`;
                assert.equal((await context.request.post(base + 'api/auth/register', { data: { username, password: 'isolated-keyboard-widget' } })).status(), 200);
                const page = await context.newPage(), errors = [], mediaRequests = [];
                let badAudio = false;
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', async route => {
                    const url = new URL(route.request().url());
                    if (url.pathname.endsWith('/api/source-files')) {
                        const sourceKey = url.searchParams.get('source');
                        const files = ['first.wav', 'second.wav'].map(name => ({ name, relativePath: name, sourceKey, previewUrl: `/mygrain-bastardloops/api/source-sample?source=${sourceKey}&path=${name}` }));
                        if (sourceKey === 'samples_altbass') files.splice(0, 2, { name: 'fixture.aif', relativePath: 'fixture.aif', sourceKey, previewUrl: '/mygrain-bastardloops/api/source-sample?source=samples_altbass&path=fixture.aif' });
                        return route.fulfill({ json: { ok: true, sourceKey, files } });
                    }
                    if (url.pathname.endsWith('/api/source-sample')) {
                        const headers = route.request().headers();
                        assert.equal(url.searchParams.get('mygrainUser') || headers['x-mygrain-user'], username);
                        mediaRequests.push({ path: url.searchParams.get('path'), native: !headers['x-mygrain-user'] });
                        if (badAudio) return route.fulfill({ status: 503, body: 'Unavailable' });
                        if (url.searchParams.get('path').endsWith('.aif')) return route.fulfill({ contentType: 'audio/aiff', body: fs.readFileSync(path.join(__dirname, '../SAMPLES_ALTBASS/Pulse Bass/Pulse Bass-40-64.aif')), headers: { 'X-Mygrain-Source-Region': JSON.stringify({ start: .1, end: .6 }) } });
                        return route.fulfill({ contentType: 'audio/wav', body: wav() });
                    }
                    return url.origin === new URL(base).origin ? route.continue() : route.abort();
                });
                await page.goto(base);
                await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                if (mobile) await page.locator('#start-btn').tap(); else await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
                async function open(target = 'keyboardSample') {
                    await page.evaluate(target => openDropboxSampleBrowser(target), target);
                    await page.waitForFunction(() => !dropboxSampleBrowserLoading && document.querySelector('#dropboxSampleBrowserList audio'));
                }
                async function pressPlayer(index = 0) {
                    const audio = page.locator('#dropboxSampleBrowserList audio').nth(index);
                    await audio.scrollIntoViewIfNeeded();
                    const box = await audio.boundingBox();
                    // WPE adds a 15-second-back button before Play once media
                    // metadata arrives; the initially unloaded control has none.
                    const loaded = await audio.evaluate(a => Number.isFinite(a.duration));
                    const position = { x: engine === 'webkit' ? (loaded && box.width > 500 ? 56 : 22) : 24, y: box.height / 2 };
                    if (mobile) await audio.tap({ position }); else await audio.click({ position });
                    if (process.env.MYGRAIN_WIDGET_DEBUG) {
                        console.log(engine, mobile, index, await audio.evaluate(a => ({ paused: a.paused, time: a.currentTime, duration: a.duration, error: a.error?.code })));
                        await page.screenshot({ path: `/tmp/keyboard-widget-debug-${engine}-${+mobile}.png` });
                    }
                }
                for (const target of ['keyboardSample']) {
                    await open(target);
                    assert.equal(await page.locator('#dropboxSampleBrowserList [data-mygrain-preview]').count(), 0);
                    assert.equal(await page.locator('#dropboxSampleBrowserList audio:visible').count(), 2);
                    assert.equal((await page.locator('#dropboxSampleBrowserList .primary').first().textContent()).toLowerCase(), 'load into keyboard');
                    assert.equal(await page.locator('#dropboxSampleBrowserList audio').evaluateAll(nodes => nodes.every(audio => audio.paused && audio.currentTime === 0 && audio.src.includes('mygrainUser='))), true);
                }
                assert.equal(mediaRequests.length, 0, 'WAV listings must not download every sample eagerly');
                const before = await page.evaluate(() => ({ name: keyboardSampleMetadata?.fileName, undo: mygrainCardHistory.counts.undo }));
                await page.evaluate(() => {
                    const audio = document.querySelector('#dropboxSampleBrowserList audio');
                    window.widgetMeter = audioContext.createAnalyser();
                    window.widgetSource = audioContext.createMediaElementSource(audio);
                    widgetSource.connect(widgetMeter); widgetMeter.connect(audioContext.destination);
                });
                await pressPlayer();
                await page.waitForFunction(() => { const a = document.querySelector('#dropboxSampleBrowserList audio'); return !a.paused && a.currentTime > .05; });
                await page.waitForFunction(() => { const pcm = new Float32Array(widgetMeter.fftSize); widgetMeter.getFloatTimeDomainData(pcm); return pcm.some(value => Math.abs(value) > .001); });
                assert.deepEqual(await page.evaluate(() => ({ name: keyboardSampleMetadata?.fileName, undo: mygrainCardHistory.counts.undo })), before, 'Preview must not load or edit the instrument');
                await pressPlayer();
                await page.waitForFunction(() => document.querySelector('#dropboxSampleBrowserList audio').paused);
                await pressPlayer();
                await page.waitForFunction(() => !document.querySelector('#dropboxSampleBrowserList audio').paused);
                await pressPlayer(1);
                await page.waitForFunction(() => { const a = document.querySelectorAll('#dropboxSampleBrowserList audio'); return a[0].paused && !a[1].paused; });
                await page.waitForFunction(() => document.querySelectorAll('#dropboxSampleBrowserList audio')[1].ended);
                await pressPlayer(1);
                await page.waitForFunction(() => { const a = document.querySelectorAll('#dropboxSampleBrowserList audio')[1]; return !a.paused && a.currentTime > .05; });
                await page.screenshot({ path: `/tmp/keyboard-widget-${engine}-${mobile ? 'phone' : 'desktop'}.png` });
                await page.evaluate(() => { window.widgetRetired = [...document.querySelectorAll('#dropboxSampleBrowserList audio')]; closeDropboxSampleBrowser(); });
                assert.equal(await page.evaluate(() => widgetRetired.every(a => a.paused && !a.getAttribute('src'))), true);
                // Error remains recoverable through Refresh; no duplicate button returns.
                badAudio = true; await open(); await pressPlayer();
                await page.waitForFunction(() => document.getElementById('dropboxSampleBrowserStatus').textContent.includes('Could not play'));
                badAudio = false; await page.locator('#dropboxSampleBrowserRefreshBtn').click();
                await page.waitForFunction(() => !dropboxSampleBrowserLoading && !document.querySelector('#dropboxSampleBrowserList audio').error);
                await pressPlayer();
                await page.waitForFunction(() => !document.querySelector('#dropboxSampleBrowserList audio').paused && document.querySelector('#dropboxSampleBrowserList audio').currentTime > .05);
                await page.evaluate(() => window.widgetRetired = [...document.querySelectorAll('#dropboxSampleBrowserList audio')]);
                const load = page.locator('#dropboxSampleBrowserList .primary').first();
                if (mobile) await load.tap(); else await load.click();
                await page.waitForFunction(() => document.getElementById('dropboxSampleBrowserOverlay').hidden && keyboardSampleMetadata?.fileName === 'first.wav');
                assert.equal(await page.evaluate(() => widgetRetired.every(a => a.paused && !a.getAttribute('src'))), true);
                // The keyboard's AIFF folder also has only the widget, with sampler region retained.
                await open('keyboardSample');
                await page.locator('#dropboxSampleBrowserSourceSelect').selectOption('samples_altbass');
                await page.waitForFunction(() => !dropboxSampleBrowserLoading && document.querySelector('#dropboxSampleBrowserList audio')?.src.startsWith('blob:'));
                assert.equal(await page.locator('#dropboxSampleBrowserList [data-mygrain-preview]').count(), 0);
                await pressPlayer();
                await page.waitForFunction(() => document.querySelector('#dropboxSampleBrowserList audio').currentTime > .02);
                assert.ok(Math.abs(await page.locator('#dropboxSampleBrowserList audio').evaluate(a => a.duration) - .5) < .01);
                await page.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock')));
                assert.equal(await page.locator('#dropboxSampleBrowserList audio').evaluate(a => a.paused && !a.getAttribute('src')), true);
                // Other browsers still retain their explicit preview flow.
                await open('grainMain');
                assert.equal(await page.locator('#dropboxSampleBrowserList [data-mygrain-preview]').count(), 2);
                assert.deepEqual(errors, []);
                assert.ok(mediaRequests.some(request => request.native));
                results.push({ engine, mobile, keyboardBrowser: true, nativeNonSilentAudio: true, lazyWavDownloads: true, nativePlayPauseReplay: true, singlePlayback: true, errorRefresh: true, loadSample: true, closeAndLockCleanup: true, aiffRegion: true, otherBrowsersUnchanged: true });
                console.log(`${engine} ${mobile ? 'phone' : 'desktop'} passed`);
                await context.close();
            }
        } finally { await browser.close(); }
    }
    console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
