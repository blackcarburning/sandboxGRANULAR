const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const errors = [];
    const writes = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())) {
                writes.push(route.request().url());
                return route.abort();
            }
            return route.continue();
        });
        await page.route('**/mygrain-wavs/api/list', route => route.fulfill({ json: { ok: true, files: [{ name: 'Live verification.wav', size: 44, url: '/mygrain/mock.wav' }] } }));
        await page.goto('https://openclaw.blackcarburning.com/mygrain/', { waitUntil: 'load' });
        assert.match(await page.locator('#start-overlay .build-badge').textContent(), /v2026\.10\.14\.DrumsFavs\.2/);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainSongBeta.busy);
        await page.click('#performanceDrumMachineOpenBtn');
        assert.equal(await page.locator('[data-drum-jump]').count(), 6);
        assert.equal(await page.locator('#drumMachineCymbalsGrid .drum-machine-accent-btn').count(), 16);
        for (const id of ['drumMachineHatFilterCutoff', 'drumMachineHatFilterEnv', 'drumMachineCymbalsFilterCutoff', 'drumMachineCymbalsFilterEnv', 'drumMachineCymbalsAccentAmount']) {
            assert.equal(await page.locator(`#${id}`).count(), 1);
        }
        await page.click('#drumMachinePlayBtn');
        await page.waitForFunction(() => [...document.querySelectorAll('#drumMachineOverlay .drum-machine-step-grid')].every(grid => grid.querySelector('.drum-machine-step-btn.current')));
        assert.equal(await page.locator('#drumMachineOverlay .drum-machine-step-btn.current').count(), 6);
        await page.click('#drumMachinePlayBtn');
        await page.click('#drumMachineCloseBtn');
        await page.evaluate(() => openWavRepositoryBrowser());
        await page.waitForFunction(() => mygrainFavourites.loaded && document.querySelector('#wavRepositoryBrowserList .sample-favourite-heart'));
        assert.equal(await page.locator('#favourites-wav-filter').count(), 1);
        assert.equal(await page.locator('#wavRepositoryBrowserList .sample-favourite-heart').isDisabled(), false);
        await page.click('#wavRepositoryBrowserCloseBtn');
        await page.evaluate(() => {
            mygrainSongBeta.song = { id: 'verification-only', name: 'Read-only verification', parts: ['Intro', 'Verse', 'Outro'].map((name, index) => ({ id: String(index), name, bpm: 120, patternSteps: 16, repeats: 1, sha256: 'verification' })) };
            mygrainSongBeta.render();
        });
        assert.equal(await page.locator('.song-beta-part-play').count(), 3);
        for (const width of [390, 320, 844]) {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
            await page.locator('#songBetaCard').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#songBetaCard').evaluate(card => card.scrollWidth > card.clientWidth + 2), false);
            assert.equal(await page.getByRole('button', { name: 'Play song at Verse', exact: true }).isVisible(), true);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#songBetaCard').scrollIntoViewIfNeeded();
        await page.screenshot({ path: '/tmp/mygrain-song-part-live-mobile.png' });
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ liveBuild: 'v2026.10.14.DrumsFavs.2', playheads: 6, crashAccents: true, filters: true, favouritesAPI: true, partHeaderTransport: true, responsive: [390, 320, 844], productionWrites: writes, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
