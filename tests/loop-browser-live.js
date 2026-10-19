const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.LOOP_BROWSER_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain-bastardloops/';

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
            const context = await browser.newContext({ viewport });
            const page = await context.newPage();
            const wavRequests = [];
            const listResponses = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('response', response => {
                if (new URL(response.url()).pathname.endsWith('/api/list')) listResponses.push(response);
            });
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) {
                    writes.push(request.method() + ' ' + request.url());
                    return route.abort();
                }
                if (new URL(request.url()).pathname.endsWith('.wav')) wavRequests.push(request.url());
                return route.continue();
            });
            await page.goto(`${base}?build=LoopBrowser.1`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelectorAll('#grid .card').length === 50);
            assert.ok((await page.locator('.footer').textContent()).includes('v2026.10.14.LoopBrowser.1'));
            assert.equal(await page.locator('audio').count(), 0);
            assert.equal(wavRequests.length, 0);
            const firstListBytes = (await listResponses[0].body()).length;
            assert.ok(firstListBytes < 20000, firstListBytes);
            const originalName = await page.locator('#grid .name').first().textContent();
            await page.click('#next');
            await page.waitForFunction(() => document.getElementById('pageLabel').textContent.startsWith('Page 2 '));
            assert.notEqual(await page.locator('#grid .name').first().textContent(), originalName);
            assert.equal(wavRequests.length, 0);
            await page.fill('#filter', originalName);
            await page.waitForFunction(name => document.querySelectorAll('#grid .card').length === 1 && document.querySelector('#grid .name').textContent === name, originalName);
            assert.equal(wavRequests.length, 0);
            await page.locator('#grid button').click();
            await page.waitForFunction(() => document.querySelector('#preview audio')?.readyState >= 1);
            assert.equal(await page.locator('audio').count(), 1);
            assert.ok(wavRequests.length > 0);
            assert.equal(new Set(wavRequests).size, 1);
            const bounds = await page.evaluate(() => {
                const button = document.querySelector('#preview button');
                const rect = button.getBoundingClientRect();
                return { scrollWidth: document.documentElement.scrollWidth, width: innerWidth, buttonHit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
            });
            assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
            assert.equal(bounds.buttonHit, true);
            if (viewport.width === 390) await page.screenshot({ path: '/tmp/mygrain-lightweight-loop-browser-live-mobile.png' });
            await page.getByRole('button', { name: 'Close preview' }).click();
            assert.equal(await page.locator('audio').count(), 0);
            results.push({ viewport, firstListBytes, initialAudioRequests: 0, explicitPreviewFiles: new Set(wavRequests).size });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, results, errors, productionWrites: writes }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
