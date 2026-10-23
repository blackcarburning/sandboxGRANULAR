// Native Chromium swipes; native taps in Chromium/WebKit. WebKit's public
// automation API offers taps only, so its swipe fallback exercises DOM touch
// cancellation plus a deliberately delivered compatibility click.
const { chromium, webkit } = require('playwright-core');
const assert = require('node:assert/strict');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async () => {
    for (const [name, engine] of Object.entries({ chromium, webkit })) {
        const browser = await engine.launch(name === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            await context.request.post(base + 'api/auth/register', { data: { username: 'scrolltaps' + name + Date.now(), password: 'isolated-loop-scroll-fixture' } });
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(base);
            async function ready() {
                await page.waitForFunction(() => window.mygrainKMultitrack && window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.evaluate(() => mygrainCardHistory.ready);
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            }
            await ready();
            await page.evaluate(() => { window.loopTestScrolls = 0; document.addEventListener('scroll', () => { window.loopTestScrolls++; }, true); });
            let nativeScrolledGestures = 0;
            const session = name === 'chromium' ? await context.newCDPSession(page) : null;
            async function swipe(locator, { cancel = false } = {}) {
                await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
                await page.waitForTimeout(250);
                await locator.evaluate(element => { element.dataset.testClicks = '0'; element.addEventListener('click', () => { element.dataset.testClicks = String(Number(element.dataset.testClicks) + 1); }, { once: true }); });
                const scrollsBefore = await page.evaluate(() => loopTestScrolls);
                const rect = await locator.boundingBox(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
                const distance = y > 250 ? -180 : 150;
                if (session) {
                    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
                    for (let i = 1; i <= 10; i++) {
                        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance * i / 10 }] });
                        await page.waitForTimeout(30);
                    }
                    await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
                } else {
                    await locator.evaluate((element, cancel) => {
                        const bounds = element.getBoundingClientRect(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
                        const dispatch = (type, dy) => {
                            const touch = { identifier: 7, target: element, clientX: x, clientY: y + dy };
                            const event = new Event(type, { bubbles: true });
                            Object.defineProperties(event, { touches: { value: /end|cancel/.test(type) ? [] : [touch] }, changedTouches: { value: [touch] } });
                            element.dispatchEvent(event);
                        };
                        dispatch('touchstart', 0); dispatch('touchmove', -45); dispatch(cancel ? 'touchcancel' : 'touchend', -45);
                        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
                    }, cancel);
                }
                await page.waitForTimeout(150);
                if (session && await page.evaluate(() => loopTestScrolls) > scrollsBefore) nativeScrolledGestures++;
                assert.equal(await locator.getAttribute('data-test-clicks'), '0', 'scroll activated ' + await locator.getAttribute('id'));
            }
            // Persist deliberately different mute/on/processing states and verify
            // that selecting from blank space cannot change any track setting.
            await page.evaluate(() => {
                for (let i = 0; i < 5; i++) {
                    mygrainKMultitrack.change(i, 'mute', i % 2 === 1);
                    mygrainKMultitrack.change(i, 'enabled', i !== 3);
                    mygrainKMultitrack.change(i, 'level', .3 + i * .1);
                }
                mygrainKMultitrack.select(0);
            });
            const trackSettings = () => page.evaluate(() => JSON.stringify(mygrainKMultitrack.captureSettings().tracks));
            const original = await trackSettings();
            const mute = page.locator('[data-k-track="4"] [data-k-mute]');
            const muted = await mute.isChecked(); await mute.locator('..').tap(); assert.equal(await mute.isChecked(), !muted);
            await mute.tap(); assert.equal(await mute.isChecked(), muted);
            await page.locator('[data-k-track="2"] [data-k-record-select]').tap();
            assert.equal(await page.evaluate(() => mygrainKMultitrack.selected), 2);
            // Every loop card: scrolling across Solo must neither activate it
            // nor poison its next ordinary tap. This guards TOUCH.1–3 regressions.
            const soloSelector = '.performance-feature-card[aria-label^="Bastardloop"] .mygrain-solo-button,#performanceDrumMachineCard .mygrain-solo-button,[aria-label="Dropbox sample layer controls"] .mygrain-solo-button';
            const ids = await page.locator(soloSelector).evaluateAll(buttons => buttons.map(button => button.id));
            assert.equal(ids.length, 14);
            for (const id of ids) {
                await page.evaluate(() => setLoopLayerSolo('none', { silent: true }));
                const button = page.locator('#' + id);
                await swipe(button);
                assert.deepEqual(await page.evaluate(() => loopLayerSolo), []);
                await button.tap(); assert.equal(await button.getAttribute('aria-pressed'), 'true', id);
                await button.tap(); assert.equal(await button.getAttribute('aria-pressed'), 'false', id);
            }
            if (session) assert.ok(nativeScrolledGestures > 0, 'native swipes must actually scroll');
            console.log('PASS', name, '14 card Solo swipe cancellations and ordinary native on/off taps');
            await swipe(mute); assert.equal(await mute.isChecked(), muted);
            await swipe(page.locator('[data-k-track="4"] .k-track-heading'), { cancel: true });
            assert.equal(await page.evaluate(() => mygrainKMultitrack.selected), 2);
            for (const layer of ['L', 'X']) {
                await page.evaluate(layer => window['openBastardLoop' + layer + 'Overlay'](), layer);
                const cursor = () => page.evaluate(layer => window.eval('bastardLoop' + layer + 'EditStepIndex'), layer);
                const next = page.locator(`#bastardLoop${layer}NextStepBtn`), before = await cursor();
                await swipe(next); assert.equal(await cursor(), before);
                await next.tap(); assert.equal(await cursor(), before + 1);
                await next.tap(); assert.equal(await cursor(), before + 2);
                await next.focus(); await page.keyboard.press('Enter'); assert.equal(await cursor(), before + 3);
                await page.keyboard.press('Space'); assert.equal(await cursor(), before + 4);
                await next.click(); assert.equal(await cursor(), before + 5);
                const step = page.locator(`#bastardLoop${layer}StepGrid button`).nth(7);
                await swipe(step); assert.equal(await cursor(), before + 5);
                await page.evaluate(layer => {
                    window['setBastardLoop' + layer + 'Step'](7, { note: 'C4', rest: false });
                    window['resetBastardLoop' + layer + 'StepTapMemory']();
                }, layer);
                await step.tap(); assert.equal(await cursor(), 7);
                await step.tap();
                assert.equal(await page.evaluate(layer => window.eval('bastardLoop' + layer + 'RatchetEditStepIndex'), layer), 7, 'native double tap must still open ratchet');
                const close = page.locator(`#bastardLoop${layer}CloseBtn`);
                await swipe(close); assert.equal(await page.locator(`#bastardLoop${layer}Overlay`).isVisible(), true);
                await close.tap(); assert.equal(await page.locator(`#bastardLoop${layer}Overlay`).isVisible(), false);
                console.log('PASS', name, layer, 'navigation, step and Close swipes; native rapid taps/double-tap, mouse and Enter/Space');
            }
            await page.evaluate(() => {
                const overlay = document.getElementById('dropboxSampleBrowserOverlay');
                overlay.hidden = false; overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('dropbox-sample-browser-open');
            });
            const sampleClose = page.locator('#dropboxSampleBrowserCloseBtn');
            await swipe(sampleClose);
            assert.equal(await page.locator('#dropboxSampleBrowserOverlay').isVisible(), true);
            await sampleClose.tap();
            assert.equal(await page.locator('#dropboxSampleBrowserOverlay').isVisible(), false);
            console.log('PASS', name, 'sample browser Close swipe/tap; native scrolling gestures', nativeScrolledGestures);
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
                await page.setViewportSize(viewport);
                for (let i = 0; i < 5; i++) for (const selector of ['[data-k-enabled]', '[data-k-mute]']) {
                    const input = page.locator(`[data-k-track="${i}"] ${selector}`);
                    await input.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
                    const point = await input.evaluate(element => {
                        const label = element.closest('label').getBoundingClientRect(), card = element.closest('section').getBoundingClientRect();
                        return { x: card.right - 18, y: label.y + label.height / 2, labelRight: label.right };
                    });
                    assert.ok(point.x > point.labelRight, JSON.stringify({ viewport, point }));
                    if (viewport.width < 960) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
                    assert.equal(await page.evaluate(() => mygrainKMultitrack.selected), i);
                    assert.equal(await trackSettings(), original);
                    assert.equal(await page.locator(`[data-k-track="${i}"] [data-k-record-select]`).isChecked(), true);
                }
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                await page.screenshot({ path: `/tmp/mygrain-scroll-${name}-${viewport.width}.png` });
                console.log('PASS', name, viewport.width, 'all K blank On/Mute rows select without changing settings');
            }
            await page.setViewportSize({ width: 390, height: 844 });
            await page.evaluate(() => mygrainKMultitrack.select(2));
            await page.evaluate(() => saveState()); await page.waitForTimeout(900);
            const settings = await trackSettings();
            await page.reload(); await ready();
            assert.equal(await trackSettings(), settings);
            assert.equal(await page.evaluate(() => mygrainKMultitrack.selected), 2);
            assert.deepEqual(errors, []);
            console.log('PASS', name, 'saved K settings/selection recall; no page errors');
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
