// Real audio + IntersectionObserver lifecycle on disposable localhost accounts only.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const mobile of [false, true]) {
            if (process.env.K_ENGINE && process.env.K_ENGINE !== engine) continue;
            if (process.env.K_MOBILE && process.env.K_MOBILE !== String(mobile)) continue;
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `kvu_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-k-vu-fixture' } })).status(), 200);
            const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            assert.equal((await context.request.get(base + 'k-track-meters.js')).status(), 200);
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainKTrackMeters && window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn')[mobile ? 'tap' : 'click']();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            assert.equal(await page.locator('[data-k-track-meter]').count(), 5);
            const setup = await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                window.__kMeterReads = 0; window.__kMeterWrites = 0;
                new MutationObserver(changes => { window.__kMeterWrites += changes.length; }).observe(document.getElementById('kMultitrackTracks'), { attributes: true, childList: true, characterData: true, subtree: true });
                const split = audioContext.createChannelSplitter.bind(audioContext);
                audioContext.createChannelSplitter = (...args) => {
                    const splitter = split(...args), connect = splitter.connect.bind(splitter);
                    splitter.connect = (node, ...rest) => {
                        const read = node.getFloatTimeDomainData.bind(node);
                        node.getFloatTimeDomainData = data => { window.__kMeterReads++; return read(data); };
                        return connect(node, ...rest);
                    };
                    return splitter;
                };
                applyGlobalBpm(120); setBastardLoopKLevelPercent(100, { skipSave: true });
                setBastardLoopKEnabled(true, { silent: true, skipSave: true });
                for (let i = 0; i < 5; i++) {
                    const b = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate), data = b.getChannelData(0);
                    for (let n = 0; n < data.length; n++) data[n] = .4 / (i + 1) * Math.sin(2 * Math.PI * 200 * n / b.sampleRate);
                    mygrainKMultitrack.setBuffer(i, b); Object.assign(mygrainKMultitrack.tracks[i], { sourceBpm: 120, steps: 16, level: 1, mute: false, pan: 0 });
                }
                mygrainKMultitrack.refreshBuffers(); setBastardLoopPlaying(true, { silent: true });
                window.__kOriginalVoices = [...mygrainKMultitrack.voices.values()];
                const voice = mygrainKMultitrack.voices.get(0), witness = audioContext.createAnalyser(); witness.fftSize = 1024;
                voice.filters.at(-1).connect(witness); window.__kWitness = witness;
                return { gain: getBastardLoopKOutputGain(), voices: mygrainKMultitrack.voices.size };
            });
            assert.equal(setup.voices, 5);
            const readings = [];
            for (let i = 0; i < 5; i++) {
                const meter = page.locator(`[data-k-track-meter="${i}"]`); await meter.scrollIntoViewIfNeeded();
                await page.waitForFunction(i => Number(document.querySelector(`[data-k-track-meter="${i}"]`).getAttribute('aria-valuenow')) > -55, i);
                await page.waitForTimeout(350);
                const db = Number(await meter.getAttribute('aria-valuenow')), expected = 20 * Math.log10(.4 / (i + 1) * setup.gain / 2);
                assert(Math.abs(db - expected) < 2, JSON.stringify({ engine, mobile, i, db, expected })); readings.push(db);
            }
            await page.locator('[data-k-track-meter="0"]').scrollIntoViewIfNeeded();
            await page.evaluate(async () => { mygrainKMultitrack.change(0, 'level', .5); });
            await page.waitForFunction(() => !mygrainCardHistory.busy); await page.waitForTimeout(600);
            const half = Number(await page.locator('[data-k-track-meter="0"]').getAttribute('aria-valuenow'));
            assert(Math.abs(half - readings[0] + 6) < 2, JSON.stringify({ half, readings }));
            await page.evaluate(() => mygrainKMultitrack.change(0, 'mute', true)); await page.waitForTimeout(1800);
            assert.equal(await page.locator('[data-k-track-meter="0"]').getAttribute('aria-valuetext'), 'Silent');
            await page.evaluate(() => { mygrainKMultitrack.change(0, 'mute', false); }); await page.waitForFunction(() => !mygrainCardHistory.busy);
            await page.evaluate(() => { mygrainKMultitrack.change(0, 'level', 1); }); await page.waitForFunction(() => !mygrainCardHistory.busy);
            await page.waitForTimeout(400);
            const energy = () => page.evaluate(() => { const d = new Float32Array(1024); __kWitness.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length); });
            const beforeEnergy = await energy(); assert(beforeEnergy > .001);
            await page.evaluate(() => scrollTo(0, 0)); await page.waitForFunction(() => mygrainKTrackMeters.activeCount === 0);
            await page.waitForTimeout(150);
            const before = await page.evaluate(() => ({ reads: __kMeterReads, writes: __kMeterWrites }));
            await page.waitForTimeout(400);
            assert.deepEqual(await page.evaluate(() => ({ reads: __kMeterReads, writes: __kMeterWrites })), before);
            assert.equal(await page.evaluate(() => mygrainKTrackMeters.running), false);
            const afterEnergy = await energy(); assert(Math.abs(afterEnergy / beforeEnergy - 1) < .05);
            assert.equal(await page.evaluate(() => __kOriginalVoices.every((voice, i) => mygrainKMultitrack.voices.get(i) === voice)), true);
            await page.locator('[data-k-track-meter="4"]').scrollIntoViewIfNeeded(); await page.waitForFunction(() => mygrainKTrackMeters.activeCount > 0);
            if (mobile && await page.evaluate(() => innerWidth < 420)) assert(await page.evaluate(() => mygrainKTrackMeters.activeCount) < 5);
            await page.evaluate(() => audioContext.suspend()); assert.equal(await page.evaluate(() => mygrainKTrackMeters.activeCount), 0);
            await page.evaluate(() => audioContext.resume()); await page.waitForFunction(() => mygrainKTrackMeters.activeCount > 0);
            await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
            assert.equal(await page.evaluate(() => mygrainKTrackMeters.activeCount), 0);
            await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForFunction(() => mygrainKTrackMeters.activeCount > 0);
            for (let i = 0; i < 8; i++) await page.evaluate(() => startBastardLoopK());
            assert.equal(await page.evaluate(() => mygrainKMultitrack.voices.size), 5);
            assert(await page.evaluate(() => mygrainKTrackMeters.activeCount) <= 5);
            await page.waitForFunction(() => Number(document.querySelector('[data-k-track-meter="4"]').getAttribute('aria-valuenow')) > -55);
            await page.waitForTimeout(350);
            await page.locator('#kMultitrackTracks').screenshot({ path: `/tmp/mygrain-k-vu-${engine}-${mobile ? 'phone' : 'desktop'}.png` });
            if (mobile) for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(viewport); await page.locator('[data-k-track-meter="4"]').scrollIntoViewIfNeeded();
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            }
            await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
            assert.equal(await page.evaluate(() => mygrainKTrackMeters.activeCount), 0); assert.equal(await page.evaluate(() => mygrainKTrackMeters.running), false);
            await page.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock')));
            assert.equal(await page.evaluate(() => mygrainKTrackMeters.activeCount), 0);
            assert.deepEqual(errors, []);
            results.push({ engine, mobile, readings, half, offscreenReadsAndWrites: 0, beforeEnergy, afterEnergy });
            console.log('PASS', engine, mobile); await context.close();
        } } finally { await browser.close(); }
    }
    fs.writeFileSync('/tmp/mygrain-k-vu-browser-results.json', JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
