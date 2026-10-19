const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
    const base = 'https://openclaw.blackcarburning.com/mygrain/';
    for (const name of ['index.html', 'manual.html', 'song-beta-adapter.js', 'vocal-takes.js']) {
        const response = await fetch(`${base}${name}?verify=mplus-pan-4`, { cache: 'no-store' });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), name);
    }
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
            return route.continue();
        });
        await page.goto(base + '?verify=mplus-pan-4', { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainVocalTakes && window.mygrainSongBeta && !mygrainSongBeta.busy);
        assert.equal(await page.locator('.build-badge').first().textContent(), 'Build v2026.10.14.MPlus.4');
        assert.equal(await page.locator('[aria-label="Bastardloop M+ controls"]').count(), 1);
        assert.equal(await page.locator('#performanceBastardLoopMPlusSaveVersionBtn').isDisabled(), true);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        const playback = await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true });
            const buffer = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .2), audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            for (let frame = 0; frame < data.length; frame += 1) data[frame] = .2 * Math.sin(2 * Math.PI * 330 * frame / buffer.sampleRate);
            await applyRecordedBastardLoopMPlusBuffer(buffer, { bpm: 120 });
            setBastardLoopMPlusEnabled(true, { silent: true });
            const started = startAllBastardLoopLayers(audioContext.currentTime + .1, { skipUi: true });
            const result = { started, backing: Boolean(bastardLoopMPlusSource), leadEmpty: !bastardLoopMRawBuffer && !bastardLoopMSource };
            stopAllBastardLoopLayers({ skipUi: true, fade: false });
            return result;
        });
        assert.deepEqual(playback, { started: true, backing: true, leadEmpty: true });
        const setPan = async value => page.locator('#performanceBastardLoopMPlusPan').evaluate((slider, next) => {
            slider.value = String(next);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await setPan(-40);
        assert.equal(await page.locator('#performanceBastardLoopMPlusPanValue').textContent(), '40% Left');
        assert.equal(await page.evaluate(() => bastardLoopMPlusPan), -.4);
        await page.waitForFunction(() => Math.abs(bastardLoopMPlusPanNode.pan.value + .4) < .001);
        for (const width of [1440, 390, 320, 844]) {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 1000 });
            await page.evaluate(() => document.getElementById('performanceBastardLoopMPlusSaveVersionBtn').click());
            await page.waitForFunction(() => !mygrainVocalTakes.busy && mygrainVocalTakes.targetLane === 'M+');
            assert.match(await page.locator('#vocalTakesDialog [data-target]').textContent(), /M\+.*backing/);
            assert.match(await page.locator('#vocalTakesDialog [data-field="name"]').inputValue(), /_none$/);
            const fits = await page.locator('#vocalTakesDialog').evaluate(dialog => {
                const bounds = dialog.getBoundingClientRect();
                return bounds.left >= 0 && bounds.right <= innerWidth + 1 && dialog.scrollWidth <= dialog.clientWidth + 1;
            });
            assert.equal(fits, true, `${width}px`);
            await page.click('#vocalTakesDialog [data-action="close"]');
            if (width === 390 || width === 320) {
                await page.locator('#sectionJumpHandle').tap();
                await page.locator('#sectionJumpPanel').getByRole('button', { name: 'Loop M+', exact: true }).tap();
                await page.waitForFunction(() => {
                    const drawer = document.getElementById('sectionJumpDrawer');
                    const target = document.querySelector('[aria-label="Bastardloop M+ controls"]').getBoundingClientRect();
                    return !drawer.classList.contains('is-open') && !drawer.classList.contains('is-settling') && target.top >= -1 && target.top < 100 && drawer.getBoundingClientRect().left >= innerWidth - 36;
                });
                if (width === 390) await page.screenshot({ path: '/tmp/mygrain-mplus-live-phone.png' });
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            await page.locator('#performanceBastardLoopMPlusPan').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#performanceBastardLoopMPlusPan').isVisible(), true);
            await setPan(60);
            await page.waitForTimeout(100);
            assert.equal(await page.locator('#performanceBastardLoopMPlusPanValue').textContent(), '60% Right');
            await page.locator('#performanceBastardLoopMPlusPanCentreBtn').click();
            assert.equal(await page.locator('#performanceBastardLoopMPlusPan').inputValue(), '0');
            assert.equal(await page.locator('#performanceBastardLoopMPlusPanValue').textContent(), 'Centre');
            if (width === 390) await page.screenshot({ path: '/tmp/mygrain-mplus-pan-live-phone.png' });
        }
        await page.goto(base + 'manual.html?verify=mplus-pan-4', { waitUntil: 'load' });
        for (const id of ['song-mode', 'v-loop', 'm-loop', 'vocal-workflows', 'pan-lab']) assert.equal(await page.locator(`#${id}`).count(), 1);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#song-mode').scrollIntoViewIfNeeded();
        await page.screenshot({ path: '/tmp/mygrain-mplus-manual-phone.png' });
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log('PASS: Public HTML/manual/adapter/library match local files; M+-only playback, left/right/centre pan, target-aware Save Version, Jump and 1440/390/320/844px layouts. Zero production mutations.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
