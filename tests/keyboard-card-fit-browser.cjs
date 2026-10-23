// Disposable localhost account: responsive keyboard card, native focus and saved-state reload.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18947/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `keyfit_${engine}_${Date.now()}`, password: 'isolated-keyboard-fit' } })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
            async function start() {
                await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
            }
            await page.goto(base); await start();
            for (const [width, height] of [[320, 640], [390, 844], [430, 932], [844, 390], [390, 844]]) {
                await page.setViewportSize({ width, height });
                await page.locator('#keyboardContainer').scrollIntoViewIfNeeded();
                await page.evaluate(() => updateKeyboardGeometry());
                const layout = await page.evaluate(() => {
                    const selectors = ['.performance-keyboard-card', '.keyboard-section', '#keyboardContainer', '#keyboardRecordingLengthCard', '#keyboardRecordingLevelCard'];
                    const rects = selectors.map(s => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return { s, left: r.left, right: r.right, width: r.width, scroll: e.scrollWidth, client: e.clientWidth }; });
                    const destination = document.querySelector('.k-keyboard-destination').getBoundingClientRect();
                    const select = document.querySelector('#performanceKeyboardKTrack').getBoundingClientRect();
                    const solo = document.querySelector('#performanceKeyboardKSolo').getBoundingClientRect();
                    return { rects, keys: document.querySelectorAll('#keyboardContainer .key:not([hidden])').length,
                        separate: destination.right <= solo.left && select.right <= solo.left,
                        focusFont: ['performanceKeyboardKTrack', 'performanceKeyboardKRecordSteps'].map(id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)),
                        scale: visualViewport.scale, textAdjust: getComputedStyle(document.querySelector('.performance-keyboard-card')).webkitTextSizeAdjust };
                });
                for (const r of layout.rects) {
                    assert(r.left >= 0 && r.right <= width + 1, JSON.stringify({ engine, width, r }));
                    assert(r.scroll <= r.client + 1, JSON.stringify({ engine, width, r }));
                }
                assert(layout.separate, 'K destination cannot overlap Solo');
                assert(layout.focusFont.every(n => n >= 16));
                assert.equal(layout.keys, 25);
                assert.equal(layout.scale, 1);
                await page.locator('#performanceKeyboardKRecordSteps').fill('64');
                await page.locator('#performanceKeyboardKRecordSteps').dispatchEvent('change');
                await page.locator('#performanceKeyboardKTrack').selectOption('2');
                assert.equal(await page.locator('#performanceKeyboardKTrack').inputValue(), '2');
                // Exercise repeated real key presses without replacing audio handlers.
                await page.evaluate(() => {
                    const b = audioContext.createBuffer(1, 48000, 48000), a = b.getChannelData(0);
                    for (let i = 0; i < a.length; i++) a[i] = .1 * Math.sin(2 * Math.PI * 261.6256 * i / 48000);
                    setKeyboardSampleBuffer(b); setKeyboardSoundSource('sample', { skipSave: true }); setHoldEnabled(true);
                });
                const key = page.locator('#keyboardContainer .key[data-note="C2"]');
                await key.scrollIntoViewIfNeeded();
                for (let i = 0; i < 4; i++) {
                    const r = await key.boundingBox(); await key.tap({ position: { x: r.width / 2, y: r.height * .88 } });
                    await page.waitForFunction(expected => heldNotes.has('C2') === expected, i % 2 === 0);
                }
                await page.evaluate(() => { setHoldEnabled(false); stopKeyboardSounds({ immediate: true }); });
                results.push({ engine, width, height, ...layout });
            }
            await page.reload(); await start();
            await page.locator('#keyboardContainer').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#performanceKeyboardKRecordSteps').inputValue(), '64');
            assert.equal(await page.locator('#performanceKeyboardKTrack').inputValue(), '2');
            assert.equal(await page.evaluate(() => document.querySelector('.performance-keyboard-card').getBoundingClientRect().right <= innerWidth), true);
            await page.screenshot({ path: `/tmp/mygrain-keyfit-${engine}.png` });
            assert.deepEqual(errors, []);
            await context.close();
        } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ passed: results.length, results }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
