// Failure/retry and long-list UI acceptance. Disposable localhost data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const base = process.env.SONG_BETA_TEST_URL;
assert.match(base || '', /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `pastefail_${Date.now()}`, password: 'isolated-picker-test' } })).status(), 200);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
        await page.goto(base);
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && document.documentElement.dataset.mygrainStartup === 'ready');
        assert.equal(await page.locator('#songBetaPasteParts').isDisabled(), true);
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        const initial = await page.evaluate(async () => {
            const c = mygrainSongBeta;
            stopAllPerformancePlayback({ silent: true });
            applyGlobalBpm(300); syncPatternLengthControls(8, { skipSave: true });
            document.getElementById('songBetaName').value = 'Picker failure'; await c.newSong();
            for (const name of ['Source', 'Destination 1', 'Destination 2', 'Destination 3']) await c.newPart({ name, repeats: 1 });
            c.copyLoop(c.song.parts[0], ['V', 'drumKick']); c.render();
            window.pickerArmCalls = 0; c.arm = async () => { pickerArmCalls++; throw new Error('Unexpected Arm'); };
            return c.song;
        });
        const picker = page.locator('.song-beta-paste-dialog');
        const filter = url => url.pathname.endsWith('/paste-loop');
        let attempts = 0;
        const failSecond = route => { attempts++; return attempts === 2 ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture connection failure' }) }) : route.continue(); };
        await page.route(filter, failSecond);
        await page.locator('#songBetaPasteParts').tap();
        for (const part of initial.parts.slice(1)) await picker.locator(`input[data-part-id="${part.id}"]`).check();
        await picker.locator('.song-beta-paste-selected').tap();
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(attempts, 2);
        assert.match(await page.locator('#songBetaStatus').textContent(), /Saved 1\/3.*Destination 2.*Fixture connection failure.*Refresh Songs/);
        const failed = await page.evaluate(() => mygrainSongBeta.song);
        assert.equal(failed.revision, initial.revision + 1);
        assert.deepEqual(failed.parts.map(part => part.revision || 1), [1, 2, 1, 1]);
        assert.equal(await page.evaluate(() => pickerArmCalls), 0);
        await page.unroute(filter, failSecond);
        await page.evaluate(async () => { await mygrainSongBeta.refresh(); mygrainSongBeta.render(); });
        assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song), failed);
        // Retry only the unfinished destinations, preserving the first save.
        await page.locator('#songBetaPasteParts').tap();
        for (const part of initial.parts.slice(2)) await picker.locator(`input[data-part-id="${part.id}"]`).check();
        await picker.locator('.song-beta-paste-selected').tap(); await page.waitForFunction(() => !mygrainSongBeta.busy);
        const saved = await page.evaluate(() => mygrainSongBeta.song);
        assert.deepEqual(saved.parts.map(part => part.revision || 1), [1, 2, 2, 2]);
        assert.equal(saved.revision, initial.revision + 3);
        // Recording is rejected visibly before mounting the picker.
        await page.evaluate(() => { isRecording = true; });
        await page.locator('#songBetaPasteParts').tap();
        assert.equal(await picker.count(), 0);
        assert.match(await page.locator('#songBetaStatus').textContent(), /Finish recording/);
        await page.evaluate(() => { isRecording = false; });
        // Layout-only 64-position fixture: never submit fabricated destinations.
        await page.evaluate(() => { const c = mygrainSongBeta; window.pickerRealSong = c.song; c.song = { ...c.song, parts: Array.from({ length: 64 }, (_, i) => ({ ...c.song.parts[0], id: `layout-${i}`, name: `Part ${i + 1} ` + 'long-name '.repeat(8) })) }; c.render(); });
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport); await page.locator('#songBetaPasteParts').tap();
            assert.equal(await picker.locator('input[data-part-id]').count(), 64);
            await picker.locator('input[data-select-all]').check();
            assert.equal(await picker.locator('.song-beta-paste-selected').textContent(), 'Paste selected (64)');
            assert.equal(await picker.evaluate(element => { const b = element.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1 && b.top >= 0 && b.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1; }), true);
            await picker.getByRole('button', { name: 'Cancel', exact: true }).tap(); await picker.waitFor({ state: 'detached' });
        }
        await page.evaluate(() => { mygrainSongBeta.song = pickerRealSong; mygrainSongBeta.render(); });
        assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song), saved);
        await page.reload(); await page.waitForFunction(() => window.mygrainSongBeta?.song && !mygrainSongBeta.busy);
        assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song), saved);
        assert.deepEqual(errors, []);
        const result = { partialFailureStopsRemainingTargets: true, acknowledgedSavesPreserved: true, unfinishedTargetsRetry: true, noAutoArm: true, recordingBlocked: true, sixtyFourRowMobileLayout: true, reloadPersists: true };
        fs.writeFileSync('/tmp/mygrain-paste-picker-failure-results.json', JSON.stringify(result, null, 2)); console.log('PASS', JSON.stringify(result));
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
