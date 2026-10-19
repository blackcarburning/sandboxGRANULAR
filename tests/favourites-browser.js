const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost server.');

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const errors = [];
    const productionWrites = [];
    const headers = { 'Access-Control-Allow-Origin': '*' };
    const install = async page => {
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/mygrain/api/patches/list', route => route.fulfill({ json: { ok: true, files: ['one.zip', 'two.zip'].map(name => ({ name, size: 1024 })) } }));
        await page.route('https://openclaw.blackcarburning.com/**', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) { productionWrites.push(request.url()); return route.abort(); }
            if (request.url().includes('/api/source-files')) {
                const source = new URL(request.url()).searchParams.get('source');
                return route.fulfill({ headers, json: { ok: true, sourceLabel: source, files: ['one.wav', 'two.wav'].map(name => ({ name, relativePath: `folder/${name}`, previewUrl: `${base}fixture.wav` })) } });
            }
            if (request.url().includes('/api/list')) {
                const extension = request.url().includes('/mygrain-midi/') ? 'mid' : request.url().includes('patch') || request.url().includes('stems') ? 'zip' : 'wav';
                return route.fulfill({ headers, json: { ok: true, files: ['one', 'two'].map(name => ({ name: `${name}.${extension}`, size: 1024, url: `${base}fixture.${extension}` })) } });
            }
            return route.continue();
        });
    };
    const start = async page => {
        await install(page);
        await page.goto(base, { waitUntil: 'load' });
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
    };
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await start(page);
        await page.evaluate(() => openDropboxSampleBrowser('drumMachineHat'));
        await page.waitForFunction(() => !dropboxSampleBrowserLoading && mygrainFavourites.loaded);
        const cards = page.locator('#dropboxSampleBrowserList .sample-browser-card');
        assert.equal(await cards.count(), 2);
        await cards.nth(0).locator('.sample-favourite-heart').click();
        await page.waitForFunction(() => document.querySelector('#dropboxSampleBrowserList .sample-favourite-heart.active'));
        await page.selectOption('#favourites-samples-filter', '*');
        assert.equal(await cards.count(), 1);
        page.once('dialog', dialog => dialog.accept('Gentle closed hat'));
        await cards.nth(0).getByRole('button', { name: 'Rename favourite', exact: false }).click();
        await page.waitForFunction(() => document.querySelector('#dropboxSampleBrowserList .sample-favourite-label')?.textContent === 'Gentle closed hat');
        await page.selectOption('#favourites-samples-filter', '');
        await page.fill('#dropboxSampleBrowserFilter', 'gentle');
        assert.equal(await cards.count(), 1);
        await page.fill('#dropboxSampleBrowserFilter', '');
        await page.locator('#dropboxSampleBrowserOverlay summary').click();
        page.once('dialog', dialog => dialog.accept(`Studio rides ${Date.now()}`));
        await page.locator('#dropboxSampleBrowserOverlay').getByRole('button', { name: '+ Collection', exact: true }).click();
        await page.waitForFunction(() => mygrainFavourites.state('samples').collection !== 'default');
        const groupId = await page.inputValue('#favourites-samples-collection');
        page.once('dialog', dialog => dialog.accept('Session favourites'));
        await page.locator('#dropboxSampleBrowserOverlay').getByRole('button', { name: 'Rename collection', exact: true }).click();
        await page.waitForFunction(id => mygrainFavourites.groups.some(group => group.id === id && group.name === 'Session favourites'), groupId);
        await cards.nth(1).locator('.sample-favourite-heart').click();
        await page.waitForFunction(id => Object.keys(mygrainFavourites.groups.find(group => group.id === id).items).length === 1, groupId);
        await page.selectOption('#favourites-samples-filter', groupId);
        assert.equal(await cards.count(), 1);
        assert.equal(await cards.nth(0).locator('.sample-browser-name').textContent(), 'two.wav');
        await cards.nth(0).locator('.sample-favourite-heart').click();
        await page.waitForFunction(() => document.querySelectorAll('#dropboxSampleBrowserList .sample-browser-card').length === 0);
        await page.selectOption('#favourites-samples-filter', '*');
        assert.equal(await cards.count(), 1);
        await page.evaluate(() => openDropboxSampleBrowser('drumMachineKick'));
        await page.waitForFunction(() => !dropboxSampleBrowserLoading);
        assert.equal(await cards.count(), 0);
        await page.evaluate(() => openDropboxSampleBrowser('drumMachineHat'));
        await page.waitForFunction(() => !dropboxSampleBrowserLoading);
        assert.equal(await cards.count(), 1);
        await page.selectOption('#favourites-samples-filter', 'default');
        await cards.nth(0).locator('.sample-favourite-heart').click();
        await page.waitForFunction(() => document.querySelectorAll('#dropboxSampleBrowserList .sample-browser-card').length === 0);
        await page.selectOption('#favourites-samples-filter', '');
        const targets = await page.evaluate(() => Object.values(SAMPLE_BROWSER_TARGETS));
        for (const target of targets) {
            await page.evaluate(value => openDropboxSampleBrowser(value), target);
            await page.waitForFunction(() => !dropboxSampleBrowserLoading);
            assert.equal(await page.locator('#dropboxSampleBrowserList .sample-favourite-heart').count(), 2, target);
            assert.equal(await page.locator('#favourites-samples-filter').count(), 1, target);
        }
        await page.click('#dropboxSampleBrowserCloseBtn');
        for (const [kind, open, list, close] of [
            ['wav', 'openWavRepositoryBrowser', 'wavRepositoryBrowserList', 'wavRepositoryBrowserCloseBtn'],
            ['midi', 'openMidiRepositoryBrowser', 'midiRepositoryBrowserList', 'midiRepositoryBrowserCloseBtn'],
            ['stems', 'openStemRepositoryBrowser', 'stemRepositoryBrowserList', 'stemRepositoryBrowserCloseBtn'],
            ['patches', 'openPatchRepositoryBrowser', 'patchRepositoryBrowserList', 'patchRepositoryBrowserCloseBtn']
        ]) {
            await page.evaluate(name => window[name](), open);
            await page.waitForFunction(id => document.querySelectorAll(`#${id} .sample-browser-card`).length === 2, list);
            const entries = page.locator(`#${list} .sample-browser-card`);
            if (kind === 'wav') await entries.nth(0).locator('audio').evaluate(audio => { audio.dataset.favouriteProbe = 'retained'; });
            await entries.nth(0).locator('.sample-favourite-heart').click();
            await page.waitForFunction(id => document.querySelector(`#${id} .sample-favourite-heart.active`), list);
            if (kind === 'wav') assert.equal(await entries.nth(0).locator('audio').getAttribute('data-favourite-probe'), 'retained');
            await page.selectOption(`#favourites-${kind}-filter`, '*');
            assert.equal(await entries.count(), 1);
            await page.click(`#${close}`);
        }
        const groups = await page.evaluate(() => JSON.stringify(mygrainFavourites.groups));
        await page.evaluate(() => { const preset = gatherPreset(); applyPreset(preset); });
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainFavourites.groups)), groups);
        await page.evaluate(() => {
            const buffer = audioContext.createBuffer(1, 4800, 48000);
            const blob = new Blob([audioBufferToWav24bit(buffer)], { type: 'audio/wav' });
            for (let index = 0; index < 2; index += 1) performanceTakeSlots[index] = { blob, filename: `fixture-${index}.wav`, bpm: 120, bars: 1, capturedAt: new Date(1790000000000 + index), draftName: `Fixture ${index}` };
            openPerformanceTakeBrowser();
        });
        const takes = page.locator('#performanceTakeBrowserList .sample-browser-card');
        assert.equal(await takes.count(), 2);
        await takes.nth(0).locator('.sample-favourite-heart').click();
        await page.waitForFunction(() => document.querySelector('#performanceTakeBrowserList .sample-favourite-heart.active'));
        await page.selectOption('#favourites-takes-filter', '*');
        assert.equal(await takes.count(), 1);
        await takes.nth(0).locator('.sample-favourite-heart').click();
        await page.waitForFunction(() => !document.querySelector('#performanceTakeBrowserList .sample-browser-card'));
        await page.selectOption('#favourites-takes-filter', '');
        assert.equal(await takes.count(), 2);
        await page.evaluate(() => closePerformanceTakeBrowser());
        await page.evaluate(() => openWavRepositoryBrowser());
        await page.waitForFunction(() => document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length === 1);
        for (const width of [390, 320, 844]) {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
            const bounds = await page.locator('#wavRepositoryBrowserOverlay .sample-browser-shell').evaluate(shell => {
                const list = shell.querySelector('.sample-browser-list');
                return { width: shell.clientWidth, scroll: shell.scrollWidth, listHeight: list.clientHeight };
            });
            assert.ok(bounds.scroll <= bounds.width + 1, JSON.stringify({ width, bounds }));
            assert.ok(bounds.listHeight > 30, JSON.stringify({ width, bounds }));
            if (width === 390) await page.screenshot({ path: '/tmp/mygrain-favourites-mobile.png' });
        }
        await page.click('#wavRepositoryBrowserCloseBtn');
        const context = await browser.newContext();
        const second = await context.newPage();
        await start(second);
        await second.evaluate(() => openWavRepositoryBrowser());
        await second.waitForFunction(() => mygrainFavourites.loaded && document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length === 2);
        await second.selectOption('#favourites-wav-filter', '*');
        assert.equal(await second.locator('#wavRepositoryBrowserList .sample-browser-card').count(), 1);
        await context.close();
        assert.deepEqual(errors, []);
        assert.deepEqual(productionWrites, []);
        console.log(JSON.stringify({ sampleTargets: targets.length, collections: true, renameLabels: true, renameCollections: true, remove: true, sourceIsolation: true, repositories: ['wav', 'midi', 'stems', 'patches'], audioElementPreservedOnHeart: true, patchIsolation: true, separateBrowserPersistence: true, responsive: [390, 320, 844], productionWrites, pageErrors: errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
