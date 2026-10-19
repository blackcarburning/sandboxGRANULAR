const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:8765/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
            const context = await browser.newContext({ viewport, isMobile: viewport.width < 1000, hasTouch: true, reducedMotion: 'reduce' });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#performanceMixerSliderJumps button').length === 25);
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const snapshot = () => page.evaluate(() => ({
                sliders: Array.from(document.querySelectorAll('#performanceMixerCard input[type="range"]'), control => [control.id, control.value]),
                solos: Array.from(document.querySelectorAll('#performanceMixerCard .performance-mixer-solo-btn'), button => [button.id, button.getAttribute('aria-pressed')])
            }));
            const initial = await snapshot();
            assert.equal(initial.sliders.length, 25);
            assert.equal(initial.solos.length, 19);
            assert.equal(await page.locator('#performanceMixerCard .performance-sound-card .performance-mixer-jump-btn').count(), 25);
            assert.equal(await page.locator('#performanceMixerCard .performance-mixer-stack > :first-child').getAttribute('id'), 'performanceMixerJumpCard');
            const jumpToMixer = async () => {
                if (viewport.width < 961) await page.locator('#sectionJumpBastardMixerBtn').tap();
                else await page.evaluate(() => document.getElementById('performanceMixerCard').scrollIntoView({ block: 'start', behavior: 'auto' }));
                const bounds = await page.locator('#performanceMixerJumpCard').boundingBox();
                assert.ok(bounds.y >= 0 && bounds.y < viewport.height, `Jump card not first on arrival: ${JSON.stringify(bounds)}`);
            };
            const targets = await page.locator('#performanceMixerSliderJumps button').evaluateAll(buttons => buttons.map(button => ({ buttonId: button.id, controlId: button.getAttribute('aria-controls') })));
            for (const { buttonId, controlId } of targets) {
                await jumpToMixer();
                const button = page.locator(`#${buttonId}`);
                assert.match(await button.getAttribute('aria-label'), /^Jump to .+ slider$/);
                await button.click();
                const slider = page.locator(`#${controlId}`);
                const bounds = await slider.boundingBox();
                assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, `${controlId} offscreen: ${JSON.stringify(bounds)}`);
                assert.equal(await slider.evaluate(control => document.activeElement === control), true);
                assert.equal(await slider.evaluate(control => getComputedStyle(control.closest('.performance-sound-card')).outlineWidth), '2px');
                assert.equal(await page.locator('#synthPopupOverlay').isVisible(), false);
                assert.equal(await page.evaluate(() => ['bastardLoopLOverlay', 'bastardLoopXOverlay', 'bastardLoopQOverlay', 'drumMachineOverlay'].some(id => !document.getElementById(id).hidden)), false);
            }
            assert.deepEqual(await snapshot(), initial);
            await jumpToMixer();
            await page.locator('#performanceBastardLoopQLevelMixerJumpBtn').focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'performanceBastardLoopQLevelMixer');
            const qLevel = Number(await page.locator('#performanceBastardLoopQLevelMixer').inputValue());
            await page.keyboard.press('ArrowRight');
            assert.equal(await page.evaluate(() => mygrainQ.state.level), (qLevel + 1) / 100);
            await page.keyboard.press('ArrowLeft');
            assert.deepEqual(await snapshot(), initial);
            await page.evaluate(() => { syncPerformanceMixerVuVisibility(); syncPerformanceMixerVuVisibility(); });
            assert.equal(await page.locator('#performanceMixerSliderJumps button').count(), 25);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
            await jumpToMixer();
            if (process.env.MYGRAIN_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.MYGRAIN_SCREENSHOT_DIR, `mixer-shortcuts-${viewport.width}x${viewport.height}.png`) });
            results.push({ viewport, sliderShortcutsChecked: targets.length, mixerEntryShowsJumpCard: true, unchangedSliders: initial.sliders.length, unchangedSolos: initial.solos.length, keyboardAdjustmentChecked: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
