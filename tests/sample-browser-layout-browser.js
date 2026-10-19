const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SAMPLE_BROWSER_TEST_URL || 'http://127.0.0.1:8765/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const errors = [];
    const writes = [];
    const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }];
    try {
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            const request = route.request();
            const url = new URL(request.url());
            if (!['GET', 'HEAD'].includes(request.method())) {
                writes.push(request.url());
                return route.abort();
            }
            if (url.pathname.endsWith('/api/source-files')) {
                return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
                    ok: true,
                    sourceLabel: url.searchParams.get('source'),
                    files: ['needle.wav', 'other.wav'].map(name => ({ name, relativePath: name }))
                } });
            }
            if (url.pathname === '/mygrain/api/favourites') {
                return route.fulfill({ json: { ok: true, revision: 1, groups: [{ id: 'default', name: 'Favourites', items: {} }] } });
            }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            for (const target of ['drumMachinePerc', 'drumMachineKick', 'drumMachineSnare', 'drumMachineHat', 'drumMachineClap', 'drumMachineCymbals', 'grainMain', 'drumMachineHat']) {
                await page.evaluate(value => openDropboxSampleBrowser(value), target);
                await page.waitForFunction(() => !dropboxSampleBrowserLoading && mygrainFavourites.loaded);
                const folderExpected = target === 'drumMachinePerc' || target === 'grainMain';
                assert.equal(await page.locator('#dropboxSampleBrowserSourceGroup').isVisible(), folderExpected, `${target}: folder chooser at ${viewport.width}px`);
                const cards = page.locator('#dropboxSampleBrowserList .sample-browser-card');
                assert.equal(await cards.count(), 2);
                const search = page.locator('#dropboxSampleBrowserFilter');
                await search.fill('needle');
                assert.equal(await cards.count(), 1);
                const geometry = await search.evaluate(element => {
                    const style = getComputedStyle(element);
                    return {
                        height: element.clientHeight,
                        padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
                        fontSize: parseFloat(style.fontSize),
                        lineHeight: style.lineHeight,
                        selection: style.webkitUserSelect || style.userSelect,
                        focused: document.activeElement === element
                    };
                });
                assert.equal(geometry.padding, 0);
                assert.equal(geometry.lineHeight, 'normal');
                assert.equal(geometry.selection, 'text');
                assert.ok(geometry.height > geometry.fontSize);
                assert.equal(geometry.focused, true);
                if (target === 'drumMachinePerc') {
                    const select = page.locator('#dropboxSampleBrowserSourceSelect');
                    const nextSource = await select.locator('option').evaluateAll(options => options.find(option => option.value === 'samples_hat')?.value || options.at(-1).value);
                    await select.selectOption(nextSource);
                    await page.waitForFunction(() => !dropboxSampleBrowserLoading);
                    assert.equal(await page.evaluate(() => getSampleBrowserTargetConfig().sourceKey), nextSource);
                    assert.equal(await cards.count(), 1);
                }
                if (viewport.width === 390 && target === 'drumMachineHat') {
                    await page.screenshot({ path: '/tmp/mygrain-sample-layout-mobile.png', caret: 'initial' });
                }
                await page.evaluate(() => closeDropboxSampleBrowser());
            }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ viewports, fixedDrumFoldersHidden: true, percussionAndGrainFoldersRetained: true, searchAndFocus: true, writes, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
