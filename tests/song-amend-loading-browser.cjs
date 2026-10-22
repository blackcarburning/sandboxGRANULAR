// Real Amend controls and original archives; isolated localhost accounts only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18896/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({chromium, webkit})) {
        const browser = await type.launch(engine === 'chromium' ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
        try {
            for (const mobile of [false, true]) {
                const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900}, isMobile: mobile, hasTouch: mobile});
                assert.equal((await context.request.post(base + 'api/auth/register', {data: {username: `amready_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-amend-readiness'}})).status(), 200);
                const page = await context.newPage(), errors = [];
                page.on('pageerror', error => errors.push(error.message));
                let downloads = 0, delay = true;
                await page.route('**/*', async route => {
                    const url = new URL(route.request().url());
                    if (url.origin !== new URL(base).origin) return route.abort();
                    if (route.request().method() === 'GET' && /\/parts\/[a-f0-9]{32}$/.test(url.pathname)) {
                        downloads++;
                        if (delay) await new Promise(resolve => setTimeout(resolve, 1200));
                    }
                    return route.continue();
                });
                const press = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
                const start = async () => {
                    await page.waitForFunction(() => window.mygrainSongBeta && document.documentElement.dataset.mygrainStartup === 'ready');
                    await press('#start-btn');
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                };
                await page.goto(base); await start();
                await page.evaluate(async () => {
                    stopAllPerformancePlayback({silent: true});
                    const source = audioContext.createBuffer(2, audioContext.sampleRate * 8, audioContext.sampleRate);
                    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < source.length; i++) source.getChannelData(ch)[i] = .1 * Math.sin(2 * Math.PI * (ch ? 330 : 220) * i / source.sampleRate);
                    bastardLoopBuffer = source; bastardLoopVBuffer = source;
                    document.getElementById('songBetaName').value = 'Amend readiness fixture';
                    const c = mygrainSongBeta; await c.newSong();
                    await c.newPart({name: 'Target', repeats: 1}); await c.newPart({name: 'Other', repeats: 1}); c.render();
                    document.querySelector('.song-beta-toggle').click();
                });
                const time = Date.now();
                await press('.song-beta-amend >> nth=0');
                await page.waitForSelector('#songBetaAmendProgress', {timeout: 700});
                const feedbackMs = Date.now() - time;
                assert.equal(await page.locator('.song-beta-amending').count(), 0, 'Preparation must not claim ready shading');
                assert.equal(await page.evaluate(() => mygrainSongBeta.editing), null);
                assert.match(await page.locator('.song-beta-amend').first().textContent(), /Preparing/);
                await page.waitForFunction(() => !!mygrainSongBeta.editing && !mygrainSongBeta.busy);
                const coldMs = Date.now() - time;
                assert.equal(downloads, 1); assert.equal(await page.locator('.song-beta-amending').count(), 1);
                assert.equal(await page.locator('#songBetaAmendProgress').count(), 0);
                assert.equal(await page.locator('#songBetaSavePart').isEnabled(), true);
                const warm = await page.evaluate(async () => {
                    const c = mygrainSongBeta, part = c.song.parts[0];
                    c.cancelAmendment(); c.cancel(true); c.releasePart(part);
                    const start = performance.now(); await c.run(() => c.amendPart(part));
                    return {ms: performance.now() - start, editing: !!c.editing, original: bastardLoopBuffer.getChannelData(0)[1]};
                });
                assert.equal(downloads, 1, 'Released decoded originals should reuse disk archive');
                assert.equal(warm.editing, true); assert.ok(warm.ms < coldMs - 700);
                await page.evaluate(async () => {mygrainSongBeta.cancelAmendment(); await mygrainSongBeta.finishEditing();});
                // New page/controller must use the same account-isolated archive, not an in-memory map.
                await page.reload(); await start();
                const reloaded = await page.evaluate(async () => {
                    const c = mygrainSongBeta, start = performance.now();
                    await c.run(() => c.amendPart(c.song.parts[0]));
                    return {ms: performance.now() - start, editing: !!c.editing, status: document.getElementById('songBetaStatus').textContent, original: bastardLoopBuffer.getChannelData(0)[1]};
                });
                assert.equal(downloads, 1); assert.equal(reloaded.editing, true, reloaded.status); assert.equal(reloaded.original, warm.original);
                // Corrupt the optional archive: discard it and retrieve/authenticate a fresh original.
                delay = false;
                await page.evaluate(async () => {
                    const c = mygrainSongBeta, part = c.song.parts[0];
                    c.cancelAmendment(); c.cancel(true); c.releasePart(part);
                    const key = JSON.stringify([c.key, c.song.id, part.sourcePartId || part.id, part.sha256]);
                    await c.sourceStore.put(key, new Uint8Array([0, 1, 2]).buffer);
                    await c.run(() => c.amendPart(part));
                });
                assert.equal(downloads, 2); assert.equal(await page.evaluate(() => !!mygrainSongBeta.editing), true);
                // Actual IndexedDB budget: separate tiny cache, atomic pruning, overwrite and delete.
                const bounded = await page.evaluate(async () => {
                    const store = new MygrainSongStorage.SourceStore(undefined, 10);
                    for (const key of ['tiny-a', 'tiny-b', 'tiny-c']) await store.delete(key);
                    await store.put('tiny-a', new ArrayBuffer(6)); await store.put('tiny-b', new ArrayBuffer(6));
                    const a = await store.get('tiny-a'), b = await store.get('tiny-b');
                    await store.put('tiny-b', new ArrayBuffer(4)); await store.put('tiny-c', new ArrayBuffer(6));
                    const keep = [await store.get('tiny-b'), await store.get('tiny-c')].map(value => value?.byteLength);
                    await store.delete('tiny-b'); await store.delete('tiny-c');
                    return {a: !!a, b: b?.byteLength, keep};
                });
                assert.deepEqual(bounded, {a: false, b: 6, keep: [4, 6]});
                assert.deepEqual(errors, []);
                results.push({engine, mobile, feedbackMs, coldMs, warmMs: warm.ms, reloadMs: reloaded.ms, downloads, bounded});
                fs.writeFileSync('/tmp/mygrain-amend-loading-results.json', JSON.stringify(results, null, 2));
                console.log('PASS', results.at(-1)); await context.close();
            }
        } finally {await browser.close();}
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
