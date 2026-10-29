'use strict';
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const schema = require('../ai-patch-controls.json');
assert.equal(schema.controls.performanceBastardLoopFilterCutoff.readOnly, true);
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18965/mygrain/';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);

(async () => {
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? {
            executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
                try {
                    const login = await context.request.post(base + 'api/auth/login', {
                        data: { username: 'admin', password: process.env.MYGRAIN_TEST_ADMIN_PASSWORD || 'isolated-speedups-test' }
                    });
                    assert.equal(login.status(), 200);
                    const page = await context.newPage(), errors = [], requests = [];
                    page.on('pageerror', error => errors.push(error.message));
                    let mode = 'success', release;
                    await page.route('**/*', async route => {
                        const url = new URL(route.request().url());
                        if (url.origin !== new URL(base).origin) return route.abort();
                        if (!url.pathname.endsWith('/api/ai-patch-direction')) return route.continue();
                        requests.push(route.request().postDataJSON());
                        const responseMode = mode;
                        if (responseMode === 'hold') await new Promise(resolve => { release = resolve; });
                        const recipe = { title: 'G bootstrap regression', description: 'Fixture, not a model result.',
                            parameters: responseMode === 'readOnly' ? { performanceBastardLoopFilterCutoff: 4000 } : { globalBpmSlider: 123 }, loops: {} };
                        try { await route.fulfill({ status: responseMode === 'error' ? 503 : 200,
                            json: responseMode === 'error' ? { ok: false, error: 'Test AI unavailable.' } : { ok: true, model: 'openai/gpt-6.1-sol', recipe } }); } catch {}
                    });
                    await page.goto(base);
                    await page.waitForFunction(() => window.mygrainGenreator?.genres.length === 15 && document.documentElement.dataset.mygrainStartup === 'ready');
                    // Fail clearly on a contract mismatch rather than timing out on a disabled button.
                    await page.waitForFunction(() => window.mygrainAiPatch?.ready || document.getElementById('aiPatchStatus').textContent.includes('could not load'));
                    assert.equal(await page.evaluate(() => mygrainAiPatch.ready), true, `AI must accept shipped control contract v${schema.version}`);
                    await page.evaluate(() => mygrainCardHistory.ready);
                    await page.locator('#start-btn').click();
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                    await page.locator('#sectionJumpHandle').click();
                    await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').click();
                    await page.locator('#genreatorCard').scrollIntoViewIfNeeded();
                    assert.equal(await page.locator('#genreatorCard [data-genre]:enabled').count(), 15);
                    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                    const before = await page.locator('#globalBpmSlider').inputValue();
                    await page.locator('#genreatorBpm').fill('123');
                    const button = page.locator('[data-genre="house"]');
                    await button.tap();
                    await page.waitForFunction(() => document.getElementById('genreatorStatus').textContent.includes('patch applied'));
                    assert.equal(requests.at(-1).genre, 'house');
                    assert.equal(requests.at(-1).genreBpm, 123);
                    assert.equal(await page.locator('#globalBpmSlider').inputValue(), '123');
                    await page.locator('#genreatorUndo').tap();
                    await page.waitForFunction(() => !mygrainCardHistory.busy);
                    assert.equal(await page.locator('#globalBpmSlider').inputValue(), before);
                    for (mode of ['error', 'readOnly']) {
                        const fingerprint = await page.evaluate(() => mygrainAiPatchAdapter.fingerprint());
                        await button.tap();
                        await page.waitForFunction(() => !mygrainGenreator.busy && !mygrainAiPatch.busy);
                        assert.match(await page.locator('#genreatorStatus').innerText(), mode === 'error' ? /unavailable/ : /Unsupported or out-of-range/);
                        assert.equal(await page.evaluate(() => mygrainAiPatchAdapter.fingerprint()), fingerprint);
                        assert.equal(await page.locator('#genreatorCard [data-genre]:enabled').count(), 15);
                    }
                    mode = 'hold';
                    await button.tap();
                    await page.waitForFunction(() => mygrainAiPatch.busy);
                    assert.equal(await page.locator('#genreatorCard [data-genre]:disabled').count(), 15);
                    await page.locator('#genreatorCancel').tap();
                    release();
                    await page.waitForFunction(() => !mygrainGenreator.busy && !mygrainAiPatch.busy);
                    assert.match(await page.locator('#genreatorStatus').innerText(), /Cancelled/);
                    assert.equal(await page.locator('#genreatorCard [data-genre]:enabled').count(), 15);
                    assert.deepEqual(errors, []);
                    console.log(JSON.stringify({ engine, viewport, schemaVersion: schema.version, requests: requests.length, ok: true }));
                } finally { await context.close(); }
            }
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
