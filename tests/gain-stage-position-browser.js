const assert = require('node:assert/strict');
const fs = require('node:fs');
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
            for (const anchoring of ['auto', 'none']) {
                const context = await browser.newContext({ viewport, isMobile: viewport.width < 1000, hasTouch: true, reducedMotion: 'reduce' });
                const page = await context.newPage();
                page.setDefaultTimeout(30000);
                page.on('pageerror', error => errors.push(error.stack));
                await page.route('**/*', route => {
                    const request = route.request();
                    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                    if (new URL(request.url()).origin !== new URL(base).origin) return route.abort();
                    if (process.env.MYGRAIN_LEGACY_DIR && new URL(request.url()).pathname === new URL(base).pathname) {
                        return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(process.env.MYGRAIN_LEGACY_DIR, 'index.html'), 'utf8') });
                    }
                    return route.continue();
                });
                await page.goto(base, { waitUntil: 'load' });
                await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#performanceMixerSliderJumps button').length === 25);
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(anchoring => {
                    document.documentElement.style.overflowAnchor = anchoring;
                    window.testGainReport = count => ({
                        debugAvailable: true,
                        debug: null,
                        suggestions: Array.from({ length: count }, (unused, index) => ({
                            controlId: 'performanceMasterTrim',
                            label: `Master Trim ${index + 1}`,
                            score: 100 - index,
                            details: ['The output needs additional headroom. '.repeat(6), 'Reduce this level to leave space for the other sources. '.repeat(4)]
                        }))
                    });
                    window.testGainScrolls = [];
                    const scrollBy = window.scrollBy.bind(window);
                    window.scrollBy = options => { window.testGainScrolls.push(options); scrollBy(options); };
                    jumpToPerformanceMixerSlider('performanceBastardLoopQLevelMixer');
                }, anchoring);
                const slider = page.locator('#performanceBastardLoopQLevelMixer');
                const state = () => page.evaluate(() => ({
                    sliders: Array.from(document.querySelectorAll('#performanceMixerCard input[type="range"]'), control => [control.id, control.value]),
                    solos: Array.from(document.querySelectorAll('#performanceMixerCard .performance-mixer-solo-btn'), control => [control.id, control.getAttribute('aria-pressed')])
                }));
                const originalState = await state();
                const bounds = () => slider.boundingBox();
                const stable = async (before, label, focusId = 'performanceBastardLoopQLevelMixer') => {
                    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                    const after = await bounds();
                    assert.ok(Math.abs(after.y - before.y) <= 1, `${label} moved slider: ${JSON.stringify({ viewport, anchoring, before, after })}`);
                    assert.ok(Math.abs(after.x - before.x) <= 1, `${label} moved slider horizontally`);
                    assert.equal(await page.evaluate(() => document.activeElement.id), focusId);
                };
                const reportBounds = await bounds();
                for (const count of Array.from({ length: 32 }, (unused, index) => [0, 5, 1, 0][index % 4])) {
                    await page.evaluate(count => renderPerformanceGainStageAudit(window.testGainReport(count)), count);
                    await stable(reportBounds, `Report with ${count} warnings`);
                }
                assert.deepEqual(await state(), originalState);

                await page.evaluate(() => {
                    renderPerformanceGainStageAudit(window.testGainReport(5));
                    mixerGainStageHighlightsActive = true;
                });
                const keyboardBounds = await bounds();
                const keyboardLevel = Number(await slider.inputValue());
                await page.keyboard.press('ArrowRight');
                await stable(keyboardBounds, 'Clearing a stale report on keyboard input');
                assert.equal(Number(await slider.inputValue()), keyboardLevel + 1);
                assert.equal(await page.evaluate(() => mygrainQ.state.level), (keyboardLevel + 1) / 100);
                assert.equal(await page.locator('#performanceGainStageAuditList').innerText(), '');
                await page.keyboard.press('ArrowLeft');
                assert.deepEqual(await state(), originalState);

                const dragBounds = await bounds();
                await page.mouse.move(dragBounds.x + dragBounds.width / 2, dragBounds.y + dragBounds.height / 2);
                await page.mouse.down();
                await page.mouse.move(dragBounds.x + dragBounds.width / 2 + 15, dragBounds.y + dragBounds.height / 2);
                const dragLevel = Number(await slider.inputValue());
                const beforeDragReport = await bounds();
                await page.evaluate(() => renderPerformanceGainStageAudit(window.testGainReport(5)));
                await stable(beforeDragReport, 'Warning growth during native slider drag');
                await page.mouse.move(dragBounds.x + dragBounds.width / 2 + 40, dragBounds.y + dragBounds.height / 2);
                await page.mouse.up();
                assert.ok(Number(await slider.inputValue()) > dragLevel, 'Slider drag stopped responding after report update');
                assert.equal(await page.evaluate(() => mygrainQ.state.level), Number(await slider.inputValue()) / 100);

                const touchSession = await context.newCDPSession(page);
                const nativeTouchBounds = await bounds();
                const touchPoint = { x: nativeTouchBounds.x + nativeTouchBounds.width / 2, y: nativeTouchBounds.y + nativeTouchBounds.height / 2 };
                await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
                await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchPoint, x: touchPoint.x + 15 }] });
                const nativeTouchLevel = Number(await slider.inputValue());
                const beforeTouchReport = await bounds();
                const touchFocus = await page.evaluate(() => document.activeElement.id);
                await page.evaluate(() => renderPerformanceGainStageAudit(window.testGainReport(0)));
                await stable(beforeTouchReport, 'Warning collapse during native touch drag', touchFocus);
                await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchPoint, x: touchPoint.x + 50 }] });
                await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                assert.ok(Number(await slider.inputValue()) > nativeTouchLevel, 'Touch drag stopped responding after report update');
                assert.equal(await page.evaluate(() => mygrainQ.state.level), Number(await slider.inputValue()) / 100);
                await touchSession.detach();

                await page.evaluate(() => {
                    document.getElementById('performanceBastardLoopQLevelMixer').blur();
                    document.getElementById('performanceBastardLoopQLevelMixer').dispatchEvent(new Event('input', { bubbles: true }));
                });
                const touchState = await state();
                const touchBounds = await bounds();
                await page.evaluate(() => renderPerformanceGainStageAudit(window.testGainReport(0)));
                await stable(touchBounds, 'Unfocused touch-style input', '');
                assert.deepEqual(await state(), touchState);

                await page.evaluate(() => {
                    jumpToPerformanceMixerSlider('performanceBastardLoopQLevelMixer');
                    window.scrollBy({ top: window.innerHeight + 100, behavior: 'instant' });
                    window.testGainScrolls.length = 0;
                    renderPerformanceGainStageAudit(window.testGainReport(5));
                });
                assert.equal(await page.evaluate(() => window.testGainScrolls.length), 0, 'Manual scrolling off the slider must not snap back');

                await page.evaluate(() => {
                    renderPerformanceGainStageAudit(window.testGainReport(1));
                    document.getElementById('performanceGainStageAuditList').scrollIntoView({ block: 'start', behavior: 'instant' });
                });
                const beforeJump = await state();
                await page.locator('#performanceGainStageAuditList [data-gain-stage-control]').click();
                await page.waitForFunction(() => document.activeElement.id === 'performanceMasterTrim');
                const targetBounds = await page.locator('#performanceMasterTrim').boundingBox();
                assert.ok(targetBounds.y >= 0 && targetBounds.y + targetBounds.height <= viewport.height, 'Explicit Open slider must still navigate');
                assert.deepEqual(await state(), beforeJump);

                await page.evaluate(() => {
                    const buffer = audioContext.createBuffer(1, audioContext.sampleRate / 10, audioContext.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let frame = 0; frame < data.length; frame += 1) data[frame] = 0.02 * Math.sin(frame * Math.PI * 2 * 120 / buffer.sampleRate);
                    drumMachineKickBuffer = buffer;
                    setDrumMachinePattern('kick', Array.from({ length: 16 }, (unused, index) => index % 4 === 0), { skipSave: true });
                    startDrumMachine(audioContext.currentTime + 0.1, { silent: true, skipSave: true });
                    window.testGainTransport = { origin: drumMachineTransportStartTime, modulation: modulationIntervalId };
                    jumpToPerformanceMixerSlider('performanceBastardLoopQLevelMixer');
                    window.testGainMonitorTicks = 0;
                    collectPerformanceGainStageSuggestions = () => window.testGainReport([0, 5, 1, 0][window.testGainMonitorTicks++ % 4]);
                    startPerformanceGainStageAuditMonitor();
                });
                const monitorBounds = await bounds();
                const monitorState = await state();
                for (let tick = 2; tick <= 7; tick += 1) {
                    await page.waitForFunction(tick => window.testGainMonitorTicks >= tick, tick);
                    await stable(monitorBounds, `Live monitor tick ${tick}`);
                }
                assert.deepEqual(await state(), monitorState);
                assert.equal(await page.evaluate(() => drumMachinePlaying && drumMachineTransportStartTime === window.testGainTransport.origin && modulationIntervalId === window.testGainTransport.modulation), true);
                await page.evaluate(() => stopDrumMachine({ silent: true, skipSave: true }));
                await page.waitForFunction(() => performanceGainStageAuditMonitorTimer === null);
                await stable(monitorBounds, 'Playback stopped message');
                await page.evaluate(() => runPerformanceGainStageAudit({ announce: false }));
                await stable(monitorBounds, 'Clearing stopped playback report');
                assert.deepEqual(await state(), monitorState);
                results.push({ viewport, anchoring, reportGrowthAndCollapse: true, nativeMouseTouchAndKeyboard: true, unfocusedTouchInput: true, explicitNavigation: true, liveMonitor: true, unchangedPlaybackTransport: true });
                await context.close();
            }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
