const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        const writes = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
            return route.continue();
        });
        await page.goto('https://openclaw.blackcarburning.com/mygrain/', { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainVocalTakes && mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await page.click('#performanceBastardLoopMTakesBtn');
        await page.waitForFunction(() => !mygrainVocalTakes.busy && mygrainVocalTakes.dialog.open);
        assert.match(await page.locator('#vocalTakesDialog [data-status]').textContent(), /shared workspace/);
        await page.click('#vocalTakesDialog [data-action="close"]');
        await page.evaluate(async () => {
            const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
            buffer.getChannelData(0).fill(.2);
            await applyRecordedBastardLoopMBuffer(buffer, { bpm: 120 });
        });
        await page.click('#performanceBastardLoopMSaveVersionBtn');
        await page.waitForFunction(() => !mygrainVocalTakes.busy);
        assert.match(await page.locator('#vocalTakesDialog [data-field="name"]').inputValue(), /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_none$/);
        await page.selectOption('#vocalTakesDialog [data-field="user"]', '__new__');
        assert.equal(await page.locator('#vocalTakesDialog [data-group="new-user"]').isVisible(), true);
        for (const width of [1440, 390, 320, 844]) {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 1000 });
            const bounds = await page.locator('#vocalTakesDialog').evaluate(dialog => ({ width: dialog.clientWidth, scroll: dialog.scrollWidth, left: dialog.getBoundingClientRect().left, outer: dialog.getBoundingClientRect().width, viewport: innerWidth }));
            assert.ok(bounds.scroll <= bounds.width + 1);
            assert.ok(Math.abs(bounds.left - (bounds.viewport - bounds.outer) / 2) < 2);
            if (width === 320) await page.screenshot({ path: '/tmp/mygrain-vocal-workspace-live-mobile.png' });
        }
        await page.click('#vocalTakesDialog [data-action="cancel-save"]');
        await page.click('#vocalTakesDialog [data-action="close"]');
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ liveLibraryGet: true, saveDialog: true, newUserChoice: true, centeredResponsiveDialog: true, pageErrors: errors, productionWrites: writes }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
