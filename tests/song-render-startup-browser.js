const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

// Every account, source, part and render written here belongs to the isolated
// test server. Never point this acceptance test at a production origin.
const base = process.env.SONG_BETA_TEST_URL;
assert.match(base || '', /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.SONG_RENDER_EVIDENCE || '/tmp/mygrain-song-render-startup';
fs.mkdirSync(evidence, { recursive: true });
const results = [];
(async () => {
    for (const [engine, type] of Object.entries({ webkit, chromium })) {
        if (process.env.SONG_RENDER_ENGINES && !process.env.SONG_RENDER_ENGINES.split(',').includes(engine)) continue;
        const browser = await type.launch(engine === 'chromium'
            ? { executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] }
            : { headless: true });
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                if (process.env.SONG_RENDER_WIDTHS && !process.env.SONG_RENDER_WIDTHS.split(',').includes(String(viewport.width))) continue;
                const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
                    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1' });
                const page = await context.newPage();
                page.setDefaultTimeout(60000);
                const errors = [], warnings = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('console', message => { if (['error', 'warning'].includes(message.type()) && !message.text().includes('net::ERR_FAILED')) warnings.push(message.text()); });
                await page.route('**/*', route => {
                    const request = route.request(), url = new URL(request.url());
                    if (url.origin !== new URL(base).origin) return route.abort();
                    if (process.env.SONG_RENDER_HTML && url.pathname === '/mygrain/') {
                        return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(process.env.SONG_RENDER_HTML, 'utf8') });
                    }
                    return route.continue();
                });
                try {
                    const registration = await context.request.post(new URL('api/auth/register', base).href, {
                        data: { username: 'render' + Date.now(), password: 'isolated-test-fixture' }
                    });
                    assert.equal(registration.status(), 200);
                    await page.goto(base, { waitUntil: 'load' });
                    await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
                    await page.locator('#start-btn').click();
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                    const result = await page.evaluate(async () => {
                        const controller = mygrainSongBeta;
                        applyGlobalBpm(300);
                        syncPatternLengthControls(8, { skipSave: true });
                        setGranularLayersEnabled(false, { silent: true, skipSave: true });
                        seqGrainsEnabled = false;
                        document.getElementById('seqGrainsEnabled').checked = false;
                        document.getElementById('songBetaName').value = 'Renderer startup regression';
                        await controller.newSong();
                        controller.armConcurrency = 10;
                        let renders = 0;
                        let activeRenders = 0;
                        let peakRenders = 0;
                        const contextListeners = new Set();
                        const nativeAdd = audioContext.addEventListener.bind(audioContext);
                        const nativeRemove = audioContext.removeEventListener.bind(audioContext);
                        audioContext.addEventListener = (type, listener, options) => {
                            contextListeners.add(listener);
                            return nativeAdd(type, listener, options);
                        };
                        audioContext.removeEventListener = (type, listener, options) => {
                            contextListeners.delete(listener);
                            return nativeRemove(type, listener, options);
                        };
                        const originalRender = mygrainSongBetaAdapter.renderPart;
                        mygrainSongBetaAdapter.renderPart = async (...args) => {
                            renders += 1;
                            peakRenders = Math.max(peakRenders, ++activeRenders);
                            try { return await originalRender(...args); }
                            finally { activeRenders -= 1; }
                        };
                        const addPart = async index => {
                            const source = audioContext.createBuffer(1, audioContext.sampleRate / 2, audioContext.sampleRate);
                            const channel = source.getChannelData(0);
                            for (let frame = 0; frame < channel.length; frame += 1) channel[frame] = .15 * Math.sin(2 * Math.PI * (220 + index * 30) * frame / source.sampleRate);
                            bastardLoopBuffer = source;
                            bastardLoopSourceBpm = 300;
                            bastardLoopEnabled = true;
                            saveState();
                            document.getElementById('songBetaPartName').value = 'Part ' + index;
                            document.getElementById('songBetaRepeats').value = '1';
                            await controller.newPart();
                        };
                        for (let index = 1; index <= 4; index += 1) await addPart(index);
                        await controller.arm();
                        const initial = { armed: controller.armed, renders };
                        await addPart(5);
                        await controller.reusePart(controller.song.parts[0]);
                        await controller.reusePart(controller.song.parts[1]);
                        const pending = { ready: controller.uniqueParts().filter(part => controller.isPartReady(part)).length, unique: controller.uniqueParts().length, placements: controller.song.parts.length };
                        await controller.arm();
                        const prepared = { armed: controller.armed, renders };
                        const audio = [...controller.renders.values()].map(buffer => {
                            const channel = buffer.getChannelData(0);
                            let power = 0;
                            for (const sample of channel) power += sample * sample;
                            return { duration: buffer.duration, rms: Math.sqrt(power / channel.length) };
                        });
                        await controller.arm();
                        const warm = { armed: controller.armed, renders };
                        await controller.playSong();
                        const playing = controller.playing;
                        controller.cancel(true, { hardCut: true });
                        return { initial, pending, prepared, warm, audio, playing, stopped: !controller.playing,
                            peakRenders, contextListeners: contextListeners.size,
                            preparationBytes: controller.memoryBudget.bytes, downloadBytes: controller.downloadBudget.bytes,
                            bridges: __mygrainSongRenderBridges.size, frames: document.querySelectorAll('iframe[title="Isolated song audio renderer"]').length };
                    });
                    assert.deepEqual(result.initial, { armed: true, renders: 4 });
                    assert.deepEqual(result.pending, { ready: 4, unique: 5, placements: 7 });
                    assert.deepEqual(result.prepared, { armed: true, renders: 5 });
                    assert.deepEqual(result.warm, { armed: true, renders: 5 });
                    assert.equal(result.audio.length, 5);
                    assert.ok(result.audio.every(audio => Math.abs(audio.duration - .4) < .001 && audio.rms > .001), JSON.stringify(result.audio));
                    assert.equal(result.playing, true);
                    assert.equal(result.stopped, true);
                    assert.equal(result.bridges, 0);
                    assert.equal(result.frames, 0);
                    assert.equal(result.peakRenders, 1, 'iPhone must not start multiple renderer graphs');
                    assert.equal(result.contextListeners, 0, 'removed frames must release their shared-context listeners');
                    assert.equal(result.preparationBytes, 0);
                    assert.equal(result.downloadBytes, 0);
                    assert.deepEqual(errors, []);
                    const significantWarnings = warnings.filter(message => !message.startsWith('Failed to load resource:'));
                    assert.deepEqual(significantWarnings, []);
                    results.push({ engine, viewport, ...result, errors });
                    console.log('PASS', engine, viewport.width, viewport.height, '5 real renders, 4 ready/1 pending/7 placements, warm reuse, play/stop, cleanup');
                } catch (error) {
                    await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}-failure.png`) }).catch(() => {});
                    console.error(JSON.stringify({ engine, viewport, errors, warnings }, null, 2));
                    throw error;
                } finally { await context.close(); }
            }
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
});
