const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const build = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/Build <strong>(v[^<]+)<\/strong>/)[1];

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const blocked of [false, true]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
            if (blocked) await context.addInitScript(() => {
                for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
            });
            const page = await context.newPage();
            page.setDefaultTimeout(45000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
                return new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainQ && window.mygrainSongBeta && !mygrainSongBeta.busy && document.querySelectorAll('#bastardLoopQScale option').length === 86);
            assert.ok((await page.locator('.build-badge').first().textContent()).includes(build));
            assert.equal(await page.evaluate(async () => (await mygrainSongBeta.request('')).features.qPianoRenders), 6);
            await page.click('#start-btn');
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.click('#performanceBastardLoopQEditBtn');
            await page.evaluate(() => { document.getElementById('bastardLoopQEditTools').open = true; });
            await page.click('[data-q-step="3"]');
            await page.click('[data-q-action="accent"]');
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[3]), { kind: 'accent', notes: [], accent: true });
            await page.evaluate(() => { document.getElementById('bastardLoopQPlaybackSettings').open = true; });
            await page.click('#bastardLoopQArpBuilderBtn');
            await page.waitForFunction(() => !mygrainQ.arpBuilder.busy);
            assert.doesNotMatch(await page.locator('#qArpStatus').textContent(), /unavailable|invalid|error/i);
            await page.fill('#qArpLength', '4');
            await page.locator('#qArpLength').press('Tab');
            await page.locator('[data-arp-column="1"][data-arp-rank="0"]').click();
            await page.click('#qArpApply');
            assert.equal(await page.evaluate(() => mygrainQ.state.arpSteps[1]), 0);
            assert.equal(await page.evaluate(() => mygrainQ.state.arpPattern), 'custom');
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(viewport);
                await page.locator('#qArpApply').scrollIntoViewIfNeeded();
                const bounds = await page.locator('#qArpOverlay').boundingBox();
                assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.width <= viewport.width + 1 && bounds.height <= viewport.height + 1);
            }
            await page.locator('#qArpClose').scrollIntoViewIfNeeded();
            await page.click('#qArpClose');
            assert.equal(await page.locator('#qArpOverlay').getAttribute('aria-hidden'), 'true');
            assert.equal(await page.locator('#bastardLoopQOverlay').getAttribute('aria-hidden'), 'false');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'bastardLoopQArpBuilderBtn');
            await page.click('#bastardLoopQCloseBtn');
            await page.click('#performanceBastardLoopQArpBuilderBtn');
            assert.equal(await page.locator('#qArpOverlay').getAttribute('aria-hidden'), 'false');
            await page.locator('#qArpClose').scrollIntoViewIfNeeded();
            await page.click('#qArpClose');
            results.push({ blockedStorage: blocked, blankAccent: true, builderFromCardAndEditor: true, serverLibraryRead: true, gapApply: true, portraitLandscape: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ build, publicReadOnly: true, results, errors, writes, physicalSafari: 'not tested' }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
