const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        const errors = [];
        const writes = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
        await page.route('**/*', route => route.request().url().startsWith(new URL(base).origin + '/') ? route.continue() : route.abort());
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.locator('#songBetaDeviceName').fill('Usability phone');
        await page.locator('#songBetaName').fill('Direct editing fixture');
        await page.locator('#songBetaNewSong').click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
        await page.evaluate(() => { applyGlobalBpm(300); syncPatternLengthControls(8, { skipSave: true }); });
        const idle = () => page.waitForFunction(() => !mygrainSongBeta.busy, null, { timeout: 120000 });
        const release = async () => {
            await page.locator('#songBetaFinishEditing').click();
            await idle();
            assert.equal(await page.evaluate(() => Boolean(mygrainSongBeta.lease.token)), false);
        };
        await release();
        assert.equal(await page.locator('#songBetaNewPart').isEnabled(), true);
        await page.locator('#songBetaPartName').fill('Verse');
        await page.locator('#songBetaNewPart').click();
        await idle();
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts.length), 1);
        await page.locator('.song-beta-toggle').click();
        await release();
        for (const selector of ['.song-beta-amend', '.song-beta-reuse', '.song-beta-delete', '.song-beta-edit[aria-label="Rename Verse"]', '#songBetaRenameSong', '.song-beta-part-colour input', '.song-beta-part-repeats input']) {
            assert.equal(await page.locator(selector).first().isEnabled(), true, selector);
        }
        const unchanged = await page.evaluate(() => mygrainSongBeta.song.revision);
        await page.locator('.song-beta-amend').click();
        await idle();
        assert.equal(await page.evaluate(() => Boolean(mygrainSongBeta.editing)), true);
        assert.equal(await page.locator('#songBetaEditStatus, #songBetaClearCopy, .song-beta-save-amendment, .song-beta-cancel-amendment').count(), 0);
        assert.equal(await page.locator('.song-beta-copy').isDisabled(), true);
        assert.equal(await page.locator('#songBetaSavePart').isEnabled(), true);
        assert.equal(await page.locator('#songBetaCancelEdit').isEnabled(), true);
        if (process.env.SONG_BETA_EVIDENCE_DIR) await page.locator('#songBetaCard').screenshot({ path: path.join(process.env.SONG_BETA_EVIDENCE_DIR, 'amending-phone.png') });
        await page.locator('#songBetaCancelEdit').click();
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.revision), unchanged);
        assert.equal(await page.locator('.song-beta-amend').isEnabled(), true);
        await release();
        await page.locator('.song-beta-amend').click();
        await idle();
        await page.evaluate(() => applyGlobalBpm(240));
        await page.locator('#songBetaSavePart').click();
        await idle();
        assert.equal(await page.evaluate(() => mygrainSongBeta.editing), null);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[0].bpm), 240);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.revision), unchanged + 1);
        await release();
        await page.locator('.song-beta-copy').click();
        assert.equal(await page.locator('.song-beta-copy-layers button').count(), 11);
        await page.locator('.song-beta-copy-layers [data-layer="A"]').click();
        await idle();
        assert.equal(await page.locator('.song-beta-paste').textContent(), 'Paste Part');
        assert.match(await page.locator('#songBetaClipboard').textContent(), /Bastardloop A from Verse.*destination/);
        assert.equal(await page.locator('.song-beta-amend').isEnabled(), true);
        assert.equal(await page.evaluate(() => Boolean(mygrainSongBeta.lease.token)), false);
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 640 }]) {
            await page.setViewportSize(viewport);
            const layout = await page.locator('#songBetaCard').evaluate(card => ({ width: card.clientWidth, scroll: card.scrollWidth }));
            assert.ok(layout.scroll <= layout.width + 1, JSON.stringify({ viewport, layout }));
            await page.locator('.song-beta-copy').click();
            const dialog = await page.locator('.song-beta-copy-dialog').boundingBox();
            assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= viewport.width + 1 && dialog.y + dialog.height <= viewport.height + 1);
            await page.locator('.song-beta-copy-dialog button').last().click();
        }
        await page.setViewportSize({ width: 390, height: 844 });
        if (process.env.SONG_BETA_EVIDENCE_DIR) await page.locator('#songBetaCard').screenshot({ path: path.join(process.env.SONG_BETA_EVIDENCE_DIR, 'copy-phone.png') });
        assert.equal(await page.evaluate(() => mygrainSongBeta.loopClipboard.layer), 'A');
        assert.equal(await page.locator('.song-beta-paste').isEnabled(), true);
        assert.deepEqual(await page.locator('.song-beta-part-controls button').allTextContents(), ['Audition', 'Play Song From Here', 'Loop Part', 'Clear Colour', 'Recall', 'Reuse Part', 'Amend', 'Delete', 'Copy From Part', 'Paste Part', 'Rename']);
        assert.equal(await page.locator('.song-beta-amend').isEnabled(), true);
        const beforeCancel = writes.length;
        page.once('dialog', dialog => dialog.dismiss());
        await page.locator('#songBetaRenameSong').click();
        await idle();
        assert.equal(writes.length, beforeCancel);
        page.once('dialog', dialog => dialog.accept('Renamed directly'));
        await page.locator('#songBetaRenameSong').click();
        await idle();
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.name), 'Renamed directly');
        await release();
        await page.locator('.song-beta-part-repeats input').fill('3');
        await page.locator('.song-beta-part-repeats input').press('Tab');
        await idle();
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[0].repeats), 3);
        await release();
        await page.locator('.song-beta-part-colour input').fill('#123456');
        await idle();
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[0].colour), '#123456');
        await release();
        await page.locator('.song-beta-reuse').click();
        await idle();
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts.length), 2);
        await release();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.song-beta-delete').first().click();
        await idle();
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts.length), 1);
        await release();
        const savedPart = await page.evaluate(() => mygrainSongBeta.song.parts[0].id);
        await page.evaluate(id => { mygrainSongBeta.expandedParts.add(`${mygrainSongBeta.song.id}:${id}`); mygrainSongBeta.render(); }, savedPart);
        const otherLock = await page.evaluate(async () => {
            const owner = { deviceId: 'f'.repeat(32), sessionId: 'e'.repeat(32), label: 'Other phone' };
            const result = await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/lock/acquire`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': `"${mygrainSongBeta.song.revision}"` }, body: JSON.stringify(owner) });
            return { ...owner, token: result.token };
        });
        await page.locator('.song-beta-amend').click();
        await idle();
        assert.match(await page.locator('#songBetaStatus').textContent(), /Other phone/);
        assert.equal(await page.evaluate(() => mygrainSongBeta.editing), null);
        await page.evaluate(async owner => {
            await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/lock/release`, { method: 'POST', headers: { 'X-Mygrain-Song-Device': owner.deviceId, 'X-Mygrain-Song-Session': owner.sessionId, 'X-Mygrain-Song-Lock': owner.token } });
        }, otherLock);
        await page.locator('.song-beta-amend').click();
        await idle();
        assert.equal(await page.evaluate(() => Boolean(mygrainSongBeta.editing)), true);
        await page.locator('#songBetaCancelEdit').click();
        assert.deepEqual(errors, []);
        await release();
        console.log(JSON.stringify({ directAmendAndSave: true, directNewPartRenameColourRepeatsReuseDelete: true, originalCancelPreservesSavedRevision: true,
            originalControlsAndOrder: true, noExtraWorkflowControls: true, copyDoesNotDisableEditing: true, otherDeviceProtectedAndRetry: true, layouts: ['390x844', '844x390', '320x640'], errors }, null, 2));
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
