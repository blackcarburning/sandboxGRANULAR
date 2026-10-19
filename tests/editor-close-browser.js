const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:8765/mygrain/';
const legacyDirectory = process.env.MYGRAIN_LEGACY_DIR;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const [viewport, pointerFallback] of [[{ width: 390, height: 844 }, false], [{ width: 844, height: 390 }, false], [{ width: 390, height: 844 }, true]]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            if (pointerFallback) await context.addInitScript(() => { window.PointerEvent = undefined; });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                const url = new URL(request.url());
                if (url.origin !== new URL(base).origin) return route.abort();
                if (legacyDirectory && url.pathname === new URL(base).pathname) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(legacyDirectory, 'index.html')) });
                if (legacyDirectory && url.pathname.endsWith('/q-card.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(legacyDirectory, 'q-card.js')) });
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate / 10, audioContext.sampleRate);
                const samples = buffer.getChannelData(0);
                for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = .02 * Math.sin(frame * Math.PI * 2 * 120 / buffer.sampleRate);
                drumMachineKickBuffer = buffer;
                setDrumMachinePattern('kick', Array.from({ length: 16 }, (unused, index) => index % 4 === 0), { skipSave: true });
                if (!startDrumMachine(audioContext.currentTime + .1, { silent: true, skipSave: true })) throw new Error('Drum transport failed to start');
                window.editorCloseTransport = { origin: drumMachineTransportStartTime, modulation: modulationIntervalId };
            });
            const client = await context.newCDPSession(page);
            const checked = [];
            for (const layer of ['L', 'X', 'Q', 'drums', 'synth']) {
                const overlayId = layer === 'drums' ? 'drumMachineOverlay' : layer === 'synth' ? 'synthPopupOverlay' : `bastardLoop${layer}Overlay`;
                const closeId = layer === 'drums' ? 'drumMachineCloseBtn' : layer === 'synth' ? 'oscPopupCloseBtn' : `bastardLoop${layer}CloseBtn`;
                const open = async () => {
                    await page.evaluate(layer => {
                        if (layer === 'L') openBastardLoopLOverlay();
                        if (layer === 'X') openBastardLoopXOverlay();
                        if (layer === 'Q') mygrainQ.open();
                        if (layer === 'drums') openDrumMachineOverlay();
                        if (layer === 'synth') openSynthPopup();
                    }, layer);
                    await page.locator(`#${overlayId}`).waitFor({ state: 'visible' });
                };
                await open();
                await page.locator(`#${closeId}`).tap();
                await page.locator(`#${overlayId}`).waitFor({ state: 'hidden' });
                const delayedClick = await page.evaluate(() => {
                    const handle = document.getElementById('sectionJumpHandle');
                    handle.focus();
                    const accepted = handle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
                    return { accepted, open: document.getElementById('sectionJumpDrawer').classList.contains('is-open'), focus: document.activeElement.id };
                });
                assert.equal(delayedClick.open, false, `${layer}: delayed compatibility click reopened Jump`);
                assert.equal(delayedClick.accepted, false, `${layer}: delayed click not consumed`);
                assert.notEqual(delayedClick.focus, 'sectionJumpHandle');
                await page.locator('#sectionJumpHandle').tap();
                assert.equal(await page.locator('#sectionJumpHandle').getAttribute('aria-expanded'), 'false');
                await page.waitForFunction(() => !document.getElementById('sectionJumpDrawer').classList.contains('is-close-guarded'));
                await page.locator('#sectionJumpHandle').tap();
                assert.equal(await page.evaluate(() => {
                    const drawer = document.getElementById('sectionJumpDrawer');
                    return drawer.classList.contains('is-open') || drawer.matches(':focus-within');
                }), true, `${layer}: Jump did not reopen after the cooldown`);
                await page.keyboard.press('Escape');
                await page.locator('#sectionJumpHandle').evaluate(handle => handle.blur());
                if (layer === 'L' || layer === 'X') {
                    await open();
                    const bounds = await page.locator(`#${closeId}`).boundingBox();
                    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] });
                    await page.waitForTimeout(550);
                    assert.equal(await page.locator(`#${overlayId}`).isVisible(), true, `${layer}: editor disappeared before finger release`);
                    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    await page.locator(`#${overlayId}`).waitFor({ state: 'hidden' });
                    assert.equal(await page.locator('#sectionJumpHandle').getAttribute('aria-expanded'), 'false');
                    await page.waitForFunction(() => !document.getElementById('sectionJumpDrawer').classList.contains('is-close-guarded'));
                    await page.waitForTimeout(220);
                }
                await open();
                await page.locator(`#${closeId}`).click();
                await page.locator(`#${overlayId}`).waitFor({ state: 'hidden' });
                await page.waitForFunction(() => !document.getElementById('sectionJumpDrawer').classList.contains('is-close-guarded'));
                checked.push(layer);
            }
            assert.equal(await page.evaluate(() => drumMachinePlaying && drumMachineTransportStartTime === window.editorCloseTransport.origin && modulationIntervalId === window.editorCloseTransport.modulation), true);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
            results.push({ viewport, pointerFallback, touchAndMouseClose: checked, delayedClicksBlocked: checked.length, longPressReleaseChecked: ['L', 'X'], transportUnchanged: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
