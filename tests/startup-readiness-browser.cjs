'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19232/mygrain/';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const results = [];
const phoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
async function login(context) {
    assert.equal((await context.request.post(base + 'api/auth/login', {
        data: { username: 'admin', password: 'isolated-startup-check' }
    })).status(), 200);
}
(async () => {
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? {
            executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
                if (process.env.STARTUP_CSS_ONLY) continue;
                const phone = viewport.width < 960;
                for (const authenticated of [false, true]) {
                    const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, ...(phone ? { userAgent: phoneUA } : {}) });
                    if (authenticated) await login(context);
                    const page = await context.newPage(), errors = [], requests = [];
                    page.on('pageerror', e => errors.push(e.message));
                    page.on('request', r => requests.push(new URL(r.url()).pathname));
                    await page.route('**/*', async route => {
                        const url = new URL(route.request().url());
                        if (url.origin !== new URL(base).origin || url.pathname.endsWith('mygrain-rainbow-brain.webp')) return route.abort();
                        if (/account-context\.js$|mygrain-accounts\.(css|js)$/.test(url.pathname)) await new Promise(resolve => setTimeout(resolve, 180));
                        return route.continue();
                    });
                    await page.addInitScript(() => {
                        window.startupPartialFrames = 0;
                        const inspect = () => {
                            const start = document.getElementById('start-btn');
                            if (document.documentElement.dataset.mygrainStartup === 'loading' && start && getComputedStyle(start).visibility === 'visible') startupPartialFrames++;
                            if (document.documentElement.dataset.mygrainStartup !== 'ready') requestAnimationFrame(inspect);
                        };
                        requestAnimationFrame(inspect);
                    });
                    await page.goto(base, { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                    assert.equal(await page.evaluate(() => startupPartialFrames), 0);
                    assert.equal(await page.locator('#mygrain-account-shell[role="alert"]').count(), 0);
                    assert.equal(requests.filter(x => x.endsWith('/account-context.js')).length, authenticated ? 1 : 0, 'context preload must not duplicate the request; guest shell embeds its public context');
                    if (authenticated) {
                        assert(await page.locator('#start-btn').isEnabled());
                        assert.equal(await page.locator('#mygrainCurrentUser').textContent(), 'admin');
                        assert.equal(requests.filter(x => /wasp-master-(phone|desktop)\.js$/.test(x)).length, 1);
                        assert(requests.some(x => x.endsWith(phone ? '/wasp-master-phone.js' : '/wasp-master-desktop.js')));
                        await page.locator('#start-btn').click();
                        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                        assert(await page.evaluate(() => !!mygrainLayerControls && typeof openLoopStoreBrowser === 'function' && typeof renderDawReadyBarsExport === 'function' && !!document.getElementById('performanceLoopStoreAddBtn')));
                        assert.equal(await page.evaluate(() => saveState({ snapshotOnly: true }).modes.bastardLoopLRepository), 'samples_leads');
                    } else {
                        await page.locator('[data-mygrain-account-action="login"]').click();
                        await page.locator('#mygrainLoginForm').waitFor({ state: 'visible' });
                        assert.equal(await page.evaluate(() => typeof audioContext), 'undefined');
                        assert.equal(requests.filter(x => /daw-(project|remote|bridge|fx)\.js$|layer-controls\.js$/.test(x)).length, 0);
                    }
                    assert.deepEqual(errors, []);
                    results.push({ engine, viewport, authenticated, delayedAccounts: true, logoAborted: true, partialFrames: 0, errors });
                    console.log('PASS', JSON.stringify(results.at(-1)));
                    await context.close();
                }
            }
            // A failed required style must offer a working reload, not reveal half the app.
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: phoneUA });
            await login(context);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', e => { errors.push(e.message); console.log('CSS-case error:', e.stack); });
            let failCss = true;
            await page.route('**/*', async route => {
                const pathname = new URL(route.request().url()).pathname;
                if (pathname.endsWith('/mygrain-accounts.css') && failCss) return route.abort();
                // Exercise late API completion after the failed document has
                // already replaced its controls with the recovery screen.
                if (pathname.includes('/api/')) await new Promise(resolve => setTimeout(resolve, 600));
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'domcontentloaded' });
            const retry = page.getByRole('button', { name: 'Reload MYGRAIN', exact: true });
            await retry.waitFor({ state: 'visible' });
            assert.match(await page.locator('#mygrain-account-shell').textContent(), /styling could not load/);
            assert.equal(await page.locator('#start-btn').count(), 0);
            await page.waitForTimeout(800);
            const failureErrors = errors.splice(0);
            failCss = false;
            await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), retry.click()]);
            await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
            // Keep failed-document and unload errors in the report separately;
            // compare these with the untouched baseline before deployment.
            const transitionErrors = errors.splice(0);
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            assert.deepEqual(errors, []);
            results.push({ engine, requiredCssFailureRetry: true, failureErrors, transitionErrors, errors });
            console.log('PASS', JSON.stringify(results.at(-1)));
            await context.close();
        } finally { await browser.close(); }
    }
    if (process.env.STARTUP_OUTPUT) fs.writeFileSync(process.env.STARTUP_OUTPUT, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
