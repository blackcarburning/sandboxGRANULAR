const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.fill('#songBetaName', 'Saved selection fixture');
        await page.click('#songBetaNewSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song?.name === 'Saved selection fixture');
        const saved = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const snapshot = { format: 'mygrain-song-part', version: 1, state: { modes: {}, globalBpm: 120, patternLength: 16 }, extra: { sequencerSteps: Array.from({ length: 16 }, () => ({ enabled: true, pitch: 'C4', volume: 80 })) }, assets: [] };
            const body = await createStoredZip([{ path: 'song-part.json', data: JSON.stringify(snapshot) }]);
            for (const [name, repeats] of [['Intro', 1], ['Verse', 2]]) {
                const result = await controller.request(`/${controller.song.id}/parts?name=${name}&repeats=${repeats}`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
                controller.acceptSong(result.song);
            }
            controller.render();
            return { song: controller.song, key: controller.key };
        });
        assert.equal(await page.locator('.song-beta-part').count(), 2);
        await page.fill('#songBetaName', 'Empty selection fixture');
        await page.click('#songBetaNewSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song?.name === 'Empty selection fixture');
        const emptyId = await page.evaluate(() => mygrainSongBeta.song.id);
        assert.equal(await page.locator('.song-beta-part').count(), 0);
        const layouts = [];
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.selectOption('#songBetaSongs', saved.song.id);
            await page.waitForFunction(id => !mygrainSongBeta.busy && mygrainSongBeta.song?.id === id, saved.song.id);
            assert.equal(await page.locator('#songBetaSongs').inputValue(), saved.song.id);
            assert.equal(await page.locator('.song-beta-part').count(), 2);
            assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song), saved.song);
            assert.match(await page.locator('#songBetaStatus').textContent(), /Loaded Saved selection fixture/);
            assert.equal(await page.locator('#songBetaArm').isEnabled(), true);
            assert.equal(await page.locator('#songBetaArm').evaluate(button => button.classList.contains('song-beta-armed')), false);
            assert.equal(await page.locator('#songBetaPlay').isDisabled(), true);
            assert.equal(await page.evaluate(() => localStorage.getItem('mygrain-song-selected-v1')), saved.song.id);
            assert.equal(await page.evaluate(() => mygrainSongBeta.key), saved.key);
            await page.selectOption('#songBetaSongs', emptyId);
            await page.waitForFunction(id => !mygrainSongBeta.busy && mygrainSongBeta.song?.id === id, emptyId);
            assert.equal(await page.locator('.song-beta-part').count(), 0);
            assert.equal(await page.locator('#songBetaArm').isDisabled(), true);
            assert.equal(await page.locator('#songBetaCard').evaluate(card => card.scrollWidth > card.clientWidth + 2), false);
            layouts.push(viewport.width);
        }
        await page.route(base + 'api/songs/' + saved.song.id, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture song unavailable' }) }), { times: 1 });
        await page.selectOption('#songBetaSongs', saved.song.id);
        await page.waitForFunction(() => !mygrainSongBeta.busy && document.getElementById('songBetaStatus').textContent === 'Fixture song unavailable');
        assert.equal(await page.locator('#songBetaSongs').inputValue(), emptyId);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.id), emptyId);
        assert.equal(await page.evaluate(() => localStorage.getItem('mygrain-song-selected-v1')), emptyId);
        await page.selectOption('#songBetaSongs', saved.song.id);
        await page.waitForFunction(id => !mygrainSongBeta.busy && mygrainSongBeta.song?.id === id, saved.song.id);
        await page.selectOption('#songBetaSongs', '');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song === null);
        assert.equal(await page.locator('#songBetaSongs').inputValue(), '');
        assert.equal(await page.locator('.song-beta-part').count(), 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('mygrain-song-selected-v1')), '');
        await page.selectOption('#songBetaSongs', saved.song.id);
        await page.waitForFunction(id => !mygrainSongBeta.busy && mygrainSongBeta.song?.id === id, saved.song.id);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(id => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.id === id, saved.song.id);
        assert.equal(await page.locator('#songBetaSongs').inputValue(), saved.song.id);
        assert.equal(await page.locator('.song-beta-part').count(), 2);
        assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song), saved.song);
        assert.equal(await page.evaluate(() => mygrainSongBeta.key), saved.key);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ createdEmptySong: true, restoredPreviousArrangement: true, repeatedSwitches: true, placeholderClearsSelection: true, failedLoadRetainsPreviousSong: true, reloadRetainsSelection: true, savedPartsUnchanged: true, libraryKeyUnchanged: true, cacheRequiresArming: true, layouts, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
